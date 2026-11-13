import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AssistantMessageComponent,
  CustomEditor,
  InteractiveMode,
  UserMessageComponent,
  ToolExecutionComponent,
  initTheme,
  getSelectListTheme,
  Theme,
  type KeybindingsManager as PiKeys,
} from "@earendil-works/pi-coding-agent";
import {
  KeybindingsManager,
  TUI_KEYBINDINGS,
  stripTerminalSequences,
  visibleWidth,
  type TUI,
} from "@earendil-works/pi-tui";
import {
  THEME_NAMES,
  THEME_PRESETS,
  resolveThemeName,
  signaturePreset,
  signatureBackgroundPalette,
  getPresetBackgroundDefaults,
} from "../extensions/omt/presets/index.ts";
import { getActiveTheme, resetActiveTheme, setActiveTheme } from "../extensions/omt/core/theme.ts";
import { CleanEditor } from "../extensions/omt/features/editor/index.ts";
import { createUserMessageControl } from "../extensions/omt/features/user-message/index.ts";
import {
  createSignatureToolRenderer,
} from "../extensions/omt/presets/omt-signature/tools.ts";
import {
  formatFooterLine,
  type FooterRenderData,
} from "../extensions/omt/features/footer/index.ts";
import { CleanHeaderComponent } from "../extensions/omt/features/header/index.ts";
import { signatureSpinner } from "../extensions/omt/presets/omt-signature/motion.ts";
import { signatureWorking } from "../extensions/omt/presets/omt-signature/working.ts";

const proto = InteractiveMode.prototype as unknown as {
  createExtensionUIContext(this: unknown): { theme: Theme };
};
const tui = { terminal: { rows: 30, columns: 80 }, requestRender() {} } as TUI;

function getTheme(appearance: "dark" | "light" = "dark"): Theme {
  initTheme(appearance);
  return proto.createExtensionUIContext.call({}).theme;
}

test("omt-signature preset definition has all semantic tokens and correct aliases", () => {
  resetActiveTheme();
  assert.equal(getActiveTheme().id, "omt-signature");
  assert.equal(getActiveTheme().label, "OMT Signature");

  assert.equal(resolveThemeName("omt-signature"), "omt-signature");
  assert.equal(resolveThemeName("signature"), "omt-signature");
  assert.equal(resolveThemeName("omt"), "omt-signature");

  assert.equal(THEME_PRESETS["omt-signature"], signaturePreset);
  assert.equal(THEME_PRESETS.omt, signaturePreset);
  assert.equal(THEME_PRESETS.signature, signaturePreset);

  assert.equal(signaturePreset.glyph.prompt, "◈");
  assert.equal(signaturePreset.glyph.running, "◈");
  assert.equal(signaturePreset.glyph.success, "✔");
  assert.equal(signaturePreset.glyph.failure, "✖");
  assert.equal(signaturePreset.glyph.interrupted, "■");
  assert.equal(signaturePreset.glyph.branch, "⎇ ");

  assert.equal(signaturePreset.thinking.indicator, "◈");
  assert.equal(signaturePreset.thinking.label, "Reasoning");
  assert.equal(signaturePreset.editor.frame, "line");
  assert.equal(signaturePreset.panelBg, false);
});

