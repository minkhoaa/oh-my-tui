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
  assert.deepEqual(THEME_NAMES, ["omt-signature", "omt-clean", "omt-ember", "omt-rail", "minimal", "native"]);
  assert.equal(THEME_PRESETS.omt, THEME_PRESETS["omt-signature"]);
  assert.equal(THEME_PRESETS.signature, THEME_PRESETS["omt-signature"]);
  assert.equal(THEME_PRESETS.rail, THEME_PRESETS["omt-rail"]);
  assert.equal(THEME_PRESETS.clean, THEME_PRESETS["omt-clean"], "backward-compatible alias resolves to omt-clean");

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
  assert.equal(THEME_PRESETS["omt-clean"].glyph.prompt, "›");
  assert.equal(THEME_PRESETS.ember.glyph.prompt, "❯");
  assert.equal(THEME_PRESETS.rail.glyph.prompt, "");
  assert.equal(THEME_PRESETS.minimal.glyph.prompt, ">");
  assert.equal(THEME_PRESETS.native.glyph.prompt, "");

  // Thinking indicators
  assert.equal(THEME_PRESETS["omt-signature"].thinking.indicator, "◈");
  assert.equal(THEME_PRESETS["omt-clean"].thinking.indicator, "•");
  assert.equal(THEME_PRESETS.ember.thinking.indicator, "●");
  assert.equal(THEME_PRESETS.rail.thinking.indicator, "⋯");
  assert.equal(THEME_PRESETS.minimal.thinking.indicator, "·");

  // Thinking labels
  assert.equal(THEME_PRESETS["omt-signature"].thinking.label, "Reasoning");
  assert.equal(THEME_PRESETS["omt-clean"].thinking.label, "Reasoning");
  assert.equal(THEME_PRESETS.ember.thinking.label, "∴ Thought");
  assert.equal(THEME_PRESETS.rail.thinking.label, "+ Thought");
  assert.equal(THEME_PRESETS.minimal.thinking.label, "Thinking");
  assert.equal(THEME_PRESETS.native.thinking.label, "Thinking...");

  // Framing
  assert.equal(THEME_PRESETS["omt-signature"].editor.frame, "line");
  assert.equal(THEME_PRESETS["omt-clean"].editor.frame, "blank");
  assert.equal(THEME_PRESETS.ember.editor.frame, "line");
  assert.equal(THEME_PRESETS.rail.editor.frame, "blank");
  assert.equal(THEME_PRESETS.minimal.editor.frame, "blank");
  assert.equal(THEME_PRESETS.native.editor.frame, "native");

  // Surface panels
  assert.equal(THEME_PRESETS["omt-signature"].panelBg, false);
  assert.equal(THEME_PRESETS["omt-clean"].panelBg, true);
  assert.equal(THEME_PRESETS.ember.panelBg, false);
  assert.equal(THEME_PRESETS.rail.panelBg, true);
  assert.equal(THEME_PRESETS.minimal.panelBg, false);
  assert.equal(THEME_PRESETS.native.panelBg, false);
});

test("setActiveTheme updates active style and resets cleanly", () => {
  resetActiveTheme();
  assert.equal(getActiveTheme().id, "omt-signature");
  setActiveTheme("ember");
  assert.equal(getActiveTheme().id, "omt-ember");
  setActiveTheme("rail");
  assert.equal(getActiveTheme().id, "omt-rail");
  setActiveTheme("minimal");
  assert.equal(getActiveTheme().id, "minimal");
  setActiveTheme("native");
  assert.equal(getActiveTheme().id, "native");
  setActiveTheme("omt-clean");
  assert.equal(getActiveTheme().id, "omt-clean");
  // Backward-compatible alias 'clean'
  setActiveTheme("clean");
  assert.equal(getActiveTheme().id, "omt-clean");
  resetActiveTheme();
  assert.equal(getActiveTheme().id, "omt-signature");
  assert.throws(() => setActiveTheme("unknown" as ThemeName), /Unknown theme preset/);
});

test("legacy theme names normalize without accepting inherited object properties", () => {
  try {
    assert.equal(resolveThemeName("omt"), "omt-signature");
    assert.equal(resolveThemeName("signature"), "omt-signature");
    assert.equal(resolveThemeName("omt-signature"), "omt-signature");
    assert.equal(resolveThemeName("clean"), "omt-clean");
    assert.equal(resolveThemeName("omt-clean"), "omt-clean");
    assert.equal(setActiveTheme("clean"), THEME_PRESETS["omt-clean"]);
    for (const name of ["unknown", "constructor", "toString", "__proto__", "hasOwnProperty"]) {
      assert.equal(resolveThemeName(name), undefined);
      assert.throws(() => setActiveTheme(name), /Unknown theme preset/);
      assert.equal(getActiveTheme(), THEME_PRESETS["omt-clean"], "invalid names preserve selection");
    }
  } finally { resetActiveTheme(); }
});

