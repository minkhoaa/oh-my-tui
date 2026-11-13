import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";
import type { SubagentItem, SubagentSnapshot } from "../omt-adapters/types.ts";
import { fmtDur } from "./sidepanels.ts";

export type TeamTab = "workers" | "inspect" | "console" | "cost";

export interface TeamWorkerRow {
  readonly id: string;
  readonly label: string;
  readonly agentName?: string;
  readonly status: string;
  readonly headline?: string;
  readonly elapsedMs?: number;
}

export interface TeamDashboardData {
  readonly title?: string;
  readonly tab?: TeamTab;
  readonly summary?: string;
  readonly workers: readonly TeamWorkerRow[] | readonly SubagentItem[];
  readonly selectedIndex?: number;
  readonly follow?: boolean;
}

export function teamTabsLine(activeTab: TeamTab = "workers", theme?: Theme): string {
  const tabs: Array<{ id: TeamTab; num: number; label: string }> = [
    { id: "workers", num: 1, label: "Workers" },
    { id: "inspect", num: 2, label: "Inspect" },
    { id: "console", num: 3, label: "Console" },
    { id: "cost", num: 4, label: "Cost" },
  ];

  return tabs
    .map((t) => {
      const isSelected = t.id === activeTab;
      const text = `${t.num} ${t.label}`;
      if (isSelected) {
        return theme?.bold
          ? theme.bold(theme.fg ? theme.fg("accent", `[${text}]`) : `[${text}]`)
          : `[${text}]`;
      }
      return theme?.fg ? theme.fg("muted", text) : text;
    })
    .join("  ");
}

/**
 * Renders the Team Dashboard panel.
 */
export function renderTeamDashboardPanel(
  data: TeamDashboardData,
  panelW: number = 80,
  theme?: Theme,
): string[] {
  const contentW = Math.max(20, panelW - 4);
  const fgAccent = (s: string) => (theme?.fg ? theme.fg("accent", s) : s);
  const fgMuted = (s: string) => (theme?.fg ? theme.fg("muted", s) : s);
  const fgText = (s: string) => (theme?.fg ? theme.fg("text", s) : s);
  const fgSuccess = (s: string) => (theme?.fg ? theme.fg("success", s) : s);
  const fgWarn = (s: string) => (theme?.fg ? theme.fg("warning", s) : s);

  const title = data.title || "Team Dashboard";
  const titleLine = theme?.bold
    ? theme.bold(fgAccent(truncateToWidth(title, contentW, "…")))
    : fgAccent(truncateToWidth(title, contentW, "…"));

  const lines: string[] = [
    titleLine,
    truncateToWidth(teamTabsLine(data.tab ?? "workers", theme), contentW, "…"),
  ];

  if (data.summary) {
    lines.push(fgMuted(truncateToWidth(data.summary, contentW, "…")));
  }

  lines.push(fgMuted(truncateToWidth("↑↓ scroll · f follow · space/b page · g/G top/bottom · 1-4 tabs", contentW, "…")));

  const workers = data.workers ?? [];
  const cursor = Math.max(0, Math.min(data.selectedIndex ?? 0, Math.max(0, workers.length - 1)));

  if (workers.length > 0) {
    const selected = workers[cursor] as any;
    const label = selected.label || selected.name || selected.agentName || "worker";
    const status = selected.status || "idle";
    lines.push(truncateToWidth(`selected: ${label} · ${status}`, contentW, "…"));
    if (selected.headline || selected.task) {
      lines.push(truncateToWidth(`headline: ${selected.headline || selected.task}`, contentW, "…"));
    }
  }

  lines.push("");

  // Workers table
  for (let i = 0; i < workers.length; i++) {
    const w = workers[i] as any;
    const isSelected = i === cursor;
    const st = (w.status || "").toLowerCase();
    let dot = "○";
    let dotStyle = fgMuted;
    if (st === "running" || st === "active") {
      dot = "●";
      dotStyle = fgSuccess;
    } else if (st === "completed" || st === "done") {
      dot = "✓";
      dotStyle = fgSuccess;
    } else if (st === "failed" || st === "error") {
      dot = "!";
      dotStyle = fgWarn;
    }

    const name = w.label || w.name || w.agentName || `worker-${i + 1}`;
    const role = w.agentName ? `[${w.agentName}]` : "";
    let dur = "";
    if (w.elapsedMs) dur = fmtDur(w.elapsedMs);
    else if (w.startedAt) dur = fmtDur(Date.now() - w.startedAt);

    const prefix = isSelected ? "> " : "  ";
    const rowContent = `${prefix}${dotStyle(dot)} ${fgText(name)} ${fgMuted(role)} ${fgMuted(st)} ${fgMuted(dur)}`;
    lines.push(truncateToWidth(rowContent, contentW, "…"));
  }

  if (data.tab && data.tab !== "workers") {
    const follow = data.follow ? "[follow on]" : "[paused f/G]";
    lines.push(fgMuted(follow));
  }

  lines.push("");
  lines.push(fgMuted("Enter · 1-4 tabs · r refresh · q close"));

  return lines;
}

/**
 * Mount contract for Team Dashboard component.
 */
export function createTeamDashboardComponent(
  getData: () => TeamDashboardData,
  theme?: Theme,
): Component {
  return {
    render(width: number): string[] {
      const data = getData();
      return renderTeamDashboardPanel(data, width, theme);
    },
    invalidate() {},
  };
}
