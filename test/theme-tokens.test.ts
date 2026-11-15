import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OBSIDIAN_STUDIO_COLORS,
  OBSIDIAN_STUDIO_BRAND,
  BrandTokens,
  RAIL_GLYPHS,
  RailGlyphs,
  resolveRailColor,
  resolveRailHex,
  resolveRailGlyph,
  BADGE_GLYPHS,
  BadgeStyles,
  formatBadge,
  formatSolidChip,
  formatLozenge,
  formatBracket,
  GAUGE_GLYPHS,
  GaugeTokens,
  resolveGaugeColor,
  renderGaugeBar,
  REASONING_GLYPHS,
  ReasoningTokens,
  formatReasoningHeader,
  formatReasoningCapsule,
  DEGRADABLE_GLYPH_CATALOG,
  UniversalDegradation,
  isStrictAscii,
  getTerminalDegradationLevel,
  degradeGlyph,
} from "../extensions/omt/core/theme-tokens.ts";
import * as OmtIndex from "../extensions/omt/index.ts";
import { accessibilityStore } from "../extensions/omt/features/accessibility/model.ts";
import {
  OBSIDIAN_STUDIO_RAW_THEME,
  getObsidianStudioPalette,
  railStateToPaletteSpec,
  gaugeColorToPaletteSpec,
} from "../extensions/omt/presets/omt-obsidian/palette.ts";
import type { ThemePreset } from "../extensions/omt/presets/shared/types.ts";

test("Obsidian Studio Brand Tokens & Colors Contract", () => {
  assert.equal(OBSIDIAN_STUDIO_COLORS.canvas, "#0D0E11");
  assert.equal(OBSIDIAN_STUDIO_COLORS.gunmetal, "#222630");
  assert.equal(OBSIDIAN_STUDIO_COLORS.cyan, "#00F0FF");
  assert.equal(OBSIDIAN_STUDIO_COLORS.violet, "#9D4EDD");
  assert.equal(OBSIDIAN_STUDIO_COLORS.emerald, "#05FFA1");
  assert.equal(OBSIDIAN_STUDIO_COLORS.crimson, "#FF2A6D");
  assert.equal(OBSIDIAN_STUDIO_COLORS.text, "#F1F5F9");
  assert.equal(OBSIDIAN_STUDIO_COLORS.muted, "#64748B");
  assert.equal(OBSIDIAN_STUDIO_COLORS.amber, "#FFB300");

  assert.equal(OBSIDIAN_STUDIO_BRAND.glyph, "⌁");
  assert.equal(OBSIDIAN_STUDIO_BRAND.asciiGlyph, "~");
  assert.equal(OBSIDIAN_STUDIO_BRAND.name, "Obsidian Studio");
  assert.equal(BrandTokens.glyph, "⌁");
});

test("RailGlyphs: Spine characters & stateful rail color resolution", () => {
  assert.equal(RAIL_GLYPHS.block, "▎");
  assert.equal(RAIL_GLYPHS.hairline, "│");
  assert.equal(RAIL_GLYPHS.ascii, "|");

  // Glyph resolution
  assert.equal(resolveRailGlyph("block"), "▎");
  assert.equal(resolveRailGlyph("hairline"), "│");
  assert.equal(resolveRailGlyph("ascii"), "|");
  assert.equal(resolveRailGlyph("block", true), "|"); // forced ASCII

  // Active / Streaming / Thinking states
  for (const state of ["thinking", "streaming", "running", "executing", "active"] as const) {
    const c = resolveRailColor(state);
    assert.equal(c.hex, OBSIDIAN_STUDIO_COLORS.cyan, `State ${state} must resolve to cyan`);
    assert.equal(c.secondaryHex, OBSIDIAN_STUDIO_COLORS.violet);
    assert.equal(c.role, "active");
    assert.equal(resolveRailHex(state), OBSIDIAN_STUDIO_COLORS.cyan);
  }

  // History / Idle / Completed states
  for (const state of ["completed", "idle", "done", "history", "success"] as const) {
    const c = resolveRailColor(state);
    assert.equal(c.hex, OBSIDIAN_STUDIO_COLORS.muted);
    assert.equal(c.role, "history");
  }

  // Interrupted / Warning states
  for (const state of ["interrupted", "warning", "aborted"] as const) {
    const c = resolveRailColor(state);
    assert.equal(c.hex, OBSIDIAN_STUDIO_COLORS.amber);
    assert.equal(c.role, "warning");
  }

  // Error / Failure states
  for (const state of ["error", "failure", "failed"] as const) {
    const c = resolveRailColor(state);
    assert.equal(c.hex, OBSIDIAN_STUDIO_COLORS.crimson);
    assert.equal(c.role, "error");
  }

  // Contract object checks
  assert.equal(RailGlyphs.glyphs.block, "▎");
  assert.equal(RailGlyphs.resolveHex("thinking"), "#00F0FF");
});

