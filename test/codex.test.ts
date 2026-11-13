import assert from "node:assert/strict";
import { test } from "node:test";
import { AssistantMessageComponent, InteractiveMode, UserMessageComponent, initTheme,
  type ExtensionAPI, type ExtensionContext, type Theme, type ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Container, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { blend, CODEX_COMMIT, codexAccent, codexActivity, codexElapsed, codexOutputPreview, codexPanel, codexSummary, setCodexPalette } from "../extensions/omt/presets/codex-inspired/rendering.ts";
import { createCleanBashRenderer, createCleanEditRenderer, createCleanReadRenderer, createCleanWriteRenderer, determineToolState } from "../extensions/omt/features/tools/index.ts";
import { createThinkingControl } from "../extensions/omt/features/thinking/index.ts";
import { createUserMessageControl } from "../extensions/omt/features/user-message/index.ts";
import { observeNativeUIOwnership, observeWorkingRender } from "../extensions/omt/core/native-ui.ts";
import { getActiveTheme, resetActiveTheme, setActiveTheme } from "../extensions/omt/core/theme.ts";
import { formatFooterLine } from "../extensions/omt/features/footer/index.ts";

const proto = InteractiveMode.prototype as unknown as { createExtensionUIContext(this: unknown): { theme: Theme } };
const plain = (rows: string[]) => rows.map(stripTerminalSequences).map((line) => line.trimEnd());
function theme() { initTheme("dark"); setActiveTheme("codex-inspired"); return proto.createExtensionUIContext.call({}).theme; }
function context() {
  return { args: {}, state: {}, cwd: "/tmp", outputPad: 1, isPartial: true, isError: false,
    keyText: () => "ctrl+o", keyHint: (_: string, text: string) => `ctrl+o ${text}` } as unknown as Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];
}

test("pinned source palette: 12% white/4% black blend, integer truncation and transparent unknown background", () => {
  const t = theme();
  assert.equal(CODEX_COMMIT, "086ccc833bc9cf01024ad2dd6af7dbd421b6bf9a");
  assert.deepEqual(blend([255, 255, 255], [0, 0, 0], 0.12), [30, 30, 30]);
  try {
    setCodexPalette({ background: { r: 0, g: 0, b: 0 } });
    assert.match(codexPanel(t, "panel"), /48;2;30;30;30/);
    assert.match(codexPanel(t, "panel", true), /48;2;40;40;40/);
    assert.match(codexAccent(t, "Read"), /38;2;99;168;248/);
    setCodexPalette({ background: { r: 255, g: 255, b: 255 } });
    assert.match(codexPanel(t, "panel"), /48;2;244;244;244/);
    assert.match(codexPanel(t, "panel", true), /48;2;249;249;249/);
    assert.match(codexAccent(t, "Read"), /38;2;28;100;200/);
    setCodexPalette({});
    assert.equal(codexPanel(t, "panel"), "panel");
  } finally { setCodexPalette({}); }
});

test("source animation frames: 600ms delay, 1s cosine sweep, 4s cadence; whole graphemes and 600ms fallback", () => {
  const t = theme();
  setCodexPalette({ foreground: { r: 200, g: 200, b: 200 }, background: { r: 0, g: 0, b: 0 } });
  try {
    const initial = codexSummary(t, "Working", 0);
    assert.equal(codexSummary(t, "Working", 599), initial);
    assert.notEqual(codexSummary(t, "Working", 1100), initial);
    assert.deepEqual([...codexSummary(t, "Working", 1100).matchAll(/38;2;(\d+);/g)].map((match) => Number(match[1])), [100, 125, 175, 200, 175, 125, 100], "cosine band against #c8c8c8 on black");
    assert.equal(codexSummary(t, "Working", 5100), codexSummary(t, "Working", 1100));
    assert.equal(codexSummary(t, "Working", 1600), codexSummary(t, "Working", 4500));
    const unicode = codexSummary(t, "é 👩🏽‍💻 你好", 1100);
    assert.equal(stripTerminalSequences(unicode), "é 👩🏽‍💻 你好");
    assert.ok(unicode.includes("👩🏽‍💻"), "no ANSI escapes inside a grapheme");
    assert.equal(codexActivity(t, 0), codexActivity(t, 2000));
    assert.notEqual(codexActivity(t, 0), codexActivity(t, 960));
    const fallback = { getColorMode: () => "256color" } as Theme;
    assert.equal(stripTerminalSequences(codexActivity(fallback, 599)), "•");
    assert.equal(stripTerminalSequences(codexActivity(fallback, 600)), "◦");
    assert.equal(stripTerminalSequences(codexActivity(fallback, 1200)), "•");
    assert.deepEqual([0, 59000, 60000, 3599000, 3600000, 7389000].map(codexElapsed), ["0s", "59s", "1m 00s", "59m 59s", "1h 00m 00s", "2h 03m 09s"]);
  } finally { setCodexPalette({}); }
});

