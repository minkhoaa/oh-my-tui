import assert from "node:assert/strict";
import { test } from "node:test";
import {
  InteractiveMode, FooterComponent, UserMessageComponent, AssistantMessageComponent, ToolExecutionComponent, createReadToolDefinition,
  createWriteToolDefinition, createEditToolDefinition, createBashToolDefinition,
  initTheme, getSelectListTheme, type ExtensionContext, type ExtensionAPI, type KeybindingsManager as PiKeys,
  type Theme, type ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, TUI_KEYBINDINGS, stripTerminalSequences, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { CleanEditor } from "../extensions/omt/features/editor/index.ts";
import { createUserMessageControl } from "../extensions/omt/features/user-message/index.ts";
import { createCleanReadRenderer, createCleanBashRenderer, createCleanWriteRenderer, createCleanEditRenderer, createToolsControl } from "../extensions/omt/features/tools/index.ts";
import { createFooterControl, formatFooterLine } from "../extensions/omt/features/footer/index.ts";
import { hasNativeFooterRenderer, nativeToolRenderers, observeNativeUIOwnership, observeAssistantMessages, observeWorkingRender } from "../extensions/omt/core/native-ui.ts";
import { THEME_NAMES } from "../extensions/omt/presets/index.ts";
import { resetActiveTheme, setActiveTheme } from "../extensions/omt/core/theme.ts";
import { cleanPanel, setCleanPalette } from "../extensions/omt/presets/omt-clean/rendering.ts";

const prototype = InteractiveMode.prototype as unknown as { createExtensionUIContext(this: unknown): { theme: Theme; getFooterComponent?(): unknown } };
const tui = { terminal: { rows: 30, columns: 80 }, requestRender() {} } as TUI;

// Deliberately exercise the installed host's actual UI-context implementation.
test("Clean shares source-derived surfaces, gutters and compact framing across themes", () => {
  setActiveTheme("omt-clean");
  const control = createUserMessageControl();
  try {
    for (const palette of ["dark", "light", "system"]) {
      initTheme(palette);
      setCleanPalette({ background: palette === "light" ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 } });
      const theme = prototype.createExtensionUIContext.call({}).theme;
      const keys = new KeybindingsManager(TUI_KEYBINDINGS);
      const editor = new CleanEditor(tui, { borderColor: (s) => s, selectList: getSelectListTheme() }, keys as PiKeys, () => theme);
      for (const padding of [1, 5]) {
        editor.setPaddingX(padding);
        editor.setText("hello 你好 👩🏽‍💻");
        const message = new UserMessageComponent("hello 你好 👩🏽‍💻", undefined, padding);
        const tool = new ToolExecutionComponent("read", "visual", { path: "hello.ts" }, { outputPad: padding }, createCleanReadRenderer(), tui, process.cwd());
        tool.updateResult({ content: [{ type: "text", text: "hello" }], isError: false });
        for (const width of [10, 20, 40, 80, 120]) {
          const editorLines = editor.render(width);
          const messageLines = message.render(width);
          const toolLines = tool.render(width);
          if (width >= 40) assert.equal(editorLines.length, messageLines.length, "compact vertical geometry matches");
          assert.ok(!stripTerminalSequences(editorLines[0]!).includes("─"), "no redundant rule");
          for (const [name, lines] of [["editor", editorLines], ["message", messageLines], ["tool", toolLines]] as const) {
            for (const line of lines) assert.ok(visibleWidth(line) <= width, `${palette} ${name} width=${width} padding=${padding}: ${JSON.stringify(stripTerminalSequences(line))}`);
          }
          if (width >= 40) {
            const column = Math.max(2, padding);
            assert.equal(stripTerminalSequences(editorLines[1]!).indexOf("hello"), column);
            assert.equal(stripTerminalSequences(messageLines[1]!).indexOf("hello"), column);
            assert.equal(stripTerminalSequences(toolLines[1]!).indexOf("Explored"), column);
            assert.equal(stripTerminalSequences(toolLines[2]!).indexOf("Read"), column + 2);
            const footer = formatFooterLine(width, theme, { outputPad: padding, branch: "main", extensionStatuses: [], modelId: "model" });
            assert.equal(stripTerminalSequences(footer).indexOf("model"), column);
            const bg = cleanPanel(theme, "surface").split("surface")[0]!;
            if (bg) {
              assert.ok(editorLines[1]!.includes(bg));
              assert.ok(messageLines[1]!.includes(cleanPanel(theme, "surface", true).split("surface")[0]!));
              assert.ok(!toolLines.join("").includes(bg), "tools stay transparent");
              assert.ok(!footer.includes(bg), "footer stays transparent");
            }
          }
        }
      }
    }
  } finally { control.cleanup?.(); setCleanPalette({}); }
});

