/**
 * Oh My TUI (OMT) Obsidian Studio Theme Tokens & Contracts.
 *
 * Provides standardized design tokens for:
 * 1. RailGlyphs (Left-rail spine characters and stateful rail color resolvers)
 * 2. BadgeStyles (Inverted solid chips, lozenges, brackets)
 * 3. GaugeTokens (Context Fuel Gauge Unicode block tokens & thresholds)
 * 4. ReasoningTokens (Pulsing thinking header & folded reasoning capsule)
 * 5. Brand tokens for Obsidian Studio
 * 6. Universal Degradation helpers (Full UTF-8 -> Clean Unicode -> Strict ASCII)
 */

import { accessibilityStore } from "../features/accessibility/model.ts";

// =============================================================================
// 1. Brand Tokens: Obsidian Studio ("Void & Voltage")
// =============================================================================

export const OBSIDIAN_STUDIO_COLORS = {
  /** Canvas / deep black void background */
  canvas: "#0D0E11",
  /** Gunmetal slate rail spine and subtle borders */
  gunmetal: "#222630",
  /** Electric cyan primary accent / thinking indicator */
  cyan: "#00F0FF",
  /** Electric violet secondary accent / plan indicator */
  violet: "#9D4EDD",
  /** Acid emerald for success states / additions */
  emerald: "#05FFA1",
  /** Crimson laser for error states / deletions */
  crimson: "#FF2A6D",
  /** Bright foreground text */
  text: "#F1F5F9",
  /** Gunmetal muted slate text / secondary details */
  muted: "#64748B",
  /** Amber warning / interrupted state */
  amber: "#FFB300",
} as const;

export type ObsidianStudioColorKey = keyof typeof OBSIDIAN_STUDIO_COLORS;

export const OBSIDIAN_STUDIO_BRAND = {
  name: "Obsidian Studio",
  version: "1.0.0",
  glyph: "⌁",
  asciiGlyph: "~",
  tagline: "High-Precision Developer Cockpit",
  colors: OBSIDIAN_STUDIO_COLORS,
} as const;

export interface ObsidianBrandContract {
  readonly name: string;
  readonly version: string;
  readonly glyph: string;
  readonly asciiGlyph: string;
  readonly tagline: string;
  readonly colors: typeof OBSIDIAN_STUDIO_COLORS;
}

export const BrandTokens: ObsidianBrandContract = OBSIDIAN_STUDIO_BRAND;

// =============================================================================
// 2. RailGlyphs: Left-Rail Spine Characters & Stateful Color Resolvers
// =============================================================================

export interface RailGlyphSet {
  /** Standard thick left-rail block spine */
  readonly block: string;
  /** Hairline single vertical bar */
  readonly hairline: string;
  /** Strict ASCII vertical bar */
  readonly ascii: string;
}

export const RAIL_GLYPHS: RailGlyphSet = {
  block: "▎",
  hairline: "│",
  ascii: "|",
} as const;

export type RailGlyphVariant = "block" | "hairline" | "ascii";

export type RailState =
  | "thinking"
  | "streaming"
  | "running"
  | "executing"
  | "active"
  | "completed"
  | "idle"
  | "done"
  | "history"
  | "success"
  | "interrupted"
  | "warning"
  | "aborted"
  | "error"
  | "failure"
  | "failed";

export interface RailColorToken {
  /** Primary hex color */
  readonly hex: string;
  /** Optional secondary / gradient hex color */
  readonly secondaryHex?: string;
  /** Semantic role name */
  readonly role: "active" | "history" | "warning" | "error";
}

/**
 * Resolve the stateful rail color based on observable agent / tool lifecycle states:
 * - Active / Thinking / Streaming: Electric Cyan (`#00F0FF`) / Violet (`#9D4EDD`)
 * - History / Completed: Gunmetal Slate (`#64748B` / `#222630`)
 * - Interrupted / Warning: Amber (`#FFB300`)
 * - Error / Failure: Crimson Laser (`#FF2A6D`)
 */
export function resolveRailColor(state: RailState): RailColorToken {
  switch (state) {
    case "thinking":
    case "streaming":
    case "running":
    case "executing":
    case "active":
      return {
        hex: OBSIDIAN_STUDIO_COLORS.cyan,
        secondaryHex: OBSIDIAN_STUDIO_COLORS.violet,
        role: "active",
      };
    case "completed":
    case "idle":
    case "done":
    case "history":
    case "success":
      return {
        hex: OBSIDIAN_STUDIO_COLORS.muted,
        secondaryHex: OBSIDIAN_STUDIO_COLORS.gunmetal,
        role: "history",
      };
    case "interrupted":
    case "warning":
    case "aborted":
      return {
        hex: OBSIDIAN_STUDIO_COLORS.amber,
        role: "warning",
      };
    case "error":
    case "failure":
    case "failed":
      return {
        hex: OBSIDIAN_STUDIO_COLORS.crimson,
        role: "error",
      };
  }
}

