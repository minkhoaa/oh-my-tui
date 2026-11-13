import assert from "node:assert/strict";
import { test } from "node:test";
import {
  InteractiveMode,
  UserMessageComponent,
  initTheme,
  getSelectListTheme,
  type KeybindingsManager as PiKeys,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, TUI_KEYBINDINGS, stripTerminalSequences, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { THEME_NAMES, THEME_PRESETS, resolveThemeName, type ThemeName } from "../extensions/omt/presets/index.ts";
import { getActiveTheme, resetActiveTheme, setActiveTheme } from "../extensions/omt/core/theme.ts";
import { getStateGlyph, getStateColor, type ObservableAgentState } from "../extensions/omt/presets/shared/style.ts";
import { CleanEditor } from "../extensions/omt/features/editor/index.ts";
import { createUserMessageControl } from "../extensions/omt/features/user-message/index.ts";
import { renderStatusIcon } from "../extensions/omt/features/tools/index.ts";
import { formatFooterLine, type FooterRenderData } from "../extensions/omt/features/footer/index.ts";

const prototype = InteractiveMode.prototype as unknown as { createExtensionUIContext(this: unknown): { theme: Theme } };
const tui = { terminal: { rows: 30, columns: 80 }, requestRender() {} } as TUI;

test("all theme presets exist with distinct semantic tokens and omt-signature as default", () => {
  resetActiveTheme();
  assert.equal(getActiveTheme().id, "omt-signature");
  assert.equal(getActiveTheme().label, "OMT Signature");
  assert.deepEqual(THEME_NAMES, ["omt-signature", "codex-inspired", "claude-code-inspired", "opencode-inspired", "minimal", "native"]);
  assert.equal(THEME_PRESETS.omt, THEME_PRESETS["omt-signature"]);
  assert.equal(THEME_PRESETS.signature, THEME_PRESETS["omt-signature"]);
  assert.equal(THEME_PRESETS.opencode, THEME_PRESETS["opencode-inspired"]);
  assert.equal(THEME_PRESETS.codex, THEME_PRESETS["codex-inspired"], "backward-compatible alias resolves to codex-inspired");

  for (const name of THEME_NAMES) {
    const preset = THEME_PRESETS[name];
    assert.ok(preset, `Preset ${name} must exist`);
    assert.equal(preset.id, name);
    assert.ok(preset.label.length > 0);
    assert.ok(preset.color.text);
    assert.ok(preset.color.secondary);
    assert.ok(preset.color.quiet);
    assert.ok(preset.color.prompt);
    assert.ok(preset.color.panel);
    assert.ok(preset.color.success);
    assert.ok(preset.color.warning);
    assert.ok(preset.color.error);
    assert.ok(preset.color.border);
    assert.ok(preset.spacing.content >= 1);
    assert.ok(preset.spacing.gap !== undefined);
    assert.ok(preset.spacing.separator !== undefined);
    assert.ok(preset.glyph.running.length > 0);
    assert.ok(preset.glyph.success.length > 0);
    assert.ok(preset.glyph.failure.length > 0);
    assert.ok(preset.glyph.interrupted.length > 0);
    assert.ok(preset.thinking.indicator.length > 0);
    assert.ok(preset.thinking.label.length > 0);
    assert.ok(["blank", "line", "native"].includes(preset.editor.frame));
  }

  // Visual distinction of prompt glyphs
  assert.equal(THEME_PRESETS["omt-signature"].glyph.prompt, "◈");
  assert.equal(THEME_PRESETS["codex-inspired"].glyph.prompt, "›");
  assert.equal(THEME_PRESETS.claude.glyph.prompt, "❯");
  assert.equal(THEME_PRESETS.opencode.glyph.prompt, "");
  assert.equal(THEME_PRESETS.minimal.glyph.prompt, ">");
  assert.equal(THEME_PRESETS.native.glyph.prompt, "");

  // Thinking indicators
  assert.equal(THEME_PRESETS["omt-signature"].thinking.indicator, "◈");
  assert.equal(THEME_PRESETS["codex-inspired"].thinking.indicator, "•");
  assert.equal(THEME_PRESETS.claude.thinking.indicator, "●");
  assert.equal(THEME_PRESETS.opencode.thinking.indicator, "⋯");
  assert.equal(THEME_PRESETS.minimal.thinking.indicator, "·");

  // Thinking labels
  assert.equal(THEME_PRESETS["omt-signature"].thinking.label, "Reasoning");
  assert.equal(THEME_PRESETS["codex-inspired"].thinking.label, "Reasoning");
  assert.equal(THEME_PRESETS.claude.thinking.label, "∴ Thought");
  assert.equal(THEME_PRESETS.opencode.thinking.label, "+ Thought");
  assert.equal(THEME_PRESETS.minimal.thinking.label, "Thinking");
  assert.equal(THEME_PRESETS.native.thinking.label, "Thinking...");

  // Framing
  assert.equal(THEME_PRESETS["omt-signature"].editor.frame, "line");
  assert.equal(THEME_PRESETS["codex-inspired"].editor.frame, "blank");
  assert.equal(THEME_PRESETS.claude.editor.frame, "line");
  assert.equal(THEME_PRESETS.opencode.editor.frame, "blank");
  assert.equal(THEME_PRESETS.minimal.editor.frame, "blank");
  assert.equal(THEME_PRESETS.native.editor.frame, "native");

  // Surface panels
  assert.equal(THEME_PRESETS["omt-signature"].panelBg, false);
  assert.equal(THEME_PRESETS["codex-inspired"].panelBg, true);
  assert.equal(THEME_PRESETS.claude.panelBg, false);
  assert.equal(THEME_PRESETS.opencode.panelBg, true);
  assert.equal(THEME_PRESETS.minimal.panelBg, false);
  assert.equal(THEME_PRESETS.native.panelBg, false);
});

test("setActiveTheme updates active style and resets cleanly", () => {
  resetActiveTheme();
  assert.equal(getActiveTheme().id, "omt-signature");
  setActiveTheme("claude");
  assert.equal(getActiveTheme().id, "claude-code-inspired");
  setActiveTheme("opencode");
  assert.equal(getActiveTheme().id, "opencode-inspired");
  setActiveTheme("minimal");
  assert.equal(getActiveTheme().id, "minimal");
  setActiveTheme("native");
  assert.equal(getActiveTheme().id, "native");
  setActiveTheme("codex-inspired");
  assert.equal(getActiveTheme().id, "codex-inspired");
  // Backward-compatible alias 'codex'
  setActiveTheme("codex");
  assert.equal(getActiveTheme().id, "codex-inspired");
  resetActiveTheme();
  assert.equal(getActiveTheme().id, "omt-signature");
  assert.throws(() => setActiveTheme("unknown" as ThemeName), /Unknown theme preset/);
});

test("legacy theme names normalize without accepting inherited object properties", () => {
  try {
    assert.equal(resolveThemeName("omt"), "omt-signature");
    assert.equal(resolveThemeName("signature"), "omt-signature");
    assert.equal(resolveThemeName("omt-signature"), "omt-signature");
    assert.equal(resolveThemeName("codex"), "codex-inspired");
    assert.equal(resolveThemeName("codex-inspired"), "codex-inspired");
    assert.equal(setActiveTheme("codex"), THEME_PRESETS["codex-inspired"]);
    for (const name of ["unknown", "constructor", "toString", "__proto__", "hasOwnProperty"]) {
      assert.equal(resolveThemeName(name), undefined);
      assert.throws(() => setActiveTheme(name), /Unknown theme preset/);
      assert.equal(getActiveTheme(), THEME_PRESETS["codex-inspired"], "invalid names preserve selection");
    }
  } finally { resetActiveTheme(); }
});

test("editor renders distinct visual signatures across all presets", () => {
  initTheme("dark");
  const theme = prototype.createExtensionUIContext.call({}).theme;
  const keys = new KeybindingsManager(TUI_KEYBINDINGS);

  try {
    for (const name of ["omt-signature", "codex-inspired", "claude", "opencode", "minimal", "native"] as const) {
      setActiveTheme(name);
      const editor = new CleanEditor(tui, { borderColor: (s) => s, selectList: getSelectListTheme() }, keys as PiKeys, () => theme);
      editor.setText("test input 你好");
      const lines = editor.render(80);
      assert.ok(lines.length >= 3);
      for (const line of lines) {
        assert.ok(visibleWidth(line) <= 80);
      }

      const stripped = lines.map((l) => stripTerminalSequences(l));
      const topBorder = stripped[0]!;
      const promptLine = stripped[1]!;

      if (name === "omt-signature") {
        assert.ok(topBorder.includes("─"), "signature line framing");
        assert.ok(promptLine.trimStart().startsWith("test input"), "Signature preserves the native editor text row");
        assert.equal(promptLine.indexOf("test input"), editor.getPaddingX());
      } else if (name === "codex-inspired") {
        assert.ok(!topBorder.includes("─"), "codex blank framing removes rules");
        assert.ok(promptLine.includes("› test input"));
        assert.equal(promptLine.indexOf("test input"), 2);
      } else if (name === "claude") {
        assert.ok(topBorder.includes("─"), "Claude's composer has horizontal rules");
        assert.ok(promptLine.includes("❯ test input"));
        assert.equal(promptLine.indexOf("test input"), 2);
      } else if (name === "opencode") {
        assert.ok(!topBorder.includes("─"), "OpenCode uses a left rail, not rules");
        assert.equal(promptLine.indexOf("┃"), 2);
        assert.equal(promptLine.indexOf("test input"), 5);
      } else if (name === "minimal") {
        assert.ok(!topBorder.includes("─"), "minimal blank framing");
        assert.ok(promptLine.includes("> test input"));
        assert.equal(promptLine.indexOf("test input"), 2, "minimal uses compact 2-col content alignment");
      } else if (name === "native") {
        assert.ok(topBorder.includes("─"), "native retains native line border");
        assert.ok(!promptLine.includes("›") && !promptLine.includes("❯"));
      }
    }
  } finally {
    resetActiveTheme();
  }
});

test("tool execution renders distinct glyphs and formatting across presets", () => {
  initTheme("dark");
  const theme = prototype.createExtensionUIContext.call({}).theme;

  try {
    // Signature
    setActiveTheme("omt-signature");
    assert.equal(stripTerminalSequences(renderStatusIcon("running", theme)), "◈");
    assert.equal(stripTerminalSequences(renderStatusIcon("success", theme)), "✔");
    assert.equal(stripTerminalSequences(renderStatusIcon("failure", theme)), "✖");
    assert.equal(stripTerminalSequences(renderStatusIcon("interrupted", theme)), "■");

    // Codex retains its bullet through running and completed execution states.
    setActiveTheme("codex-inspired");
    assert.equal(stripTerminalSequences(renderStatusIcon("running", theme)), "•");
    assert.equal(stripTerminalSequences(renderStatusIcon("success", theme)), "•");
    assert.equal(stripTerminalSequences(renderStatusIcon("failure", theme)), "•");
    assert.equal(stripTerminalSequences(renderStatusIcon("interrupted", theme)), "•");

    // Also test alias 'codex'
    setActiveTheme("codex");
    assert.equal(stripTerminalSequences(renderStatusIcon("running", theme)), "•");

    // Claude uses a record bullet and semantic color, not checkmarks.
    setActiveTheme("claude");
    assert.equal(stripTerminalSequences(renderStatusIcon("running", theme)), "●");
    assert.equal(stripTerminalSequences(renderStatusIcon("success", theme)), "●");
    assert.equal(stripTerminalSequences(renderStatusIcon("failure", theme)), "●");
    assert.equal(stripTerminalSequences(renderStatusIcon("interrupted", theme)), "●");

    // OpenCode uses call-specific arrows/shell grammar, not success checkmarks.
    setActiveTheme("opencode");
    assert.equal(stripTerminalSequences(renderStatusIcon("running", theme)), "⋯");
    assert.equal(stripTerminalSequences(renderStatusIcon("success", theme)), "→");
    assert.equal(stripTerminalSequences(renderStatusIcon("failure", theme)), "→");
    assert.equal(stripTerminalSequences(renderStatusIcon("interrupted", theme)), "→");

    // Minimal: ·, +, -, !
    setActiveTheme("minimal");
    assert.equal(stripTerminalSequences(renderStatusIcon("running", theme)), "·");
    assert.equal(stripTerminalSequences(renderStatusIcon("success", theme)), "+");
    assert.equal(stripTerminalSequences(renderStatusIcon("failure", theme)), "-");
    assert.equal(stripTerminalSequences(renderStatusIcon("interrupted", theme)), "!");
  } finally {
    resetActiveTheme();
  }
});

test("getStateGlyph and getStateColor standardize all observable agent states across presets", () => {
  const states: ObservableAgentState[] = ["thinking", "streaming", "executing", "completed", "interrupted", "error"];

  for (const presetName of THEME_NAMES) {
    const preset = THEME_PRESETS[presetName];

    // Every observable state maps to a non-empty glyph
    for (const st of states) {
      const glyph = getStateGlyph(st, preset);
      assert.ok(glyph !== undefined && (presetName === "native" && st === "thinking" ? true : glyph.length > 0), `${presetName} ${st} glyph`);
      const color = getStateColor(st, preset);
      assert.ok(color.length > 0, `${presetName} ${st} color`);
    }

    // Semantic colors
    assert.equal(getStateColor("completed", preset), preset.color.success);
    assert.equal(getStateColor("interrupted", preset), preset.color.warning);
    assert.equal(getStateColor("error", preset), preset.color.error);
    assert.equal(getStateColor("thinking", preset), preset.color.secondary);
    assert.equal(getStateColor("streaming", preset), preset.color.secondary);
    assert.equal(getStateColor("executing", preset), preset.color.secondary);
  }

  // Signature indicators
  assert.equal(getStateGlyph("thinking", THEME_PRESETS["omt-signature"]), "◈");
  assert.equal(getStateGlyph("executing", THEME_PRESETS["omt-signature"]), "◈");
  assert.equal(getStateGlyph("completed", THEME_PRESETS["omt-signature"]), "✔");
  assert.equal(getStateGlyph("interrupted", THEME_PRESETS["omt-signature"]), "■");
  assert.equal(getStateGlyph("error", THEME_PRESETS["omt-signature"]), "✖");

  // Codex indicators
  assert.equal(getStateGlyph("thinking", THEME_PRESETS["codex-inspired"]), "•");
  assert.equal(getStateGlyph("executing", THEME_PRESETS["codex-inspired"]), "•");
  assert.equal(getStateGlyph("completed", THEME_PRESETS["codex-inspired"]), "•");
  assert.equal(getStateGlyph("interrupted", THEME_PRESETS["codex-inspired"]), "•");
  assert.equal(getStateGlyph("error", THEME_PRESETS["codex-inspired"]), "•");

  // Claude indicators
  assert.equal(getStateGlyph("thinking", THEME_PRESETS.claude), "●");
  assert.equal(getStateGlyph("executing", THEME_PRESETS.claude), "●");

  // OpenCode indicators
  assert.equal(getStateGlyph("thinking", THEME_PRESETS.opencode), "⋯");
  assert.equal(getStateGlyph("completed", THEME_PRESETS.opencode), "→");
  assert.equal(getStateGlyph("error", THEME_PRESETS.opencode), "→");
  assert.equal(getStateGlyph("interrupted", THEME_PRESETS.opencode), "→");

  // Minimal indicators
  assert.equal(getStateGlyph("thinking", THEME_PRESETS.minimal), "·");
  assert.equal(getStateGlyph("completed", THEME_PRESETS.minimal), "+");
  assert.equal(getStateGlyph("error", THEME_PRESETS.minimal), "-");
  assert.equal(getStateGlyph("interrupted", THEME_PRESETS.minimal), "!");
});

test("footer renders distinct separators, branch icons, and activity glyphs across presets", () => {
  initTheme("dark");
  const theme = prototype.createExtensionUIContext.call({}).theme;

  const data: FooterRenderData = {
    branch: "main",
    extensionStatuses: ["active"],
    activity: { type: "tool", name: "bash", detail: "npm test" },
    contextUsage: { percent: 45, contextWindow: 200000 },
    modelId: "gpt-5",
    provider: "openai",
    hasMultipleProviders: true,
  };

  try {
    setActiveTheme("omt-signature");
    const sigLine = stripTerminalSequences(formatFooterLine(100, theme, data));
    assert.ok(sigLine.includes("main"));
    assert.ok(sigLine.includes("gpt-5"));
    assert.ok(sigLine.includes("45%"));

    setActiveTheme("codex-inspired");
    const codexLine = stripTerminalSequences(formatFooterLine(100, theme, data));
    assert.ok(codexLine.includes("main"));
    assert.ok(codexLine.includes("Context 55% left"));
    assert.ok(!codexLine.includes("bash"), "working row already reports activity");
    assert.ok(codexLine.includes(" · "));

    setActiveTheme("claude");
    const claudeLine = stripTerminalSequences(formatFooterLine(100, theme, data));
    assert.ok(claudeLine.includes("(main)"));
    assert.ok(claudeLine.includes("gpt-5"));
    assert.ok(!claudeLine.includes("bash"), "statusline does not duplicate the working row");

    setActiveTheme("opencode");
    const opencodeLine = stripTerminalSequences(formatFooterLine(100, theme, data));
    assert.ok(opencodeLine.includes("main"));
    assert.ok(opencodeLine.includes("active"));
    assert.ok(!opencodeLine.includes("bash"), "no duplicate working activity");

    setActiveTheme("minimal");
    const minimalLine = stripTerminalSequences(formatFooterLine(100, theme, data));
    assert.ok(!minimalLine.includes("⎇"), "minimal drops decorative branch glyph");
    assert.ok(minimalLine.includes("main"));
    assert.ok(minimalLine.includes("· bash"));
    assert.ok(minimalLine.includes(" | "));
  } finally {
    resetActiveTheme();
  }
});

test("user messages align with preset content padding and invalidate cache on theme switch", () => {
  const control = createUserMessageControl();
  try {
    initTheme("dark");
    resetActiveTheme();
    setActiveTheme("codex-inspired");
    const msg = new UserMessageComponent("hello world");
    const codexLines = msg.render(80);
    assert.equal(stripTerminalSequences(codexLines[1]!).indexOf("hello"), 2);

    setActiveTheme("minimal");
    control.applyTheme?.();
    const minimalLines = msg.render(80);
    assert.equal(stripTerminalSequences(minimalLines[1]!).indexOf("hello"), 2);

    setActiveTheme("native");
    control.applyTheme?.();
    const nativeLines = msg.render(80);
    assert.equal(stripTerminalSequences(nativeLines[1]!).indexOf("hello"), 1);

    setActiveTheme("claude");
    control.applyTheme?.();
    const claudeLines = msg.render(80);
    assert.equal(stripTerminalSequences(claudeLines[1]!).indexOf("hello"), 2);
  } finally {
    control.cleanup?.();
    resetActiveTheme();
  }
});

test("all presets handle terminal widths from 120 down to 5 without overflowing", () => {
  initTheme("dark");
  const theme = prototype.createExtensionUIContext.call({}).theme;
  const keys = new KeybindingsManager(TUI_KEYBINDINGS);

  const footerData: FooterRenderData = {
    branch: "feature/theme-presets",
    extensionStatuses: ["running tests"],
    activity: { type: "tool", name: "bash", detail: "npm test" },
    contextUsage: { percent: 85, contextWindow: 128000 },
    modelId: "claude-3-7-sonnet",
    reasoning: true,
    thinkingLevel: "high",
  };

  try {
    for (const name of THEME_NAMES) {
      setActiveTheme(name);
      const editor = new CleanEditor(tui, { borderColor: (s) => s, selectList: getSelectListTheme() }, keys as PiKeys, () => theme);
      editor.setText("narrow test 你好");

      for (const width of [120, 80, 50, 30, 15, 10]) {
        const editorLines = editor.render(width);
        for (const line of editorLines) {
          assert.ok(visibleWidth(line) <= width, `${name} editor overflowed at width ${width}: ${visibleWidth(line)}`);
        }
      }

      // Empty editor below 10 cols yields safely to native layout
      for (const width of [9, 5, 2]) {
        const emptyEditor = new CleanEditor(tui, { borderColor: (s) => s, selectList: getSelectListTheme() }, keys as PiKeys, () => theme);
        const lines = emptyEditor.render(width);
        for (const line of lines) {
          assert.ok(visibleWidth(line) <= width);
        }
      }

      // Footer adapts responsively all the way down to 5 cols
      for (const width of [120, 80, 50, 30, 15, 8, 5]) {
        const footerLine = formatFooterLine(width, theme, footerData);
        assert.ok(visibleWidth(footerLine) <= width, `${name} footer overflowed at width ${width}: ${visibleWidth(footerLine)}`);
      }
    }
  } finally {
    resetActiveTheme();
  }
});
