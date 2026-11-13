import test from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { Theme, CustomEditor, type ExtensionContext, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import {
  CURSOR_MARKER,
  stripTerminalSequences,
  visibleWidth,
  type EditorTheme,
  type TUI,
  type TuiMouseEvent,
} from "@earendil-works/pi-tui";
import { CleanEditor, type SignatureStatuslineData } from "../extensions/omt/presets/shared/editor.ts";
import { CleanHeaderComponent } from "../extensions/omt/features/header/index.ts";
import { createFooterControl, CleanFooterComponent, OMT_FOOTER_OWNER } from "../extensions/omt/features/footer/index.ts";
import { createEditorControl } from "../extensions/omt/features/editor/index.ts";
import { setActiveTheme, resetActiveTheme } from "../extensions/omt/core/theme.ts";
import {
  formatSignatureStatsLine,
  formatSignatureHints,
  signatureEditorStatusline,
} from "../extensions/omt/presets/omt-signature/editor.ts";

function createMockTheme(): Theme {
  return new Theme(
    { dim: "#777777", muted: "#aaaaaa", text: "#eeeeee", thinkingXhigh: "#eeeeee", accent: "#a6e3a1" } as any,
    { userMessageBg: "#202020", selectedBg: "#303030" } as any,
    "truecolor" as any,
  );
}

const mockEditorTheme: EditorTheme = {
  borderColor: (s: string) => `\x1b[38;5;240m${s}\x1b[39m`,
  selectList: {
    selectedPrefix: (s: string) => s,
    selectedText: (s: string) => s,
    description: (s: string) => s,
    scrollInfo: (s: string) => s,
    noMatch: (s: string) => s,
  },
};

const mockKeys: KeybindingsManager = {
  matches: () => false,
  getKeybinding: () => undefined,
  formatKeybinding: () => "",
} as any;

const mockTui: TUI = {
  terminal: { rows: 30, columns: 80 } as any,
  requestRender: () => {},
} as any;

test("Header parity: renders single muted session · cwd line when populated, truncates to 48 chars", () => {
  setActiveTheme("omt-signature");
  try {
    const theme = createMockTheme();
    const home = homedir();
    const testCwd = `${home}/projects/my-repo`;

    // 1. Session with messages
    const mockCtx = {
      cwd: testCwd,
      sessionManager: {
        getSessionName: () => "feature-login",
        getEntries: () => [{ type: "message", role: "user" }],
      },
    } as any;

    const header = new CleanHeaderComponent(theme, () => mockCtx);
    const lines = header.render(120);

    // Must be exactly 1 line when populated
    assert.equal(lines.length, 1, "Populated session header must be exactly 1 line");

    const plain = stripTerminalSequences(lines[0]!);
    assert.ok(plain.startsWith("feature-login · ~/projects/my-repo"), `Header plain text mismatch: ${plain}`);
    assert.ok(visibleWidth(plain) <= 48, "Header text must be truncated to at most 48 display cells");

    // 2. Fallback when session name is absent, using shortened session ID
    const mockCtxSid = {
      cwd: testCwd,
      sessionManager: {
        getSessionName: () => "",
        getSessionId: () => "abcdef1234567890",
        getEntries: () => [{ type: "message", role: "user" }],
      },
    } as any;

    const headerSid = new CleanHeaderComponent(theme, () => mockCtxSid);
    const linesSid = headerSid.render(120);
    assert.equal(linesSid.length, 1);
    const plainSid = stripTerminalSequences(linesSid[0]!);
    assert.ok(plainSid.startsWith("abcdef12 · ~/projects/my-repo"));

    // 3. Narrow terminal: strictly bounded by width
    for (const w of [40, 25, 10]) {
      const narrowLines = header.render(w);
      for (const line of narrowLines) {
        assert.ok(visibleWidth(line) <= w, `Header overflowed at width ${w}`);
      }
    }
  } finally {
    resetActiveTheme();
  }
});

test("Header parity: empty chat renders single muted session · cwd header followed by OMT welcomeView", () => {
  setActiveTheme("omt-signature");
  try {
    const theme = createMockTheme();
    const mockCtx = {
      cwd: "/home/user/work",
      sessionManager: {
        getSessionName: () => "empty-sess",
        getEntries: () => [],
      },
    } as any;

    const header = new CleanHeaderComponent(theme, () => mockCtx);
    const lines = header.render(100);

    // Empty session renders header + welcome banner
    assert.ok(lines.length > 5, `Empty session must render welcome banner, got ${lines.length} lines`);

    const plainHeader = stripTerminalSequences(lines[0]!);
    assert.ok(plainHeader.includes("empty-sess"));

    const fullText = lines.map(stripTerminalSequences).join("\n");
    assert.ok(fullText.includes("●"), "Must contain gutter bullet ●");
    assert.ok(fullText.includes("█████"), "Must contain OMT 5x5 block logo glyphs");
    assert.ok(fullText.includes("OMT"), "Must contain OMT title");
    assert.ok(fullText.includes("/ commands · ! bash · ctrl+o more"), "Must contain OMT hints");
    assert.ok(fullText.includes("ready"), "Must contain ready label");
    assert.ok(fullText.includes("Resources"), "Must contain Resources line");
    assert.ok(fullText.includes("New session started"), "Must contain New session started");

    // Width containment check across widths
    for (const w of [120, 80, 60, 40, 20]) {
      const rendered = header.render(w);
      for (const ln of rendered) {
        assert.ok(visibleWidth(ln) <= w, `Welcome line overflowed width ${w}: ${ln}`);
      }
    }
  } finally {
    resetActiveTheme();
  }
});

test("Statusline formatting: zero/unknown stats displays only model without false 0% or $0.00", () => {
  // 1. Zero/unknown stats: only model
  const zeroData: SignatureStatuslineData = {
    model: "claude-3-5-sonnet",
    contextUsage: { percent: 0 },
    totalTokens: 0,
    cost: 0,
  };
  const zeroStats = formatSignatureStatsLine(zeroData);
  assert.equal(zeroStats, "claude-3-5-sonnet", "Zero stats must only show model label");
  assert.ok(!zeroStats.includes("0%"), "Must not display 0%");
  assert.ok(!zeroStats.includes("$0.00"), "Must not display $0.00");

  // 2. Active stats with context %, tokens, and cost
  const activeData: SignatureStatuslineData = {
    model: "claude-3-5-sonnet",
    agent: "reviewer",
    contextUsage: { percent: 42.4 },
    totalTokens: 28400,
    cost: 0.12,
  };
  const activeStats = formatSignatureStatsLine(activeData);
  assert.ok(activeStats.includes("claude-3-5-sonnet · @reviewer"), "Includes model and agent");
  assert.ok(activeStats.includes("42%"), "Includes rounded context percentage");
  assert.ok(activeStats.includes("28.4k"), "Formats tokens with k suffix");
  assert.ok(activeStats.includes("$0.12"), "Includes cost");

  // 3. Extension status prefix
  const withExt: SignatureStatuslineData = {
    ...activeData,
    extStat: "LSP: 0 err",
  };
  const withExtStats = formatSignatureStatsLine(withExt);
  assert.ok(withExtStats.startsWith("LSP: 0 err · "), "Extension status prepended");
});

test("Statusline hints formatting: idle vs working vs armed states", () => {
  const idleData: SignatureStatuslineData = {};
  assert.equal(formatSignatureHints(idleData), "↵ send · / commands · @ files · ^P model · ^C quit");

  const runningData: SignatureStatuslineData = { isThinking: true };
  assert.equal(formatSignatureHints(runningData), "↵ steer · ⌥↵ follow-up · Esc×2 cancel");

  const armedData: SignatureStatuslineData = { isThinking: true, escArmed: true };
  assert.equal(formatSignatureHints(armedData), "press Esc again to cancel");

  const shellData: SignatureStatuslineData = { shellOn: true };
  assert.equal(formatSignatureHints(shellData), "↵ run · ↑↓ history · ^V paste · ^C clear/quit · Esc exit");
});

test("Composer parity: CleanEditor renders rounded frame and integrated statusline above bottom border", () => {
  setActiveTheme("omt-signature");
  try {
    const theme = createMockTheme();
    const clean = new CleanEditor(
      mockTui,
      mockEditorTheme,
      mockKeys,
      () => theme,
      () => "claude-3-5-sonnet",
      () => undefined,
      { framed: true },
    );

    clean.setText("Hello OMT parity");
    const width = 60;
    const lines = clean.render(width);

    // Composer box structure:
    // lines[0]: top border ╭────────────╮
    // lines[1..N-2]: textarea content │ Hello... │
    // lines[N-2]: integrated statusline │ ↵ send ... model │
    // lines[N-1]: bottom border ╰────────────╯
    assert.ok(lines.length >= 4, `Expected at least 4 lines (top + text + statusline + bottom), got ${lines.length}`);

    const topBorder = stripTerminalSequences(lines[0]!);
    assert.ok(topBorder.startsWith("╭"), "Top border must start with ╭");
    assert.ok(topBorder.endsWith("╮"), "Top border must end with ╮");
    assert.equal(visibleWidth(topBorder), width);

    const textRow = stripTerminalSequences(lines[1]!);
    assert.ok(textRow.startsWith("│ "), "Text row must be framed on left with │ ");
    assert.ok(textRow.endsWith(" │"), "Text row must be framed on right with  │");
    assert.ok(textRow.includes("Hello OMT parity"), "Must contain entered text");
    assert.equal(visibleWidth(textRow), width);

    const statuslineRow = stripTerminalSequences(lines[lines.length - 2]!);
    assert.ok(statuslineRow.startsWith("│ "), "Statusline row must be framed on left with │ ");
    assert.ok(statuslineRow.endsWith(" │"), "Statusline row must be framed on right with  │");
    assert.ok(statuslineRow.includes("claude-3-5-sonnet"), "Statusline row must contain model");
    assert.ok(statuslineRow.includes("↵ send"), "Statusline row must contain idle hints");
    assert.equal(visibleWidth(statuslineRow), width);

    const bottomBorder = stripTerminalSequences(lines[lines.length - 1]!);
    assert.ok(bottomBorder.startsWith("╰"), "Bottom border must start with ╰");
    assert.ok(bottomBorder.endsWith("╯"), "Bottom border must end with ╯");
    assert.equal(visibleWidth(bottomBorder), width);
  } finally {
    resetActiveTheme();
  }
});

test("Cursor marker preservation: hardware cursor and visual positioning remain intact with framed decoration", () => {
  setActiveTheme("omt-signature");
  try {
    const theme = createMockTheme();
    const clean = new CleanEditor(
      mockTui,
      mockEditorTheme,
      mockKeys,
      () => theme,
      () => "claude-3-5-sonnet",
      () => undefined,
      { framed: true },
    );

    clean.focused = true;
    clean.setText("const greeting = 'hello world';");
    const width = 80;
    const lines = clean.render(width);

    // Find the text line with the cursor
    const cursorLine = lines.find((ln) => ln.includes(CURSOR_MARKER));
    assert.ok(cursorLine, "One text line must contain CURSOR_MARKER when focused");

    // Check CURSOR_MARKER was not overwritten or corrupted
    const markerIndex = cursorLine.indexOf(CURSOR_MARKER);
    assert.ok(markerIndex > 0, "CURSOR_MARKER must have valid column index");

    // The text row must be framed properly without shifting cursor column
    const stripped = stripTerminalSequences(cursorLine);
    assert.ok(stripped.startsWith("│ "), "Decorated line starts with border │ ");
    assert.ok(stripped.endsWith(" │"), "Decorated line ends with border  │");
    assert.equal(visibleWidth(stripped), width);
  } finally {
    resetActiveTheme();
  }
});

test("Autocomplete handling: dropdown renders below bottom border and mouse click row is adjusted", async () => {
  setActiveTheme("omt-signature");
  try {
    const theme = createMockTheme();
    const clean = new CleanEditor(
      mockTui,
      mockEditorTheme,
      mockKeys,
      () => theme,
      () => "claude-3-5-sonnet",
      () => undefined,
      { framed: true },
    );

    clean.focused = true;
    let completionSelected = "";
    clean.setAutocompleteProvider({
      getSuggestions: async () => ({
        prefix: "/mod",
        items: [
          { value: "/model", label: "/model - Switch model" },
          { value: "/mode", label: "/mode - Switch mode" },
        ],
      }),
      applyCompletion: (_lines, line, _col, item) => {
        completionSelected = item.value;
        return { lines: [item.value], cursorLine: line, cursorCol: item.value.length };
      },
    });

    clean.setText("/mod");
    clean.handleInput("\t");
    await new Promise((resolve) => setTimeout(resolve, 50));

    const lines = clean.render(60);
    // Find bottom border
    const bottomBorderIndex = lines.findIndex((ln) => stripTerminalSequences(ln).startsWith("╰"));
    assert.ok(bottomBorderIndex > 0, "Bottom border must exist");

    // Autocomplete dropdown rows must be AFTER bottom border
    const dropdownLines = lines.slice(bottomBorderIndex + 1);
    assert.ok(dropdownLines.length > 0, "Autocomplete dropdown rows must render below bottom border");
    const dropdownText = dropdownLines.map(stripTerminalSequences).join("\n");
    assert.ok(dropdownText.includes("/model"), "Dropdown must contain suggestions");

    // Mouse hit test on statusline must be safely consumed without mis-indexing editor text
    const host = clean as unknown as { renderedVisibleLineCount: number };
    const statuslineRow = (host.renderedVisibleLineCount ?? 1) + 1;
    const res = clean.handleMouse({
      type: "click",
      button: "left",
      x: 10,
      y: statuslineRow,
      screenX: 10,
      screenY: statuslineRow,
      width: 60,
      height: 10,
      shift: false,
      alt: false,
      ctrl: false,
    });
    assert.equal(res?.handled, true, "Click on statusline must be handled without error");
  } finally {
    resetActiveTheme();
  }
});

test("Preset switching: preserves exact same editor instance, buffer, and cursor while updating dynamic embedWorkingStatus", () => {
  const theme = createMockTheme();
  const clean = new CleanEditor(
    mockTui,
    mockEditorTheme,
    mockKeys,
    () => theme,
    () => "model-a",
  );

  clean.setText("persistent text buffer across presets");

  // 1. Initial signature preset
  setActiveTheme("omt-signature");
  clean.refreshPresentation();
  assert.equal(clean.embedWorkingStatus, true, "embedWorkingStatus must be true under omt-signature");

  // 2. Switch to codex-inspired: same instance, text preserved, embedWorkingStatus false
  setActiveTheme("codex-inspired");
  clean.refreshPresentation();
  assert.equal(clean.getText(), "persistent text buffer across presets");
  assert.equal(clean.embedWorkingStatus, false, "embedWorkingStatus must be false under codex-inspired");

  // 3. Switch to native: same instance, text preserved, embedWorkingStatus false
  setActiveTheme("native");
  clean.refreshPresentation();
  assert.equal(clean.getText(), "persistent text buffer across presets");
  assert.equal(clean.embedWorkingStatus, false, "embedWorkingStatus must be false under native");

  // 4. Switch back to omt-signature: same instance, text preserved, embedWorkingStatus true
  setActiveTheme("omt-signature");
  clean.refreshPresentation();
  assert.equal(clean.getText(), "persistent text buffer across presets");
  assert.equal(clean.embedWorkingStatus, true, "embedWorkingStatus must be true under omt-signature again");

  resetActiveTheme();
});

test("Footer control: suppresses standalone footer under omt-signature via empty factory and restores on other presets", () => {
  const mockPi = {
    on: () => {},
    getSettings: () => ({ outputPad: 1 }),
  } as any;
  const control = createFooterControl(mockPi);
  let currentFooterComponent: any = undefined;
  let currentFooterFactory: any = undefined;

  const mockCtx = {
    mode: "tui",
    ui: {
      setFooter: (factory: any) => {
        currentFooterFactory = factory;
        currentFooterComponent = factory ? factory(mockTui, createMockTheme(), {}) : undefined;
      },
      getFooterComponent: () => currentFooterFactory,
      theme: createMockTheme(),
    },
  } as any;

  // 1. omt-signature: footer component rendered lines must be empty (suppressed)
  setActiveTheme("omt-signature");
  control.on(mockCtx);

  assert.ok(currentFooterComponent, "Footer component was mounted");
  assert.deepEqual(currentFooterComponent.render(80), [], "Standalone footer must be suppressed under omt-signature (0 lines)");

  // 2. Switch to codex-inspired: standalone footer is restored and renders lines
  setActiveTheme("codex-inspired");
  control.applyTheme(mockCtx);
  assert.ok(currentFooterComponent instanceof CleanFooterComponent, "Restored CleanFooterComponent on codex-inspired");
  const codexLines = currentFooterComponent.render(80);
  assert.ok(codexLines.length >= 1, "Codex footer must render visible line(s)");

  // 3. Switch to native: setFooter(undefined) called
  setActiveTheme("native");
  control.applyTheme(mockCtx);
  assert.equal(currentFooterFactory, undefined, "Native theme must restore native footer with setFooter(undefined)");

  // 4. Third-party footer owner protection: must not overwrite foreign footer
  const foreignFactory = () => ({ render: () => ["foreign footer"] });
  mockCtx.ui.getFooterComponent = () => foreignFactory;

  setActiveTheme("omt-signature");
  control.applyTheme(mockCtx);
  assert.equal(mockCtx.ui.getFooterComponent(), foreignFactory, "Must not displace foreign footer owner");

  control.cleanup?.(mockCtx);
  resetActiveTheme();
});

test("Command routing: commandInterceptor intercepts commands before host onSubmit", async () => {
  const theme = createMockTheme();
  const clean = new CleanEditor(mockTui, mockEditorTheme, mockKeys, () => theme);

  let nativeSubmitted = "";
  let intercepted = "";

  // Host wires onSubmit
  clean.onSubmit = async (text: string) => {
    nativeSubmitted = text;
  };

  // Wire command interceptor
  clean.setCommandInterceptor(async (text: string) => {
    if (text.startsWith("/settings") || text.startsWith("/model")) {
      intercepted = text;
      return true; // handled
    }
    return false; // pass-through
  });

  // Submit /settings: intercepted, host NOT called
  const submit = clean.onSubmit;
  if (!submit) throw new Error("onSubmit is undefined");
  await submit("/settings");
  assert.equal(intercepted, "/settings");
  assert.equal(nativeSubmitted, "");

  // Submit regular text: pass-through to host
  await submit("regular prompt");
  assert.equal(nativeSubmitted, "regular prompt");
});
