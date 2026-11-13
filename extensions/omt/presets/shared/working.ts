import type { Theme, WorkingIndicatorOptions } from "@earendil-works/pi-coding-agent";
import { getActiveTheme } from "../../core/theme.ts";
import { isCodexTheme, isOpenCodeTheme, isClaudeTheme, isSignatureTheme } from "./style.ts";
import { codexWorking } from "../codex-inspired/working.ts";
import { openCodeWorking } from "../opencode-inspired/working.ts";
import { CLAUDE_FRAME_MS, CLAUDE_FRAMES, claudeWorkingLine } from "../claude-code-inspired/working.ts";
import { signatureWorking } from "../omt-signature/working.ts";
import { isAnimationActive, scaleElapsed, scaleInterval } from "../../core/motion.ts";

export function hasAnimatedWorking(): boolean {
  if (!isAnimationActive()) return false;
  return isCodexTheme() || isOpenCodeTheme() || isClaudeTheme() || isSignatureTheme();
}

export function usesWorkingPhases(): boolean {
  return isClaudeTheme() || isSignatureTheme() || !hasAnimatedWorking();
}

export function workingIndicator(supported: boolean): WorkingIndicatorOptions {
  if (!isAnimationActive()) {
    return { frames: [getActiveTheme().thinking.indicator] };
  }
  if (supported && isSignatureTheme()) {
    return {
      frames: [...signatureWorking.indicator.frames],
      intervalMs: scaleInterval(signatureWorking.indicator.intervalMs),
    };
  }
  if (supported && isOpenCodeTheme()) {
    return {
      frames: [...openCodeWorking.indicator.frames],
      intervalMs: scaleInterval(openCodeWorking.indicator.intervalMs),
    };
  }
  if (supported && isCodexTheme()) {
    return {
      frames: [...codexWorking.indicator.frames],
      intervalMs: scaleInterval(codexWorking.indicator.intervalMs),
    };
  }
  if (supported && isClaudeTheme()) {
    return {
      frames: [...CLAUDE_FRAMES],
      intervalMs: scaleInterval(CLAUDE_FRAME_MS),
    };
  }
  return { frames: [getActiveTheme().thinking.indicator] };
}

export function workingLine(theme: Theme, elapsed: number, phase: string, key: string, width: number): string | undefined {
  const animated = isAnimationActive();
  const scaled = scaleElapsed(elapsed);
  if (isSignatureTheme()) return signatureWorking.render(theme, scaled, phase, key, width);
  if (isOpenCodeTheme()) return openCodeWorking.render(theme, scaled, key, width);
  if (isCodexTheme()) return codexWorking.render(theme, scaled, key, width);
  if (isClaudeTheme()) return claudeWorkingLine(theme, scaled, phase, key, width, animated);
  return undefined;
}
