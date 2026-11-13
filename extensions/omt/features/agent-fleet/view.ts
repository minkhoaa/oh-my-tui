import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";
import type { FleetAgentRow, FleetSummary, FleetDashboardState, FleetTab } from "./types.ts";

// ---------------------------------------------------------------------------
// Safe theming (mirrors sidebar/sidepanels.ts conventions)
// ---------------------------------------------------------------------------

function fgSafe(theme: Theme | undefined, color: string, text: string): string {
  if (!theme || typeof theme.fg !== "function") return text;
  try { return theme.fg(color as any, text); } catch { return text; }
}

function boldSafe(theme: Theme | undefined, text: string): string {
  if (!theme || typeof theme.bold !== "function") return text;
  try { return theme.bold(text); } catch { return text; }
}

function dimSafe(theme: Theme | undefined, text: string): string {
  if (!theme) return text;
  try {
    if (typeof (theme as any).dim === "function") return (theme as any).dim(text);
    if (typeof theme.fg === "function") return theme.fg("muted", text);
  } catch {}
  return text;
}

function okStyle(theme: Theme | undefined, text: string): string {
  return fgSafe(theme, "success", text);
}

function errStyle(theme: Theme | undefined, text: string): string {
  return fgSafe(theme, "error", text);
}

function warnStyle(theme: Theme | undefined, text: string): string {
  return fgSafe(theme, "warning", text);
}

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Summary line
// ---------------------------------------------------------------------------

export function renderFleetSummary(summary: FleetSummary, theme?: Theme, contentW = 30): string {
  const parts: string[] = [];
  if (summary.running > 0) parts.push(okStyle(theme, `${summary.running} running`));
  if (summary.stopping > 0) parts.push(warnStyle(theme, `${summary.stopping} stopping`));
  if (summary.stopped > 0) parts.push(dimSafe(theme, `${summary.stopped} stopped`));
  if (parts.length === 0) parts.push(dimSafe(theme, "no agents"));
  return truncateToWidth(parts.join(dimSafe(theme, " · ")), contentW, "");
}

// ---------------------------------------------------------------------------
// Agent row
// ---------------------------------------------------------------------------

export function renderFleetAgentRow(
  agent: FleetAgentRow,
  isSelected: boolean,
  theme?: Theme,
  contentW = 30,
): string {
  let dot: string;
  if (agent.status === "running") dot = okStyle(theme, "●");
  else if (agent.status === "stopping") dot = warnStyle(theme, "◐");
  else dot = dimSafe(theme, "○");

  const prefix = isSelected ? fgSafe(theme, "accent", "▸ ") : "  ";
  const name = agent.label || agent.agent || agent.id;

  let suffix = "";
  if (agent.status === "running") suffix = agent.elapsedLabel;
  else if (agent.reason) suffix = agent.reason;
  const suffixStr = suffix ? dimSafe(theme, ` ${suffix}`) : "";
  const suffixLen = visibleWidth(suffixStr);
  const nameMax = Math.max(1, contentW - 4 - suffixLen);
  const displayName = visibleWidth(name) > nameMax
    ? truncateToWidth(name, nameMax, "…")
    : name;

  const row = `${prefix}${dot} ${fgSafe(theme, "text", displayName)}${suffixStr}`;
  return truncateToWidth(row, contentW, "");
}

// ---------------------------------------------------------------------------
// Inspect panel
// ---------------------------------------------------------------------------

export function renderFleetInspectPanel(
  agent: FleetAgentRow | undefined,
  theme?: Theme,
  contentW = 30,
): string[] {
  if (!agent) return [dimSafe(theme, "No agent selected")];

  const lines: string[] = [];
  const label = (key: string, value: string | undefined) => {
    if (!value) return;
    const keyStr = dimSafe(theme, `${key}: `);
    const valStr = fgSafe(theme, "text", truncateToWidth(value, Math.max(1, contentW - visibleWidth(key) - 2), "…"));
    lines.push(truncateToWidth(`${keyStr}${valStr}`, contentW, ""));
  };

  label("ID", agent.id);
  label("Run", agent.runId);
  if (agent.childRunId) label("Child Run", agent.childRunId);
  label("Agent", agent.agent);
  label("Label", agent.label);
  label("Status", agent.status);
  if (agent.phase) label("Phase", agent.phase);
  if (agent.reason) label("Reason", agent.reason);
  label("Elapsed", agent.elapsedLabel);

  return lines;
}

