import assert from "node:assert/strict";
import { test } from "node:test";
import { AssistantMessageComponent, CustomEditor, InteractiveMode, ToolExecutionComponent, UserMessageComponent, initTheme, getSelectListTheme,
  type ExtensionAPI, type ExtensionContext, type Theme, type ToolRenderers, type KeybindingsManager as PiKeys } from "@earendil-works/pi-coding-agent";
import { Container, CURSOR_MARKER, KeybindingsManager, TUI_KEYBINDINGS, stripTerminalSequences, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { railBg, railCollapse, railScanner, railSpinner, railWrap } from "../extensions/omt/presets/omt-rail/rendering.ts";
import { THEME_NAMES, resolveThemeName } from "../extensions/omt/presets/index.ts";
import { getActiveTheme, resetActiveTheme, setActiveTheme } from "../extensions/omt/core/theme.ts";
import { createUserMessageControl } from "../extensions/omt/features/user-message/index.ts";
import { CleanEditor } from "../extensions/omt/features/editor/index.ts";
import { createCleanBashRenderer, createCleanEditRenderer, createCleanReadRenderer, createCleanWriteRenderer, determineToolState } from "../extensions/omt/features/tools/index.ts";
import { createThinkingControl } from "../extensions/omt/features/thinking/index.ts";
import { observeNativeUIOwnership } from "../extensions/omt/core/native-ui.ts";
import { formatFooterLine } from "../extensions/omt/features/footer/index.ts";

const proto = InteractiveMode.prototype as unknown as { createExtensionUIContext(this: unknown): { theme: Theme } };
const tui = { terminal: { rows: 32, columns: 80 }, requestRender() {} } as TUI;
const plain = (rows: string[]) => rows.map(stripTerminalSequences).map((line) => line.trimEnd());
function setup(t: { after(fn: () => void): void }, palette = "dark") {
  initTheme(palette); setActiveTheme("omt-rail"); t.after(resetActiveTheme);
  return proto.createExtensionUIContext.call({}).theme;
}
function context(args: unknown = {}) {
  return { args, state: {}, cwd: "/tmp", outputPad: 1, isPartial: true, isError: false, argsComplete: true, executionStarted: true,
    keyText: () => "ctrl+o", keyHint: (_: string, text: string) => `ctrl+o ${text}` } as unknown as Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];
}

test("OMT Rail ID, local light/dark palette and aliases", (t) => {
  let theme = setup(t);
  assert.equal(resolveThemeName("rail"), "omt-rail");
  assert.equal(setActiveTheme("rail").label, "OMT Rail");
  assert.ok(THEME_NAMES.includes("omt-rail"));
  assert.match(railBg(theme, "panel", "panel"), /48;2;20;20;20/);
  assert.match(railBg(theme, "element", "composer"), /48;2;30;30;30/);
  assert.match(railBg(theme, "added", railBg(theme, "addedNumber", "gutter") + "body"), /49m\x1b\[48;2;32;48;59mbody/, "native intraline/gutter resets restore the outer diff background");
  initTheme("light"); theme = proto.createExtensionUIContext.call({}).theme;
  assert.match(railBg(theme, "panel", "panel"), /48;2;250;250;250/);
  assert.match(railBg(theme, "element", "composer"), /48;2;245;245;245/);
});

test("source braille order, reduced motion and scanner positions/holds/trails", (t) => {
  const theme = setup(t);
  assert.deepEqual(Array.from({ length: 10 }, (_, i) => railSpinner(i * 80)), ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]);
  assert.equal(railSpinner(800), "⠋");
  assert.equal(railSpinner(40, false), "⋯");
  const frames = Array.from({ length: 54 }, (_, i) => plain([railScanner(theme, i * 40)])[0]);
  assert.equal(frames[0], "■⬝⬝⬝⬝⬝⬝⬝");
  assert.equal(frames[7], "⬝⬝■■■■■■");
  assert.equal(frames[17], "⬝⬝⬝⬝⬝⬝■■");
  assert.equal(frames[23], "■■■■■■⬝⬝");
  assert.equal(frames[53], "⬝⬝⬝⬝⬝⬝⬝⬝");
  assert.equal(railScanner(theme, 2160), railScanner(theme, 0));
  assert.notEqual(railScanner(theme, 8 * 40), railScanner(theme, 9 * 40));
  assert.equal(stripTerminalSequences(railScanner(theme, 50, false)), "⋯");
});

