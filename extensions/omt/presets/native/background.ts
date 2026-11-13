import type { PresetBackgroundPalette } from "../../features/backgrounds/scenes/index.ts";

/**
 * Native preset background configuration:
 * Preserves native Pi terminal presentation; backgrounds remain disabled.
 */
export const nativeBackgroundPalette: PresetBackgroundPalette = Object.freeze({
  primary: [140, 140, 140] as const,
  secondary: [90, 90, 90] as const,
  dim: [40, 40, 40] as const,
  glow: [200, 200, 200] as const,
  ambientBg: [0, 0, 0] as const,
  label: "Native Presentation (Disabled)",
  defaultScene: "aurora",
});

export const NATIVE_BACKGROUND_DEFAULTS = Object.freeze({
  palette: nativeBackgroundPalette,
  scene: "aurora" as const,
  preferredHeight: 0,
  framing: "none" as const,
});