test("omt-signature editor preserves native input geometry and status borders without overflow", () => {
  const theme = getTheme("dark");
  const keys = new KeybindingsManager(TUI_KEYBINDINGS);
  setActiveTheme("omt-signature");

  for (const width of [120, 80, 50, 40, 20]) {
    const editor = new CleanEditor(
      tui,
      { borderColor: (s) => s, selectList: getSelectListTheme() },
      keys as PiKeys,
      () => theme,
      () => "claude-3-5-sonnet",
      () => undefined,
      { framed: true },
    );
    editor.setText("const greeting = 'hello world';");
    const lines = editor.render(width);
    // OMT 6-row composer presentation: top border, 3 text rows, statusline, bottom border
    assert.equal(lines.length, 6, "Composer must have exactly 6 rows (top + 3 text + statusline + bottom)");

    for (const line of lines) {
      assert.equal(
        visibleWidth(line),
        width,
        `Line length ${visibleWidth(line)} must exactly match target ${width}: ${line}`,
      );
    }

    const stripped = lines.map(stripTerminalSequences);
    assert.ok(stripped[0]!.startsWith("╭"), "framed top border starts with ╭");
    assert.ok(stripped[0]!.endsWith("╮"), "framed top border ends with ╮");
    if (width >= 40) {
      assert.ok(stripped[1]!.startsWith("│ ❯ "), "first text row presents signature prompt");
      assert.ok(stripped[1]!.includes("const greeting = 'hello world'"));
    } else {
      assert.ok(stripped[1]!.startsWith("│ "), "first visible row is framed");
    }
    if (width >= 40) {
      assert.ok(stripped[4]!.includes("↵ send"), "statusline includes idle hint when space permits");
    }
    assert.ok(stripped[4]!.includes("claude-3-5-sonn"), "statusline includes model label");
    assert.ok(stripped[5]!.startsWith("╰"), "framed bottom border starts with ╰");
    assert.ok(stripped[5]!.endsWith("╯"), "framed bottom border ends with ╯");

    // Real native state invariance checks
    const native = new CustomEditor(tui, { borderColor: (s) => s, selectList: getSelectListTheme() }, keys as PiKeys);
    native.setPaddingX(editor.getPaddingX());
    native.setText(editor.getText());
    assert.equal(editor.getText(), native.getText(), "native text buffer invariance");
    assert.deepEqual(editor.getCursor(), native.getCursor(), "native cursor coordinate invariance");
    assert.equal(editor.getExpandedText(), native.getExpandedText(), "native expanded text invariance");
    const nativeStripped = native.render(width).map(stripTerminalSequences);
    if (width >= 40) {
      assert.equal(
        stripped[1]!.slice(4, -1),
        nativeStripped[1]!.slice(4, -1),
        "inner text row content matches native CustomEditor exactly",
      );
    }
  }
  resetActiveTheme();
});

test("omt-signature tools render all tool types with clean cards and diffs", () => {
  const theme = getTheme("dark");
  setActiveTheme("omt-signature");

  const readRenderer = createSignatureToolRenderer("read");
  const writeRenderer = createSignatureToolRenderer("write");
  const editRenderer = createSignatureToolRenderer("edit");
  const bashRenderer = createSignatureToolRenderer("bash");
  const grepRenderer = createSignatureToolRenderer("grep");
  const customRenderer = createSignatureToolRenderer("subagent");

  const mockCtx = {
    args: {},
    state: {},
    cwd: "/workspace/project",
    outputPad: 1,
    isPartial: false,
    isError: false,
    durationMs: 145,
    keyText: () => "ctrl+o",
    keyHint: (_: string, t: string) => `ctrl+o ${t}`,
  } as any;

  for (const width of [120, 80, 40, 20]) {
    // 1. Read tool call & result
    const readCall = readRenderer.renderCall!({ path: "src/main.ts" }, theme, mockCtx);
    const readCallLines = readCall.render(width);
    assert.ok(readCallLines.length >= 1);
    assert.ok(visibleWidth(readCallLines[0]!) <= width);
    assert.ok(stripTerminalSequences(readCallLines[0]!).includes("Read"));
    if (width >= 40) {
      assert.ok(stripTerminalSequences(readCallLines[0]!).includes("src/main.ts"));
    }

    const readResult = readRenderer.renderResult!(
      { content: [{ type: "text", text: "line 1\nline 2\nline 3\n" }], details: undefined },
      { expanded: false, isPartial: false },
      theme,
      mockCtx,
    );
    const readResultLines = readResult.render(width);
    for (const line of readResultLines) assert.ok(visibleWidth(line) <= width);

    // 2. Write tool
    const writeCall = writeRenderer.renderCall!({ path: "src/new.ts" }, theme, mockCtx);
    const writeLines = writeCall.render(width);
    assert.ok(writeLines.length >= 1);
    assert.ok(visibleWidth(writeLines[0]!) <= width);
    assert.ok(stripTerminalSequences(writeLines[0]!).includes("Write"));

    // 3. Edit tool with diff
    const editCall = editRenderer.renderCall!({ path: "src/utils.ts" }, theme, mockCtx);
    const editCallLines = editCall.render(width);
    assert.ok(editCallLines.length >= 1);
    assert.ok(visibleWidth(editCallLines[0]!) <= width);
    assert.ok(stripTerminalSequences(editCallLines[0]!).includes("Edit"));

    const diff = "--- a/src/utils.ts\n+++ b/src/utils.ts\n@@ -1,3 +1,3 @@\n-const a = 1;\n+const a = 2;\n";
    const editResult = editRenderer.renderResult!(
      { content: [], details: { diff } },
      { expanded: true, isPartial: false },
      theme,
      { ...mockCtx, args: { path: "src/utils.ts" } },
    );
    const editResultLines = editResult.render(width);
    assert.ok(editResultLines.length >= 1);
    for (const line of editResultLines) assert.ok(visibleWidth(line) <= width);

    // 4. Bash tool
    const bashCall = bashRenderer.renderCall!({ command: "npm test" }, theme, mockCtx);
    const bashCallLines = bashCall.render(width);
    assert.ok(bashCallLines.length >= 1);
    assert.ok(visibleWidth(bashCallLines[0]!) <= width);
    assert.ok(stripTerminalSequences(bashCallLines[0]!).includes("Bash"));
    assert.ok(stripTerminalSequences(bashCallLines[0]!).includes("npm test"));

    // 5. Grep tool
    const grepCall = grepRenderer.renderCall!({ pattern: "interface", path: "src" }, theme, mockCtx);
    const grepCallLines = grepCall.render(width);
    assert.ok(grepCallLines.length >= 1);
    assert.ok(visibleWidth(grepCallLines[0]!) <= width);
    assert.ok(stripTerminalSequences(grepCallLines[0]!).includes("Grep"));

    // 6. Custom/subagent tool
    const customCall = customRenderer.renderCall!({ task: "run tests" }, theme, mockCtx);
    const customCallLines = customCall.render(width);
    assert.ok(customCallLines.length >= 1);
    assert.ok(visibleWidth(customCallLines[0]!) <= width);
    assert.ok(stripTerminalSequences(customCallLines[0]!).includes("Subagent"));
  }

  resetActiveTheme();
});

