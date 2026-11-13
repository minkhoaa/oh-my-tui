import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { TuiAltScreen, CURSOR_MARKER, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import omt from "../extensions/omt/index.ts";
import { configStore } from "../extensions/omt/core/config.ts";
import { motionCoordinator, setActiveTui } from "../extensions/omt/core/motion.ts";
import { resetActiveTheme, setActiveTheme } from "../extensions/omt/core/theme.ts";
import { createBackgroundControl } from "../extensions/omt/features/backgrounds/integration.ts";
import { createSettingsComponent } from "../extensions/omt/features/settings-ui/index.ts";

function host() {
  const terminal = { columns: 80, rows: 24, write() {}, hideCursor() {}, showCursor() {}, stop() {} };
  const tui = new TuiAltScreen(terminal as any, true), native = tui as any;
  native.altScreenActive = true; native.stopped = false;
  const renderRequests: boolean[] = [];
  const requestRender = tui.requestRender.bind(tui);
  tui.requestRender = (force = false) => { renderRequests.push(force); requestRender(force); };
  const lines = ["Header", "", "  界 linked transcript", "", `Editor ${CURSOR_MARKER}draft`, "Footer"];
  tui.addChild({ render: () => lines, invalidate() {} });
  const notices: string[] = [];
  const ctx = { cwd: "", mode: "tui", hasUI: true, ui: { getBackgroundTui: () => tui, setWidget() {}, notify: (message: string) => notices.push(message) } } as any;
  return { tui, native, terminal, lines, ctx, notices, renderRequests };
}
function image(path: string, animated = false) {
  const result = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=32x24:rate=5", ...(animated ? ["-t", "0.6", "-loop", "0"] : ["-frames:v", "1"]), "-threads", "1", "-y", path]);
  assert.equal(result.status, 0, result.stderr?.toString());
}

test("all imported types use native fullscreen pipeline through commands; switching, pause, reduced motion, resize and cleanup", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omt-background-integration-"));
  const { tui, native, terminal, ctx, notices, renderRequests } = host(); ctx.cwd = dir;
  const events = new Map<string, Function>(); let command: any;
  const originalFetch = globalThis.fetch;
  const originalHook = native.applySearchHighlights;
  try {
    globalThis.fetch = (() => { throw new Error("No network permitted"); }) as any;
    configStore.init(dir); configStore.setAnimationOverride("reducedMotion", "normal");
    setActiveTheme("codex-inspired");
    omt({ registerFlag() {}, registerToolRenderer() {}, registerCommand(name: string, registered: unknown) { if (name === "omt") command = registered; }, on(name: string, handler: Function) { events.set(name, handler); }, getFlag() {} } as any);
    image(join(dir, "two  spaces.png")); image(join(dir, "animation.gif"), true);
    writeFileSync(join(dir, "scene.json"), JSON.stringify({ version: 1, type: "scene", name: "Terminal stars", scene: { layers: [{ scene: "starfield" }, { scene: "particles" }] } }));
    for (const path of ["two  spaces.png", "animation.gif", "scene.json"]) await command.handler(`background upload "${path}"`, ctx);
    assert.equal(configStore.assets.list().length, 3, notices.join("\n"));
    writeFileSync(join(dir, "malformed.json"), '{"name": "\x1b]52;escape\x07"');
    await command.handler("background upload malformed.json", ctx);
    assert(!/[\x00-\x1f\x7f-\x9f]/.test(notices.at(-1)!), "parser errors cannot inject terminal controls");
    await command.handler("background list", ctx);
    assert(notices.at(-1)!.includes("two  spaces.png"));
    assert(notices.at(-1)!.includes("moonlit"));
    assert(notices.at(-1)!.includes("Built-in library"));

    // Built-in library background selection by alias
    await command.handler("background select moonlit", ctx);
    assert.equal(configStore.getEffectiveBackgroundAsset(), configStore.assets.resolveId("moonlit"));
    native.doRender();
    assert.equal(motionCoordinator.hasActive(), true);
    await command.handler("background remove moonlit", ctx);
    assert.match(notices.at(-1)!, /cannot be deleted/);
    for (const asset of configStore.assets.list()) {
      const forcedBefore = renderRequests.filter(Boolean).length;
      await command.handler(`background select ${asset.id}`, ctx);
      assert(renderRequests.filter(Boolean).length > forcedBefore, "binding repaints native foreground once instead of reusing stale startup/resize diff state");
      native.doRender();
      const rows = tui.getScreenLines();
      assert.equal(rows.length, 24); assert(rows.every(row => visibleWidth(row) === 80));
      assert(rows.some(row => stripTerminalSequences(row).includes("界 linked transcript")));
      assert.equal(native.currentLayout.lines[2], "  界 linked transcript");
      assert.equal(motionCoordinator.hasActive(), asset.kind !== "image");
      if (asset.kind !== "image") {
        configStore.setBackgroundOverride("fps", 5);
        assert.equal((motionCoordinator as any).scheduledInterval, 200);
        motionCoordinator.register("tool:cadence-check");
        assert.equal((motionCoordinator as any).scheduledInterval, 50);
        motionCoordinator.clearTransient();
        assert.equal((motionCoordinator as any).scheduledInterval, 200, "one scheduler slows back down when foreground motion ends");
        configStore.setBackgroundOverride("fps", 15);
      }
      await command.handler("background pause", ctx); assert.equal(motionCoordinator.hasActive(), false);
      // Agent completion must not undo an explicit user pause.
      assert.ok(events.has("agent_settled"));
      await events.get("agent_settled")!({}, ctx); assert.equal(configStore.getBackground().playing, false);
      await command.handler("background resume", ctx);
      configStore.setAnimationOverride("reducedMotion", "reduced"); assert.equal(motionCoordinator.hasActive(), false);
      configStore.setAnimationOverride("reducedMotion", "normal");
      terminal.columns = 40; terminal.rows = 16; native.doRender();
      assert.equal(tui.getScreenLines().length, 16); assert(tui.getScreenLines().every(row => visibleWidth(row) <= 40));
      terminal.columns = 80; terminal.rows = 24;
      await command.handler("theme native", ctx); assert.equal(motionCoordinator.hasActive(), false);
      await command.handler("theme codex", ctx); native.doRender();
    }
    await command.handler("background fps 5", ctx); assert.equal(configStore.getBackground().fps, 5);
    await command.handler("background fit tile", ctx); assert.equal(configStore.getBackground().fit, "tile");
    await command.handler("background mode invalid", ctx); assert.match(notices.at(-1)!, /Invalid/);
    await command.handler("background remove ../escape", ctx); assert.match(notices.at(-1)!, /Invalid/);
    const id = configStore.assets.list()[0]!.id;
    configStore.selectBackgroundAsset(id, true); assert(configStore.saveCurrentAsDefaults());
    configStore.selectBackgroundAsset(null); assert.equal(configStore.getEffectiveBackgroundAsset(), null, "global selection clears active saved assignment");
    configStore.init(dir); assert.equal(configStore.getEffectiveBackgroundAsset(), id);
    await command.handler(`background remove ${id}`, ctx); configStore.init(dir);
    assert.equal(configStore.getEffectiveBackgroundAsset(), null);
    await command.handler("background reset", ctx);
    await command.handler("background off", ctx); assert.equal(native.applySearchHighlights, originalHook);
    assert.equal(motionCoordinator.hasActive(), false);
  } finally {
    await events.get("session_shutdown")?.({}, ctx);
    motionCoordinator.dispose(); setActiveTui(undefined); resetActiveTheme(); tui.stop();
    globalThis.fetch = originalFetch; rmSync(dir, { recursive: true, force: true });
  }
});