/** Resolve only the primary hex string for a given rail state */
export function resolveRailHex(state: RailState): string {
  return resolveRailColor(state).hex;
}

/** Resolve the appropriate rail spine glyph according to variant and ASCII mode */
export function resolveRailGlyph(
  variant: RailGlyphVariant = "block",
  isAscii?: boolean,
): string {
  if (isAscii ?? accessibilityStore.isPlainTextAsciiBorders()) {
    return RAIL_GLYPHS.ascii;
  }
  switch (variant) {
    case "hairline":
      return RAIL_GLYPHS.hairline;
    case "ascii":
      return RAIL_GLYPHS.ascii;
    case "block":
    default:
      return RAIL_GLYPHS.block;
  }
}

export interface RailGlyphsContract {
  readonly glyphs: RailGlyphSet;
  readonly resolveGlyph: typeof resolveRailGlyph;
  readonly resolveColor: typeof resolveRailColor;
  readonly resolveHex: typeof resolveRailHex;
}

export const RailGlyphs: RailGlyphsContract = {
  glyphs: RAIL_GLYPHS,
  resolveGlyph: resolveRailGlyph,
  resolveColor: resolveRailColor,
  resolveHex: resolveRailHex,
};

// =============================================================================
// 3. BadgeStyles: Solid Chips, Lozenges, Brackets
// =============================================================================

export type BadgeVariant = "chip" | "lozenge" | "bracket";

export interface BadgeStyleTokens {
  readonly chipLead: string;
  readonly lozengeOpen: string;
  readonly lozengeClose: string;
  readonly bracketOpen: string;
  readonly bracketClose: string;
  readonly asciiChipLead: string;
  readonly asciiLozengeOpen: string;
  readonly asciiLozengeClose: string;
  readonly asciiBracketOpen: string;
  readonly asciiBracketClose: string;
}

export const BADGE_GLYPHS: BadgeStyleTokens = {
  chipLead: " ▊ ",
  lozengeOpen: "❲",
  lozengeClose: "❳",
  bracketOpen: "[",
  bracketClose: "]",
  asciiChipLead: "| ",
  asciiLozengeOpen: "(",
  asciiLozengeClose: ")",
  asciiBracketOpen: "[",
  asciiBracketClose: "]",
} as const;

/**
 * Format a badge label with the selected visual style:
 * - "chip": Inverted solid chip style (` ▊ READ `)
 * - "lozenge": Rounded lozenge (`❲read❳`)
 * - "bracket": Square brackets (`[READ]`)
 */
export function formatBadge(
  label: string,
  variant: BadgeVariant = "chip",
  isAscii?: boolean,
): string {
  const ascii = isAscii ?? accessibilityStore.isPlainTextAsciiBorders();
  const raw = label.trim();

  if (ascii) {
    switch (variant) {
      case "chip":
        return `| ${raw.toUpperCase()} |`;
      case "lozenge":
        return `(${raw.toLowerCase()})`;
      case "bracket":
        return `[${raw.toUpperCase()}]`;
    }
  }

  switch (variant) {
    case "chip":
      return `${BADGE_GLYPHS.chipLead}${raw.toUpperCase()} `;
    case "lozenge":
      return `${BADGE_GLYPHS.lozengeOpen}${raw.toLowerCase()}${BADGE_GLYPHS.lozengeClose}`;
    case "bracket":
      return `${BADGE_GLYPHS.bracketOpen}${raw.toUpperCase()}${BADGE_GLYPHS.bracketClose}`;
  }
}

export function formatSolidChip(label: string, isAscii?: boolean): string {
  return formatBadge(label, "chip", isAscii);
}

export function formatLozenge(label: string, isAscii?: boolean): string {
  return formatBadge(label, "lozenge", isAscii);
}

export function formatBracket(label: string, isAscii?: boolean): string {
  return formatBadge(label, "bracket", isAscii);
}

export interface BadgeStylesContract {
  readonly glyphs: BadgeStyleTokens;
  readonly format: typeof formatBadge;
  readonly solidChip: typeof formatSolidChip;
  readonly lozenge: typeof formatLozenge;
  readonly bracket: typeof formatBracket;
}

export const BadgeStyles: BadgeStylesContract = {
  glyphs: BADGE_GLYPHS,
  format: formatBadge,
  solidChip: formatSolidChip,
  lozenge: formatLozenge,
  bracket: formatBracket,
};

// =============================================================================
// 4. GaugeTokens: Fuel Gauge Unicode Block Tokens & Thresholds
// =============================================================================

