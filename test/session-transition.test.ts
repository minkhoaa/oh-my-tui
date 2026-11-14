import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  AgentSessionRuntime, createAgentSessionServices, createAgentSessionFromServices,
  createAgentSessionRuntime, InteractiveMode, ModelRuntime, SessionManager, SettingsManager,
  type CreateAgentSessionRuntimeFactory,
} from "@earendil-works/pi-coding-agent";
import { Container, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { installNativeSessionPresentation, installNativeSessionStatusPresentation } from "../extensions/omt/core/native-ui.ts";

const packageDir = fileURLToPath(new URL("../", import.meta.url));

for (const mode of ["regular", "fullscreen"] as const) {
  test(`real ${mode} /new batches every intermediate paint, reapplies owned palette and resets all session components`, async t => {
    const sandbox = await mkdtemp(join(tmpdir(), "omt-transition-"));
    const previousDir = process.env.PI_CODING_AGENT_DIR, previousOffline = process.env.PI_OFFLINE;
    process.env.PI_CODING_AGENT_DIR = sandbox;
    process.env.PI_OFFLINE = "1";
    t.mock.method(globalThis, "fetch", () => { throw new Error("No network during lifecycle verification"); });
    let host: any, runtime: AgentSessionRuntime | undefined, failCreation = false, showReplacementOverlay = false;
    let overlayPaints = 0;
    t.after(async () => {
      host?.stop();
      try { await runtime?.dispose(); } catch { /* A deliberately failed replacement has already disposed the old session. */ }
      if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousDir;
      if (previousOffline === undefined) delete process.env.PI_OFFLINE;
      else process.env.PI_OFFLINE = previousOffline;
      await rm(sandbox, { recursive: true, force: true });
    });
    const settingsManager = SettingsManager.inMemory({ packages: [packageDir], quietStartup: true, defaultProjectTrust: "never" });
    const modelRuntime = await ModelRuntime.create({
      authPath: join(sandbox, "auth.json"), modelsPath: join(sandbox, "models.json"),
      modelsStorePath: join(sandbox, "models-store.json"), allowModelNetwork: false, refreshOnCreate: false,
    });
    let nativePaints = 0;
    const create: CreateAgentSessionRuntimeFactory = async options => {
      if (host) {
        // Force the exact frame the old smoke test missed, AFTER Pi has reset
        // extension UI and invalidated the old context, BEFORE a new runtime exists.
        host.renderer.renderNow(true);
        if (showReplacementOverlay) {
          const overlay = host.renderer.showOverlay({ render: () => { overlayPaints++; return ["FOREIGN_REPLACEMENT_PROMPT"]; }, invalidate() {} }, { width: 30 });
          try { host.renderer.renderNow(true); }
          finally { overlay.hide(); }
        }
        await new Promise(resolve => setTimeout(resolve, 30));
        host.renderer.renderNow(true);
      }
      if (failCreation) throw new Error("intentional replacement failure");
      const services = await createAgentSessionServices({ ...options, settingsManager, modelRuntime,
        resourceLoaderOptions: { noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true },
      });
      const result = await createAgentSessionFromServices({ services, sessionManager: options.sessionManager, sessionStartEvent: options.sessionStartEvent });
      assert.deepEqual(result.extensionsResult.errors, []);
      return { ...result, services, diagnostics: services.diagnostics };
    };
    runtime = await createAgentSessionRuntime(create, { cwd: sandbox, agentDir: sandbox, sessionManager: SessionManager.inMemory(sandbox) });
    const terminal = { columns: 120, rows: 40, start() {}, stop() {}, write() {}, moveBy() {}, hideCursor() {}, showCursor() {},
      clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, clearProgress() {}, setProgramStatus() {}, clearProgramStatus() {},
    };
    host = new InteractiveMode(runtime, { terminal: terminal as any, tuiMode: mode });
    await host.init();
    const nativeRender = host.builtInHeader.render;
    host.builtInHeader.render = function (width: number) { nativePaints++; return nativeRender.call(this, width); };
    const originalPaint = Object.getPrototypeOf(host.renderer).doRender;
    assert.notEqual(host.renderer.doRender, originalPaint, "native renderer has the guarded paint transaction");
    const errors: string[] = [];
    host.showError = (message: string) => { errors.push(message); };
    const initialPrompt = runtime.session.systemPrompt;
    const initialTools = runtime.session.getActiveToolNames();
    for (let i = 0; i < 3; i++) {
      const oldSession = runtime.session;
      const oldHeader = host.customHeader, oldEditor = host.editor;
      await host.handleClearCommand();
      host.renderer.renderNow(true);
      assert.deepEqual(errors, []);
      assert.equal(nativePaints, 0, "not even a forced intermediate frame renders Pi's native header");
      assert.notEqual(runtime.session, oldSession);
      assert.notEqual(host.customHeader, oldHeader, "old header is released, not retained with a stale context");
      assert.notEqual(host.editor, oldEditor, "native session replacement really resets the editor");
      const ui = host.createExtensionUIContext();
      assert.match(ui.theme.name, /^omt-signature-host-/, "native post-bind theme reset does not leak through");
      const children = [...host.chatContainer.children];
      const status = host.chatContainer.render(80);
      assert.match(status.map(stripTerminalSequences).join("\n"), /✓ New session started/);
      assert.ok(status.join("").includes(ui.theme.fg("success", "✓")), "native /new status uses OMT success styling");
      assert.deepEqual(host.chatContainer.children, children, "no status/history reconstruction");
      for (const width of [1, 2, 10, 20, 40, 80]) {
        const nativeRows = Container.prototype.render.call(host.chatContainer, width);
        const omtRows = host.chatContainer.render(width);
        assert.deepEqual(omtRows.map(stripTerminalSequences), nativeRows.map(stripTerminalSequences), "status text, wrapping and padding remain native");
        assert.ok(omtRows.every((row: string) => visibleWidth(row) <= width));
      }
      assert.equal(runtime.session.systemPrompt, initialPrompt);
      assert.deepEqual(runtime.session.getActiveToolNames(), initialTools);
      assert.equal(runtime.session.messages.length, 0, "no model-facing messages injected");
    }
    let callbackPainted = false;
    await runtime.newSession({ withSession: async ctx => {
      assert.match(ctx.ui.theme.name!, /^omt-signature-host-/);
      // A potentially long callback must not keep the presentation locked.
      const count = host.renderer.fullRedraws;
      host.renderer.renderNow(true);
      assert.ok(host.renderer.fullRedraws > count);
      callbackPainted = true;
    } });
    assert.equal(callbackPainted, true);
    showReplacementOverlay = true;
    await runtime.newSession();
    assert.ok(overlayPaints > 0, "a foreign blocking overlay can render during replacement");
    showReplacementOverlay = false;
    const beforeCancel = runtime.session;
    const beforeSwitch = t.mock.method(runtime as any, "emitBeforeSwitch", async () => ({ cancelled: true }));
    assert.deepEqual(await runtime.newSession(), { cancelled: true });
    assert.equal(runtime.session, beforeCancel, "native cancellation is returned untouched");
    beforeSwitch.mock.restore();
    // Native selection must NOT be hidden by batching or status presentation.
    await runtime.session.prompt("/omt theme native");
    await host.handleClearCommand();
    host.renderer.renderNow(true);
    assert.ok(nativePaints > 0);
    assert.equal(host.customHeader, undefined);
    assert.doesNotMatch(host.createExtensionUIContext().theme.name, /^omt-signature-host-/);
    await runtime.session.prompt("/omt theme omt-signature");
    nativePaints = 0;
    // Rejection must unlock painting even when session_start never runs.
    failCreation = true;
    await assert.rejects(runtime.newSession(), /intentional replacement failure/);
    assert.equal(nativePaints, 0);
    assert.equal(host.renderer.doRender, originalPaint, "failed replacement restores the renderer immediately");
    assert.equal(runtime.newSession, AgentSessionRuntime.prototype.newSession);
    // Reinstall on the real, recognized host to check takeover and restoration
    // of retained wrappers without relying on a mock method's source shape.
    const ui = { getNativeSessionHost: () => host } as any;
    const owner = { ownsTheme: () => false, refreshTheme() {} };
    const binding = installNativeSessionPresentation(ui, owner)!;
    assert.ok(binding);
    const retained = host.renderer.doRender;
    const retainedNew = runtime.newSession;
    let foreignPaints = 0;
    const foreignPaint = function (this: any) { foreignPaints++; return retained.call(this); };
    host.renderer.doRender = foreignPaint;
    assert.equal(installNativeSessionPresentation(ui, owner), undefined, "do not capture a foreign renderer");
    binding.dispose();
    assert.equal(host.renderer.doRender, foreignPaint, "cleanup leaves foreign ownership intact");
    host.renderer.renderNow(true);
    assert.ok(foreignPaints > 0, "retained paint wrapper delegates after cleanup");
    await assert.rejects(retainedNew.call(runtime), /intentional replacement failure/, "retained session wrapper delegates the native call and its rejection unchanged");
    host.renderer.doRender = originalPaint;
  });
}

test("session paint boundary fails closed on unsupported/foreign methods", () => {
  const foreign = async () => ({ cancelled: true });
  const host = { runtimeHost: { newSession: foreign }, renderer: { doRender() {} }, themeController: { applyFromSettings() {} } };
  const ui = { getNativeSessionHost: () => host } as any;
  assert.equal(installNativeSessionPresentation(ui, { ownsTheme: () => false, refreshTheme() {} }), undefined);
  assert.equal(host.runtimeHost.newSession, foreign);
});

test("session status boundary leaves foreign rows/mouse/geometry untouched and retained wrappers inert", () => {
  const chat = new Container();
  const foreign = { render: () => ["✓ New session started"], invalidate() {} };
  chat.addChild(foreign);
  const ui = { getNativeChatContainer: () => chat } as any;
  const mouse = chat.handleMouse;
  const native = chat.render(30);
  const dispose = installNativeSessionStatusPresentation(ui, () => true, () => "must never replace a foreign row");
  assert.ok(dispose);
  assert.deepEqual(chat.render(30), native);
  assert.equal(chat.handleMouse, mouse);
  assert.ok(chat.render(30).every(line => visibleWidth(line) <= 30));
  const retained = chat.render;
  const other = () => ["foreign surface"];
  chat.render = other;
  dispose();
  assert.equal(chat.render, other);
  assert.deepEqual(retained.call(chat, 30), native);
});