test("Rail shell preview uses first ten logical lines and a codepoint budget", (t) => {
  setup(t);
  const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
  assert.equal(railCollapse(lines, 80).output, lines.split("\n").slice(0, 10).join("\n") + "\n…");
  assert.equal(railCollapse("hello", 40).overflow, false);
  const long = railCollapse("😀".repeat(1000), 20);
  assert.equal(Array.from(long.output).length, 200);
  assert.equal(long.output.endsWith("…"), true);
});

test("Rail wrapping uses shell punctuation boundaries and never splits a grapheme", (t) => {
  setup(t);
  assert.deepEqual(plain(railWrap("$ printf 'one\\ntwo\\nthree'", 18)), ["$ printf 'one\\ntwo", "\\nthree'"]);
  const text = "你好 é 👩🏽‍💻 🇻🇳".repeat(10);
  for (const width of [2, 3, 10, 20, 40]) {
    const rows = railWrap(text, width);
    assert.equal(rows.join(""), text);
    for (const row of rows) assert.ok(visibleWidth(row) <= width);
  }
});

test("native message bodies, zones, caches and restoration survive Rail rails and cross-preset switches", (t) => {
  const theme = setup(t);
  const user = new UserMessageComponent("hello **world** 你好\n\nsecond paragraph");
  const assistant = new AssistantMessageComponent({ role: "assistant", content: [{ type: "text", text: "hello **world**\n\n```ts\nconst x = 1;\n```" }], stopReason: "stop" } as any);
  const nativeUser = user.render(80), nativeAssistant = assistant.render(80);
  const original = UserMessageComponent.prototype.render;
  const control = createUserMessageControl(() => theme);
  t.after(() => { control.cleanup?.(); assert.equal(UserMessageComponent.prototype.render, original); });
  const rows = user.render(80), prose = assistant.render(80);
  assert.equal(plain(rows)[1]!.indexOf("hello"), 5);
  assert.ok(plain(rows).every((line) => line.indexOf("┃") === 2));
  assert.match(rows[1]!, /48;2;20;20;20/);
  assert.match(rows[1]!, /38;2;92;156;245/); // default build agent: secondary, not primary
  assert.ok(rows[0]!.includes("\x1b]133;A\x07"));
  assert.ok(rows.at(-1)!.includes("\x1b]133;C\x07"));
  assert.ok(plain(prose).some((line) => line.startsWith("     hello")));
  assert.ok(!plain(prose).some((line) => line.includes("•")));
  const markdown = user.children[0]!;
  const invalidate = t.mock.method(markdown, "invalidate");
  for (let i = 0; i < 100; i++) user.render(80);
  assert.equal(invalidate.mock.callCount(), 0, "clock redraws reuse Markdown caches");
  for (const name of ["omt-clean", "minimal", "native", "omt-rail"] as const) {
    setActiveTheme(name); control.applyTheme?.();
    for (const width of [10, 20, 40, 80, 120, 160, 40]) {
      for (const line of [...user.render(width), ...assistant.render(width)]) assert.ok(visibleWidth(line) <= width);
    }
  }
  control.off();
  assert.deepEqual(user.render(80), nativeUser);
  assert.deepEqual(assistant.render(80), nativeAssistant);
  assert.equal(getActiveTheme().id, "omt-rail");
});

