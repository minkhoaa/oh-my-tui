import type { Theme, WorkingIndicatorOptions } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { OMT_BRAILLE_SPINNER_FRAMES, signatureFg } from "./rendering.ts";
import { omtSpinner } from "./motion.ts";
import { isAnimationActive } from "../../core/motion.ts";

export const signatureWorking = {
  indicator: {
    frames: [...OMT_BRAILLE_SPINNER_FRAMES],
    intervalMs: 500,
  } satisfies WorkingIndicatorOptions,

  render(theme: Theme, elapsed: number, phase: string, _key: string, width: number): string {
    const spinner = omtSpinner(elapsed, isAnimationActive());
    const status = `${signatureFg(theme, "accent", spinner)} ${phase}`;
    return truncateToWidth(`  ${status}`, width, "…");
  },
};

export function signatureWorkingLine(
  theme: Theme,
  elapsed: number,
  phase: string,
  key: string,
  width: number,
): string {
  return signatureWorking.render(theme, elapsed, phase, key, width);
}