// ---------------------------------------------------------------------------
// Full dashboard panel
// ---------------------------------------------------------------------------

export function renderFleetDashboardPanel(
  state: FleetDashboardState,
  contentW = 30,
  theme?: Theme,
  maxAgentRows = Number.POSITIVE_INFINITY,
): string[] {
  const lines: string[] = [];

  // Title
  const title = state.summary.running > 0
    ? `Agent Fleet (${state.summary.running} active)`
    : `Agent Fleet (${state.summary.total})`;
  lines.push(boldSafe(theme, fgSafe(theme, "accent", truncateToWidth(title, contentW, "…"))));

  // Summary
  lines.push(renderFleetSummary(state.summary, theme, contentW));

  // Separator
  lines.push(fgSafe(theme, "border", "─".repeat(contentW)));

  if (state.tab === "fleet") {
    if (state.empty) {
      lines.push(dimSafe(theme, "No subagent activity observed."));
      lines.push(dimSafe(theme, "Agents will appear when launched"));
      lines.push(dimSafe(theme, "via the subagent tool."));
    } else {
      const visibleCount = Math.max(1, Math.floor(maxAgentRows));
      const start = Math.max(0, Math.min(state.selectedIndex - Math.floor(visibleCount / 2), state.agents.length - visibleCount));
      const end = Math.min(state.agents.length, start + visibleCount);
      if (start > 0) lines.push(dimSafe(theme, `↑ ${start} earlier agents`));
      for (let i = start; i < end; i++) {
        const agent = state.agents[i]!;
        lines.push(renderFleetAgentRow(agent, i === state.selectedIndex, theme, contentW));
      }
      if (end < state.agents.length) lines.push(dimSafe(theme, `↓ ${state.agents.length - end} more agents`));
    }
  } else if (state.tab === "inspect") {
    lines.push(...renderFleetInspectPanel(state.inspectedAgent, theme, contentW));
  }

  // Footer hints
  lines.push(fgSafe(theme, "border", "─".repeat(contentW)));
  lines.push(dimSafe(theme, truncateToWidth(
    "Click row to select · again to inspect",
    contentW, ""
  )));

  return lines;
}

// ---------------------------------------------------------------------------
// Framed panel (matching sidebar box style)
// ---------------------------------------------------------------------------

export function renderFleetDashboardFramed(
  state: FleetDashboardState,
  outerW = 34,
  theme?: Theme,
  maxAgentRows = Number.POSITIVE_INFINITY,
): string[] {
  const inner = Math.max(1, outerW - 4);
  const contentLines = renderFleetDashboardPanel(state, inner, theme, maxAgentRows);

  const tl = "╭", tr = "╮", bl = "╰", br = "╯", hz = "─", vt = "│";
  const topBorder = fgSafe(theme, "border", `${tl}${hz.repeat(outerW - 2)}${tr}`);
  const botBorder = fgSafe(theme, "border", `${bl}${hz.repeat(outerW - 2)}${br}`);

  const framed: string[] = [topBorder];
  for (const row of contentLines) {
    const rowWidth = visibleWidth(row);
    let fitted = row;
    if (rowWidth > inner) fitted = truncateToWidth(row, inner, "");
    else if (rowWidth < inner) fitted = row + " ".repeat(inner - rowWidth);
    framed.push(`${fgSafe(theme, "border", `${vt} `)}${fitted}${fgSafe(theme, "border", ` ${vt}`)}`);
  }
  framed.push(botBorder);

  return framed;
}
