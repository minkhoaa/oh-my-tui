// OMT Clean footer presentation for Pi.
import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import { contentPadding } from "../shared/style.ts";
import { cleanDim } from "./rendering.ts";
import type { FooterRenderData } from "../shared/footer.ts";

export function cleanFooter(width: number, _theme: Theme, data: FooterRenderData): string {
    const pad = " ".repeat(Math.min(contentPadding(data.outputPad), Math.floor(width / 4)));
    const model = data.routedModelId ?? data.modelId;
    const level = data.reasoning ? ` ${data.routedThinkingLevel ?? data.thinkingLevel ?? "off"}` : "";
    const percent = data.contextUsage?.percent;
    const context = typeof percent === "number" && Number.isFinite(percent)
      ? `Context ${Math.max(0, Math.min(100, 100 - Math.round(percent)))}% left` : "";
    const home = homedir();
    const directory = data.cwd ? (data.cwd === home || data.cwd.startsWith(`${home}/`) ? `~${data.cwd.slice(home.length)}` : data.cwd) : "";
    const statuses = data.extensionStatuses.join(" · ");
    const meta = [context, directory, data.branch, statuses].filter(Boolean);
    while (meta.length && visibleWidth(`${pad}${model}${level} · ${meta.join(" · ")}${pad}`) > width) {
      // Extension warnings take precedence over branch/path and context.
      const drop = meta.indexOf(directory || data.branch || context);
      meta.splice(drop >= 0 ? drop : 0, 1);
    }
    return truncateToWidth(`${pad}${cleanDim(model + level)}${meta.length ? cleanDim(` · ${meta.join(" · ")}`) : ""}`, width, "…");
}
