import assert from "node:assert/strict";
import { test } from "node:test";
import { AssistantMessageComponent, CustomEditor, InteractiveMode, ToolExecutionComponent, UserMessageComponent, initTheme, getSelectListTheme,
  type ExtensionAPI, type ExtensionContext, type Theme, type ToolRenderers, type KeybindingsManager as PiKeys } from "@earendil-works/pi-coding-agent";
import { Container, CURSOR_MARKER, KeybindingsManager, TUI_KEYBINDINGS, stripTerminalSequences, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { emberBg, emberFg } from "../extensions/omt/presets/omt-ember/rendering.ts";
import { EMBER_FRAME_MS, EMBER_FRAMES, emberSpinner, emberWorkingLine } from "../extensions/omt/presets/omt-ember/working.ts";
import { THEME_NAMES, THEME_PRESETS, resolveThemeName } from "../extensions/omt/presets/index.ts";
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
  initTheme(palette); setActiveTheme("omt-ember"); t.after(resetActiveTheme);
  return proto.createExtensionUIContext.call({}).theme;
}
function context(args: unknown = {}) {
  return { args, state: {}, cwd: "/tmp", outputPad: 1, isPartial: true, expanded: false, isError: false, argsComplete: true, executionStarted: true,
    keyText: () => "ctrl+o", keyHint: (_: string, text: string) => `ctrl+o ${text}` } as unknown as Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];
}

