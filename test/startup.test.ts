import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { CustomEditor, InteractiveMode, initTheme, getSelectListTheme, type ExtensionContext, type ExtensionUIContext, type KeybindingsManager as PiKeys } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, TUI_KEYBINDINGS, stripTerminalSequences, type TUI } from "@earendil-works/pi-tui";
import { createEditorControl, CleanEditor } from "../extensions/omt/features/editor/index.ts";
import { getActiveTheme, resetActiveTheme, setActiveTheme } from "../extensions/omt/core/theme.ts";
import { observeNativeUIOwnership, readNativeTerminalColors } from "../extensions/omt/core/native-ui.ts";
import { setCleanPalette } from "../extensions/omt/presets/omt-clean/rendering.ts";

test("Pi 1.5.0 exposes extension UI only after the renderer starts (host boundary)", () => {
  // Check the real installed host, not a simulated ordering. A changed upstream
  // boundary should fail this test and trigger removal of the documented limit.
  const source = InteractiveMode.prototype.init.toString();
  const ordered = ["this.ui.start()", "this.themeController.applyFromSettings()", "await this.themeController.waitForTerminalColors()", "this.shouldShowStartupHeader()", "ensureTool(\"fd\"", "await this.rebindCurrentSession()", "this.renderInitialMessages()", "this.ui.renderNow()"];
  let offset = -1;
  for (const step of ordered) {
    const next = source.indexOf(step);
    assert.ok(next > offset, `native startup order: ${step}`);
    offset = next;
  }
  const entry = readFileSync(new URL("../extensions/omt/integration/runtime.ts", import.meta.url), "utf8");
  const startup = entry.slice(entry.indexOf('pi.on("session_start"'));
  const selection = startup.indexOf("setActiveTheme(initial ?? saved)");
  const activation = startup.indexOf("activateComponents(ctx)");
  assert.ok(selection >= 0 && activation > selection, "select preset before mounting components");
  assert.doesNotMatch(entry, /setHeader|quietStartup|setTimeout|\.init\s*=/, "no header suppression, waits or init interception");
});

test("first Clean frame reuses confirmed native terminal replies without a second query", (t) => {
  initTheme("dark"); setActiveTheme("omt-clean");
  const restore = observeNativeUIOwnership();
  assert.ok(restore);
  t.after(() => { restore(); setCleanPalette({}); resetActiveTheme(); });
  const foreground = { r: 221, g: 221, b: 221 }, background = { r: 16, g: 16, b: 16 };
  const controller = { waitForTerminalColors() {}, terminalColors: { foreground, background } };
  const host = { themeController: controller };
  const ui = (InteractiveMode.prototype as any).createExtensionUIContext.call(host);
  const snapshot = readNativeTerminalColors(ui)!;
  assert.deepEqual(snapshot, { foreground, background });
  snapshot.background!.r = 99;
  assert.equal(background.r, 16, "read-only boundary does not leak mutable native state");
  let queries = 0;
  const tui = { terminal: { rows: 32, columns: 80 }, requestRender() {}, queryTerminalColors: async () => { queries++; return {}; } } as unknown as TUI;
  setCleanPalette({});
  const editor = new CleanEditor(tui, { borderColor: (text) => text, selectList: getSelectListTheme() }, new KeybindingsManager(TUI_KEYBINDINGS) as PiKeys,
    () => ui.theme, () => "", () => readNativeTerminalColors(ui));
  assert.equal(queries, 0);
  assert.match(editor.render(80).join("\n"), /\x1b\[48;2;44;44;44m/, "source-derived prompt fill exists on the first render");
  editor.refreshPresentation(); assert.equal(queries, 0);
  for (const terminalColors of [{}, { foreground, background: { r: -1, g: 0, b: 0 } }, { foreground, background: { r: 1.5, g: 0, b: 0 } }]) {
    const unsupported = (InteractiveMode.prototype as any).createExtensionUIContext.call({ themeController: { waitForTerminalColors() {}, terminalColors } });
    assert.equal(readNativeTerminalColors(unsupported), undefined, "unconfirmed/invalid replies use public fallback");
  }
  assert.equal(readNativeTerminalColors((InteractiveMode.prototype as any).createExtensionUIContext.call({})), undefined);
});

test("preset switches reuse the owned editor with native cursor, undo, paste and completion state", async (t) => {
  initTheme("dark"); resetActiveTheme();
  t.after(resetActiveTheme);
  const palette = (InteractiveMode.prototype as any).createExtensionUIContext.call({}).theme;
  const keys = new KeybindingsManager(TUI_KEYBINDINGS) as PiKeys;
  const tui = { terminal: { columns: 80, rows: 32 }, requestRender() {} } as TUI;
  const editorTheme = { borderColor: (text: string) => text, selectList: getSelectListTheme() };
  let current: CustomEditor = new CustomEditor(tui, editorTheme, keys);
  let factory: Parameters<ExtensionUIContext["setEditorComponent"]>[0];
  let mounts = 0;
  const ctx = { mode: "tui", ui: {
    theme: palette, getEditorComponent: () => factory,
    getEditorText: () => current.getExpandedText(), setEditorText: (text: string) => current.setText(text),
    setEditorComponent: (next: typeof factory) => {
      mounts++; factory = next;
      current = next ? next(tui, editorTheme, keys) as CustomEditor : new CustomEditor(tui, editorTheme, keys);
      current.setPaddingX(1);
    },
  } } as unknown as ExtensionContext;
  const control = createEditorControl();
  t.after(() => control.cleanup(ctx));
  control.on(ctx);
  const owned = current as CleanEditor;
  owned.setText("draft 你好\nsecond line"); owned.handleInput("\x1b[D"); owned.handleInput("X");
  const text = owned.getText(), cursor = owned.getCursor();
  owned.setAutocompleteProvider({ getSuggestions: async () => ({ prefix: "/om", items: [{ value: "/omt", label: "/omt" }] }),
    applyCompletion: (_lines, line, _col, item) => ({ lines: [item.value], cursorLine: line, cursorCol: item.value.length }) });
  for (const preset of ["omt-rail", "omt-ember", "minimal", "omt-clean"]) {
    setActiveTheme(preset); control.applyTheme(ctx);
    assert.equal(current, owned); assert.equal(mounts, 1);
    assert.equal(owned.getText(), text); assert.deepEqual(owned.getCursor(), cursor);
    assert.equal(owned.getPaddingX(), getActiveTheme().spacing.content, "padding contracts again after Rail");
    for (const width of [20, 40, 80, 120]) assert.ok(owned.render(width).every((row) => !stripTerminalSequences(row).includes("undefined")));
  }
  owned.handleInput("\x1f"); assert.ok(!owned.getText().includes("X"), "undo history survives switching");
  owned.setText("/om"); owned.handleInput("\t");
  await new Promise((resolve) => setTimeout(resolve, 30));
  const before = owned.render(80).slice(3).map(stripTerminalSequences);
  assert.ok(before.length > 0, "native completion is open");
  setActiveTheme("ember"); control.applyTheme(ctx);
  assert.deepEqual(owned.render(80).slice(3).map(stripTerminalSequences), before);
  owned.setPaddingX(8); setActiveTheme("rail"); control.applyTheme(ctx);
  assert.equal(owned.getPaddingX(), 8, "larger configured native output padding wins");
  const foreign = () => new CustomEditor(tui, editorTheme, keys);
  factory = foreign; control.applyTheme(ctx);
  assert.equal(factory, foreign); assert.equal(mounts, 1, "do not refresh/reclaim a foreign editor");
});
