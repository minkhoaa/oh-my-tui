import type { PresetBackgroundPalette } from "../../features/backgrounds/scenes/index.ts";

/**
 * Codex Inspired preset background configuration:
 * Cybernetic matrix phosphors with terminal-blended slate greens.
 */
export const codexBackgroundPalette: PresetBackgroundPalette = Object.freeze({
  primary: [0, 255, 102] as const, // Classic phosphor green
  secondary: [0, 170, 68] as const, // Mid green stream
  dim: [0, 60, 25] as const, // Faint green trail
  glow: [180, 255, 200] as const, // Bright code head
  ambientBg: [10, 24, 16] as const,
  label: "Codex Digital Phosphor",
  defaultScene: "matrix",
});

export const CODEX_BACKGROUND_DEFAULTS = Object.freeze({
  palette: codexBackgroundPalette,
  scene: "matrix" as const,
  preferredHeight: 4,
  framing: "bracket" as const,
});
