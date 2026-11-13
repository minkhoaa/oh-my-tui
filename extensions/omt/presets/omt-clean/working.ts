// OMT Clean working state presentation for Pi.
import type { Theme } from "@earendil-works/pi-coding-agent";
import { CLEAN_FRAME_MS, cleanStatus } from "./rendering.ts";
export const cleanWorking = {
  indicator: { frames: ["•", "◦"], intervalMs: CLEAN_FRAME_MS },
  render: (theme: Theme, elapsed: number, key: string, width: number) => cleanStatus(theme, "Working", elapsed, elapsed, key, width),
};
