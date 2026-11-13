import type { Theme } from "@earendil-works/pi-coding-agent";
import { isAnimationActive, scaleElapsed } from "../../core/motion.ts";
import { CODEX_FRAME_MS, codexActivity as rawCodexActivity, codexDim } from "./rendering.ts";

export { CODEX_FRAME_MS };

export const CODEX_SWEEP_CADENCE_MS = 2000;
export const CODEX_PULSE_CADENCE_MS = 600;

export function codexActivity(theme: Theme, elapsedMs: number, animated = isAnimationActive()): string {
  if (!animated) return "•";
  return rawCodexActivity(theme, scaleElapsed(elapsedMs));
}

export function codexSpinner(elapsedMs: number, animated = isAnimationActive()): string {
  if (!animated) return "•";
  const scaled = scaleElapsed(elapsedMs);
  return Math.floor(scaled / CODEX_PULSE_CADENCE_MS) % 2 ? codexDim("◦") : "•";
}
