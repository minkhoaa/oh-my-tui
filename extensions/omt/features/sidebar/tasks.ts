import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { visibleWidth, truncateToWidth, stripTerminalSequences } from "@earendil-works/pi-tui";
import type { TodoItem, TodoStatus, TaskSnapshot, TaskSortOrder, TaskDisplaySettings } from "../omt-adapters/types.ts";
import { fmtNum, fmtDur } from "./sidepanels.ts";

export interface TaskWidgetOptions {
  activeTaskId?: string;
  startedAt?: number;
  inputTokens?: number;
  outputTokens?: number;
  tick?: number;
  display?: TaskDisplaySettings;
  theme?: Theme;
  hideTaskWidget?: boolean;
}

const taskSpinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function taskHeader(tasks: readonly TodoItem[]): string {
  let done = 0;
  let running = 0;
  let open = 0;
  for (const t of tasks) {
    if (t.status === "completed") done++;
    else if (t.status === "in_progress") running++;
    else open++;
  }
  const parts: string[] = [];
  if (done > 0) parts.push(`${done} done`);
  if (running > 0) parts.push(`${running} in progress`);
  if (open > 0) parts.push(`${open} open`);
  return `${tasks.length} tasks (${parts.join(", ")})`;
}

export function orderTasks(tasks: readonly TodoItem[], order: TaskSortOrder = "id"): TodoItem[] {
  const out = [...tasks];
  const rank = (status: TodoStatus) => {
    switch (status) {
      case "in_progress":
        return 0;
      case "pending":
        return 1;
      default:
        return 2;
    }
  };
  const statusRank = (s: TodoStatus) => 2 - rank(s);

  switch (order) {
    case "status":
      out.sort((a, b) => statusRank(a.status) - statusRank(b.status));
      break;
    case "active":
      out.sort((a, b) => rank(a.status) - rank(b.status));
      break;
    case "recent":
      out.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      break;
    case "oldest":
      out.sort((a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0));
      break;
    case "id":
    default:
      out.sort((a, b) => {
        const numA = parseInt(a.id, 10);
        const numB = parseInt(b.id, 10);
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        return a.id.localeCompare(b.id);
      });
      break;
  }
  return out;
}

export function collapseDone(tasks: readonly TodoItem[], collapse = false): { kept: TodoItem[]; collapsed: number } {
  if (!collapse) return { kept: [...tasks], collapsed: 0 };
  const kept: TodoItem[] = [];
  let collapsed = 0;
  for (const t of tasks) {
    if (t.status === "completed") {
      collapsed++;
    } else {
      kept.push(t);
    }
  }
  return { kept, collapsed };
}

/**
 * Renders the above-editor Task Widget.
 */
export function renderTaskWidget(
  items: readonly TodoItem[] | TaskSnapshot,
  width: number,
  options?: TaskWidgetOptions,
): string[] {
  if (options?.hideTaskWidget) return [];

  const rawTasks = Array.isArray(items) ? items : (items as TaskSnapshot).items;
  if (!rawTasks || rawTasks.length === 0) return [];

  const theme = options?.theme;
  const safeWidth = Math.max(10, Math.floor(width));

  const fgAccent = (s: string) => (theme?.fg ? theme.fg("accent", s) : s);
  const fgMuted = (s: string) => (theme?.fg ? theme.fg("muted", s) : s);
  const fgText = (s: string) => (theme?.fg ? theme.fg("text", s) : s);
  const fgSuccess = (s: string) => (theme?.fg ? theme.fg("success", s) : s);
  const strikeText = (s: string) => (theme?.style ? theme.style(s, { strikethrough: true, fg: "muted" }) : s);

  // Header always totals every task
  const headStr = fgAccent("●") + " " + fgAccent(taskHeader(rawTasks));
  const lines: string[] = [truncateToWidth(headStr, safeWidth, "")];

  const disp = options?.display ?? {};
  const sortOrder = disp.sortOrder ?? "id";
  const collapseCompleted = disp.collapseCompleted ?? false;
  const showAll = disp.showAll ?? false;
  const maxVisible = Math.max(5, Math.min(100, disp.maxVisible ?? 10));
  const hiddenAt = disp.hiddenAt ?? "bottom";

  let ordered = orderTasks(rawTasks, sortOrder);
  const { kept, collapsed } = collapseDone(ordered, collapseCompleted);
  ordered = kept;

  let hidden = 0;
  const fromTop = hiddenAt === "top";
  if (!showAll && ordered.length > maxVisible) {
    hidden = ordered.length - maxVisible;
    if (fromTop) {
      ordered = ordered.slice(hidden);
    } else {
      ordered = ordered.slice(0, maxVisible);
    }
  }

  const overflowLine = () => {
    if (hidden === 0) return "";
    return fgMuted(`    … and ${hidden} more`);
  };

  if (fromTop && hidden > 0) {
    lines.push(overflowLine());
  }

  const tick = options?.tick ?? 0;
  const activeId = options?.activeTaskId;

  for (const t of ordered) {
    const isActive = activeId !== undefined && t.id === activeId && t.status === "in_progress";
    let line = "";

    if (isActive) {
      const formText = t.subAction || t.content;
      const elapsed = options?.startedAt ? fmtDur(Date.now() - options.startedAt) : "";
      const statParts: string[] = [];
      if (elapsed) statParts.push(elapsed);
      if (options?.inputTokens && options.inputTokens > 0) statParts.push(`↑ ${fmtNum(options.inputTokens)}`);
      if (options?.outputTokens && options.outputTokens > 0) statParts.push(`↓ ${fmtNum(options.outputTokens)}`);
      const stats = statParts.length > 0 ? ` (${statParts.join(" · ")})` : "";

      const spinner = taskSpinner[tick % taskSpinner.length] ?? "⠋";
      const prefix = `  ${spinner} ${fgMuted("#" + t.id)} `;
      const formMax = Math.max(1, safeWidth - visibleWidth(prefix) - visibleWidth(stats) - 1);
      const form = truncateToWidth(formText, formMax, "…");
      line = prefix + fgAccent(form) + fgMuted(stats);
    } else if (t.status === "completed") {
      line = `  ${fgSuccess("✔")} ${strikeText("#" + t.id + " " + t.content)}`;
    } else if (t.status === "in_progress") {
      line = `  ${fgAccent("◼")} ${fgMuted("#" + t.id)} ${fgText(t.content)}`;
    } else {
      line = `  ${fgMuted("◻")} ${fgMuted("#" + t.id)} ${fgText(t.content)}`;
    }

    if (t.blockedBy && t.blockedBy.length > 0) {
      line += fgMuted(` [blocked by #${t.blockedBy.join(", #")}]`);
    }

    lines.push(truncateToWidth(line, safeWidth, ""));
  }

  if (!fromTop && hidden > 0) {
    lines.push(overflowLine());
  }

  if (collapsed > 0) {
    lines.push(`${fgSuccess("✔")} ${fgMuted(`${collapsed} completed`)}`);
  }

  return lines;
}

/**
 * Mount contract for Task Widget component.
 */
export function createTaskWidgetComponent(
  getSnapshot: () => TaskSnapshot | TodoItem[],
  options?: () => TaskWidgetOptions,
): Component {
  return {
    render(width: number): string[] {
      const snapshot = getSnapshot();
      const opts = options?.() ?? {};
      return renderTaskWidget(snapshot, width, opts);
    },
    invalidate() {},
  };
}