export interface GaugeGlyphSet {
  readonly filled: string;
  readonly empty: string;
  readonly asciiFilled: string;
  readonly asciiEmpty: string;
}

export const GAUGE_GLYPHS: GaugeGlyphSet = {
  filled: "▰",
  empty: "▱",
  asciiFilled: "#",
  asciiEmpty: "-",
} as const;

export interface GaugeThresholdColor {
  /** Hex color for the fuel gauge segment */
  readonly color: string;
  /** Severity level */
  readonly level: "normal" | "warning" | "critical";
  /** True when usage exceeds 80%, recommending `/compact` */
  readonly recommendCompact: boolean;
}

/**
 * Resolve threshold color for Context Fuel Gauge:
 * - < 50%: Electric Cyan (`#00F0FF`)
 * - 50% - 80%: Amber Warning (`#FFB300`)
 * - > 80%: Crimson Laser (`#FF2A6D`), triggers compact recommendation
 *
 * @param ratio Number between 0 and 1, or percentage between 0 and 100.
 */
export function resolveGaugeColor(ratio: number): GaugeThresholdColor {
  const pct = ratio > 1 ? ratio : Math.max(0, ratio * 100);
  if (pct < 50) {
    return {
      color: OBSIDIAN_STUDIO_COLORS.cyan,
      level: "normal",
      recommendCompact: false,
    };
  }
  if (pct <= 80) {
    return {
      color: OBSIDIAN_STUDIO_COLORS.amber,
      level: "warning",
      recommendCompact: false,
    };
  }
  return {
    color: OBSIDIAN_STUDIO_COLORS.crimson,
    level: "critical",
    recommendCompact: true,
  };
}

/**
 * Render fuel gauge bar with custom slot count (default: 8 slots).
 * Example at 38%: `▰▰▰▱▱▱▱▱` (3 filled, 5 empty)
 */
export function renderGaugeBar(
  ratio: number,
  totalSlots = 8,
  isAscii?: boolean,
): string {
  const ascii = isAscii ?? accessibilityStore.isPlainTextAsciiBorders();
  const normalized = Math.max(0, Math.min(1, ratio > 1 ? ratio / 100 : ratio));
  const slots = Math.max(1, Math.floor(totalSlots));
  const filledCount = Math.round(normalized * slots);
  const emptyCount = Math.max(0, slots - filledCount);

  const filledChar = ascii ? GAUGE_GLYPHS.asciiFilled : GAUGE_GLYPHS.filled;
  const emptyChar = ascii ? GAUGE_GLYPHS.asciiEmpty : GAUGE_GLYPHS.empty;

  return filledChar.repeat(filledCount) + emptyChar.repeat(emptyCount);
}

export interface GaugeTokensContract {
  readonly glyphs: GaugeGlyphSet;
  readonly resolveColor: typeof resolveGaugeColor;
  readonly renderBar: typeof renderGaugeBar;
}

export const GaugeTokens: GaugeTokensContract = {
  glyphs: GAUGE_GLYPHS,
  resolveColor: resolveGaugeColor,
  renderBar: renderGaugeBar,
};

// =============================================================================
// 5. ReasoningTokens: Pulsing Header & Folded Capsule
// =============================================================================

export interface ReasoningGlyphSet {
  readonly pulse: string;
  readonly capsule: string;
  readonly chevron: string;
  readonly rule: string;
  readonly asciiPulse: string;
  readonly asciiCapsule: string;
  readonly asciiChevron: string;
  readonly asciiRule: string;
}

export const REASONING_GLYPHS: ReasoningGlyphSet = {
  pulse: "✦",
  capsule: "◈",
  chevron: "▸",
  rule: "┈┈",
  asciiPulse: "*",
  asciiCapsule: ">",
  asciiChevron: ">",
  asciiRule: "--",
} as const;

/**
 * Format live pulsing header during active thinking phase:
 * e.g., `✦ Thinking (2.4s, 184 tok) ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈`
 */
export function formatReasoningHeader(
  durationSeconds?: number,
  tokens?: number,
  isAscii?: boolean,
): string {
  const ascii = isAscii ?? accessibilityStore.isPlainTextAsciiBorders();
  const icon = ascii ? REASONING_GLYPHS.asciiPulse : REASONING_GLYPHS.pulse;
  let text = `${icon} Thinking`;

  const meta: string[] = [];
  if (durationSeconds !== undefined && durationSeconds >= 0) {
    meta.push(`${durationSeconds.toFixed(1)}s`);
  }
  if (tokens !== undefined && tokens >= 0) {
    meta.push(`${tokens} tok`);
  }
  if (meta.length > 0) {
    text += ` (${meta.join(", ")})`;
  }
  return text;
}

