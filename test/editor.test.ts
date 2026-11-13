import assert from "node:assert/strict";
import { test } from "node:test";
import { CustomEditor, Theme, type KeybindingsManager as PiKeys } from "@earendil-works/pi-coding-agent";
import {
  CURSOR_MARKER, KeybindingsManager, type TUI, TUI_KEYBINDINGS,
  setKeybindings, stripTerminalSequences, visibleWidth, type Terminal,
} from "@earendil-works/pi-tui";
import { CleanEditor, createEditorControl } from "../extensions/omt/features/editor/index.ts";
import { setActiveTheme, resetActiveTheme } from "../extensions/omt/core/theme.ts";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const keys = new KeybindingsManager({
  ...TUI_KEYBINDINGS,
  "app.interrupt": { defaultKeys: "escape" },
  "app.exit": { defaultKeys: "ctrl+d" },
  "app.clipboard.pasteImage": { defaultKeys: "ctrl+v" },
  "app.model.cycleForward": { defaultKeys: "ctrl+p" },
});
setKeybindings(keys);
const theme = new Theme(
  { dim: "#777777", muted: "#aaaaaa", text: "#eeeeee", thinkingXhigh: "#eeeeee" } as ConstructorParameters<typeof Theme>[0],
  { userMessageBg: "#202020", selectedBg: "#303030" } as ConstructorParameters<typeof Theme>[1],
  "truecolor",
);
const editorTheme = {
  borderColor: (text: string) => text,
  selectList: {
    selectedPrefix: (text: string) => text,
    selectedText: (text: string) => text,
    description: (text: string) => text,
    scrollInfo: (text: string) => text,
    noMatch: (text: string) => text,
  },
};
function editors() {
  setActiveTheme("omt-clean");
  const tui = { terminal: { rows: 30, columns: 80 } as Terminal, requestRender() {} } as TUI;
  const native = new CustomEditor(tui, editorTheme, keys as PiKeys);
  const clean = new CleanEditor(tui, editorTheme, keys as PiKeys, () => theme);
  native.setPaddingX(2);
  native.focused = clean.focused = true;
  return { native, clean };
}

test("clean frame preserves native Unicode wrapping, cursor geometry, scrolling and resize", () => {
  const { native, clean } = editors();
  for (const text of ["", "你好 e\u0301 👩🏽‍💻 🇻🇳", "漢字🙂".repeat(35), Array.from({ length: 25 }, (_, i) => `line ${i}`).join("\n")]) {
    native.setText(text);
    clean.setText(text);
    for (const width of [80, 20, 10, 9, 8, 120, 30]) {
      const baseline = native.render(width);
      const actual = clean.render(width);
      assert.equal(actual.length, baseline.length);
      for (let row = 0; row < actual.length; row++) {
        assert.ok(visibleWidth(actual[row]!) <= width, `row fits at width ${width}`);
        if (row > 0 && row < actual.length - 1) {
          const plain = stripTerminalSequences(actual[row]!);
          const expected = stripTerminalSequences(baseline[row]!);
          assert.equal(plain, width >= 10 && row === 1 ? `›${expected.slice(1)}` : expected);
        }
      }
      const cursor = (lines: string[]) => lines.map((line, row) => ({ row, line }))
        .filter(({ line }) => line.includes(CURSOR_MARKER))
        .map(({ row, line }) => [row, visibleWidth(line.split(CURSOR_MARKER)[0]!)]);
      assert.deepEqual(cursor(actual), cursor(baseline));
      assert.equal(cursor(actual).length, 1);
    }
  }
});

test("native input, history, paste, undo, multiline and submission remain unchanged", () => {
  const { native, clean } = editors();
  const outputs: string[][] = [[], []];
  [native, clean].forEach((editor, i) => {
    editor.onSubmit = (text) => outputs[i]!.push(text);
    editor.addToHistory("earlier 你好");
  });
  const paste = "多行🙂\n".repeat(20);
  for (const input of ["\x1b[A", "\x1b[B", "a", "你", "e\u0301", "👩🏽‍💻", "\x1b[D", "\x7f", "\x1b[13;2u", "second", "\x1b[200~" + paste + "\x1b[201~", "\x1b[D", "\x1b[C", "\x1f", "\r"]) {
    for (const editor of [native, clean]) { editor.render(30); editor.handleInput(input); }
    assert.equal(clean.getText(), native.getText());
    assert.equal(clean.getExpandedText(), native.getExpandedText());
    assert.deepEqual(clean.getCursor(), native.getCursor());
    assert.deepEqual(outputs[1], outputs[0]);
  }
  assert.equal(outputs[1]!.length, 1);
});

test("narrow empty composer and native mouse hit-testing keep row/column geometry", () => {
  const { native, clean } = editors();
  for (const width of [1, 2, 5, 9]) {
    assert.deepEqual(clean.render(width), native.render(width));
  }
  for (const editor of [native, clean]) {
    editor.setText("hello 你好\nsecond line");
    editor.render(40);
    editor.handleMouse({ type: "click", button: "left", x: 6, y: 1, screenX: 6, screenY: 1, width: 40, height: 4, shift: false, alt: false, ctrl: false });
  }
  assert.deepEqual(clean.getCursor(), native.getCursor());
});

test("completion, attachment paste shortcut and application actions remain native", async () => {
  const { native, clean } = editors();
  for (const editor of [native, clean]) {
    editor.setAutocompleteProvider({
      getSuggestions: async () => ({ prefix: "/om", items: [{ value: "/omt", label: "/omt" }] }),
      applyCompletion: (_lines, line, _col, item) => ({ lines: [item.value], cursorLine: line, cursorCol: item.value.length }),
    });
    editor.setText("/om");
    editor.handleInput("\t");
  }
  await new Promise((resolve) => setTimeout(resolve, 30));
  const nativeMenu = native.render(40);
  const cleanMenu = clean.render(40);
  assert.ok(nativeMenu.length > 3, "completion menu is visible");
  assert.deepEqual(cleanMenu.slice(3).map(stripTerminalSequences), nativeMenu.slice(3).map(stripTerminalSequences));
  const bg = theme.bg("userMessageBg", "test").split("test")[0]!;
  for (const line of cleanMenu.slice(3)) {
    assert.ok(!line.includes(bg), "autocomplete menu stays on native popover surface");
  }
  for (const editor of [native, clean]) editor.handleInput("\t");
  assert.equal(clean.getText(), native.getText());
  assert.ok(clean.getText().startsWith("/omt"));
  let attachments = 0;
  let models = 0;
  clean.onPasteImage = () => { attachments++; clean.insertTextAtCursor("[image #1]"); };
  clean.onAction("app.model.cycleForward", () => { models++; });
  clean.handleInput("\x16");
  clean.handleInput("\x10");
  assert.equal(attachments, 1);
  assert.equal(models, 1);
  assert.ok(clean.getText().includes("[image #1]"));
  assert.equal(clean.embedWorkingStatus, false);
});

test("unsupported APIs and non-TUI modes safely keep the native editor", () => {
  const control = createEditorControl();
  for (const mode of ["rpc", "json", "print", "tui"] as const) {
    const ctx = { mode, ui: {} } as ExtensionContext;
    assert.match(control.on(ctx), /unavailable/);
    assert.match(control.off(ctx), /unavailable/);
  }
  control.cleanup();
});
