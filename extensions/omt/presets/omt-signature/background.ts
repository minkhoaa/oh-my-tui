import type { PresetBackgroundPalette } from "../../features/backgrounds/scenes/index.ts";

/**
 * OMT Signature preset background configuration:
 * Electric violet nebulae, cyan star voyages, and midnight depth.
 */
export const signatureBackgroundPalette: PresetBackgroundPalette = Object.freeze({
  primary: [139, 92, 246] as const, // Electric violet #8B5CF6
  secondary: [56, 189, 248] as const, // Sky cyan #38BDF8
  dim: [30, 27, 75] as const, // Deep midnight indigo
  glow: [167, 139, 250] as const, // Violet flare
  ambientBg: [15, 23, 42] as const, // Slate-900
  label: "Signature Violet Voyage",
  defaultScene: "star-voyage",
});

export const SIGNATURE_BACKGROUND_DEFAULTS = Object.freeze({
  palette: signatureBackgroundPalette,
  scene: "star-voyage" as const,
  preferredHeight: 4,
  framing: "rule" as const,
});
