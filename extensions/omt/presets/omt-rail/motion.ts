import type { Theme } from "@earendil-works/pi-coding-agent";
import { isAnimationActive, scaleElapsed } from "../../core/motion.ts";
import { RAIL_FRAME_MS, RAIL_BRAILLE, railScanner as rawRailScanner, railSpinner as rawRailSpinner, railFg } from "./rendering.ts";

export { RAIL_FRAME_MS, RAIL_BRAILLE };
export const RAIL_BRAILLE_MS = 80;

export function railScanner(theme: Theme, elapsed: number, animated = isAnimationActive()): string {
  if (!animated) return railFg(theme, "secondary", "⋯");
  return rawRailScanner(theme, scaleElapsed(elapsed), true);
}

export function railSpinner(elapsed: number, animated = isAnimationActive()): string {
  if (!animated) return "⋯";
  return rawRailSpinner(scaleElapsed(elapsed), true);
}