test("rail composer preserves Pi rows, cursor column, multiline editing and native completion surfaces", (t) => {
  const theme = setup(t), keys = new KeybindingsManager(TUI_KEYBINDINGS);
  const editor = new CleanEditor(tui, { borderColor: (s) => s, selectList: getSelectListTheme() }, keys as PiKeys, () => theme, () => "Fixture · local");
  editor.focused = true;
  editor.setText("hello 你好\nsecond row");
  const rows = editor.render(80);
  assert.equal(plain(rows)[1]!.indexOf("hello"), 5);
  assert.equal(plain(rows)[1]!.indexOf("┃"), 2);
  assert.equal(plain(rows).at(-1)!.indexOf("╹"), 2);
  assert.ok(rows.join("").includes(CURSOR_MARKER));
  assert.ok(plain(rows).at(-1)!.includes("Fixture · local"));
  assert.equal(editor.getText(), "hello 你好\nsecond row");
  for (const width of [10, 20, 40, 120, 80]) for (const line of editor.render(width)) assert.ok(visibleWidth(line) <= width);
  editor.setText("");
  assert.equal(plain(editor.render(80))[1]!.indexOf("┃"), 2);
});

test("Rail editor keeps native input, cursor/mouse geometry and completion rows", async (t) => {
  const theme = setup(t), keys = new KeybindingsManager(TUI_KEYBINDINGS);
  const editorTheme = { borderColor: (s: string) => s, selectList: getSelectListTheme() };
  const native = new CustomEditor(tui, editorTheme, keys as PiKeys);
  native.setPaddingX(5);
  const custom = new CleanEditor(tui, editorTheme, keys as PiKeys, () => theme);
  for (const input of ["hello", "你好", "\x1b[13;2u", "é 👩🏽‍💻", "\x1b[D", "\x7f", "\x1b[200~paste\nmultiline\x1b[201~"]) {
    for (const editor of [native, custom]) { editor.handleInput(input); editor.render(40); }
    assert.equal(custom.getText(), native.getText()); assert.deepEqual(custom.getCursor(), native.getCursor());
    const cursor = (editor: CustomEditor) => editor.render(40).map((line, row) => [row, line.includes(CURSOR_MARKER) ? visibleWidth(line.split(CURSOR_MARKER)[0]!) : -1]).filter((entry) => entry[1] !== -1);
    assert.deepEqual(cursor(custom), cursor(native));
  }
  for (const editor of [native, custom]) {
    editor.setAutocompleteProvider({ getSuggestions: async () => ({ prefix: "/om", items: [{ value: "/omt", label: "/omt" }] }),
      applyCompletion: (_lines, line, _col, item) => ({ lines: [item.value], cursorLine: line, cursorCol: item.value.length }) });
    editor.setText("/om"); editor.handleInput("\t");
  }
  await new Promise((resolve) => setTimeout(resolve, 30));
  const nativeRows = native.render(40), customRows = custom.render(40);
  assert.ok(nativeRows.length > 3);
  assert.deepEqual(customRows.slice(3), nativeRows.slice(3));
});

test("native hidden reasoning changes Thinking to Thought, expands and retains error diagnostics", (t) => {
  const theme = setup(t), control = createUserMessageControl(() => theme);
  t.after(() => control.cleanup?.());
  const msg = { role: "assistant", content: [{ type: "thinking", thinking: "Actual reasoning text" }], stopReason: "stop" } as any;
  const component = new AssistantMessageComponent(msg, true, undefined, "+ Thought");
  component.updateContent(msg, true);
  assert.match(plain(component.render(80)).join(""), /⋯ Thinking/);
  component.updateContent(msg, false);
  assert.match(plain(component.render(80)).join(""), /\+ Thought/);
  component.setHiddenThinkingLabel("Foreign/native label");
  assert.match(plain(component.render(80)).join(""), /Foreign\/native label/, "thinking off or a foreign label must not be restyled by messages");
  component.setHiddenThinkingLabel("+ Thought");
  component.setHideThinkingBlock(false);
  assert.match(plain(component.render(80)).join(""), /Actual reasoning text/);
  component.updateContent({ ...msg, stopReason: "error", errorMessage: "actual diagnostic" }, false);
  const error = component.render(80);
  assert.match(plain(error).join(""), /actual diagnostic/);
  assert.match(error.join(""), /38;2;224;108;117/);
});