/**
 * Format folded reasoning capsule when thinking completes:
 * e.g., `◈ Reasoned in 2.4s (184 tok) ▸`
 */
export function formatReasoningCapsule(
  durationSeconds: number,
  tokens?: number,
  isAscii?: boolean,
): string {
  const ascii = isAscii ?? accessibilityStore.isPlainTextAsciiBorders();
  const icon = ascii ? REASONING_GLYPHS.asciiCapsule : REASONING_GLYPHS.capsule;
  const chevron = ascii ? REASONING_GLYPHS.asciiChevron : REASONING_GLYPHS.chevron;
  const dur = `${Math.max(0, durationSeconds).toFixed(1)}s`;
  const tok = tokens !== undefined && tokens >= 0 ? ` (${tokens} tok)` : "";

  return `${icon} Reasoned in ${dur}${tok} ${chevron}`;
}

export interface ReasoningTokensContract {
  readonly glyphs: ReasoningGlyphSet;
  readonly formatHeader: typeof formatReasoningHeader;
  readonly formatCapsule: typeof formatReasoningCapsule;
}

export const ReasoningTokens: ReasoningTokensContract = {
  glyphs: REASONING_GLYPHS,
  formatHeader: formatReasoningHeader,
  formatCapsule: formatReasoningCapsule,
};

// =============================================================================
// 6. Universal Degradation Helpers (Full UTF-8 -> Clean Unicode -> Strict ASCII)
// =============================================================================

export type DegradationLevel = "utf8" | "clean-unicode" | "ascii";

export interface DegradableGlyph {
  readonly utf8: string;
  readonly cleanUnicode: string;
  readonly ascii: string;
}

export const DEGRADABLE_GLYPH_CATALOG: Record<string, DegradableGlyph> = {
  brand: { utf8: "⌁", cleanUnicode: "❖", ascii: "~" },
  railBlock: { utf8: "▎", cleanUnicode: "│", ascii: "|" },
  railHairline: { utf8: "│", cleanUnicode: "│", ascii: "|" },
  pulse: { utf8: "✦", cleanUnicode: "●", ascii: "*" },
  capsule: { utf8: "◈", cleanUnicode: "◆", ascii: ">" },
  chevron: { utf8: "▸", cleanUnicode: ">", ascii: ">" },
  gaugeFilled: { utf8: "▰", cleanUnicode: "■", ascii: "#" },
  gaugeEmpty: { utf8: "▱", cleanUnicode: "□", ascii: "-" },
  chipLead: { utf8: " ▊ ", cleanUnicode: " ▌ ", ascii: "| " },
  lozengeOpen: { utf8: "❲", cleanUnicode: "(", ascii: "(" },
  lozengeClose: { utf8: "❳", cleanUnicode: ")", ascii: ")" },
  rule: { utf8: "┈┈", cleanUnicode: "──", ascii: "--" },
} as const;

/** Check whether strict plain text ASCII mode is active */
export function isStrictAscii(override?: boolean): boolean {
  if (typeof override === "boolean") return override;
  try {
    return accessibilityStore.isPlainTextAsciiBorders();
  } catch {
    return false;
  }
}

/** Determine the active terminal degradation level */
export function getTerminalDegradationLevel(forceAscii?: boolean): DegradationLevel {
  if (isStrictAscii(forceAscii)) return "ascii";
  return "utf8";
}

/**
 * Degrades a token or glyph contract according to the specified or ambient degradation level.
 */
export function degradeGlyph(
  glyph: DegradableGlyph | keyof typeof DEGRADABLE_GLYPH_CATALOG,
  level?: DegradationLevel | boolean,
): string {
  const target: DegradableGlyph =
    typeof glyph === "string" ? DEGRADABLE_GLYPH_CATALOG[glyph] ?? { utf8: glyph, cleanUnicode: glyph, ascii: glyph } : glyph;

  const resolvedLevel: DegradationLevel =
    typeof level === "boolean"
      ? (level ? "ascii" : "utf8")
      : (level ?? getTerminalDegradationLevel());

  switch (resolvedLevel) {
    case "ascii":
      return target.ascii;
    case "clean-unicode":
      return target.cleanUnicode;
    case "utf8":
    default:
      return target.utf8;
  }
}

export interface UniversalDegradationContract {
  readonly isStrictAscii: typeof isStrictAscii;
  readonly getLevel: typeof getTerminalDegradationLevel;
  readonly degrade: typeof degradeGlyph;
  readonly catalog: typeof DEGRADABLE_GLYPH_CATALOG;
}

export const UniversalDegradation: UniversalDegradationContract = {
  isStrictAscii,
  getLevel: getTerminalDegradationLevel,
  degrade: degradeGlyph,
  catalog: DEGRADABLE_GLYPH_CATALOG,
};
