// OpenCode-inspired working state presentation for Pi.
import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { OPENCODE_FRAME_MS, openCodeFg, openCodeScanner } from "./rendering.ts";
export const openCodeWorking = {
  indicator: { frames: ["■", "⬝"], intervalMs: OPENCODE_FRAME_MS },
  render: (theme: Theme, elapsed: number, key: string, width: number) => truncateToWidth(`   ${openCodeScanner(theme, elapsed)}  ${key ? openCodeFg(theme, "text", key) + openCodeFg(theme, "muted", " interrupt") : ""}`, width, ""),
};