test("clean legacy alias and canonical ID render identical ANSI across every surface", () => {
  const control = createUserMessageControl();
  try {
    for (const palette of ["dark", "light", "system"]) {
      initTheme(palette);
      setCleanPalette({ background: palette === "light" ? { r: 255, g: 255, b: 255 } : { r: 16, g: 16, b: 16 } });
      const theme = prototype.createExtensionUIContext.call({}).theme;
      const keys = new KeybindingsManager(TUI_KEYBINDINGS);
      for (const width of [10, 20, 40, 80, 120]) {
        const snapshot = (name: string) => {
          setActiveTheme(name);
          control.applyTheme?.();
          const editor = new CleanEditor(tui, { borderColor: (s) => s, selectList: getSelectListTheme() }, keys as PiKeys, () => theme);
          editor.setText("draft 你好 👩🏽‍💻");
          const user = new UserMessageComponent("prompt 你好 👩🏽‍💻");
          const assistant = new AssistantMessageComponent({ role: "assistant", content: [{ type: "thinking", thinking: "Reasoning" }, { type: "text", text: "**Done**\n\n```ts\nconst x = 1;\n```" }], stopReason: "stop" } as any);
          const tools = [
            ["read", { path: "file.ts" }, createCleanReadRenderer(), { content: [{ type: "text", text: "const x = 1;" }] }],
            ["bash", { command: "printf hello" }, createCleanBashRenderer(), { content: [{ type: "text", text: "one\ntwo\nthree\nfour\nfive" }] }],
            ["write", { path: "file.ts", content: "hello\n" }, createCleanWriteRenderer(), { content: [] }],
            ["edit", { path: "file.ts" }, createCleanEditRenderer(), { content: [], details: { diff: "-1 old\n+1 new" } }],
          ] as const;
          return [editor.render(width), user.render(width), assistant.render(width),
            ...tools.flatMap(([toolName, args, renderer, result]) => {
              const tool = new ToolExecutionComponent(toolName, "alias", args, {}, renderer, tui, process.cwd());
              tool.updateResult(result as any);
              const collapsed = tool.render(width);
              tool.setExpanded(true);
              return [collapsed, tool.render(width)];
            }),
            formatFooterLine(width, theme, { branch: "main", extensionStatuses: [], modelId: "model", reasoning: true, thinkingLevel: "high" })];
        };
        assert.deepEqual(snapshot("clean"), snapshot("omt-clean"), `${palette} width=${width}`);
      }
    }
  } finally { control.cleanup?.(); setCleanPalette({}); resetActiveTheme(); }
});

