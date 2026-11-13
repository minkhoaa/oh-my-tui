import type { Theme } from "@earendil-works/pi-coding-agent";
import { isAnimationActive, scaleElapsed } from "../../core/motion.ts";
import { CLEAN_FRAME_MS, cleanActivity as rawCleanActivity, cleanDim } from "./rendering.ts";

export { CLEAN_FRAME_MS };

export const CLEAN_SWEEP_CADENCE_MS = 2000;
export const CLEAN_PULSE_CADENCE_MS = 600;

export function cleanActivity(theme: Theme, elapsedMs: number, animated = isAnimationActive()): string {
  if (!animated) return "•";
  return rawCleanActivity(theme, scaleElapsed(elapsedMs));
}

export function cleanSpinner(elapsedMs: number, animated = isAnimationActive()): string {
  if (!animated) return "•";
  const scaled = scaleElapsed(elapsedMs);
  return Math.floor(scaled / CLEAN_PULSE_CADENCE_MS) % 2 ? cleanDim("◦") : "•";
}