test("read is inline, errors stay visible, expansion exposes all native contents", (t) => {
  const theme = setup(t), renderer = createCleanReadRenderer(), ctx = context({ path: "file.ts", offset: 2, limit: 3 });
  const call = renderer.renderCall!(ctx.args, theme, ctx);
  assert.match(plain(call.render(80))[0]!, /^     [⠋-⠿] Read file.ts/);
  ctx.isPartial = false;
  const result = { content: [{ type: "text" as const, text: "one\ntwo\nthree" }], details: undefined };
  const output = renderer.renderResult!(result, { expanded: false, isPartial: false }, theme, ctx);
  assert.deepEqual(output.render(80), []);
  assert.match(plain(call.render(80))[0]!, /^     → Read file.ts/);
  const expanded = renderer.renderResult!(result, { expanded: true, isPartial: false }, theme, ctx);
  assert.deepEqual(call.render(80), [], "no duplicate header around the expanded panel");
  assert.ok(plain(expanded.render(80)).some((line) => line.includes("three")));
  ctx.isError = true;
  const error = renderer.renderResult!({ ...result, content: [{ type: "text", text: "Cannot read interrupted.txt" }] }, { expanded: false, isPartial: false }, theme, ctx);
  assert.match(plain(error.render(80)).join("\n"), /Cannot read interrupted.txt/);
  assert.equal(determineToolState(false, true, undefined, "Cannot read interrupted.txt"), "failure");
  assert.equal(determineToolState(false, true, undefined, "partial output\n\nCommand aborted"), "interrupted");
  assert.equal(determineToolState(false, false, undefined, "partial output\n\nCommand aborted"), "success", "ordinary output is not an observed interruption");
});

test("shell partial to success/failure/interruption panels keep diagnostics and complete expansion", (t) => {
  const theme = setup(t), renderer = createCleanBashRenderer(), ctx = context({ command: "printf hello" });
  const call = renderer.renderCall!(ctx.args, theme, ctx);
  assert.match(plain(call.render(80))[0]!, /\$ printf hello/);
  const output = Array.from({ length: 30 }, (_, i) => `output ${i}`).join("\n");
  for (const state of ["running", "success", "failure", "interrupted"] as const) {
    ctx.isPartial = state === "running"; ctx.isError = state === "failure";
    const result = { content: [{ type: "text" as const, text: output }], details: { exitCode: state === "failure" ? 2 : state === "interrupted" ? 130 : 0, fullOutputPath: "/tmp/full-output" } };
    const collapsed = renderer.renderResult!(result, { expanded: false, isPartial: ctx.isPartial }, theme, ctx);
    assert.deepEqual(call.render(80), []);
    const text = plain(collapsed.render(80)).join("\n");
    assert.match(text, /output 0/); assert.ok(!text.includes("output 29"));
    assert.match(text, /ctrl\+o to expand/); assert.match(text, /Full output saved to/);
    if (state === "failure") assert.match(text, /Exit code 2/);
    if (state === "interrupted") assert.match(text, /Command interrupted/);
    const expanded = renderer.renderResult!(result, { expanded: true, isPartial: ctx.isPartial }, theme, ctx);
    assert.match(plain(expanded.render(80)).join("\n"), /output 29/);
    for (const width of [1, 5, 10, 20, 40, 120, 160]) for (const line of collapsed.render(width)) assert.ok(visibleWidth(line) <= width);
  }
});

