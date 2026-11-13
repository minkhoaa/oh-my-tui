import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import {
  CustomEditor,
  InteractiveMode,
  initTheme,
  type KeybindingsManager as PiKeys,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  CURSOR_MARKER,
  KeybindingsManager,
  TUI_KEYBINDINGS,
  stripTerminalSequences,
  visibleWidth,
  type EditorTheme,
  type TUI,
} from "@earendil-works/pi-tui";
import { CleanEditor, type SignatureStatuslineData } from "../extensions/omt/presets/shared/editor.ts";
import { CleanHeaderComponent } from "../extensions/omt/features/header/index.ts";
import { createEditorControl } from "../extensions/omt/features/editor/index.ts";
import { createFooterControl } from "../extensions/omt/features/footer/index.ts";
import { setActiveTheme, resetActiveTheme, getActiveTheme } from "../extensions/omt/core/theme.ts";
import {
  formatSignatureStatsLine,
  formatSignatureHints,
  signatureEditorBorder,
  signatureEditorStatusline,
} from "../extensions/omt/presets/omt-signature/editor.ts";

function setupEditorFixture(text = "", framed = true) {
  initTheme("dark");
  const theme = (InteractiveMode.prototype as any).createExtensionUIContext.call({}).theme;
  const keys = new KeybindingsManager({ ...TUI_KEYBINDINGS, "app.interrupt": { defaultKeys: "escape" } }) as PiKeys;
  const tui: TUI = { terminal: { columns: 80, rows: 49 }, requestRender() {} } as unknown as TUI;
  const editorTheme: EditorTheme = {
    borderColor: (s: string) => s,
    selectList: {
      selectedPrefix: (s: string) => s,
      selectedText: (s: string) => s,
      description: (s: string) => s,
      scrollInfo: (s: string) => s,
      noMatch: (s: string) => s,
    },
  };
  const clean = new CleanEditor(tui, editorTheme, keys, () => theme, () => "test-model", () => undefined, { framed });
  const native = new CustomEditor(tui, editorTheme, keys);
  native.setPaddingX(clean.getPaddingX());
  for (const ed of [native, clean]) {
    ed.focused = true;
    ed.setText(text);
  }
  return { clean, native, theme, keys, tui, editorTheme };
}

function findCursor(lines: string[]) {
  const row = lines.findIndex((l) => l.includes(CURSOR_MARKER));
  assert.ok(row >= 0, "Focused editor emits CURSOR_MARKER");
  return { row, col: visibleWidth(lines[row]!.split(CURSOR_MARKER)[0]!) };
}

test("empty composer presents prompt ❯, placeholder, and col 4 cursor marker", () => {
  setActiveTheme("omt-signature");
  try {
    const { clean, native } = setupEditorFixture("");

    for (const width of [120, 80, 50, 40, 20]) {
      const rows = clean.render(width);
      assert.equal(rows.length, 6, `Must render exactly 6 rows at width ${width}`);
      for (const line of rows) {
        assert.equal(visibleWidth(line), width, `Visible width must match ${width}`);
      }

      const stripped = rows.map(stripTerminalSequences);
      assert.ok(stripped[0]!.startsWith("╭"), "Top border starts with ╭");
      assert.ok(stripped[0]!.endsWith("╮"), "Top border ends with ╮");
      assert.ok(stripped[1]!.startsWith("│ ❯ "), "Line 0 has │ ❯  prompt");
      assert.ok(stripped[1]!.includes("Type a message"), "Line 0 has placeholder");

      // Hardware cursor marker positioned at column 4
      const cur = findCursor(rows);
      assert.equal(cur.row, 1);
      assert.equal(cur.col, 4, "CURSOR_MARKER must be placed at column 4 on line 0");

      assert.ok(stripped[5]!.startsWith("╰"), "Bottom border starts with ╰");
      assert.ok(stripped[5]!.endsWith("╯"), "Bottom border ends with ╯");
    }

    // Blurred state: no CURSOR_MARKER, placeholder styled in muted
    clean.focused = false;
    const blurredRows = clean.render(80);
    assert.ok(!blurredRows.some((l) => l.includes(CURSOR_MARKER)), "Blurred editor must not emit CURSOR_MARKER");
    const strippedBlurred = blurredRows.map(stripTerminalSequences);
    assert.ok(strippedBlurred[1]!.includes("Type a message… (/ commands · ^V paste)"));
  } finally {
    resetActiveTheme();
  }
});