test("omt-signature footer adapts across viewport widths from 120 down to 10 columns", () => {
  const theme = getTheme("dark");
  setActiveTheme("omt-signature");

  const data: FooterRenderData = {
    outputPad: 1,
    branch: "main",
    cwd: "/workspace/project",
    extensionStatuses: ["ready"],
    activity: { type: "tool", name: "bash", detail: "npm test" },
    contextUsage: { percent: 42, contextWindow: 200000 },
    modelId: "gpt-4o",
    reasoning: true,
    thinkingLevel: "high",
  };

  for (const width of [120, 100, 80, 60, 45, 30, 20, 10]) {
    const rendered = formatFooterLine(width, theme, data);
    const vis = visibleWidth(rendered);
    assert.ok(vis <= width, `Width overflow at ${width}: visible=${vis}`);
    assert.ok(rendered.length > 0);

    const plain = stripTerminalSequences(rendered);
    if (width >= 80) {
      assert.ok(plain.includes("gpt-4o"));
      assert.ok(plain.includes("42%"));
      assert.ok(plain.includes("main"));
      assert.ok(plain.includes("npm test"));
    } else if (width >= 45) {
      assert.ok(plain.includes("gpt-4o"));
      assert.ok(plain.includes("42%"));
    } else if (width >= 20) {
      assert.ok(plain.includes("gpt-4o"));
    }
  }

  resetActiveTheme();
});

test("omt-signature user message renders with signature prompt glyph and proper indent", () => {
  const control = createUserMessageControl();
  try {
    const theme = getTheme("dark");
    setActiveTheme("omt-signature");

    const message = new UserMessageComponent("Please optimize the application.");
    for (const width of [120, 80, 40, 20]) {
      const lines = message.render(width);
      for (const line of lines) assert.ok(visibleWidth(line) <= width);

      const stripped = lines.map(stripTerminalSequences);
      assert.ok(stripped[0]!.includes("●"), "Row 0 must contain OMT gutter bullet ●");
      assert.ok(stripped[0]!.includes("╭"), "Row 0 must contain top rounded border ╭");
      assert.ok(stripped[1]!.includes("│"), "Row 1 must be framed with │");
      assert.ok(stripped.some((l) => l.includes("Please")), "Must contain message text 'Please'");
      if (width >= 40) {
        assert.ok(stripped[1]!.includes("Please optimize"));
      }
      assert.ok(stripped.at(-1)!.includes("╰"), "Last row must contain bottom rounded border ╰");
    }
  } finally {
    control.cleanup?.();
    resetActiveTheme();
  }
});

