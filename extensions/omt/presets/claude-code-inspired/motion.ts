import type { Theme } from "@earendil-works/pi-coding-agent";
import { isAnimationActive, scaleElapsed } from "../../core/motion.ts";
import { CLAUDE_FRAME_MS, CLAUDE_FRAMES, claudeSpinner as rawClaudeSpinner, claudeWorkingLine as rawClaudeWorkingLine } from "./working.ts";

export { CLAUDE_FRAME_MS, CLAUDE_FRAMES };

export function claudeSpinner(elapsed: number, animated = isAnimationActive()): string {
  if (!animated) return "●";
  return rawClaudeSpinner(scaleElapsed(elapsed), true);
}

export function claudeWorkingLine(
  theme: Theme,
  elapsed: number,
  phase: string,
  key: string,
  width: number,
  animated = isAnimationActive(),
): string {
  return rawClaudeWorkingLine(theme, scaleElapsed(elapsed), phase, key, width, animated);
}
