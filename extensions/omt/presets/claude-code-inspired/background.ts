import type { PresetBackgroundPalette } from "../../features/backgrounds/scenes/index.ts";

/**
 * Claude Code Inspired preset background configuration:
 * Warm terracotta sunset auroras and twilight dust motes.
 */
export const claudeBackgroundPalette: PresetBackgroundPalette = Object.freeze({
  primary: [215, 119, 87] as const, // Official Claude terracotta #d77757
  secondary: [224, 144, 96] as const, // Warm amber
  dim: [80, 40, 30] as const, // Deep sunset rust
  glow: [255, 180, 150] as const, // Sunset flare
  ambientBg: [28, 18, 16] as const,
  label: "Claude Sunset Aurora",
  defaultScene: "aurora",
});

export const CLAUDE_BACKGROUND_DEFAULTS = Object.freeze({
  palette: claudeBackgroundPalette,
  scene: "aurora" as const,
  preferredHeight: 4,
  framing: "rule" as const,
});
