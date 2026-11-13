import type { PresetBackgroundPalette } from "../../features/backgrounds/scenes/index.ts";

/**
 * Minimal preset background configuration:
 * Quiet grayscale monochrome starfields and subtle silver dust motes.
 */
export const minimalBackgroundPalette: PresetBackgroundPalette = Object.freeze({
  primary: [180, 180, 180] as const, // Silver
  secondary: [120, 120, 120] as const, // Medium gray
  dim: [50, 50, 50] as const, // Charcoal
  glow: [240, 240, 240] as const, // White sparkle
  ambientBg: [16, 16, 16] as const,
  label: "Minimal Monochrome Starfield",
  defaultScene: "starfield",
});

export const MINIMAL_BACKGROUND_DEFAULTS = Object.freeze({
  palette: minimalBackgroundPalette,
  scene: "starfield" as const,
  preferredHeight: 3,
  framing: "none" as const,
});
