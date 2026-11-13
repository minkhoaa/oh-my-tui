import type { Theme, WorkingIndicatorOptions } from "@earendil-works/pi-coding-agent";
import { getActiveTheme } from "../../core/theme.ts";
import { isCleanTheme, isRailTheme, isEmberTheme, isSignatureTheme } from "./style.ts";
import { cleanWorking } from "../omt-clean/working.ts";
import { railWorking } from "../omt-rail/working.ts";
import { EMBER_FRAME_MS, EMBER_FRAMES, emberWorkingLine } from "../omt-ember/working.ts";
import { signatureWorking } from "../omt-signature/working.ts";
import { isAnimationActive, scaleElapsed, scaleInterval } from "../../core/motion.ts";

export function hasAnimatedWorking(): boolean {
  if (!isAnimationActive()) return false;
  return isCleanTheme() || isRailTheme() || isEmberTheme() || isSignatureTheme();
}

export function usesWorkingPhases(): boolean {
  return isEmberTheme() || isSignatureTheme() || !hasAnimatedWorking();
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
  if (supported && isRailTheme()) {
    return {
      frames: [...railWorking.indicator.frames],
      intervalMs: scaleInterval(railWorking.indicator.intervalMs),
    };
  }
  if (supported && isCleanTheme()) {
    return {
      frames: [...cleanWorking.indicator.frames],
      intervalMs: scaleInterval(cleanWorking.indicator.intervalMs),
    };
  }
  if (supported && isEmberTheme()) {
    return {
      frames: [...EMBER_FRAMES],
      intervalMs: scaleInterval(EMBER_FRAME_MS),
    };
  }
  return { frames: [getActiveTheme().thinking.indicator] };
}

export function workingLine(theme: Theme, elapsed: number, phase: string, key: string, width: number): string | undefined {
  const animated = isAnimationActive();
  const scaled = scaleElapsed(elapsed);
  if (isSignatureTheme()) return signatureWorking.render(theme, scaled, phase, key, width);
  if (isRailTheme()) return railWorking.render(theme, scaled, key, width);
  if (isCleanTheme()) return cleanWorking.render(theme, scaled, key, width);
  if (isEmberTheme()) return emberWorkingLine(theme, scaled, phase, key, width, animated);
  return undefined;
}