test("tool_output.rs screen-row preview retains the head and counts partially visible logical lines", () => {
  assert.deepEqual(plain(codexOutputPreview("one\ntwo\nthree\nfour\nfive", 40, " (ctrl+o to expand)")), ["one", "two", "three", "+2 lines (ctrl+o to expand)"]);
  const long = codexOutputPreview("x".repeat(500000) + "\nlast", 20, "");
  assert.equal(long.length, 4);
  assert.equal(stripTerminalSequences(long[3]!), "+2 lines");
  for (const line of codexOutputPreview("你好👩🏽‍💻".repeat(100), 10, "")) assert.ok(visibleWidth(line) <= 10);
});

test("Codex command headers synchronize all outcomes, preserve full expansion and screen-row gutters", () => {
  resetActiveTheme();
  const t = theme(), renderer = createCleanBashRenderer(), ctx = context();
  const call = renderer.renderCall!({ command: "printf hello" }, t, ctx);
  assert.deepEqual(plain(call.render(80)), ["• Running printf hello"]);
  ctx.isPartial = false;
  const result = { content: [{ type: "text" as const, text: "one\ntwo\nthree\nfour\nfive" }], details: undefined };
  const row = renderer.renderResult!(result, { isPartial: false, expanded: false }, t, ctx);
  assert.deepEqual(plain(call.render(80)), ["• Ran printf hello"]);
  assert.deepEqual(plain(row.render(80)), ["  └ one", "    two", "    three", "    +2 lines (ctrl+o to expand)"]);
  const expanded = renderer.renderResult!(result, { isPartial: false, expanded: true }, t, ctx);
  assert.ok(plain(expanded.render(80)).includes("    five"));
  renderer.renderResult!({ ...result, details: { interrupted: true }, isError: true }, { isPartial: false, expanded: false }, t, ctx);
  assert.ok(plain(call.render(80))[0]!.startsWith("• Ran"));
  assert.match(call.render(80)[0]!, /38;5;1m|31m/);
  renderer.renderResult!({ ...result, details: { exitCode: 2 } }, { isPartial: false, expanded: false }, t, ctx);
  assert.ok(plain(call.render(80))[0]!.startsWith("• Ran"));
  assert.equal(determineToolState(false, false, undefined, "Documentation for SIGINT and interrupted calls"), "success");
  assert.equal(determineToolState(false, true, undefined, "Cannot read interrupted.txt"), "failure");
  assert.equal(determineToolState(false, true, { content: [], details: { exitCode: 137 } }), "failure", "SIGKILL alone does not prove user interruption");
  assert.equal(determineToolState(false, false, { content: [], details: { exitCode: 2 } }), "failure");
  const unicode = renderer.renderResult!({ content: [{ type: "text", text: "你好 👩🏽‍💻" }], details: undefined }, { isPartial: false, expanded: true }, t, context());
  for (const width of [1, 2, 5, 9, 10]) for (const line of unicode.render(width)) assert.ok(visibleWidth(line) <= width);
  const longCall = renderer.renderCall!({ command: "echo " + "你好 ".repeat(100) }, t, context());
  for (const width of [5, 10, 20, 40, 120]) {
    const lines = plain(longCall.render(width));
    assert.ok(lines.length <= 4);
    for (const line of lines) assert.ok(visibleWidth(line) <= width);
    if (width >= 10) assert.ok(lines.slice(1).every((line) => line.startsWith("  │ ") || line.startsWith("    …")));
  }
});