test("BadgeStyles: Solid chips, lozenges, brackets and ASCII degradation", () => {
  // UTF-8 mode
  assert.equal(formatSolidChip("read", false), " ▊ READ ");
  assert.equal(formatLozenge("read", false), "❲read❳");
  assert.equal(formatBracket("read", false), "[READ]");
  assert.equal(formatBadge("edit", "chip", false), " ▊ EDIT ");
  assert.equal(formatBadge("edit", "lozenge", false), "❲edit❳");
  assert.equal(formatBadge("edit", "bracket", false), "[EDIT]");

  // ASCII mode
  assert.equal(formatSolidChip("read", true), "| READ |");
  assert.equal(formatLozenge("read", true), "(read)");
  assert.equal(formatBracket("read", true), "[READ]");

  // BadgeStyles contract
  assert.equal(BadgeStyles.glyphs.chipLead, " ▊ ");
  assert.equal(BadgeStyles.glyphs.lozengeOpen, "❲");
  assert.equal(BadgeStyles.solidChip("bash", false), " ▊ BASH ");
});

test("GaugeTokens: Fuel gauge unicode block tokens & threshold colors", () => {
  assert.equal(GAUGE_GLYPHS.filled, "▰");
  assert.equal(GAUGE_GLYPHS.empty, "▱");
  assert.equal(GAUGE_GLYPHS.asciiFilled, "#");
  assert.equal(GAUGE_GLYPHS.asciiEmpty, "-");

  // Threshold < 50% -> Cyan
  const low = resolveGaugeColor(0.38);
  assert.equal(low.color, OBSIDIAN_STUDIO_COLORS.cyan);
  assert.equal(low.level, "normal");
  assert.equal(low.recommendCompact, false);

  const lowPct = resolveGaugeColor(45);
  assert.equal(lowPct.color, OBSIDIAN_STUDIO_COLORS.cyan);

  // Threshold 50% - 80% -> Amber Warning
  const mid = resolveGaugeColor(0.65);
  assert.equal(mid.color, OBSIDIAN_STUDIO_COLORS.amber);
  assert.equal(mid.level, "warning");
  assert.equal(mid.recommendCompact, false);

  const mid80 = resolveGaugeColor(80);
  assert.equal(mid80.color, OBSIDIAN_STUDIO_COLORS.amber);
  assert.equal(mid80.recommendCompact, false);

  // Threshold > 80% -> Crimson Laser + Recommend Compact
  const high = resolveGaugeColor(0.88);
  assert.equal(high.color, OBSIDIAN_STUDIO_COLORS.crimson);
  assert.equal(high.level, "critical");
  assert.equal(high.recommendCompact, true);

  // Render bar: 38% on 8 slots = 3 filled, 5 empty
  assert.equal(renderGaugeBar(0.38, 8, false), "▰▰▰▱▱▱▱▱");
  assert.equal(renderGaugeBar(0.38, 8, true), "###-----");

  // 100% on 10 slots
  assert.equal(renderGaugeBar(1.0, 10, false), "▰▰▰▰▰▰▰▰▰▰");
  // 0% on 5 slots
  assert.equal(renderGaugeBar(0, 5, false), "▱▱▱▱▱");

  // Contract object
  assert.equal(GaugeTokens.glyphs.filled, "▰");
  assert.equal(GaugeTokens.resolveColor(0.2).color, OBSIDIAN_STUDIO_COLORS.cyan);
});

