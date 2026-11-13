import assert from "node:assert/strict";
import { test } from "node:test";
import { FooterComponent, InteractiveMode, SessionManager, initTheme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { readDisplayUsage } from "../extensions/omt/core/usage.ts";
import { motionCoordinator } from "../extensions/omt/core/motion.ts";
import { observeNativeUIOwnership } from "../extensions/omt/core/native-ui.ts";
import { createHeaderControl } from "../extensions/omt/features/header/index.ts";
import { readSidebarMetadata } from "../extensions/omt/features/sidebar/observations.ts";
import { createSidebarControl } from "../extensions/omt/features/sidebar/index.ts";
import { createSidebarComponent } from "../extensions/omt/features/sidebar/view.ts";
import { extractSidebarState, renderSidebar } from "../extensions/omt/features/sidebar/model.ts";
import { CleanFooterComponent, createFooterControl } from "../extensions/omt/features/footer/index.ts";
import { formatSignatureStatsLine } from "../extensions/omt/presets/omt-signature/editor.ts";
import { resetActiveTheme, setActiveTheme } from "../extensions/omt/core/theme.ts";

function theme() {
  initTheme("dark");
  return (InteractiveMode.prototype as any).createExtensionUIContext.call({}).theme;
}
const usage = { input: 1000, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 1010, cost: { input: 0.03, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.03 } };
const assistant = { role: "assistant", api: "openai-completions", provider: "test", model: "offline", content: [], usage, stopReason: "stop", timestamp: 1 } as any;

test("display accounting matches the real native footer across message, tool, warming and summary usage", () => {
  const sm = SessionManager.inMemory("/isolated");
  const entry = sm.appendMessage(assistant);
  sm.appendUsage("cache_warm", "test", "offline", usage);
  sm.appendMessage({ role: "toolResult", toolCallId: "t", toolName: "subagent", content: [], isError: false, timestamp: 2, usage });
  sm.appendCompaction("summary", entry, 1000, undefined, false, usage);
  const totals = readDisplayUsage(sm.getEntries());
  const native = new FooterComponent({ sessionManager: sm, getContextUsage: () => ({ tokens: null, percent: null, contextWindow: 1000 }) } as any, {} as any);
  const expected = (native as any).getSessionStats().usageTotals;
  assert.deepEqual({ input: totals.input, output: totals.output, cacheRead: totals.cacheRead, cacheWrite: totals.cacheWrite, cost: totals.cost }, expected);
  assert.equal(totals.totalTokens, 4040);
  assert.equal(readDisplayUsage([]).cost, undefined, "missing billing data stays unknown");

  const ctx = { cwd: "/isolated", model: { id: "offline", contextWindow: 1000 }, sessionManager: sm, getContextUsage: () => ({ tokens: null, percent: null, contextWindow: 1000 }) } as any;
  setActiveTheme("omt-signature");
  try {
    const footer = new CleanFooterComponent({ requestRender() {} } as any, theme(), {} as any, () => ctx, () => undefined, () => 0);
    const rendered = stripTerminalSequences(footer.render(100)[0]!);
    assert.match(rendered, /offline.*ctx \?.*4\.0k.*\$0\.12/);
    for (const width of [1, 2, 8, 20, 40, 100]) assert.ok(footer.render(width).every(row => visibleWidth(row) <= width));
    footer.dispose();
  } finally { resetActiveTheme(); }
});

test("footer usage cache notices append-only warming entries without a tool or message event", (t) => {
  const palette = theme();
  const sm = SessionManager.inMemory("/isolated");
  const scan = t.mock.method(sm, "getEntries");
  let factory: any;
  const ctx = { mode: "tui", cwd: "/isolated", model: { id: "offline" }, sessionManager: sm, ui: {
    theme: palette, getFooterComponent: () => factory, setFooter: (value: unknown) => { factory = value; },
  } } as any;
  const control = createFooterControl({ on() {}, getSettings: () => ({ outputPad: 0 }) } as any);
  setActiveTheme("omt-signature");
  try {
    control.on(ctx);
    const component = factory({ requestRender() {} }, palette, {});
    // Signature footer is intentionally empty (integrated into composer)
    assert.equal(component.render(80).length, 0, "standalone Signature footer is empty");

    // control.getUsage(ctx) provides the cached accounting source used by composer
    assert.ok(control.getUsage, "footer control must expose getUsage");
    const initialUsage = control.getUsage(ctx);
    const cachedUsage = control.getUsage(ctx);
    assert.equal(scan.mock.callCount(), 1, "animation frames reuse accounting");
    assert.deepEqual(cachedUsage, initialUsage);

    // Native warming cache update invalidates leaf and updates cached stats
    sm.appendUsage("cache_warm", "test", "offline", usage);
    const updatedUsage = control.getUsage(ctx);
    assert.equal(scan.mock.callCount(), 2, "leaf movement invalidates without a lifecycle event");
    assert.equal(updatedUsage?.totalTokens, 1010);
    assert.equal(updatedUsage?.cost, 0.03);

    // Composer statusline metadata consumes cached source
    const stats = formatSignatureStatsLine({ model: ctx.model?.id, totalTokens: updatedUsage?.totalTokens, cost: updatedUsage?.cost });
    assert.match(stats, /1\.0k.*\$0\.03/);
    if (typeof (component as any).dispose === "function") (component as any).dispose();
  } finally { control.cleanup?.(ctx); resetActiveTheme(); }
});

test("dashboard observations use successful active-branch snapshots without invoking owners", (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("UI must not use network"); });
  const sm = SessionManager.inMemory("/isolated");
  const root = sm.appendMessage({ role: "user", content: "hi", timestamp: 0 });
  sm.appendMessage({ ...assistant, content: [
    { type: "toolCall", id: "todo", name: "manage_todo_list", arguments: {} },
    { type: "toolCall", id: "skill", name: "read", arguments: { path: "skills/check/SKILL.md" } },
  ] });
  sm.appendMessage({ role: "toolResult", toolCallId: "todo", toolName: "manage_todo_list", content: [], details: { todos: [{ title: "check UI", status: "in_progress" }] }, isError: false, timestamp: 2 });
  sm.appendMessage({ role: "toolResult", toolCallId: "skill", toolName: "read", content: [], isError: false, timestamp: 3 });
  sm.appendMessage({ role: "toolResult", toolCallId: "lsp", toolName: "lsp_diagnostics", content: [{ type: "text", text: "src/a.ts:1:2 error: example" }], isError: false, timestamp: 4 });
  const pi = {
    getCommands: () => [{ name: "skill:check", source: "skill", sourceInfo: { path: "/isolated/skills/check/SKILL.md" } }],
    getSettings: () => ({ compaction: { enabled: true }, packages: ["npm:pi-tasks"] }),
    getMcpServers: () => [{ name: "docs" }],
  } as any;
  const ctx = { cwd: "/isolated", sessionManager: sm, isIdle: () => true } as any;
  const meta = readSidebarMetadata(pi, ctx);
  assert.deepEqual(meta.todos, [{ label: "● check UI", detail: undefined }]);
  assert.deepEqual(meta.skills, [{ label: "check" }]);
  assert.match(meta.lsp![0]!.label, /src\/a.ts/);
  assert.equal(meta.commands?.skill, 1);
  assert.equal(meta.commands?.builtin, undefined, "public catalogue excludes native commands");
  assert.match(meta.mcp![0]!.detail!, /connection unknown/);
  sm.branch(root);
  const other = readSidebarMetadata(pi, ctx);
  assert.equal(other.todos, undefined);
  assert.equal(other.skills, undefined, "abandoned branch observations must not leak");
  assert.equal(other.lsp, undefined);
  const state = extractSidebarState(ctx, other);
  assert.equal(state.context?.percent, undefined, "unknown context must not be drawn as 0%");
  assert.equal(state.workspace?.ok, false, "no fabricated clean Git state");
});

