import type { PresetBackgroundPalette } from "../../features/backgrounds/scenes/index.ts";

/**
 * OMT Obsidian Studio preset background configuration:
 * Void canvas, electric cyan voltage, and violet spark accents.
 */
export const obsidianBackgroundPalette: PresetBackgroundPalette = Object.freeze({
  primary: [0, 240, 255] as const, // Electric cyan #00F0FF
  secondary: [157, 78, 221] as const, // Violet spark #9D4EDD
  dim: [13, 14, 17] as const, // Obsidian canvas #0D0E11
  glow: [5, 255, 161] as const, // Acid emerald #05FFA1
  ambientBg: [13, 14, 17] as const, // Obsidian #0D0E11
  label: "Obsidian Void & Voltage",
  defaultScene: "matrix",
});

export const OBSIDIAN_BACKGROUND_DEFAULTS = Object.freeze({
  palette: obsidianBackgroundPalette,
  scene: "matrix" as const,
  preferredHeight: 4,
  framing: "rule" as const,
});