test("recognized host capabilities activate and footer ownership hook is reversible", () => {
  const original = prototype.createExtensionUIContext;
  const restore = observeNativeUIOwnership();
  assert.ok(restore);
  const host = { customFooter: { render: () => ["foreign"] } };
  assert.equal(prototype.createExtensionUIContext.call(host).getFooterComponent?.(), host.customFooter);
  assert.equal(observeNativeUIOwnership(), undefined, "duplicate hooks fail safely");
  restore();
  assert.equal(prototype.createExtensionUIContext, original);
  const restoreAgain = observeNativeUIOwnership()!;
  const wrapper = prototype.createExtensionUIContext;
  prototype.createExtensionUIContext = function foreignUI() { return wrapper.call(this); };
  const foreign = prototype.createExtensionUIContext;
  restoreAgain();
  assert.equal(prototype.createExtensionUIContext, foreign);
  assert.equal(observeNativeUIOwnership(), undefined);
  prototype.createExtensionUIContext = original;
});

test("unsupported boundaries fail independently without disabling public APIs", () => {
  const context = prototype.createExtensionUIContext;
  const assistant = AssistantMessageComponent.prototype.render;
  const workingHost = InteractiveMode.prototype as any;
  const working = workingHost.showWorkingStatusIndicator;
  try {
    prototype.createExtensionUIContext = undefined as any;
    AssistantMessageComponent.prototype.render = undefined as any;
    workingHost.showWorkingStatusIndicator = undefined;
    assert.equal(observeNativeUIOwnership(), undefined);
    assert.equal(observeAssistantMessages(() => true, () => { throw new Error("No palette access"); }), undefined);
    assert.equal(observeWorkingRender(() => "unused"), undefined);
    assert.equal(hasNativeFooterRenderer(), true, "unrelated native footer remains recognized");
    let resolver: unknown;
    const tools = createToolsControl({ registerToolRenderer: (value) => { resolver = value; } } as ExtensionAPI);
    try {
      assert.equal(typeof resolver, "function", "public tool rendering remains available");
      assert.equal(tools.on(), "OMT tools on.");
    } finally { tools.cleanup?.(); }
  } finally {
    prototype.createExtensionUIContext = context;
    AssistantMessageComponent.prototype.render = assistant;
    workingHost.showWorkingStatusIndicator = working;
  }
});

test("unrecognized footer storage is not exposed as an empty native footer", () => {
  const restore = observeNativeUIOwnership();
  try {
    assert.ok(restore);
    assert.equal(prototype.createExtensionUIContext.call({}).getFooterComponent, undefined);
  } finally { restore?.(); }
});

test("footer render wrappers are detected even with the native method name", () => {
  const original = FooterComponent.prototype.render;
  assert.equal(hasNativeFooterRenderer(), true);
  FooterComponent.prototype.render = function render(width) { return original.call(this, width); };
  try { assert.equal(hasNativeFooterRenderer(), false); }
  finally { FooterComponent.prototype.render = original; }
});

test("missing footer ownership view fails safely without modifying setFooter", () => {
  const control = createFooterControl({ on: () => () => {} } as unknown as ExtensionAPI);
  const setFooter = () => { throw new Error("Must not claim an unobservable footer"); };
  const ctx = { mode: "tui", ui: { setFooter } } as unknown as ExtensionContext;
  try {
    assert.match(control.on(ctx), /unavailable/);
    assert.match(control.off(ctx), /unavailable/);
    assert.equal(ctx.ui.setFooter, setFooter);
  } finally { control.cleanup?.(ctx); }
});

test("native renderer detection allows built-ins and rejects partial foreign overrides", () => {
  const isNative = nativeToolRenderers();
  const definitions = { read: createReadToolDefinition("."), write: createWriteToolDefinition("."), edit: createEditToolDefinition("."), bash: createBashToolDefinition(".") };
  for (const [name, definition] of Object.entries(definitions)) {
    const candidate = definition as unknown as ToolRenderers;
    assert.equal(isNative(name, candidate), true, name);
    assert.equal(isNative(name, { ...candidate, renderResult: () => ({ render: () => ["foreign"], invalidate() {} }) }), false);
  }
});