test("ReasoningTokens: Pulsing header & folded capsule formatting", () => {
  assert.equal(REASONING_GLYPHS.pulse, "✦");
  assert.equal(REASONING_GLYPHS.capsule, "◈");
  assert.equal(REASONING_GLYPHS.chevron, "▸");

  // Header formatting
  assert.equal(formatReasoningHeader(undefined, undefined, false), "✦ Thinking");
  assert.equal(formatReasoningHeader(2.4, 184, false), "✦ Thinking (2.4s, 184 tok)");
  assert.equal(formatReasoningHeader(1.8, undefined, false), "✦ Thinking (1.8s)");
  assert.equal(formatReasoningHeader(2.4, 184, true), "* Thinking (2.4s, 184 tok)");

  // Folded capsule formatting
  assert.equal(formatReasoningCapsule(2.4, 184, false), "◈ Reasoned in 2.4s (184 tok) ▸");
  assert.equal(formatReasoningCapsule(1.5, undefined, false), "◈ Reasoned in 1.5s ▸");
  assert.equal(formatReasoningCapsule(2.4, 184, true), "> Reasoned in 2.4s (184 tok) >");

  // Contract object
  assert.equal(ReasoningTokens.glyphs.pulse, "✦");
  assert.equal(ReasoningTokens.formatHeader(1.0, 50, false), "✦ Thinking (1.0s, 50 tok)");
});

test("Universal Degradation: Comprehensive coverage across all glyphs, levels, and edge cases", () => {
  try {
    accessibilityStore.updateSettings({ plainTextAsciiBorders: false });

    // 1. All catalog items have distinct utf8, cleanUnicode, and ascii representations
    const expectedCatalogKeys = [
      "brand",
      "railBlock",
      "railHairline",
      "pulse",
      "capsule",
      "chevron",
      "gaugeFilled",
      "gaugeEmpty",
      "chipLead",
      "lozengeOpen",
      "lozengeClose",
      "rule",
    ];

    for (const key of expectedCatalogKeys) {
      const entry = DEGRADABLE_GLYPH_CATALOG[key];
      assert.ok(entry, `Catalog must contain entry for key: ${key}`);
      assert.ok(entry.utf8.length > 0, `Entry ${key} must have utf8 glyph`);
      assert.ok(entry.cleanUnicode.length > 0, `Entry ${key} must have cleanUnicode glyph`);
      assert.ok(entry.ascii.length > 0, `Entry ${key} must have ascii glyph`);

      // Verify degradeGlyph for each level
      assert.equal(degradeGlyph(key, "utf8"), entry.utf8);
      assert.equal(degradeGlyph(key, "clean-unicode"), entry.cleanUnicode);
      assert.equal(degradeGlyph(key, "ascii"), entry.ascii);

      // Verify passing the entry object directly
      assert.equal(degradeGlyph(entry, "utf8"), entry.utf8);
      assert.equal(degradeGlyph(entry, "clean-unicode"), entry.cleanUnicode);
      assert.equal(degradeGlyph(entry, "ascii"), entry.ascii);
    }

    // 2. Fallback handling for unknown catalog key
    const unknownFallback = degradeGlyph("unknown-custom-glyph");
    assert.equal(unknownFallback, "unknown-custom-glyph");

    // 3. Custom DegradableGlyph object
    const custom = { utf8: "🔥", cleanUnicode: "♨", ascii: "^" };
    assert.equal(degradeGlyph(custom, "utf8"), "🔥");
    assert.equal(degradeGlyph(custom, "clean-unicode"), "♨");
    assert.equal(degradeGlyph(custom, "ascii"), "^");

    // 4. Boolean level handling
    assert.equal(degradeGlyph("pulse", true), "*");
    assert.equal(degradeGlyph("pulse", false), "✦");

    // 5. isStrictAscii override behavior
    assert.equal(isStrictAscii(true), true);
    assert.equal(isStrictAscii(false), false);
    assert.equal(isStrictAscii(undefined), false);

    // 6. getTerminalDegradationLevel override behavior
    assert.equal(getTerminalDegradationLevel(true), "ascii");
    assert.equal(getTerminalDegradationLevel(false), "utf8");
    assert.equal(getTerminalDegradationLevel(), "utf8");

    // 7. Ambient store switching with try/finally
    accessibilityStore.updateSettings({ plainTextAsciiBorders: true });
    assert.equal(isStrictAscii(), true);
    assert.equal(getTerminalDegradationLevel(), "ascii");
    assert.equal(degradeGlyph("pulse"), "*");
    assert.equal(degradeGlyph("brand"), "~");
    assert.equal(UniversalDegradation.isStrictAscii(), true);
    assert.equal(UniversalDegradation.getLevel(), "ascii");
    assert.equal(UniversalDegradation.degrade("capsule"), ">");
  } finally {
    accessibilityStore.updateSettings({ plainTextAsciiBorders: false });
  }
});

