import type { PresetBackgroundPalette } from "../../features/backgrounds/scenes/index.ts";

/**
 * OMT Rail preset background configuration:
 * Electric cyan tech rails and cyber rain.
 */
export const railBackgroundPalette: PresetBackgroundPalette = Object.freeze({
  primary: [0, 212, 255] as const, // Electric cyan
  secondary: [0, 102, 204] as const, // Tech blue
  dim: [0, 34, 68] as const, // Deep navy
  glow: [120, 240, 255] as const, // Neon blue
  ambientBg: [12, 20, 32] as const,
  label: "Rail Electric Rain",
  defaultScene: "rain",
});

export const RAIL_BACKGROUND_DEFAULTS = Object.freeze({
  palette: railBackgroundPalette,
  scene: "rain" as const,
  preferredHeight: 4,
  framing: "rail" as const,
});