test("streaming bash creates no timers and expanded interruption keeps every output line", (t) => {
  const timer = t.mock.method(globalThis, "setInterval", () => { throw new Error("No OMT polling"); });
  initTheme("dark");
  const component = new ToolExecutionComponent("bash", "stream", { command: "echo 你好" }, {}, createCleanBashRenderer(), tui, process.cwd());
  component.markExecutionStarted();
  component.updateResult({ content: [{ type: "text", text: "progress" }], isError: false }, true);
  component.render(40);
  const output = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
  component.updateResult({ content: [{ type: "text", text: output }], details: { exitCode: 130 }, isError: true });
  component.setExpanded(true);
  const expanded = stripTerminalSequences(component.render(80).join("\n"));
  assert.match(expanded, /line 0\s*\n/);
  assert.ok(expanded.includes("line 19"));
  assert.equal(timer.mock.callCount(), 0);
});

test("public tool toggles preserve captured rows and restore subsequent rows", () => {
  let resolve: Parameters<ExtensionAPI["registerToolRenderer"]>[0];
  const control = createToolsControl({ registerToolRenderer: (resolver) => { resolve = resolver; } } as ExtensionAPI);
  const native = createReadToolDefinition(".") as unknown as ToolRenderers;
  const clean = resolve!("read", () => native);
  control.off();
  assert.equal(resolve!("read", () => native), native);
  assert.equal(clean?.renderShell, "self", "Pi captures row renderers; documented restoration boundary");
  control.cleanup?.();
});

test("all presets adapt across dark, light, and system themes with proper transparency and alignment", () => {
  setCleanPalette({});
  const control = createUserMessageControl();
  try {
    for (const palette of ["dark", "light", "system"]) {
      initTheme(palette);
      const theme = prototype.createExtensionUIContext.call({}).theme;
      const keys = new KeybindingsManager(TUI_KEYBINDINGS);

      for (const presetName of THEME_NAMES) {
        setActiveTheme(presetName);
        control.applyTheme?.();
        const editor = new CleanEditor(tui, { borderColor: (s) => s, selectList: getSelectListTheme() }, keys as PiKeys, () => theme);
        editor.setText("preset check 你好");
        const message = new UserMessageComponent("preset check 你好");
        const tool = new ToolExecutionComponent("read", "visual", { path: "check.ts" }, {}, createCleanReadRenderer(), tui, process.cwd());
        tool.updateResult({ content: [{ type: "text", text: "ok" }], isError: false });

        for (const width of [20, 60, 100]) {
          const editorLines = editor.render(width);
          const messageLines = message.render(width);
          const toolLines = tool.render(width);
          const footer = formatFooterLine(width, theme, { branch: "main", extensionStatuses: [], modelId: "test-model" });

          for (const line of [...editorLines, ...messageLines, ...toolLines, footer]) {
            assert.ok(visibleWidth(line) <= width, `${palette} ${presetName} width=${width} overflow: ${line}`);
          }

          const bg = theme.bg("userMessageBg", "surface").split("surface")[0]!;
          if (bg && width >= 40) {
            if (presetName === "omt-clean") {
              assert.equal(editorLines[1]!.includes("\x1b[48;"), false, "Clean is transparent without a reported terminal background");
            } else if (presetName === "omt-rail") {
              assert.ok(editorLines[1]!.includes("\x1b[48;"), "Rail has its own element panel");
              assert.equal(stripTerminalSequences(editorLines[1]!).indexOf("┃"), 2);
              assert.equal(stripTerminalSequences(messageLines[1]!).indexOf("preset check"), 5);
            } else if (presetName !== "native") {
              assert.ok(!editorLines[1]!.includes(bg), `${presetName} editor stays transparent`);
            }
            assert.ok(!toolLines.join("").includes(bg), "tools stay transparent across all presets");
            assert.ok(!footer.includes(bg), "footer stays transparent across all presets");
          }
        }
      }
    }
  } finally {
    control.cleanup?.();
    resetActiveTheme();
  }
});
