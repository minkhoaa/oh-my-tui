// OMT Rail footer presentation for Pi.
import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import { railFg } from "./rendering.ts";
import type { FooterRenderData } from "../shared/footer.ts";

export function railFooter(width: number, theme: Theme, data: FooterRenderData): string {
    const pad = " ".repeat(Math.min(Math.max(3, data.outputPad ?? 1), Math.floor(width / 5)));
    const home = homedir();
    const directory = data.cwd ? data.cwd === home || data.cwd.startsWith(`${home}/`) ? `~${data.cwd.slice(home.length)}` : data.cwd : "";
    const left = railFg(theme, "muted", [directory, data.branch].filter(Boolean).join(":"));
    const right = data.extensionStatuses.length ? data.extensionStatuses.join("  ") : railFg(theme, "muted", data.routedModelId ?? data.modelId);
    const gap = width - visibleWidth(pad) * 2 - visibleWidth(left) - visibleWidth(right);
    if (gap >= 2) return pad + left + " ".repeat(gap) + right + pad;
    return pad + truncateToWidth(data.extensionStatuses.length ? right : left || right, Math.max(0, width - pad.length * 2), "…") + pad;
}