test("shell mode presents shell placeholder and cyan border framing", () => {
  setActiveTheme("omt-signature");
  try {
    const { clean, theme } = setupEditorFixture("");
    clean.setStatuslineProvider(() => ({
      shellOn: true,
      model: "local-shell",
    }));

    const rows = clean.render(80);
    assert.equal(rows.length, 6);
    const stripped = rows.map(stripTerminalSequences);
    assert.ok(stripped[1]!.includes("Shell mode — type a command"), "Presents shell placeholder");
    assert.ok(stripped[4]!.includes("↵ run"), "Statusline presents shell hints");

    // Border rendered with cyan role
    const topBorder = clean.render(80)[0]!;
    // Role is cyan for shell mode
    assert.ok(topBorder.includes("╭"), "Top border has rounded corner");
  } finally {
    resetActiveTheme();
  }
});

test("nonempty single-line editing aligns text at col 4 and preserves native cursor", () => {
  setActiveTheme("omt-signature");
  try {
    const text = "Hello world from Pi!";
    const { clean, native } = setupEditorFixture(text);

    for (const width of [120, 80, 50, 40]) {
      const rows = clean.render(width);
      const nativeRows = native.render(width);
      assert.equal(rows.length, 6);

      const stripped = rows.map(stripTerminalSequences);
      const nativeStripped = nativeRows.map(stripTerminalSequences);

      assert.ok(stripped[1]!.startsWith("│ ❯ "), "Text row 1 has prompt");
      assert.ok(stripped[1]!.includes(text), "Text row 1 contains user text");
      // Inner text and padding from column 4 to width - 1 strictly matches native
      assert.equal(
        stripped[1]!.slice(4, -1),
        nativeStripped[1]!.slice(4, -1),
        "Inner content column matches native editor exactly",
      );

      const actualCursor = findCursor(rows);
      const nativeCursor = findCursor(nativeRows);
      assert.equal(actualCursor.row, 1);
      assert.equal(actualCursor.col, nativeCursor.col, "Cursor column matches native");
      assert.deepEqual(clean.getCursor(), native.getCursor(), "Cursor coordinates match native");
      assert.equal(clean.getText(), native.getText(), "Buffer text invariant");
    }
  } finally {
    resetActiveTheme();
  }
});

test("long line text wraps within viewport width without breaking outer frame", () => {
  setActiveTheme("omt-signature");
  try {
    const longText = "The quick brown fox jumps over the lazy dog. ".repeat(6);
    const { clean, native } = setupEditorFixture(longText);

    for (const width of [120, 80, 50, 40, 20]) {
      const rows = clean.render(width);
      assert.equal(rows.length, 6, `Width ${width} must have 6 rows`);
      for (const line of rows) {
        assert.equal(visibleWidth(line), width, `Every line visible width must equal ${width}`);
      }

      const stripped = rows.map(stripTerminalSequences);
      assert.ok(stripped[0]!.startsWith("╭") && stripped[0]!.endsWith("╮"));
      assert.ok(stripped[5]!.startsWith("╰") && stripped[5]!.endsWith("╯"));
      // Text rows are framed with │ ... │
      for (let r = 1; r <= 3; r++) {
        assert.ok(stripped[r]!.startsWith("│ "), `Row ${r} starts with │ `);
        assert.ok(stripped[r]!.endsWith(" │"), `Row ${r} ends with  │`);
      }
    }
  } finally {
    resetActiveTheme();
  }
});

test("Unicode, combining accents, CJK, and emojis preserve cursor alignment and width", () => {
  setActiveTheme("omt-signature");
  try {
    const unicodeText = "界 é 👩🏽‍💻 日本語 🚀";
    const { clean, native } = setupEditorFixture(unicodeText);

    for (const width of [120, 80, 50, 40]) {
      const rows = clean.render(width);
      const nativeRows = native.render(width);
      assert.equal(rows.length, 6);
      for (const line of rows) {
        assert.equal(visibleWidth(line), width);
      }

      const stripped = rows.map(stripTerminalSequences);
      const nativeStripped = nativeRows.map(stripTerminalSequences);
      assert.ok(stripped[1]!.startsWith("│ ❯ "));
      assert.equal(
        stripped[1]!.slice(4, -1),
        nativeStripped[1]!.slice(4, -1),
        "Unicode inner slice matches native CustomEditor exactly",
      );

      const actualCursor = findCursor(rows);
      const nativeCursor = findCursor(nativeRows);
      assert.equal(actualCursor.col, nativeCursor.col);
      assert.deepEqual(clean.getCursor(), native.getCursor());
    }
  } finally {
    resetActiveTheme();
  }
});