test("editor renders distinct visual signatures across all presets", () => {
  initTheme("dark");
  const theme = prototype.createExtensionUIContext.call({}).theme;
  const keys = new KeybindingsManager(TUI_KEYBINDINGS);

  try {
    for (const name of ["omt-signature", "omt-clean", "ember", "rail", "minimal", "native"] as const) {
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
      } else if (name === "omt-clean") {
        assert.ok(!topBorder.includes("─"), "clean blank framing removes rules");
        assert.ok(promptLine.includes("› test input"));
        assert.equal(promptLine.indexOf("test input"), 2);
      } else if (name === "ember") {
        assert.ok(topBorder.includes("─"), "Ember's composer has horizontal rules");
        assert.ok(promptLine.includes("❯ test input"));
        assert.equal(promptLine.indexOf("test input"), 2);
      } else if (name === "rail") {
        assert.ok(!topBorder.includes("─"), "Rail uses a left rail, not rules");
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

    // Clean retains its bullet through running and completed execution states.
    setActiveTheme("omt-clean");
    assert.equal(stripTerminalSequences(renderStatusIcon("running", theme)), "•");
    assert.equal(stripTerminalSequences(renderStatusIcon("success", theme)), "•");
    assert.equal(stripTerminalSequences(renderStatusIcon("failure", theme)), "•");
    assert.equal(stripTerminalSequences(renderStatusIcon("interrupted", theme)), "•");

    // Also test alias 'clean'
    setActiveTheme("clean");
    assert.equal(stripTerminalSequences(renderStatusIcon("running", theme)), "•");

    // Ember uses a record bullet and semantic color, not checkmarks.
    setActiveTheme("ember");
    assert.equal(stripTerminalSequences(renderStatusIcon("running", theme)), "●");
    assert.equal(stripTerminalSequences(renderStatusIcon("success", theme)), "●");
    assert.equal(stripTerminalSequences(renderStatusIcon("failure", theme)), "●");
    assert.equal(stripTerminalSequences(renderStatusIcon("interrupted", theme)), "●");

    // Rail uses call-specific arrows/shell grammar, not success checkmarks.
    setActiveTheme("rail");
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

  // Clean indicators
  assert.equal(getStateGlyph("thinking", THEME_PRESETS["omt-clean"]), "•");
  assert.equal(getStateGlyph("executing", THEME_PRESETS["omt-clean"]), "•");
  assert.equal(getStateGlyph("completed", THEME_PRESETS["omt-clean"]), "•");
  assert.equal(getStateGlyph("interrupted", THEME_PRESETS["omt-clean"]), "•");
  assert.equal(getStateGlyph("error", THEME_PRESETS["omt-clean"]), "•");

  // Ember indicators
  assert.equal(getStateGlyph("thinking", THEME_PRESETS.ember), "●");
  assert.equal(getStateGlyph("executing", THEME_PRESETS.ember), "●");

  // Rail indicators
  assert.equal(getStateGlyph("thinking", THEME_PRESETS.rail), "⋯");
  assert.equal(getStateGlyph("completed", THEME_PRESETS.rail), "→");
  assert.equal(getStateGlyph("error", THEME_PRESETS.rail), "→");
  assert.equal(getStateGlyph("interrupted", THEME_PRESETS.rail), "→");

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

    setActiveTheme("omt-clean");
    const cleanLine = stripTerminalSequences(formatFooterLine(100, theme, data));
    assert.ok(cleanLine.includes("main"));
    assert.ok(cleanLine.includes("Context 55% left"));
    assert.ok(!cleanLine.includes("bash"), "working row already reports activity");
    assert.ok(cleanLine.includes(" · "));

    setActiveTheme("ember");
    const emberLine = stripTerminalSequences(formatFooterLine(100, theme, data));
    assert.ok(emberLine.includes("(main)"));
    assert.ok(emberLine.includes("gpt-5"));
    assert.ok(!emberLine.includes("bash"), "statusline does not duplicate the working row");

    setActiveTheme("rail");
    const railLine = stripTerminalSequences(formatFooterLine(100, theme, data));
    assert.ok(railLine.includes("main"));
    assert.ok(railLine.includes("active"));
    assert.ok(!railLine.includes("bash"), "no duplicate working activity");

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
    setActiveTheme("omt-clean");
    const msg = new UserMessageComponent("hello world");
    const cleanLines = msg.render(80);
    assert.equal(stripTerminalSequences(cleanLines[1]!).indexOf("hello"), 2);

    setActiveTheme("minimal");
    control.applyTheme?.();
    const minimalLines = msg.render(80);
    assert.equal(stripTerminalSequences(minimalLines[1]!).indexOf("hello"), 2);

    setActiveTheme("native");
    control.applyTheme?.();
    const nativeLines = msg.render(80);
    assert.equal(stripTerminalSequences(nativeLines[1]!).indexOf("hello"), 1);

    setActiveTheme("ember");
    control.applyTheme?.();
    const emberLines = msg.render(80);
    assert.equal(stripTerminalSequences(emberLines[1]!).indexOf("hello"), 2);
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
    modelId: "fixture-sonnet-37",
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