test("Fuel gauge calculations, boundary thresholds and bar rendering edge cases", () => {
  try {
    accessibilityStore.updateSettings({ plainTextAsciiBorders: false });

    // 1. Boundary tests for resolveGaugeColor
    // < 50% -> normal, cyan
    const testCasesNormal = [-1, 0, 0.001, 0.25, 0.4999, 1.5, 25, 49.9];
    for (const val of testCasesNormal) {
      const res = resolveGaugeColor(val);
      assert.equal(res.level, "normal", `Value ${val} should be normal`);
      assert.equal(res.color, OBSIDIAN_STUDIO_COLORS.cyan, `Value ${val} should be cyan`);
      assert.equal(res.recommendCompact, false, `Value ${val} should not recommend compact`);
    }

    // 50% - 80% inclusive -> warning, amber
    const testCasesWarning = [0.5, 0.65, 0.7999, 0.8, 50, 65, 80];
    for (const val of testCasesWarning) {
      const res = resolveGaugeColor(val);
      assert.equal(res.level, "warning", `Value ${val} should be warning`);
      assert.equal(res.color, OBSIDIAN_STUDIO_COLORS.amber, `Value ${val} should be amber`);
      assert.equal(res.recommendCompact, false, `Value ${val} should not recommend compact`);
    }

    // > 80% -> critical, crimson, recommendCompact = true
    const testCasesCritical = [0.8001, 0.9, 1.0, 80.1, 95, 100, 150];
    for (const val of testCasesCritical) {
      const res = resolveGaugeColor(val);
      assert.equal(res.level, "critical", `Value ${val} should be critical`);
      assert.equal(res.color, OBSIDIAN_STUDIO_COLORS.crimson, `Value ${val} should be crimson`);
      assert.equal(res.recommendCompact, true, `Value ${val} should recommend compact`);
    }

    // 2. renderGaugeBar slot variations and clamping
    // Minimum slots clamping (at least 1)
    assert.equal(renderGaugeBar(0.5, 0, false).length, 1);
    assert.equal(renderGaugeBar(0.5, -5, false).length, 1);

    // Exact filling
    assert.equal(renderGaugeBar(0, 8, false), "▱▱▱▱▱▱▱▱");
    assert.equal(renderGaugeBar(1.0, 8, false), "▰▰▰▰▰▰▰▰");
    // Percentage inputs when ratio > 1
    assert.equal(renderGaugeBar(100, 8, false), "▰▰▰▰▰▰▰▰");
    assert.equal(renderGaugeBar(50, 8, false), "▰▰▰▰▱▱▱▱");
    assert.equal(renderGaugeBar(1.5, 8, false), "▱▱▱▱▱▱▱▱"); // 1.5% rounds to 0 on 8 slots
    assert.equal(renderGaugeBar(-0.5, 8, false), "▱▱▱▱▱▱▱▱");

    // 16 slots at 50%
    assert.equal(renderGaugeBar(0.5, 16, false), "▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱▱");
    assert.equal(renderGaugeBar(0.5, 16, true), "########--------");

    // Ambient accessibilityStore adaptation
    accessibilityStore.updateSettings({ plainTextAsciiBorders: true });
    assert.equal(renderGaugeBar(0.5, 8), "####----");
    // Explicit override takes precedence over ambient store
    assert.equal(renderGaugeBar(0.5, 8, false), "▰▰▰▰▱▱▱▱");
  } finally {
    accessibilityStore.updateSettings({ plainTextAsciiBorders: false });
  }
});

