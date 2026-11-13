import assert from "node:assert/strict";
import { test } from "node:test";
import { CustomEditor, InteractiveMode, initTheme, type KeybindingsManager as PiKeys } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, KeybindingsManager, TUI_KEYBINDINGS, stripTerminalSequences, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { CleanEditor } from "../extensions/omt/presets/shared/editor.ts";
import { resetActiveTheme, setActiveTheme } from "../extensions/omt/core/theme.ts";

function fixture(text: string) {
  initTheme("dark");
  const theme = (InteractiveMode.prototype as any).createExtensionUIContext.call({}).theme;
  const keys = new KeybindingsManager({ ...TUI_KEYBINDINGS, "app.interrupt": { defaultKeys: "escape" } }) as PiKeys;
  const tui = { terminal: { columns: 80, rows: 49 }, requestRender() {} } as unknown as TUI;
  const editorTheme = { borderColor: (s: string) => s, selectList: {
    selectedPrefix: (s: string) => s, selectedText: (s: string) => s, description: (s: string) => s,
    scrollInfo: (s: string) => s, noMatch: (s: string) => s,
  } };
  const clean = new CleanEditor(tui, editorTheme, keys, () => theme, () => "fixture-model", () => undefined, { framed: true });
  const native = new CustomEditor(tui, editorTheme, keys);
  native.setPaddingX(clean.getPaddingX());
  for (const editor of [native, clean]) { editor.focused = true; editor.setText(text); }
  return { native, clean };
}
function cursor(lines: string[]) {
  const row = lines.findIndex(line => line.includes(CURSOR_MARKER));
  assert.ok(row >= 0, "focused editor emits its native hardware cursor marker");
  return { row, col: visibleWidth(lines[row]!.split(CURSOR_MARKER)[0]!) };
}
function mouse(y: number, width = 80) {
  return { type: "click" as const, button: "left" as const, x: 6, y, screenX: 6, screenY: y, width, height: 49, shift: false, alt: false, ctrl: false };
}

test("signature presents exactly three text rows and six composer rows without changing native buffer/cursor", () => {
  setActiveTheme("omt-signature");
  try {
    for (const text of ["", "界 é 👩🏽‍💻", "one\ntwo\nthree", "界".repeat(160), Array.from({ length: 25 }, (_, i) => `line ${i}`).join("\n")]) {
      const { native, clean } = fixture(text);
      for (const width of [20, 40, 80, 192]) {
        const nativeRows = native.render(width);
        const rows = clean.render(width);
        assert.equal(rows.length, 6);
        assert.ok(rows.every(line => visibleWidth(line) === width));
        const actualCursor = cursor(rows);
        const nativeCursor = cursor(nativeRows);
        assert.ok(actualCursor.row >= 1 && actualCursor.row <= 3);
        assert.equal(actualCursor.col, nativeCursor.col);
        assert.deepEqual(clean.getCursor(), native.getCursor());
        assert.equal(clean.getExpandedText(), native.getExpandedText());
        assert.ok(stripTerminalSequences(rows[actualCursor.row]!).startsWith("│ "));
        assert.ok(stripTerminalSequences(rows[actualCursor.row]!).endsWith(" │"));
        if (text === "") {
          assert.ok(stripTerminalSequences(rows[1]!).includes("Type a message"));
          assert.ok(stripTerminalSequences(rows[1]!).startsWith("│ ❯ "));
        } else {
          assert.equal(
            stripTerminalSequences(rows[actualCursor.row]!).slice(4, -1),
            stripTerminalSequences(nativeRows[nativeCursor.row]!).slice(4, -1),
          );
        }
      }
    }
  } finally { resetActiveTheme(); }
});

test("cropped display rows map mouse clicks back to the native editor viewport", () => {
  setActiveTheme("omt-signature");
  try {
    const { native, clean } = fixture(Array.from({ length: 25 }, (_, i) => `line ${i} 界`).join("\n"));
    const originalText = native.getText();
    const nativeRows = native.render(80);
    const rows = clean.render(80);
    const offset = cursor(nativeRows).row - cursor(rows).row;
    assert.ok(offset > 0, "fixture actually crops a taller native viewport");
    native.handleMouse(mouse(2 + offset));
    clean.handleMouse(mouse(2));
    assert.deepEqual(clean.getCursor(), native.getCursor());
    assert.equal(clean.getText(), originalText);
    assert.equal(native.getText(), originalText);
    assert.equal(clean.render(80).length, 6);
  } finally { resetActiveTheme(); }
});

test("empty padding rows focus the existing line and statusline never edits input", () => {
  setActiveTheme("omt-signature");
  try {
    const { native, clean } = fixture("hello");
    native.render(80); clean.render(80);
    native.handleMouse(mouse(1));
    clean.handleMouse(mouse(3));
    assert.deepEqual(clean.getCursor(), native.getCursor());
    const before = clean.getCursor();
    assert.equal(clean.handleMouse(mouse(4))?.handled, true);
    assert.deepEqual(clean.getCursor(), before);
    assert.equal(clean.getText(), "hello");
    setActiveTheme("native");
    assert.deepEqual(clean.render(80), native.render(80), "leaving signature restores native geometry on the same instance");
  } finally { resetActiveTheme(); }
});

test("autocomplete mouse rows map across signature padding and statusline", async () => {
  setActiveTheme("omt-signature");
  try {
    const { native, clean } = fixture("/mo");
    for (const editor of [native, clean]) {
      editor.setAutocompleteProvider({
        getSuggestions: async () => ({ prefix: "/mo", items: [{ value: "/model", label: "model choice" }, { value: "/models", label: "models choice" }] }),
        applyCompletion: (_lines, line, _col, item) => ({ lines: [item.value], cursorLine: line, cursorCol: item.value.length }),
      });
      editor.handleInput("\t");
    }
    await new Promise(resolve => setTimeout(resolve, 30));
    const nativeRows = native.render(80);
    const rows = clean.render(80);
    const nativeRow = nativeRows.findIndex(row => stripTerminalSequences(row).includes("model choice"));
    const actualRow = rows.findIndex(row => stripTerminalSequences(row).includes("model choice"));
    assert.ok(nativeRow >= 0 && actualRow >= 6);
    native.handleMouse(mouse(nativeRow));
    clean.handleMouse(mouse(actualRow));
    assert.equal(clean.getText(), native.getText());
    assert.equal(clean.getText(), "/model");
  } finally { resetActiveTheme(); }
});

test("a later onSubmit decorator can retain and invoke the previous wrapper without recursion", async () => {
  setActiveTheme("omt-signature");
  try {
    const { clean } = fixture("");
    const submissions: string[] = [];
    clean.onSubmit = text => { submissions.push(text); };
    const previous = clean.onSubmit!;
    assert.equal(clean.onSubmit, previous, "public handler identity is stable between assignments");
    clean.onSubmit = text => previous(`decorated:${text}`);
    await clean.onSubmit!("hello");
    assert.deepEqual(submissions, ["decorated:hello"]);
    clean.onSubmit = undefined;
    assert.equal(clean.onSubmit, undefined);
  } finally { resetActiveTheme(); }
});
