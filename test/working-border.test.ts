import test from "node:test";
import assert from "node:assert/strict";
import { initTheme, InteractiveMode, type KeybindingsManager as PiKeys } from "@earendil-works/pi-coding-agent";
import { Loader, KeybindingsManager, TUI_KEYBINDINGS, CURSOR_MARKER, stripTerminalSequences, visibleWidth, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import { CleanEditor } from "../extensions/omt/presets/shared/editor.ts";
import { signatureEditorBorder } from "../extensions/omt/presets/omt-signature/editor.ts";
import { signatureWorkingLine } from "../extensions/omt/presets/omt-signature/working.ts";
import { accessibilityStore } from "../extensions/omt/features/accessibility/model.ts";
import { setActiveTheme, resetActiveTheme } from "../extensions/omt/core/theme.ts";

function palette() { initTheme("dark"); return (InteractiveMode.prototype as any).createExtensionUIContext.call({}).theme; }

test("working borders retain full width with the real status prefix padding, Unicode and ASCII framing", () => {
  const theme = palette();
  const previous = accessibilityStore.isPlainTextAsciiBorders();
  try {
    for (const ascii of [false, true]) {
      accessibilityStore.setPlainTextAsciiBorders(ascii);
      for (const width of [60, 80, 158]) for (const dashes of [1, 2]) for (const spaces of [1, 3, 5]) {
        const title = "⠋ Đang đọc 界 é · 7s";
        const prefix = "─".repeat(dashes) + " ".repeat(spaces);
        const raw = prefix + title + " " + "─".repeat(width - visibleWidth(prefix + title) - 1);
        for (const declaredWidth of [undefined, width]) {
          const actual = stripTerminalSequences(signatureEditorBorder(theme, raw, { position: "top", framed: true, role: "green", width: declaredWidth }));
          assert.equal(visibleWidth(actual), width, `prefix=${JSON.stringify(prefix)}, width=${width}, ascii=${ascii}`);
          assert.ok(actual.includes(title));
          assert.ok(actual.endsWith(ascii ? "+" : "╮"));
        }
      }
    }
  } finally { accessibilityStore.setPlainTextAsciiBorders(previous); }
});

test("native CustomEditor working indicator stays aligned with body/status/bottom across phase changes and resize", () => {
  const theme = palette(); setActiveTheme("omt-signature");
  const tui = { terminal: { rows: 49, columns: 192 }, requestRender() {} } as unknown as TUI;
  const editorTheme: EditorTheme = { borderColor: s => s, selectList: { selectedPrefix: s => s, selectedText: s => s, description: s => s, scrollInfo: s => s, noMatch: s => s } };
  const keys = new KeybindingsManager(TUI_KEYBINDINGS) as PiKeys;
  const editor = new CleanEditor(tui, editorTheme, keys, () => theme, () => "", () => undefined, { framed: true });
  editor.focused = true; editor.setText("draft 界 é");
  let phase = "Working... 7s";
  const loader = new Loader(tui, s => s, s => s, "Working"); loader.stop();
  const indicator = Object.assign(loader, {
    kind: "working" as const,
    renderInBorder: (width: number) => signatureWorkingLine(theme, 0, phase, "esc", width),
    renderSpinnerInBorder: (_width: number) => "⠋",
    dispose: () => loader.stop(),
  });
  try {
    editor.setWorkingStatusIndicator(indicator);
    for (phase of ["Working... 7s", "Streaming... 17s", "Đang đọc 界 é · 100s"]) for (const width of [10, 20, 40, 80, 158, 40]) {
      const rows = editor.render(width);
      const plain = rows.map(stripTerminalSequences);
      assert.equal(rows.length, 6);
      assert.ok(plain[0]!.startsWith("╭") && plain[0]!.endsWith("╮"), plain[0]);
      assert.ok(plain.at(-1)!.endsWith("╯"));
      assert.ok(rows.every(row => visibleWidth(row) === width), plain.map(row => `${visibleWidth(row)}:${row}`).join("\n"));
      assert.ok(rows.some(row => row.includes(CURSOR_MARKER)), "native cursor/IME marker is preserved");
      assert.equal(editor.getText(), "draft 界 é");
    }
    editor.setWorkingStatusIndicator(undefined);
    assert.ok(editor.render(158).every(row => visibleWidth(row) === 158));
  } finally { editor.setWorkingStatusIndicator(undefined); indicator.dispose(); resetActiveTheme(); }
});
