// Codex-inspired working state presentation for Pi.
import type { Theme } from "@earendil-works/pi-coding-agent";
import { CODEX_FRAME_MS, codexStatus } from "./rendering.ts";
export const codexWorking = {
  indicator: { frames: ["•", "◦"], intervalMs: CODEX_FRAME_MS },
  render: (theme: Theme, elapsed: number, key: string, width: number) => codexStatus(theme, "Working", elapsed, elapsed, key, width),
};
