import type { Theme } from "@earendil-works/pi-coding-agent";
import { isAnimationActive, scaleElapsed } from "../../core/motion.ts";
import { EMBER_FRAME_MS, EMBER_FRAMES, emberSpinner as rawEmberSpinner, emberWorkingLine as rawEmberWorkingLine } from "./working.ts";

export { EMBER_FRAME_MS, EMBER_FRAMES };

export function emberSpinner(elapsed: number, animated = isAnimationActive()): string {
  if (!animated) return "●";
  return rawEmberSpinner(scaleElapsed(elapsed), true);
}

export function emberWorkingLine(
  theme: Theme,
  elapsed: number,
  phase: string,
  key: string,
  width: number,
  animated = isAnimationActive(),
): string {
  return rawEmberWorkingLine(theme, scaleElapsed(elapsed), phase, key, width, animated);
}