test("RailGlyphs: Complete state enumeration, variant fallbacks and ambient store integration", () => {
  try {
    accessibilityStore.updateSettings({ plainTextAsciiBorders: false });

    // Verify all rail states mapped correctly
    const activeStates = ["thinking", "streaming", "running", "executing", "active"] as const;
    for (const s of activeStates) {
      const res = resolveRailColor(s);
      assert.equal(res.hex, "#00F0FF");
      assert.equal(res.secondaryHex, "#9D4EDD");
      assert.equal(res.role, "active");
      assert.equal(resolveRailHex(s), "#00F0FF");
    }

    const historyStates = ["completed", "idle", "done", "history", "success"] as const;
    for (const s of historyStates) {
      const res = resolveRailColor(s);
      assert.equal(res.hex, "#64748B");
      assert.equal(res.secondaryHex, "#222630");
      assert.equal(res.role, "history");
      assert.equal(resolveRailHex(s), "#64748B");
    }

    const warningStates = ["interrupted", "warning", "aborted"] as const;
    for (const s of warningStates) {
      const res = resolveRailColor(s);
      assert.equal(res.hex, "#FFB300");
      assert.equal(res.role, "warning");
      assert.equal(resolveRailHex(s), "#FFB300");
    }

    const errorStates = ["error", "failure", "failed"] as const;
    for (const s of errorStates) {
      const res = resolveRailColor(s);
      assert.equal(res.hex, "#FF2A6D");
      assert.equal(res.role, "error");
      assert.equal(resolveRailHex(s), "#FF2A6D");
    }

    // Default variant fallback
    // @ts-expect-error testing unknown variant fallback to block
    assert.equal(resolveRailGlyph("unknown-variant"), "▎");

    // Ambient store switching
    accessibilityStore.updateSettings({ plainTextAsciiBorders: true });
    assert.equal(resolveRailGlyph("block"), "|");
    assert.equal(resolveRailGlyph("hairline"), "|");
    // Explicit override false restores unicode
    assert.equal(resolveRailGlyph("block", false), "▎");
    assert.equal(resolveRailGlyph("hairline", false), "│");
  } finally {
    accessibilityStore.updateSettings({ plainTextAsciiBorders: false });
  }
});

