import type { FleetChild, ChildLifecycle } from "./store.ts";

export type { FleetChild, ChildLifecycle };

/** Display-oriented agent row for the dashboard view. */
export interface FleetAgentRow {
  readonly id: string;
  readonly runId: string;
  readonly childRunId?: string;
  readonly agent?: string;
  readonly label?: string;
  readonly phase?: string;
  readonly reason?: string;
  readonly status: ChildLifecycle;
  readonly elapsedLabel: string;
  readonly observedAt: number;
}

/** Aggregated fleet summary for the dashboard header. */
export interface FleetSummary {
  readonly total: number;
  readonly running: number;
  readonly stopping: number;
  readonly stopped: number;
}

/** Active tab in the fleet dashboard. */
export type FleetTab = "fleet" | "inspect";

/** Full dashboard state for rendering. */
export interface FleetDashboardState {
  readonly tab: FleetTab;
  readonly agents: readonly FleetAgentRow[];
  readonly summary: FleetSummary;
  readonly selectedIndex: number;
  readonly inspectedAgent?: FleetAgentRow;
  readonly empty: boolean;
}