test("Ember canonical name and alias share a measured local palette without changing Pi theme", (t) => {
  let theme = setup(t);
  assert.equal(resolveThemeName("ember"), "omt-ember");
  assert.equal(setActiveTheme("ember").label, "OMT Ember");
  assert.equal(THEME_PRESETS.ember, THEME_PRESETS["omt-ember"]);
  assert.ok(!THEME_NAMES.includes("ember" as any));
  assert.match(emberBg(theme, "panel", "panel"), /48;2;55;55;55/);
  assert.match(emberFg(theme, "accent", "spinner"), /38;2;215;119;87/);
  assert.match(emberFg(theme, "success", "●"), /38;2;78;186;101/);
  assert.match(emberBg(theme, "added", "a\x1b[49mb"), /49m\x1b\[48;2;2;40;0mb/);
  initTheme("light"); theme = proto.createExtensionUIContext.call({}).theme;
  assert.match(emberBg(theme, "panel", "panel"), /48;2;240;240;240/);
  assert.match(emberBg(theme, "added", "diff"), /48;2;220;255;220/);
  assert.match(emberFg(theme, "error", "error"), /38;2;171;43;63/);
});

test("observed Ember breath order/holds and working phases are independent of Clean and reduced motion is static", (t) => {
  const theme = setup(t);
  assert.equal(EMBER_FRAME_MS, 112);
  assert.deepEqual(EMBER_FRAMES, ["·", "·", "·", "·", "✢", "*", "✶", "✻", "✻", "✽", "✽", "✽", "✽", "✻", "✶", "*", "✢", "✢"]);
  for (let i = 0; i < 18; i++) assert.equal(emberSpinner(i * 112), EMBER_FRAMES[i]);
  assert.equal(emberSpinner(2016), "·");
  assert.equal(emberSpinner(9999, false), "●");
  assert.equal(emberWorkingLine(theme, 0, "Working", "esc", 80, false), emberWorkingLine(theme, 800, "Working", "esc", 80, false));
  assert.match(stripTerminalSequences(emberWorkingLine(theme, 3200, "Thinking", "esc", 80)), /Thinking… \(3s\) · esc to interrupt/);
  assert.ok(!stripTerminalSequences(emberWorkingLine(theme, 800, "Streaming", "esc", 80)).includes("tokens"));
  for (const width of [0, 1, 5, 10, 20, 40, 80, 120]) assert.ok(visibleWidth(emberWorkingLine(theme, 3210, "Running tools", "esc", width)) <= width);
});

test("Ember submitted prompts, assistant Markdown and reasoning preserve zones, content, caches and native restoration", (t) => {
  const theme = setup(t);
  const user = new UserMessageComponent("hello **world** 你好\n\nsecond paragraph");
  const msg = { role: "assistant", content: [{ type: "thinking", thinking: "Actual reasoning 你好" }, { type: "text", text: "Actual answer\n\n```ts\nconst x = 1;\n```" }], stopReason: "stop" } as any;
  const before = structuredClone(msg);
  const assistant = new AssistantMessageComponent(msg, true, undefined, "∴ Thought");
  const nativeUser = user.render(80), nativeAssistant = assistant.render(80);
  const original = UserMessageComponent.prototype.render;
  const control = createUserMessageControl(() => theme);
  t.after(() => { control.cleanup?.(); assert.equal(UserMessageComponent.prototype.render, original); });
  const rows = user.render(80), prose = plain(assistant.render(80));
  assert.equal(plain(rows)[1], "❯ hello world 你好");
  assert.match(rows[1]!, /48;2;55;55;55/);
  assert.ok(rows[0]!.includes("\x1b]133;A\x07"));
  assert.ok(rows.at(-1)!.includes("\x1b]133;C\x07"));
  assert.ok(!rows[0]!.includes("48;2"), "native spacer rows are transparent");
  assert.ok(prose.includes("● Actual answer"));
  assert.ok(prose.some((line) => line.includes("∴ Thought")));
  assert.ok(!prose.some((line) => line.includes("```")));
  assistant.updateContent(msg, true);
  // Last content is text: streaming alone is not evidence of active reasoning.
  assert.match(plain(assistant.render(80)).join(""), /∴ Thought/);
  assistant.setHideThinkingBlock(false);
  const expanded = plain(assistant.render(80));
  assert.ok(expanded.some((line) => line.includes("Actual reasoning")));
  assert.ok(!expanded.some((line) => line.includes("● Actual reasoning")));
  assert.ok(expanded.includes("● Actual answer"));
  const markdown = user.children[0]!;
  const invalidates = t.mock.method(markdown, "invalidate");
  for (let i = 0; i < 100; i++) user.render(80);
  assert.equal(invalidates.mock.callCount(), 0);
  for (const name of [...THEME_NAMES, "omt-ember"] as const) {
    setActiveTheme(name); control.applyTheme?.();
    for (const width of [10, 20, 40, 80, 120, 160, 40]) for (const line of [...user.render(width), ...assistant.render(width)]) assert.ok(visibleWidth(line) <= width);
  }
  assistant.setHideThinkingBlock(true); assistant.updateContent(msg, false);
  control.off();
  assert.deepEqual(user.render(80), nativeUser);
  assert.deepEqual(assistant.render(80), nativeAssistant);
  assert.deepEqual(msg, before);
});

test("ruled Ember composer keeps native input/cursor geometry, paste and autocomplete surfaces", async (t) => {
  const theme = setup(t), keys = new KeybindingsManager(TUI_KEYBINDINGS);
  const editorTheme = { borderColor: (s: string) => s, selectList: getSelectListTheme() };
  const native = new CustomEditor(tui, editorTheme, keys as PiKeys); native.setPaddingX(2);
  const custom = new CleanEditor(tui, editorTheme, keys as PiKeys, () => theme);
  for (const editor of [native, custom]) editor.focused = true;
  for (const input of ["hello", "你好", "\x1b[13;2u", "é 👩🏽‍💻", "\x1b[D", "\x7f", "\x1b[200~paste\nmultiline\x1b[201~"]) {
    for (const editor of [native, custom]) { editor.handleInput(input); editor.render(40); }
    assert.equal(custom.getText(), native.getText()); assert.deepEqual(custom.getCursor(), native.getCursor());
    const cursor = (editor: CustomEditor) => editor.render(40).map((line, row) => [row, line.includes(CURSOR_MARKER) ? visibleWidth(line.split(CURSOR_MARKER)[0]!) : -1]).filter((entry) => entry[1] !== -1);
    assert.deepEqual(cursor(custom), cursor(native));
  }
  assert.match(plain(custom.render(80))[0]!, /^─/);
  for (const editor of [native, custom]) {
    editor.setAutocompleteProvider({ getSuggestions: async () => ({ prefix: "/om", items: [{ value: "/omt", label: "/omt" }] }),
      applyCompletion: (_lines, line, _col, item) => ({ lines: [item.value], cursorLine: line, cursorCol: item.value.length }) });
    editor.setText("/om"); editor.handleInput("\t");
  }
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(custom.render(40).slice(3), native.render(40).slice(3));
});

test("Ember read/shell activity summaries expand row-locally, retain diagnostics and never infer errors from filenames", (t) => {
  const theme = setup(t);
  assert.equal(determineToolState(false, false, undefined, "interrupted.txt"), "success");
  assert.equal(determineToolState(false, true, undefined, "Cannot open interrupted.txt"), "failure");
  assert.equal(determineToolState(false, true, undefined, "partial\n\nCommand aborted"), "interrupted");
  assert.equal(determineToolState(false, false, { content: [], details: { exitCode: 2 } }), "failure");
  for (const [name, renderer, args, summary] of [
    ["read", createCleanReadRenderer(), { path: "hello.ts" }, "Read 1 file"],
    ["bash", createCleanBashRenderer(), { command: "printf hello" }, "Ran 1 shell command"],
  ] as const) {
    const ctx = context(args); ctx.isPartial = false;
    const call = renderer.renderCall!(args, theme, ctx);
    const output = Array.from({ length: 100 }, (_, i) => `unique line ${i}`).join("\n");
    const result = { content: [{ type: "text" as const, text: output }], details: undefined };
    const collapsed = renderer.renderResult!(result, { expanded: false, isPartial: false }, theme, ctx);
    assert.match(plain(call.render(80)).join(""), new RegExp(summary));
    assert.deepEqual(collapsed.render(80), []);
    ctx.expanded = true;
    const detailed = renderer.renderCall!(args, theme, ctx);
    const expanded = renderer.renderResult!(result, { expanded: true, isPartial: false }, theme, ctx);
    assert.match(plain(detailed.render(80))[0]!, new RegExp(`● ${name === "read" ? "Read" : "Bash"}\\(`));
    assert.match(plain(expanded.render(80)).join("\n"), /unique line 99/);
    ctx.isError = true; ctx.expanded = false;
    const failure = renderer.renderResult!({ ...result, details: { exitCode: 2, fullOutputPath: "/tmp/full" } }, { expanded: false, isPartial: false }, theme, ctx);
    const text = plain(failure.render(80)).join("\n");
    assert.match(text, /Error: Exit code 2/); assert.match(text, /Full output saved to/);
    for (const width of [1, 5, 10, 20, 40, 120, 160]) for (const line of failure.render(width)) assert.ok(visibleWidth(line) <= width);
  }
});

test("Create/Update use Ember result trees, number-before-sign diffs, bounded preview and full native expansion", (t) => {
  const theme = setup(t);
  for (const [renderer, args, details, label] of [
    [createCleanWriteRenderer(), { path: "new.ts", content: Array.from({ length: 50 }, (_, i) => `const marker${i} = ${i};`).join("\n") }, undefined, "Create"],
    [createCleanEditRenderer(), { path: "hello.ts" }, { diff: "-1 old\n+1 updated" }, "Update"],
  ] as const) {
    const ctx = context(args); ctx.isPartial = false;
    const call = renderer.renderCall!(args, theme, ctx);
    const result = { content: [], details };
    const collapsed = renderer.renderResult!(result, { expanded: false, isPartial: false }, theme, ctx);
    assert.match(plain(call.render(80))[0]!, new RegExp(`● ${label}\\(`));
    const text = plain(collapsed.render(80)).join("\n");
    assert.match(text, /⎿  Added/); assert.match(text, /      1 [-+]/);
    assert.match(collapsed.render(80).join(""), /48;2;2;40;0/);
    if (label === "Create") { assert.match(text, /ctrl\+o to expand/); assert.ok(!text.includes("marker49")); }
    const full = renderer.renderResult!(result, { expanded: true, isPartial: false }, theme, ctx);
    if (label === "Create") assert.match(plain(full.render(80)).join("\n"), /marker49/);
    const rows = full.render(80); assert.equal(full.render(80), rows, "settled rows cache by layout and width");
  }
});

test("captured Pi tool rows tolerate every preset, partial/expanded transitions and terminal resizing", (t) => {
  setup(t);
  const component = new ToolExecutionComponent("bash", "ember-fixture", { command: "printf hello" }, {}, createCleanBashRenderer(), tui, "/tmp");
  component.updateResult({ content: [{ type: "text", text: "hello 你好\n" + "long output\n".repeat(30) }], isError: false });
  for (const name of [...THEME_NAMES, "ember", "omt-rail", "omt-ember"] as const) {
    setActiveTheme(name); component.invalidate();
    for (const expanded of [true, false, true]) {
      component.setExpanded(expanded);
      for (const width of [10, 20, 40, 80, 120]) for (const line of component.render(width)) assert.ok(visibleWidth(line) <= width);
    }
  }
});

test("Ember uses only Pi's owned clock, tracks nested phases and destroys the old timer on switching/native/disable", (t) => {
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
  assert.equal(host.activeStatusIndicator.intervalMs, 112);
  assert.match(plain(host.statusContainer.render(80)).join(""), /Working…/);
  const phases = t.mock.method(ctx.ui, "setWorkingMessage");
  for (let i = 0; i < 100; i++) callbacks.get("message_update")!({ message: { role: "assistant" }, assistantMessageEvent: { type: "thinking_delta" } }, ctx);
  assert.equal(phases.mock.callCount(), 1);
  assert.match(plain(host.statusContainer.render(80)).join(""), /Thinking…/);
  callbacks.get("tool_execution_start")!({ toolCallId: "parent" }, ctx);
  callbacks.get("tool_execution_start")!({ toolCallId: "parent/1", parentToolCallId: "parent" }, ctx);
  callbacks.get("tool_execution_end")!({ toolCallId: "parent" }, ctx);
  assert.equal(host.workingMessage, "Running tools");
  for (const name of ["omt-clean", "omt-rail", "minimal", "omt-ember", "native", "omt-ember"] as const) {
    const clock = host.activeStatusIndicator.intervalId;
    setActiveTheme(name); control.applyTheme(ctx);
    if (clock) assert.ok(clock._destroyed, "only the new Pi clock survives");
  }
  ctx.ui.setWorkingMessage("Foreign later");
  assert.match(plain(host.statusContainer.render(80)).join(""), /Foreign later/);
  const clock = host.activeStatusIndicator.intervalId;
  control.off(ctx); if (clock) assert.ok(clock._destroyed);
  assert.equal(host.workingMessage, "Foreign later");
  assert.equal(host.workingIndicatorOptions, undefined);
  assert.equal(host.hiddenThinkingLabel, "Thinking...");
  host.clearStatusIndicator("working"); assert.deepEqual(host.statusContainer.render(80), []);
});

test("Ember public static fallback yields to an unsupported working renderer and restores owned fields", (t) => {
  setup(t);
  const restore = observeNativeUIOwnership()!;
  t.after(restore);
  const target = InteractiveMode.prototype as any;
  const original = target.showWorkingStatusIndicator;
  function foreignWorking(this: unknown) { return original.call(this); }
  target.showWorkingStatusIndicator = foreignWorking;
  const host = Object.assign(Object.create(InteractiveMode.prototype), {
    workingMessage: undefined, workingIndicatorOptions: undefined, workingVisible: true,
    defaultWorkingMessage: "Working", defaultHiddenThinkingLabel: "Thinking...", hiddenThinkingLabel: "Thinking...",
    chatContainer: new Container(), statusContainer: new Container(), defaultEditor: { setWorkingStatusIndicator() {} }, editor: {},
    ui: { requestRender() {}, getClearOnShrink: () => false }, options: { tuiMode: "regular" }, runtimeHost: { session: { isStreaming: true } },
  });
  const ctx = { mode: "tui", ui: host.createExtensionUIContext() } as ExtensionContext;
  const control = createThinkingControl({ on() {} } as unknown as ExtensionAPI);
  try {
    control.on(ctx);
    assert.deepEqual(host.workingIndicatorOptions, { frames: ["●"] });
    assert.equal(target.showWorkingStatusIndicator, foreignWorking);
    control.off(ctx);
    assert.equal(host.workingIndicatorOptions, undefined);
    assert.equal(host.hiddenThinkingLabel, "Thinking...");
  } finally {
    host.clearStatusIndicator(); control.cleanup(ctx);
    if (target.showWorkingStatusIndicator === foreignWorking) target.showWorkingStatusIndicator = original;
  }
});

test("Ember alias and canonical ID produce identical ANSI on every owned surface", (t) => {
  const theme = setup(t), control = createUserMessageControl(() => theme);
  t.after(() => control.cleanup?.());
  const render = (name: string) => {
    setActiveTheme(name); control.applyTheme?.();
    const user = new UserMessageComponent("Alias 你好");
    const assistant = new AssistantMessageComponent({ role: "assistant", content: [{ type: "text", text: "**Alias** answer" }], stopReason: "stop" } as any);
    const editor = new CleanEditor(tui, { borderColor: (text) => text, selectList: getSelectListTheme() }, new KeybindingsManager(TUI_KEYBINDINGS) as PiKeys, () => theme);
    editor.setText("Alias draft");
    const renderer = createCleanWriteRenderer(), ctx = context({ path: "alias.ts", content: "const x = 1;" }); ctx.isPartial = false;
    const call = renderer.renderCall!(ctx.args, theme, ctx);
    const result = renderer.renderResult!({ content: [], details: undefined }, { expanded: false, isPartial: false }, theme, ctx);
    return [user.render(80), assistant.render(80), editor.render(80), call.render(80), result.render(80),
      formatFooterLine(80, theme, { branch: "main", extensionStatuses: [], modelId: "fixture" }), emberWorkingLine(theme, 1234, "Thinking", "esc", 80)];
  };
  assert.deepEqual(render("ember"), render("omt-ember"));
});

test("Ember statusline contains only real Pi metadata, warns visibly and contracts by Unicode width", (t) => {
  const theme = setup(t);
  const data = { branch: "main", cwd: "/tmp/work", extensionStatuses: ["warning: fixture"], modelId: "fixture", activity: { type: "running" as const }, contextUsage: { percent: 12, contextWindow: 200000 } };
  const line = stripTerminalSequences(formatFooterLine(100, theme, data));
  assert.match(line, /\/tmp\/work · \(main\) · fixture · 12% context/);
  assert.match(line, /warning: fixture/);
  assert.ok(!/API Usage|accept edits|running|effort/.test(line));
  for (const width of [1, 5, 10, 20, 40, 120]) assert.ok(visibleWidth(formatFooterLine(width, theme, { ...data, modelId: "你好 fixture 👩🏽‍💻" })) <= width);
  assert.equal(getActiveTheme().id, "omt-ember");
});