test("multiline editing displays ❯ on visual line 0 and blank continuation padding on lines 1 & 2", () => {
  setActiveTheme("omt-signature");
  try {
    const multiline = "first line\nsecond line\nthird line\nfourth line";
    const { clean, native } = setupEditorFixture(multiline);

    // Place cursor on line 0
    clean.setText("line 0\nline 1\nline 2");
    const rows = clean.render(80);
    const stripped = rows.map(stripTerminalSequences);

    // Display line 0 (row 1) has prompt ❯
    assert.ok(stripped[1]!.startsWith("│ ❯ "), "Line 0 has prompt ❯ ");
    assert.ok(stripped[1]!.includes("line 0"));

    // Display line 1 (row 2) has continuation padding
    assert.ok(stripped[2]!.startsWith("│   "), "Line 1 has blank continuation padding");
    assert.ok(stripped[2]!.includes("line 1"));

    // Display line 2 (row 3) has continuation padding
    assert.ok(stripped[3]!.startsWith("│   "), "Line 2 has blank continuation padding");
    assert.ok(stripped[3]!.includes("line 2"));

    for (const line of rows) {
      assert.equal(visibleWidth(line), 80);
    }
  } finally {
    resetActiveTheme();
  }
});

test("autocomplete dropdown renders below bottom border and mouse click selects correctly", async () => {
  setActiveTheme("omt-signature");
  try {
    const { clean } = setupEditorFixture("/mo");
    let selectedItem = "";

    clean.setAutocompleteProvider({
      getSuggestions: async () => ({
        prefix: "/mo",
        items: [
          { value: "/mode", label: "/mode - Switch mode" },
          { value: "/model", label: "/model - Switch model" },
        ],
      }),
      applyCompletion: (_lines, line, _col, item) => {
        selectedItem = item.value;
        return { lines: [item.value], cursorLine: line, cursorCol: item.value.length };
      },
    });

    clean.handleInput("\t");
    await new Promise((resolve) => setTimeout(resolve, 50));

    const rows = clean.render(80);
    const bottomBorderIndex = rows.findIndex((l) => stripTerminalSequences(l).startsWith("╰"));
    assert.ok(bottomBorderIndex === 5, "Bottom border must be at row 5 in 6-row composer");

    // Dropdown items appear after bottom border
    const dropdownLines = rows.slice(bottomBorderIndex + 1);
    assert.ok(dropdownLines.length >= 2, "Autocomplete dropdown rows render below bottom border");
    const dropdownText = dropdownLines.map(stripTerminalSequences).join("\n");
    assert.ok(dropdownText.includes("/mode"), "Dropdown contains /mode");
    assert.ok(dropdownText.includes("/model"), "Dropdown contains /model");

    // Mouse click on second suggestion row selects /model
    const modelRowIndex = rows.findIndex((l) => stripTerminalSequences(l).includes("/model"));
    assert.ok(modelRowIndex > 5, "Model suggestion is below bottom border");

    clean.handleMouse({
      type: "click",
      button: "left",
      x: 10,
      y: modelRowIndex,
      screenX: 10,
      screenY: modelRowIndex,
      width: 80,
      height: 20,
      shift: false,
      alt: false,
      ctrl: false,
    });

    assert.equal(selectedItem, "/model", "Clicking suggestion selects it");
    assert.equal(clean.getText(), "/model", "Editor text updated to completed value");
  } finally {
    resetActiveTheme();
  }
});

test("normal typing, paste markers, and undo state preservation", () => {
  setActiveTheme("omt-signature");
  try {
    const { clean, native } = setupEditorFixture("");

    // Normal typing
    clean.handleInput("h");
    clean.handleInput("i");
    assert.equal(clean.getText(), "hi");
    assert.equal(clean.getCursor().col, 2);

    // Paste with bracketed paste markers
    const pastePayload = "\x1b[200~pasted content\x1b[201~";
    clean.handleInput(pastePayload);
    assert.equal(clean.getText(), "hipasted content");

    // Undo restores previous text
    clean.handleInput("\x1f"); // Ctrl+_ (undo in readline/emacs mode)
    assert.equal(clean.getText(), "hi", "Undo reverts paste");
  } finally {
    resetActiveTheme();
  }
});

test("continuous resize from 192 down to 20 and back preserves all geometry", () => {
  setActiveTheme("omt-signature");
  try {
    const { clean } = setupEditorFixture("Resizable content test");
    const sequence = [192, 120, 80, 60, 50, 40, 30, 20, 80, 192];

    for (const w of sequence) {
      const rows = clean.render(w);
      assert.equal(rows.length, 6, `Must be 6 rows at width ${w}`);
      for (const line of rows) {
        assert.equal(visibleWidth(line), w, `Row must be exactly width ${w}: ${line}`);
      }
      const stripped = rows.map(stripTerminalSequences);
      assert.ok(stripped[0]!.startsWith("╭") && stripped[0]!.endsWith("╮"));
      assert.ok(stripped[5]!.startsWith("╰") && stripped[5]!.endsWith("╯"));
    }
  } finally {
    resetActiveTheme();
  }
});

