/**
 * Native preset motion definitions.
 * Delegates motion entirely to native Pi without custom overlays.
 */
export const NATIVE_FRAME_MS = 100;

export function nativeSpinner(_elapsed: number, _animated = false): string {
  return "●";
}
