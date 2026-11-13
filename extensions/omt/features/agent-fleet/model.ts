import type { FleetChild } from "./store.ts";
import type { FleetAgentRow, FleetSummary, FleetDashboardState, FleetTab } from "./types.ts";

// ---------------------------------------------------------------------------
// Formatting helpers (reuse sidebar conventions)
// ---------------------------------------------------------------------------

function fmtElapsed(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m${s}s`;
}

// ---------------------------------------------------------------------------
// Projection: FleetChild[] → FleetAgentRow[]
// ---------------------------------------------------------------------------

/** Projects raw FleetChild snapshots into display-oriented rows. */
export function projectFleetRows(children: readonly FleetChild[], now = Date.now()): FleetAgentRow[] {
  const rows: FleetAgentRow[] = [];
  for (const child of children) {
    const elapsed = child.status === "running"
      ? fmtElapsed(Math.max(0, now - child.observedAt))
      : fmtElapsed(0);
    rows.push({
      id: child.id,
      runId: child.runId,
      childRunId: child.childRunId,
      agent: child.agent,
      label: child.label,
      phase: child.phase,
      reason: child.reason,
      status: child.status,
      elapsedLabel: elapsed,
      observedAt: child.observedAt,
    });
  }
  // Sort: running first, then stopping, then stopped; within same status by observedAt desc
  const rank = { running: 0, stopping: 1, stopped: 2 } as const;
  rows.sort((a, b) => {
    const ra = rank[a.status] ?? 2;
    const rb = rank[b.status] ?? 2;
    if (ra !== rb) return ra - rb;
    return b.observedAt - a.observedAt;
  });
  return rows;
}

/** Aggregates fleet summary counts. */
export function summarizeFleet(rows: readonly FleetAgentRow[]): FleetSummary {
  let running = 0, stopping = 0, stopped = 0;
  for (const r of rows) {
    if (r.status === "running") running++;
    else if (r.status === "stopping") stopping++;
    else stopped++;
  }
  return { total: rows.length, running, stopping, stopped };
}

/** Builds full dashboard state from fleet children and current UI state. */
export function buildFleetDashboardState(
  children: readonly FleetChild[],
  tab: FleetTab = "fleet",
  selectedIndex = 0,
  now = Date.now(),
): FleetDashboardState {
  const agents = projectFleetRows(children, now);
  const summary = summarizeFleet(agents);
  const clampedIndex = agents.length > 0
    ? Math.max(0, Math.min(selectedIndex, agents.length - 1))
    : 0;
  const inspectedAgent = tab === "inspect" && agents.length > 0
    ? agents[clampedIndex]
    : undefined;
  return {
    tab,
    agents,
    summary,
    selectedIndex: clampedIndex,
    inspectedAgent,
    empty: agents.length === 0,
  };
}
