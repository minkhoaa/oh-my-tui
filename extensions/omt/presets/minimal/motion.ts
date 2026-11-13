import { isAnimationActive, scaleElapsed } from "../../core/motion.ts";

export const MINIMAL_FRAME_MS = 250;
export const MINIMAL_FRAMES = ["·", "•", "·", " "] as const;

export function minimalSpinner(elapsed: number, animated = isAnimationActive()): string {
  if (!animated) return "·";
  const scaled = scaleElapsed(elapsed);
  const index = Math.floor(scaled / MINIMAL_FRAME_MS) % MINIMAL_FRAMES.length;
  return MINIMAL_FRAMES[index]!;
}