test("dashboard companion never docks over transcript, is idempotent and makes retained widgets inert", () => {
  let mounts = 0;
  let factory: any;
  const ctx = { mode: "tui", hasUI: true, cwd: "/isolated", sessionManager: SessionManager.inMemory("/isolated"), ui: {
    custom() { throw new Error("persistent companion must not create an overlay"); },
    setWidget(_key: string, value: any) { mounts++; factory = value; },
  } } as any;
  const control = createSidebarControl();
  control.on(ctx);
  control.on(ctx);
  assert.equal(mounts, 1);
  const widget = factory({}, theme());
  assert.equal(widget.render(80).length, 2);
  control.off(ctx);
  assert.deepEqual(widget.render(80), []);
  control.cleanup?.(ctx);
  assert.equal(mounts, 2, "repeated cleanup does not clear newer surfaces");
});

test("dashboard viewport preserves its frame, refreshes and disposes without calling done twice", () => {
  const t = theme();
  const before = motionCoordinator.activeCount();
  let done = 0;
  let snapshot = { session: { firstPrompt: "old branch" } };
  const component = createSidebarComponent({ terminal: { rows: 25 }, requestRender() {} } as any, t, undefined, () => done++, {} as any, {
    viewportHeight: 8, getState: () => snapshot,
  });
  try {
    for (const width of [0, 1, 2, 3, 8, 18, 34, 80]) {
      const lines = component.render(width);
      assert.ok(lines.length <= 8);
      assert.ok(lines.every(row => visibleWidth(row) <= width));
    }
    snapshot = { session: { firstPrompt: "new branch" } };
    component.handleInput("j");
    component.handleInput("j");
    assert.match(component.render(80).map(stripTerminalSequences).join("\n"), /new branch/);
    for (let i = 0; i < 200; i++) component.handleInput("j");
    const tail = component.render(34).map(stripTerminalSequences);
    assert.match(tail[0]!, /^╭/);
    assert.match(tail.at(-1)!, /^╰/);
    assert.match(tail.join("\n"), /WORKSPACE/);
    component.handleInput("q");
    component.dispose();
    assert.equal(done, 1);
    assert.deepEqual(component.render(34), []);
  } finally { component.dispose(); }
  assert.equal(motionCoordinator.activeCount(), before);
  for (const width of [0, 1, 2, 3, 4]) assert.ok(renderSidebar({}, width).every(row => visibleWidth(row) <= width));
});