test("settings picker previews all types, assigns per-preset and persists controls through one ConfigStore", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omt-background-settings-"));
  const { tui, ctx } = host();
  const control = createBackgroundControl();
  const noOp = { on: () => "", off: () => "", applyTheme() {} };
  const theme = { fg: (_: string, text: string) => text, bold: (text: string) => text, dim: (text: string) => text } as any;
  try {
    configStore.init(dir); setActiveTheme("codex-inspired");
    image(join(dir, "image.png"));
    const asset = await configStore.assets.importFile(join(dir, "image.png"));
    const settings = createSettingsComponent({ requestRender() {} }, theme, {} as any, () => {}, ctx, { editor: noOp, messages: noOp, tools: noOp, footer: noOp, thinking: noOp, background: control, applyTheme: () => "" });
    const list = (settings as any).children[3];
    const activate = (id: string) => { list.selectItem(id); settings.handleInput("\r"); };
    activate("background-assignment"); activate("background-asset");
    assert.equal(configStore.getBackground().presetAssets["codex-inspired"], asset.id);
    assert(settings.render(80).join("\n").includes("▀"), "settings includes a real image preview");
    assert.equal(configStore.getBackground().textureScale, 1);
    activate("background-texture-scale");
    assert.equal(configStore.getBackground().textureScale, 1.5);
    activate("background-fit"); activate("background-fps"); activate("background-playback");
    assert.equal(configStore.getBackground().fit, "contain"); assert.equal(configStore.getBackground().fps, 20);
    assert.equal(configStore.getBackground().playing, false);
    activate("save-defaults"); configStore.init(dir);
    assert.equal(configStore.getEffectiveBackgroundAsset(), asset.id); assert.equal(configStore.getBackground().fit, "contain");
    assert.equal(configStore.getBackground().textureScale, 1.5);
    configStore.setPresetOverride("minimal"); assert.equal(configStore.getEffectiveBackgroundAsset(), null);
  } finally { control.cleanup(ctx); motionCoordinator.dispose(); setActiveTui(undefined); configStore.clearSessionOverrides(); resetActiveTheme(); tui.stop(); rmSync(dir, { recursive: true, force: true }); }
});