test("read exploration and file changes use hierarchy without duplicate result summaries", () => {
  const t = theme();
  for (const [name, renderer, args, result] of [
    ["read", createCleanReadRenderer(), { path: "file.ts" }, { content: [{ type: "text", text: "file contents" }] }],
    ["write", createCleanWriteRenderer(), { path: "file.ts", content: "hello\nworld\n" }, { content: [] }],
    ["edit", createCleanEditRenderer(), { path: "file.ts" }, { content: [], details: { diff: "-1 old\n+1 new" } }],
  ] as const) {
    const ctx = context(); ctx.args = args;
    const call = renderer.renderCall!(args, t, ctx);
    ctx.isPartial = false;
    const output = renderer.renderResult!(result as any, { isPartial: false, expanded: false }, t, ctx);
    const lines = plain(call.render(80));
    assert.ok(lines[0]!.startsWith(name === "read" ? "• Explored" : name === "write" ? "• Added file.ts (+2 -0)" : "• Edited file.ts (+1 -1)"));
    if (name === "read") { assert.equal(lines[1], "  └ Read file.ts"); assert.deepEqual(output.render(80), []); }
    const expanded = renderer.renderResult!(result as any, { isPartial: false, expanded: true }, t, ctx);
    assert.ok(expanded.render(80).length > 0);
    if (name === "edit") {
      assert.deepEqual(plain(expanded.render(80)), ["    1 -old", "    1 +new"]);
    }
  }
});

test("native assistant Markdown, reasoning clicks, zones and diagnostics survive Codex gutters and disable", () => {
  theme();
  const message = { role: "assistant", content: [{ type: "thinking", thinking: "Keep reasoning" }, { type: "text", text: "# Heading\n\n**bold**\n\n```ts\nconst x = 1;\n```" }], stopReason: "error", errorMessage: "fixture error" } as any;
  const before = structuredClone(message);
  const component = new AssistantMessageComponent(message);
  const native = component.render(80);
  const original = AssistantMessageComponent.prototype.render;
  const control = createUserMessageControl();
  try {
    for (const width of [10, 20, 80, 120]) {
      const rows = component.render(width);
      for (const row of rows) assert.ok(visibleWidth(row) <= width);
      assert.ok(plain(rows).some((line) => line.startsWith("• Keep")));
      if (width >= 40) assert.ok(stripTerminalSequences(rows.join("\n")).includes("fixture error"));
    }
    component.setHideThinkingBlock(true);
    assert.ok(!component.render(80).join("").includes("Keep reasoning"));
    component.setHideThinkingBlock(false);
    control.off();
    assert.deepEqual(component.render(80), native);
    assert.deepEqual(message, before);
  } finally { control.cleanup?.(); }
  assert.equal(AssistantMessageComponent.prototype.render, original);
});

