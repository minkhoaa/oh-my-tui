import type { PresetBackgroundPalette } from "../../features/backgrounds/scenes/index.ts";

/**
 * OMT Clean preset background configuration:
 * Cybernetic matrix phosphors with terminal-blended slate greens.
 */
export const cleanBackgroundPalette: PresetBackgroundPalette = Object.freeze({
  primary: [0, 255, 102] as const, // Classic phosphor green
  secondary: [0, 170, 68] as const, // Mid green stream
  dim: [0, 60, 25] as const, // Faint green trail
  glow: [180, 255, 200] as const, // Bright code head
  ambientBg: [10, 24, 16] as const,
  label: "Clean Digital Phosphor",
  defaultScene: "matrix",
});

export const CLEAN_BACKGROUND_DEFAULTS = Object.freeze({
  palette: cleanBackgroundPalette,
  scene: "matrix" as const,
  preferredHeight: 4,
  framing: "bracket" as const,
});
