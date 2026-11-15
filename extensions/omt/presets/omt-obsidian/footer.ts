import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import type { FooterRenderData } from "../shared/footer.ts";
import { signatureFg, type SignatureColorRole } from "./rendering.ts";
import { renderGaugeBar, resolveGaugeColor } from "../../core/theme-tokens.ts";
import { accessibilityStore } from "../../features/accessibility/model.ts";

function tokens(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(Math.round(n));
}

/** Render the stats and optional hints available from Pi's footer data boundary. */
export function obsidianFooter(width: number, theme: Theme, data: FooterRenderData): string {
  if (width <= 0) return "";
  const margin = Math.min(Math.max(0, data.outputPad ?? 1), Math.max(0, Math.floor(width / 4)));
  const pad = " ".repeat(margin);
  const avail = Math.max(0, width - margin);

  const modelId = data.routedModelId ?? data.modelId;
  const agentTag = data.agent ? signatureFg(theme, "muted", ` · @${truncateToWidth(data.agent, 20, "…")}`) : "";
  const modelPart = theme.bold(signatureFg(theme, "text", modelId)) + agentTag;

  const thinkingLevel = (data.routedThinkingLevel ?? data.thinkingLevel)?.trim();
  const thinking = (data.reasoning || (thinkingLevel && thinkingLevel !== "off")) && thinkingLevel && thinkingLevel !== "off"
    ? signatureFg(theme, "muted", thinkingLevel)
    : "";

  let contextPart = "";
  if (typeof data.contextUsage?.percent === "number" && Number.isFinite(data.contextUsage.percent)) {
    const pct = Math.round(Math.max(0, Math.min(100, data.contextUsage.percent)));
    const isAscii = accessibilityStore.isPlainTextAsciiBorders();
    const barStr = isAscii ? `[${renderGaugeBar(pct, 8, true).replace(/#/g, "=")}]` : renderGaugeBar(pct, 8, false);
    const gaugeColor = resolveGaugeColor(pct);
    const colorRole: SignatureColorRole = gaugeColor.level === "normal" ? "cyan" : gaugeColor.level === "warning" ? "yellow" : "red";
    const gaugeBarStyled = signatureFg(theme, colorRole, barStr);
    contextPart = `${gaugeBarStyled} ${pct}%`;
  } else if (data.contextUsage?.percent === null) {
    contextPart = "ctx ?";
  }

  const stats = [
    modelPart,
    thinking,
    contextPart,
    typeof data.totalTokens === "number" && Number.isFinite(data.totalTokens) && data.totalTokens > 0 ? tokens(data.totalTokens) : "",
    typeof data.cost === "number" && Number.isFinite(data.cost) && data.cost > 0 ? `$${data.cost.toFixed(2)}` : "",
  ].filter(Boolean).join(signatureFg(theme, "muted", " · "));

  const branch = data.branch
    ? signatureFg(theme, "cyan", `⎇ ${data.branch === "detached" ? "(detached)" : data.branch}`)
    : "";
  const home = homedir();
  const cwd = data.cwd
    ? data.cwd === home || data.cwd.startsWith(`${home}/`)
      ? `~${data.cwd.slice(home.length)}`
      : data.cwd
    : "";
  const activity = data.activity
    ? signatureFg(theme, "green", "● ") + signatureFg(theme, "muted", data.activity.detail ?? data.activity.name ?? "running")
    : "";
  // Do not promise a literal send/interrupt shortcut: Pi owns configurable bindings.
  const hints = data.hints ?? "/ commands · @ files";

  const rawStatuses = data.extensionStatuses.length ? data.extensionStatuses.join(" · ") : "";
  const maxStatusBudget = Math.max(30, avail - visibleWidth(stats) - 1);
  const statuses = rawStatuses ? signatureFg(theme, "muted", truncateToWidth(rawStatuses, maxStatusBudget, "…")) : "";

  const sep = signatureFg(theme, "border", "  │  ");

  const left = [
    statuses,
    width >= 110 ? signatureFg(theme, "muted", hints) : "",
    branch,
    activity,
    width >= 100 && cwd ? signatureFg(theme, "muted", cwd) : "",
  ].filter(Boolean).join(sep);
  const gap = avail - visibleWidth(left) - visibleWidth(stats);
  if (left && gap >= 2) return pad + left + " ".repeat(gap) + stats;

  // Hints and cwd yield under constrained widths
  const leftNoHints = [statuses, branch, activity].filter(Boolean).join(sep);
  const gapNoHints = avail - visibleWidth(leftNoHints) - visibleWidth(stats);
  if (leftNoHints && gapNoHints >= 2) return pad + leftNoHints + " ".repeat(gapNoHints) + stats;

  // Native stats take priority over hints and activity when the row is tight.
  const compactBoth = [statuses, branch].filter(Boolean).join(sep);
  const compactBothGap = avail - visibleWidth(compactBoth) - visibleWidth(stats);
  if (statuses && branch && compactBothGap >= 1) {
    return pad + compactBoth + " ".repeat(compactBothGap) + stats;
  }

  const compactLeft = statuses || branch;
  const compactGap = avail - visibleWidth(compactLeft) - visibleWidth(stats);
  if (compactLeft && compactGap >= 1) return pad + compactLeft + " ".repeat(compactGap) + stats;

  // Extension statuses must remain visible when space allows, gracefully truncated.
  if (statuses && avail - visibleWidth(stats) >= 5) {
    const fittedStatus = signatureFg(theme, "muted", truncateToWidth(rawStatuses, avail - visibleWidth(stats) - 1, "…"));
    if (visibleWidth(fittedStatus) > 0) {
      const fittedGap = Math.max(1, avail - visibleWidth(fittedStatus) - visibleWidth(stats));
      return pad + fittedStatus + " ".repeat(fittedGap) + stats;
    }
  }

  return pad + truncateToWidth(stats, avail, "…");
}

export { obsidianFooter as signatureFooter };

