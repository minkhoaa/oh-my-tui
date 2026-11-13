import type { PresetBackgroundPalette } from "../../features/backgrounds/scenes/index.ts";

/**
 * OMT Ember preset background configuration:
 * Ember terracotta sunset auroras and twilight dust motes.
 */
export const emberBackgroundPalette: PresetBackgroundPalette = Object.freeze({
  primary: [215, 119, 87] as const, // Warm terracotta #d77757
  secondary: [224, 144, 96] as const, // Ember amber
  dim: [80, 40, 30] as const, // Deep sunset rust
  glow: [255, 180, 150] as const, // Sunset flare
  ambientBg: [28, 18, 16] as const,
  label: "Ember Sunset Aurora",
  defaultScene: "aurora",
});

export const EMBER_BACKGROUND_DEFAULTS = Object.freeze({
  palette: emberBackgroundPalette,
  scene: "aurora" as const,
  preferredHeight: 4,
  framing: "rule" as const,
});
