// OMT Rail working state presentation for Pi.
import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { RAIL_FRAME_MS, railFg, railScanner } from "./rendering.ts";
export const railWorking = {
  indicator: { frames: ["■", "⬝"], intervalMs: RAIL_FRAME_MS },
  render: (theme: Theme, elapsed: number, key: string, width: number) => truncateToWidth(`   ${railScanner(theme, elapsed)}  ${key ? railFg(theme, "text", key) + railFg(theme, "muted", " interrupt") : ""}`, width, ""),
};
