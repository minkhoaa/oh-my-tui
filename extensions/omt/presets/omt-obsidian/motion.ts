import { SIGNATURE_SPINNER_FRAMES, SIGNATURE_FRAME_MS, OMT_BRAILLE_SPINNER_FRAMES } from "./rendering.ts";

export {
  SIGNATURE_SPINNER_FRAMES,
  SIGNATURE_FRAME_MS,
  OMT_BRAILLE_SPINNER_FRAMES,
};

/** Diamond spinner cycling through 4 diamond phases. */
export function signatureSpinner(elapsed: number, animated = true): string {
  if (!animated) return "◈";
  const frameIndex =
    Math.floor(Math.max(0, elapsed) / SIGNATURE_FRAME_MS) % SIGNATURE_SPINNER_FRAMES.length;
  return SIGNATURE_SPINNER_FRAMES[frameIndex]!;
}

/** Braille spinner cycling through 10 braille frames. */
export function omtSpinner(elapsed: number, animated = true): string {
  if (!animated) return "⠋";
  const frameIndex =
    Math.floor(Math.max(0, elapsed) / 500) % OMT_BRAILLE_SPINNER_FRAMES.length;
  return OMT_BRAILLE_SPINNER_FRAMES[frameIndex]!;
}