test("Badge styling and reasoning capsule formatting edge cases", () => {
  try {
    accessibilityStore.updateSettings({ plainTextAsciiBorders: false });

    // 1. Badge whitespace trimming and casing
    assert.equal(formatBadge("  run-command  ", "chip", false), " ▊ RUN-COMMAND ");
    assert.equal(formatBadge("  RUN-COMMAND  ", "lozenge", false), "❲run-command❳");
    assert.equal(formatBadge("  run-command  ", "bracket", false), "[RUN-COMMAND]");

    // ASCII variants
    assert.equal(formatBadge("  run-command  ", "chip", true), "| RUN-COMMAND |");
    assert.equal(formatBadge("  RUN-COMMAND  ", "lozenge", true), "(run-command)");
    assert.equal(formatBadge("  run-command  ", "bracket", true), "[RUN-COMMAND]");

    // Ambient store adaptation for badges
    accessibilityStore.updateSettings({ plainTextAsciiBorders: true });
    assert.equal(formatSolidChip("deploy"), "| DEPLOY |");
    assert.equal(formatLozenge("DEPLOY"), "(deploy)");
    assert.equal(formatBracket("deploy"), "[DEPLOY]");
    assert.equal(formatSolidChip("deploy", false), " ▊ DEPLOY ");

    // 2. Reasoning header edge cases
    accessibilityStore.updateSettings({ plainTextAsciiBorders: false });
    // Duration 0, tokens 0
    assert.equal(formatReasoningHeader(0, 0, false), "✦ Thinking (0.0s, 0 tok)");
    assert.equal(formatReasoningHeader(0, 0, true), "* Thinking (0.0s, 0 tok)");
    // Fractional rounding
    assert.equal(formatReasoningHeader(3.456, 12, false), "✦ Thinking (3.5s, 12 tok)");
    // Negative duration/tokens ignored
    assert.equal(formatReasoningHeader(-1, -1, false), "✦ Thinking");
    assert.equal(formatReasoningHeader(2.5, -1, false), "✦ Thinking (2.5s)");
    assert.equal(formatReasoningHeader(-1, 50, false), "✦ Thinking (50 tok)");

    // 3. Reasoning capsule edge cases
    // Duration 0, tokens 0
    assert.equal(formatReasoningCapsule(0, 0, false), "◈ Reasoned in 0.0s (0 tok) ▸");
    assert.equal(formatReasoningCapsule(0, 0, true), "> Reasoned in 0.0s (0 tok) >");
    // Negative duration clamped to 0
    assert.equal(formatReasoningCapsule(-3.5, 100, false), "◈ Reasoned in 0.0s (100 tok) ▸");
    // No tokens
    assert.equal(formatReasoningCapsule(4.2, undefined, false), "◈ Reasoned in 4.2s ▸");
    // Negative tokens omitted
    assert.equal(formatReasoningCapsule(4.2, -5, false), "◈ Reasoned in 4.2s ▸");

    // Ambient store adaptation for reasoning tokens
    accessibilityStore.updateSettings({ plainTextAsciiBorders: true });
    assert.equal(formatReasoningHeader(1.0, 20), "* Thinking (1.0s, 20 tok)");
    assert.equal(formatReasoningCapsule(1.0, 20), "> Reasoned in 1.0s (20 tok) >");
    // Explicit override false
    assert.equal(formatReasoningHeader(1.0, 20, false), "✦ Thinking (1.0s, 20 tok)");
    assert.equal(formatReasoningCapsule(1.0, 20, false), "◈ Reasoned in 1.0s (20 tok) ▸");
  } finally {
    accessibilityStore.updateSettings({ plainTextAsciiBorders: false });
  }
});

test("Interop with palette.ts and shared/types.ts", () => {
  // Check Obsidian Studio RawTheme
  assert.equal(OBSIDIAN_STUDIO_RAW_THEME.name, "obsidian-studio");
  assert.equal(OBSIDIAN_STUDIO_RAW_THEME.accent, "#00F0FF");
  assert.equal(OBSIDIAN_STUDIO_RAW_THEME.border, "#222630");
  assert.equal(OBSIDIAN_STUDIO_RAW_THEME.text, "#F1F5F9");

  // Check resolved PaletteSpec collection
  const resolved = getObsidianStudioPalette();
  assert.equal(resolved.name, "obsidian-studio");
  assert.equal(resolved.accent.hex, "#00f0ff");
  assert.equal(resolved.border.hex, "#222630");
  assert.equal(resolved.text.hex, "#f1f5f9");

  // Check railStateToPaletteSpec
  const activeSpec = railStateToPaletteSpec("active");
  assert.equal(activeSpec.hex, "#00f0ff");
  assert.ok(activeSpec.ansi256 >= 0);

  const errorSpec = railStateToPaletteSpec("error");
  assert.equal(errorSpec.hex, "#ff2a6d");

  // Check gaugeColorToPaletteSpec
  const gaugeSpec = gaugeColorToPaletteSpec(resolveGaugeColor(0.2));
  assert.equal(gaugeSpec.hex, "#00f0ff");

  // Check ThemePreset optional tokens typing
  const dummyPreset: Partial<ThemePreset> = {
    tokens: {
      rail: RAIL_GLYPHS,
      badge: "chip",
      brand: BrandTokens,
    },
  };
  assert.equal(dummyPreset.tokens?.badge, "chip");
});

test("Re-exports in extensions/omt/index.ts", () => {
  assert.ok(OmtIndex.OBSIDIAN_STUDIO_COLORS);
  assert.ok(OmtIndex.RailGlyphs);
  assert.ok(OmtIndex.BadgeStyles);
  assert.ok(OmtIndex.GaugeTokens);
  assert.ok(OmtIndex.ReasoningTokens);
  assert.ok(OmtIndex.UniversalDegradation);
});
