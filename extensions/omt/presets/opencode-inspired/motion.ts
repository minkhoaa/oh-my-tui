import type { Theme } from "@earendil-works/pi-coding-agent";
import { isAnimationActive, scaleElapsed } from "../../core/motion.ts";
import { OPENCODE_FRAME_MS, OPENCODE_BRAILLE, openCodeScanner as rawOpenCodeScanner, openCodeSpinner as rawOpenCodeSpinner, openCodeFg } from "./rendering.ts";

export { OPENCODE_FRAME_MS, OPENCODE_BRAILLE };
export const OPENCODE_BRAILLE_MS = 80;

export function openCodeScanner(theme: Theme, elapsed: number, animated = isAnimationActive()): string {
  if (!animated) return openCodeFg(theme, "secondary", "⋯");
  return rawOpenCodeScanner(theme, scaleElapsed(elapsed), true);
}

export function openCodeSpinner(elapsed: number, animated = isAnimationActive()): string {
  if (!animated) return "⋯";
  return rawOpenCodeSpinner(scaleElapsed(elapsed), true);
}