test("CleanHeaderComponent renders compact visual identity without horizontal overflow", () => {
  const theme = getTheme("dark");

  // 1. Populated session under omt-signature: single line <= 48 display columns
  setActiveTheme("omt-signature");
  const populatedCtx = {
    cwd: "/workspace/repo",
    sessionManager: {
      getSessionName: () => "feature-signature",
      getEntries: () => [{ type: "message", role: "user" }],
    },
    model: { name: "Claude 3.5 Sonnet", id: "claude-3-5-sonnet" },
  } as any;

  const header = new CleanHeaderComponent(() => theme, () => populatedCtx);

  for (const width of [120, 80, 60, 40, 20]) {
    const lines = header.render(width);
    assert.equal(lines.length, 1, "Populated session header must be exactly 1 line");
    for (const line of lines) {
      assert.ok(visibleWidth(line) <= width, `Header overflow at width ${width}: ${line}`);
    }
    const plain = stripTerminalSequences(lines[0]!);
    assert.ok(plain.includes("feature-signature"));
    assert.ok(visibleWidth(plain) <= 48, "Header text must be truncated to at most 48 display cells");
  }

  // 2. Empty session under omt-signature: includes OMT welcome banner
  const emptyCtx = {
    cwd: "/workspace/repo",
    sessionManager: {
      getSessionName: () => "empty-signature",
      getEntries: () => [],
    },
  } as any;
  const emptyHeader = new CleanHeaderComponent(() => theme, () => emptyCtx);
  const wideLines = emptyHeader.render(80);
  assert.ok(wideLines.length > 5, "Empty session header must include welcome banner");
  const wideText = wideLines.map(stripTerminalSequences).join("\n");
  assert.ok(wideText.includes("OMT"));
  assert.ok(wideText.includes("Resources"));
  assert.ok(wideText.includes("New session started"));

  for (const width of [120, 80, 60, 40, 20]) {
    const lines = emptyHeader.render(width);
    assert.ok(lines.length > 5, "Empty session header must include welcome banner");
    for (const line of lines) {
      assert.ok(visibleWidth(line) <= width, `Header overflow at width ${width}: ${line}`);
    }
  }

  // 3. Standard preset (codex-inspired): compact 1-2 lines with brand title
  setActiveTheme("codex-inspired");
  const codexHeader = new CleanHeaderComponent(() => theme, () => populatedCtx);
  for (const width of [120, 80, 60, 40, 20]) {
    const lines = codexHeader.render(width);
    assert.ok(lines.length >= 1 && lines.length <= 2, "Standard header must be compact (1-2 lines)");
    for (const line of lines) {
      assert.ok(visibleWidth(line) <= width, `Header overflow at width ${width}: ${line}`);
    }
    const plain = stripTerminalSequences(lines[0]!);
    assert.ok(plain.includes("Oh My TUI"));
  }

  resetActiveTheme();
});

test("omt-signature spinner and working progress indicators", () => {
  const theme = getTheme("dark");
  setActiveTheme("omt-signature");

  // Motion spinner rotates through diamond glyphs
  const f0 = signatureSpinner(0, true);
  const f1 = signatureSpinner(100, true);
  const f2 = signatureSpinner(200, true);
  const f3 = signatureSpinner(300, true);
  const f4 = signatureSpinner(400, true);

  assert.equal(f0, "◈");
  assert.equal(f1, "◇");
  assert.equal(f2, "◆");
  assert.equal(f3, "◇");
  assert.equal(f4, "◈");

  // Reduced motion returns static glyph
  assert.equal(signatureSpinner(150, false), "◈");

  // Working line rendering
  const workingRow = signatureWorking.render(theme, 2400, "Reasoning", "esc", 80);
  assert.ok(visibleWidth(workingRow) <= 80);
  const plain = stripTerminalSequences(workingRow);
  assert.ok(plain.includes("Reasoning"));
  assert.ok(!plain.includes("2s"), "do not invent native phase timing");
  assert.ok(!plain.includes("esc to interrupt"), "do not promise an unconfigured interrupt binding");
  assert.deepEqual(signatureWorking.indicator, { frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], intervalMs: 500 });

  resetActiveTheme();
});

test("omt-signature background configuration and palette defaults", () => {
  const defaults = getPresetBackgroundDefaults("omt-signature");
  assert.ok(defaults);
  assert.equal(defaults.scene, "star-voyage");
  assert.equal(defaults.framing, "rule");

  assert.deepEqual(signatureBackgroundPalette.primary, [139, 92, 246]);
  assert.deepEqual(signatureBackgroundPalette.secondary, [56, 189, 248]);
  assert.equal(signatureBackgroundPalette.defaultScene, "star-voyage");
});