test("header ownership observations fail closed and disable/theme changes leave foreign owners intact", () => {
  const restore = observeNativeUIOwnership();
  assert.ok(restore);
  const palette = theme();
  let header: unknown;
  let mounts = 0;
  const ctx = { mode: "tui", ui: {
    theme: palette,
    getHeaderComponent: () => header,
    setHeader(value: unknown) { header = value; mounts++; },
  } } as any;
  const control = createHeaderControl();
  try {
    const known = (InteractiveMode.prototype as any).createExtensionUIContext.call({ customHeader: "observed" });
    assert.equal(known.getHeaderComponent(), "observed");
    const unknown = (InteractiveMode.prototype as any).createExtensionUIContext.call({});
    assert.equal(unknown.getHeaderComponent, undefined, "missing host storage must not look like an unowned header");
    setActiveTheme("omt-signature");
    control.on(ctx);
    assert.equal(mounts, 1);
    const foreign = { render() { return ["foreign header"]; } };
    header = foreign;
    control.off(ctx);
    control.on(ctx);
    setActiveTheme("native");
    control.applyTheme(ctx);
    control.cleanup(ctx);
    assert.equal(header, foreign);
    assert.equal(mounts, 1);
    assert.match(control.on({ mode: "tui", ui: { setHeader() { throw new Error("unsupported host"); } } } as any), /unavailable/);
  } finally { restore(); resetActiveTheme(); }
});