test("write numbered code and edit unified diffs have source hierarchy instead of Clean summaries", (t) => {
  const theme = setup(t);
  for (const [renderer, args, result, expected] of [
    [createCleanWriteRenderer(), { path: "file.ts", content: "const a = 1;\nconst b = 2;" }, { content: [] }, /# Wrote file.ts/],
    [createCleanEditRenderer(), { path: "file.ts" }, { content: [], details: { diff: "-1 old\n+1 new" } }, /← Edit file.ts/],
  ] as const) {
    const ctx = context(args); const call = renderer.renderCall!(args, theme, ctx);
    assert.match(plain(call.render(80))[0]!, /← (Write|Edit) file.ts/);
    ctx.isPartial = false;
    const row = renderer.renderResult!(result as any, { expanded: false, isPartial: false }, theme, ctx);
    const text = plain(row.render(80)).join("\n");
    assert.match(text, expected); assert.deepEqual(call.render(80), []);
    assert.ok(!text.includes("Added") && !text.includes("Edited") && !text.includes("lines ("));
    if ("content" in args) assert.match(text, / 2 const b = 2;/);
    else assert.match(row.render(80).join(""), /48;2;32;48;59/);
  }
  const renderer = createCleanWriteRenderer();
  const ctx = context({ path: "long.txt", content: Array.from({ length: 1000 }, (_, i) => `marker${i}`).join("\n") });
  ctx.isPartial = false;
  const row = renderer.renderResult!({ content: [], details: undefined }, { expanded: true, isPartial: false }, theme, ctx);
  const rows = row.render(80);
  const code = plain(rows).filter((line) => line.includes("marker"));
  assert.equal(code.length, 1000);
  assert.ok(code.every((line) => line.indexOf("marker") === 10), "line-number growth must align every code row");
  assert.equal(row.render(80), rows, "completed tool panels reuse their width cache on working ticks");
});

test("Pi tool component expansion and captured rows tolerate repeated cross-preset changes", (t) => {
  setup(t);
  const component = new ToolExecutionComponent("bash", "rail-fixture", { command: "printf hello" }, {}, createCleanBashRenderer(), tui, "/tmp");
  component.updateResult({ content: [{ type: "text", text: "hello 你好\n" + "long output\n".repeat(30) }], isError: false });
  for (const name of [...THEME_NAMES, "omt-rail", "omt-clean", "omt-rail"] as const) {
    setActiveTheme(name); component.invalidate();
    for (const expanded of [true, false, true]) {
      component.setExpanded(expanded);
      for (const width of [10, 20, 40, 80, 120]) for (const line of component.render(width)) assert.ok(visibleWidth(line) <= width);
    }
  }
});

test("only owned working loader animates at 40ms, settles and restores native clock on disable", (t) => {
  setup(t);
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
  t.after(() => { host.clearStatusIndicator(); control.cleanup(ctx); restore(); });
  control.on(ctx); callbacks.get("agent_start")!({}, ctx); host.showWorkingStatusIndicator();
  assert.equal(host.activeStatusIndicator.intervalMs, 40);
  assert.equal(host.hiddenThinkingLabel, "+ Thought");
  assert.match(plain(host.statusContainer.render(80)).join(""), /[■⬝]{8}/);
  callbacks.get("tool_execution_start")!({ toolCallId: "parent" }, ctx);
  callbacks.get("tool_execution_start")!({ toolCallId: "parent/1", parentToolCallId: "parent" }, ctx);
  callbacks.get("tool_execution_end")!({ toolCallId: "parent" }, ctx);
  assert.equal(host.workingMessage, "Working");
  const clock = host.activeStatusIndicator.intervalId;
  control.off(ctx); assert.ok(clock._destroyed);
  assert.equal(host.workingIndicatorOptions, undefined);
  assert.equal(host.hiddenThinkingLabel, "Thinking...");
  setActiveTheme("native"); control.on(ctx); assert.equal(host.workingIndicatorOptions, undefined);
  setActiveTheme("omt-rail"); control.applyTheme(ctx); assert.equal(host.activeStatusIndicator.intervalMs, 40);
  callbacks.get("agent_settled")!({}, ctx); host.clearStatusIndicator("working");
  assert.deepEqual(host.statusContainer.render(80), []);
});

test("Rail directory footer retains real extension warnings and never invents LSP/MCP state", (t) => {
  const theme = setup(t);
  const data = { branch: "main", cwd: "/tmp/work", extensionStatuses: ["warning: fixture"], modelId: "fixture", activity: { type: "running" as const } };
  const line = stripTerminalSequences(formatFooterLine(80, theme, data));
  assert.match(line, /\/tmp\/work:main/); assert.match(line, /warning: fixture/);
  assert.equal(line.indexOf("/tmp/work"), 3);
  assert.equal(stripTerminalSequences(formatFooterLine(80, theme, { ...data, outputPad: 12 })).indexOf("/tmp/work"), 12);
  assert.ok(!/LSP|MCP|running|◆/.test(line));
  for (const width of [1, 5, 10, 20, 40, 120]) assert.ok(visibleWidth(formatFooterLine(width, theme, data)) <= width);
});
