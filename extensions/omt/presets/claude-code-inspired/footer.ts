import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import type { FooterRenderData } from "../shared/footer.ts";
import { claudeFg } from "./rendering.ts";

/** Claude's statusline is configurable, not a fixed account/permission badge. */
export function claudeFooter(width: number, theme: Theme, data: FooterRenderData): string {
  const margin = Math.min(Math.max(2, data.outputPad ?? 1), Math.floor(width / 4));
  const pad = " ".repeat(margin);
  const home = homedir();
  const cwd = data.cwd ? data.cwd === home || data.cwd.startsWith(`${home}/`) ? `~${data.cwd.slice(home.length)}` : data.cwd : "";
  const model = data.routedModelId ?? data.modelId;
  const percent = data.contextUsage?.percent;
  const context = typeof percent === "number" && Number.isFinite(percent) ? `${Math.max(0, Math.min(100, Math.round(percent)))}% context` : "";
  const level = data.reasoning ? data.routedThinkingLevel ?? data.thinkingLevel : "";
  const parts = [cwd, data.branch ? `(${data.branch})` : "", model, level, context].filter(Boolean);
  const statuses = data.extensionStatuses.join(" · ");
  while (parts.length > 1 && visibleWidth(parts.join(" · ") + (statuses ? " · " + statuses : "")) > width - margin * 2) {
    // Keep real extension warnings; drop directory, then other optional metadata.
    const optional = parts.findIndex((part) => part !== model);
    if (optional < 0) break;
    parts.splice(optional, 1);
  }
  const text = claudeFg(theme, "muted", parts.join(" · ")) + (statuses ? (parts.length ? claudeFg(theme, "muted", " · ") : "") + statuses : "");
  return pad + truncateToWidth(text, Math.max(0, width - margin * 2), "…");
}