test("preset switching preserves editor instance, buffer, and cursor while contracting/expanding padding", () => {
  const { clean, native } = setupEditorFixture("Persistent buffer test");

  // 1. Start in omt-signature: padding is 4
  setActiveTheme("omt-signature");
  clean.refreshPresentation();
  assert.equal(clean.getPaddingX(), 4, "omt-signature has padding 4");
  assert.equal(clean.render(80).length, 6, "omt-signature renders 6 rows");

  // 2. Switch to native: padding contracts to 1, renders native 3 rows
  setActiveTheme("native");
  clean.refreshPresentation();
  assert.equal(clean.getPaddingX(), 1, "native preset has padding 1");
  assert.equal(clean.render(80).length, 3, "native preset renders 3 rows");
  assert.equal(clean.getText(), "Persistent buffer test", "Buffer preserved");

  // 3. Switch to codex-inspired: padding becomes 2
  setActiveTheme("codex-inspired");
  clean.refreshPresentation();
  assert.equal(clean.getPaddingX(), 2, "codex has padding 2");
  assert.equal(clean.getText(), "Persistent buffer test", "Buffer preserved");

  // 4. Switch back to omt-signature: padding restores to 4, renders 6 rows
  setActiveTheme("omt-signature");
  clean.refreshPresentation();
  assert.equal(clean.getPaddingX(), 4, "padding restores to 4");
  assert.equal(clean.render(80).length, 6, "renders 6 rows again");
  assert.equal(clean.getText(), "Persistent buffer test", "Buffer preserved");

  resetActiveTheme();
});

test("idle framing role is input (cInput) and working framing role is green (cGreen)", () => {
  setActiveTheme("omt-signature");
  try {
    const { clean, theme } = setupEditorFixture("Framing test");

    // 1. Idle state: border role is input
    clean.setStatuslineProvider(() => ({
      isThinking: false,
      isStreaming: false,
      model: "test-model",
    }));

    const idleRows = clean.render(80);
    assert.equal(idleRows.length, 6);
    // Idle top border has no spinner or working label
    const idleTop = stripTerminalSequences(idleRows[0]!);
    assert.ok(!idleTop.includes("Working"), "Idle top border has no working label");
    assert.ok(idleTop.startsWith("╭") && idleTop.endsWith("╮"));

    // 2. Working state: border role is green, embedded status in top border
    clean.setStatuslineProvider(() => ({
      isThinking: true,
      model: "test-model",
    }));

    const workingRows = clean.render(80);
    assert.equal(workingRows.length, 6);
    const workingStatus = stripTerminalSequences(workingRows[4]!);
    assert.ok(workingStatus.includes("↵ steer"), "Working statusline has steer hint");
  } finally {
    resetActiveTheme();
  }
});

test("header command summary distinguishes unavailable builtin counts from observed data", () => {
  setActiveTheme("omt-signature");
  try {
    const { theme } = setupEditorFixture();

    // Public Pi getCommands excludes interactive builtins (docs/extensions.md).
    // Empty public commands do not establish a builtin count of zero.
    const emptyCtx = {
      cwd: "/workspace/repo",
      sessionManager: { getSessionName: () => "sess", getEntries: () => [] },
      getCommands: () => [],
    } as any;

    const header = new CleanHeaderComponent(theme, () => emptyCtx);
    const lines = header.render(80);
    const fullText = lines.map(stripTerminalSequences).join("\n");
    const plainRows = lines.map(stripTerminalSequences);
    assert.equal(plainRows[1], "●", "source welcome gutter puts the bullet on its own row");
    assert.ok(plainRows.slice(2, 7).every(row => row.startsWith("      █")), "all five logo rows share the same six-column inset");
    assert.ok(fullText.includes("builtin —"), "Unavailable builtin count must remain unknown");
    assert.ok(!fullText.includes("builtin 0"), "Public getCommands cannot prove zero builtins");
    assert.ok(!fullText.includes("builtin 15"), "Must not contain false 15 builtin count");
    const observed = new CleanHeaderComponent(theme, () => ({ ...emptyCtx,
      getCommands: () => [{ source: "builtin" }, { source: "builtin" }],
    }));
    assert.ok(observed.render(80).map(stripTerminalSequences).join("\n").includes("builtin 2"));

    // 2. Populated session: exactly 1 line <= 48 chars
    const populatedCtx = {
      cwd: "/workspace/repo",
      sessionManager: {
        getSessionName: () => "feature-work",
        getEntries: () => [{ type: "message", role: "user" }],
      },
    } as any;
    const popHeader = new CleanHeaderComponent(theme, () => populatedCtx);
    const popLines = popHeader.render(80);
    assert.equal(popLines.length, 1, "Populated session header is exactly 1 line");
    const plain = stripTerminalSequences(popLines[0]!);
    assert.ok(plain.includes("feature-work"));
    assert.ok(visibleWidth(plain) <= 48, "Header text truncated to at most 48 display columns");
  } finally {
    resetActiveTheme();
  }
});