test("only the owned Codex working row uses Pi's 32ms clock; theme switches, disable and cleanup restore hooks", (t) => {
  theme(); setActiveTheme("codex-inspired");
  const restore = observeNativeUIOwnership()!;
  const host = Object.assign(Object.create(InteractiveMode.prototype), {
    workingMessage: undefined, workingIndicatorOptions: undefined, workingVisible: true,
    defaultWorkingMessage: "Working", defaultHiddenThinkingLabel: "Thinking...", hiddenThinkingLabel: "Thinking...",
    chatContainer: new Container(), statusContainer: new Container(), defaultEditor: { setWorkingStatusIndicator() {} }, editor: {},
    ui: { requestRender() {}, getClearOnShrink: () => false }, options: { tuiMode: "regular" }, runtimeHost: { session: { isStreaming: true } },
  });
  const ctx = { mode: "tui", ui: host.createExtensionUIContext() } as ExtensionContext;
  const callbacks = new Map<string, Function>();
  const control = createThinkingControl({ on: (name, fn) => { callbacks.set(name, fn); } } as ExtensionAPI);
  t.after(() => { host.clearStatusIndicator(); control.cleanup(ctx); restore(); resetActiveTheme(); });
  control.on(ctx); callbacks.get("agent_start")!({}, ctx);
  host.showWorkingStatusIndicator();
  assert.equal(host.activeStatusIndicator.intervalMs, 32);
  const rows = plain(host.statusContainer.render(80));
  assert.match(rows[1]!, /• Working \(0s/);
  callbacks.get("message_update")!({ message: { role: "assistant" }, assistantMessageEvent: { type: "thinking_delta" } }, ctx);
  assert.equal(host.workingMessage, "Working");
  setActiveTheme("minimal"); control.applyTheme(ctx);
  assert.deepEqual(host.activeStatusIndicator.frames, ["·"]);
  setActiveTheme("codex"); control.applyTheme(ctx);
  assert.equal(getActiveTheme().id, "codex-inspired");
  assert.equal(host.activeStatusIndicator.intervalMs, 32);
  const clock = host.activeStatusIndicator.intervalId;
  ctx.ui.setWorkingMessage("Foreign later");
  assert.ok(plain(host.statusContainer.render(80)).join("").includes("Foreign later"), "a later message owner must not be hidden by the Codex render hook");
  control.off(ctx);
  assert.ok(clock?._destroyed, "Pi disposes the 32ms clock when its indicator is disabled");
  assert.equal(host.workingMessage, "Foreign later");
  ctx.ui.setWorkingMessage();
  assert.equal(host.workingIndicatorOptions, undefined);
  assert.equal(host.activeStatusIndicator.frames.length, 10);
  const foreign = { frames: ["F"] }; ctx.ui.setWorkingIndicator(foreign);
  assert.match(control.on(ctx), /another extension/);
  control.cleanup(ctx);
  assert.equal(host.workingIndicatorOptions, foreign);
  host.clearStatusIndicator("working");
  assert.deepEqual(host.statusContainer.render(80), [], "completion leaves no stale working row");
});

test("Codex render hooks yield to foreign/incompatible shapes and never clobber later wrappers", () => {
  const assistant = AssistantMessageComponent.prototype;
  const original = assistant.render;
  assistant.render = function foreign() { return ["foreign"]; };
  const foreign = assistant.render;
  const control = createUserMessageControl();
  try { assert.equal(assistant.render, foreign); }
  finally { control.cleanup?.(); assistant.render = original; }
  const second = createUserMessageControl();
  const owned = assistant.render;
  assistant.render = function later(width) { return owned.call(this, width); };
  const later = assistant.render;
  second.cleanup?.();
  assert.equal(assistant.render, later);
  assistant.render = original;
  const host = InteractiveMode.prototype as any;
  const show = host.showWorkingStatusIndicator;
  host.showWorkingStatusIndicator = function incompatible() {};
  try { assert.equal(observeWorkingRender(() => "must not mount"), undefined); }
  finally { host.showWorkingStatusIndicator = show; }
});

test("working redraws reuse native Markdown caches; palette changes and disable still invalidate", (t) => {
  theme(); setActiveTheme("codex-inspired");
  const user = new UserMessageComponent("cached user");
  const assistant = new AssistantMessageComponent({ role: "assistant", content: [{ type: "text", text: "```ts\nconst x = 1;\n```" }], stopReason: "stop" } as any);
  const native = assistant.render(80);
  const control = createUserMessageControl();
  try {
    user.render(80); assistant.render(80);
    const userInvalidations = t.mock.method(user.children[0]!, "invalidate");
    const markdown = (assistant as any).contentContainer.children.find((child: any) => child.theme);
    const assistantInvalidations = t.mock.method(markdown, "invalidate");
    for (let frame = 0; frame < 100; frame++) { user.render(80); assistant.render(80); }
    assert.equal(userInvalidations.mock.callCount(), 0, "no per-frame user Markdown reparsing");
    assert.equal(assistantInvalidations.mock.callCount(), 0, "no per-frame assistant Markdown reparsing");
    setCodexPalette({ background: { r: 5, g: 6, b: 7 } });
    user.render(80);
    assert.equal(userInvalidations.mock.callCount(), 1);
    control.off();
    assert.deepEqual(assistant.render(80), native);
  } finally { control.cleanup?.(); setCodexPalette({}); }
});

test("Codex expanded-to-collapsed partial rows cannot retain a stale output component", () => {
  const t = theme(); setActiveTheme("codex-inspired"); const renderer = createCleanReadRenderer(), ctx = context();
  const result = { content: [{ type: "text" as const, text: "partial output" }], details: undefined };
  const expanded = renderer.renderResult!(result, { isPartial: true, expanded: true }, t, ctx);
  ctx.lastComponent = expanded;
  const collapsed = renderer.renderResult!(result, { isPartial: true, expanded: false }, t, ctx);
  assert.deepEqual(collapsed.render(80), []);
});

test("Codex footer uses remaining context, quiet metadata and no duplicate activity row", () => {
  const t = theme(); setActiveTheme("codex-inspired");
  const data = { branch: "main", extensionStatuses: [], modelId: "gpt-5", reasoning: true, thinkingLevel: "high", contextUsage: { percent: 14, contextWindow: 200000 } };
  assert.equal(stripTerminalSequences(formatFooterLine(100, t, data)), "  gpt-5 high · Context 86% left · main");
  for (const width of [1, 5, 10, 20, 40, 80, 120]) assert.ok(visibleWidth(formatFooterLine(width, t, data)) <= width);
});
