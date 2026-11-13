import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { contentPadding, quiet } from "../shared/style.ts";
import { getActiveTheme } from "../../core/theme.ts";
import type { FooterRenderData } from "../shared/footer.ts";
import { formatTokens } from "../shared/footer-format.ts";

export function minimalFooter(width: number, theme: Theme, data: FooterRenderData): string {
  const active = getActiveTheme();
  const margin = " ".repeat(width >= 30 ? contentPadding(data.outputPad) : active.spacing.inset);
  const marginW = visibleWidth(margin) * 2;

  const branchIcon = active.glyph.branch ?? "⎇ ";
  const styledBranch = data.branch
    ? (branchIcon ? quiet(theme, branchIcon) : "") + theme.fg(active.color.secondary, data.branch === "detached" ? "(detached)" : data.branch)
    : "";

  // 2. Statuses & Activity
  const separator = quiet(theme, active.spacing.separator);
  const styledStatuses = data.extensionStatuses.length > 0
    ? data.extensionStatuses.join(separator)
    : "";

  let styledToolFull = "";
  let styledToolShort = "";
  let styledRunning = "";

  if (data.activity) {
    if (data.activity.type === "tool") {
      const toolName = data.activity.name ?? "tool";
      const icon = theme.fg(active.color.secondary, active.glyph.running);
      styledToolShort = `${icon} ${theme.fg(active.color.secondary, toolName)}`;
      styledToolFull = data.activity.detail
        ? `${styledToolShort} ${quiet(theme, data.activity.detail)}`
        : styledToolShort;
    } else {
      styledRunning = `${theme.fg(active.color.secondary, active.glyph.running)} ${quiet(theme, data.activity.detail || "running")}`;
    }
  }

  const actFull = styledToolFull || styledRunning;
  const actShort = styledToolShort || styledRunning;

  const gap = active.spacing.gap;
  const leftFull = [styledBranch, actFull, styledStatuses].filter(Boolean).join(gap);
  const leftMedium = [styledBranch, actShort, styledStatuses].filter(Boolean).join(gap);
  const leftShort = styledStatuses || actShort || styledBranch;

  // 3. Context Usage
  let styledContextFull = "";
  let styledContextShort = "";
  if (data.contextUsage) {
    const { percent, contextWindow } = data.contextUsage;
    const winStr = formatTokens(contextWindow);
    if (percent !== null && Number.isFinite(percent)) {
      const pctNum = Math.round(percent);
      const pctStr = `${pctNum}%`;
      const color = pctNum >= 90 ? active.color.error : pctNum >= 70 ? active.color.warning : active.color.quiet;
      styledContextFull = `${theme.fg(color, pctStr)} ${quiet(theme, `/ ${winStr}`)}`;
      styledContextShort = theme.fg(color, pctStr);
    } else if (contextWindow > 0) {
      styledContextFull = quiet(theme, winStr);
      styledContextShort = styledContextFull;
    }
  }

  // 4. Model & Provider & Thinking Level
  let styledBase = theme.fg(active.color.secondary, data.modelId);
  if (data.routedModelId) {
    styledBase += quiet(theme, " → ") + theme.fg(active.color.secondary, data.routedModelId);
  }

  let styledWithProvider = styledBase;
  if (data.provider && (data.hasMultipleProviders || width >= 100)) {
    styledWithProvider = quiet(theme, `${data.provider} / `) + styledBase;
  }

  let styledThinkingFull = "";
  let styledThinkingShort = "";
  if (data.reasoning) {
    const level = data.routedThinkingLevel ?? data.thinkingLevel ?? "off";
    styledThinkingFull = quiet(theme, `${active.spacing.separator}${level === "off" ? "think: off" : level}`);
    if (level !== "off") {
      styledThinkingShort = quiet(theme, `${active.spacing.separator}${level}`);
    }
  }

  const rightFull = [styledContextFull, `${styledWithProvider}${styledThinkingFull}`]
    .filter(Boolean)
    .join(separator);
  const rightMedium = [styledContextFull, `${styledBase}${styledThinkingFull}`]
    .filter(Boolean)
    .join(separator);
  const rightCompact = [styledContextShort, `${styledBase}${styledThinkingShort}`]
    .filter(Boolean)
    .join(separator);
  const rightMinimal = [styledBase, styledContextShort].filter(Boolean).join(" ");

  // Drop provider/detail, then secondary context, then the left group as needed.
  for (const [left, right, minGap] of [
    [leftFull, rightFull, 2],
    [leftMedium, rightMedium, 2],
    [leftShort, rightCompact, 1],
    ["", rightCompact, 0],
  ] as const) {
    const available = width - marginW - visibleWidth(left) - visibleWidth(right);
    if (available >= minGap) return `${margin}${left}${" ".repeat(available)}${right}${margin}`;
  }

  if (visibleWidth(rightMinimal) <= width) {
    return truncateToWidth(rightMinimal, width, "");
  }

  // Tier 5: Truncate base model
  return truncateToWidth(styledBase, width, "...");
}
