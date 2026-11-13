// Read-only projection of pi-subagents' version 1 child-status events.
// A stopped process is not evidence of a successful (or failed) agent result.
export type ChildLifecycle = "running" | "stopping" | "stopped";

export interface FleetChild {
  readonly id: string;
  readonly runId: string;
  readonly childRunId?: string;
  readonly agent?: string;
  readonly label?: string;
  readonly phase?: string;
  readonly stepIndex?: number;
  readonly reason?: string;
  readonly status: ChildLifecycle;
  readonly observedAt: number;
}

const MAX_CHILDREN = 256;
const rank: Record<ChildLifecycle, number> = { running: 0, stopping: 1, stopped: 2 };

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value.slice(0, 512) : undefined;
}

/** A bounded, session-scoped projection. Call reset on session changes. */
export class FleetStore {
  private readonly children = new Map<string, FleetChild>();

  observeChildStatus(raw: unknown): boolean {
    if (!raw || typeof raw !== "object") return false;
    const e = raw as Record<string, unknown>;
    if (e.type !== "subagent.child-status" || e.version !== 1 ||
        typeof e.runId !== "string" || !e.runId || e.runId.length > 512 ||
        typeof e.childId !== "string" || !e.childId || e.childId.length > 512 ||
        typeof e.ts !== "number" || !Number.isFinite(e.ts) || e.ts < 0 ||
        (e.status !== "started" && e.status !== "stopping" && e.status !== "stopped")) return false;
    const status: ChildLifecycle = e.status === "started" ? "running" : e.status;
    // Encode both parts unambiguously: child IDs are only unique within a run.
    const key = JSON.stringify([e.runId, e.childId]);
    const previous = this.children.get(key);
    if (previous && (e.ts < previous.observedAt ||
        (e.ts === previous.observedAt && rank[status] <= rank[previous.status]) ||
        rank[status] < rank[previous.status])) return false;
    const child: FleetChild = Object.freeze({
      id: e.childId, runId: e.runId,
      childRunId: optionalString(e.childRunId) ?? previous?.childRunId,
      agent: optionalString(e.agent) ?? previous?.agent,
      label: optionalString(e.label) ?? previous?.label,
      phase: optionalString(e.phase) ?? previous?.phase,
      stepIndex: typeof e.stepIndex === "number" && Number.isSafeInteger(e.stepIndex) && e.stepIndex >= 0 ? e.stepIndex : previous?.stepIndex,
      reason: optionalString(e.reason) ?? previous?.reason,
      status, observedAt: e.ts,
    });
    this.children.delete(key);
    this.children.set(key, child);
    if (this.children.size > MAX_CHILDREN) {
      // Prefer retaining active children when evicting history.
      const oldestStopped = [...this.children].find(([, item]) => item.status === "stopped")?.[0];
      this.children.delete(oldestStopped ?? this.children.keys().next().value!);
    }
    return true;
  }

  /** Observes the direct async single-agent lifecycle exposed by pi-subagents. */
  observeAsyncStarted(raw: unknown): boolean {
    if (!raw || typeof raw !== "object") return false;
    const event = raw as Record<string, unknown>;
    if (event.mode !== "single" || typeof event.id !== "string" || !event.id || event.id.length > 512
        || typeof event.agent !== "string" || !event.agent) return false;
    const key = JSON.stringify([event.id, event.id]);
    const child = Object.freeze({
      id: event.id,
      runId: event.id,
      childRunId: event.id,
      agent: optionalString(event.agent),
      label: optionalString(event.agent),
      status: "running" as const,
      observedAt: Date.now(),
    });
    this.children.delete(key);
    this.children.set(key, child);
    if (this.children.size > MAX_CHILDREN) {
      const oldestStopped = [...this.children].find(([, item]) => item.status === "stopped")?.[0];
      this.children.delete(oldestStopped ?? this.children.keys().next().value!);
    }
    return true;
  }

  /** Tracks the exact lifetime of a native foreground subagent tool call when no child-start event exists. */
  observeToolExecution(event: unknown, running: boolean): boolean {
    if (!event || typeof event !== "object") return false;
    const payload = event as Record<string, unknown>;
    if (payload.toolName !== "subagent" || typeof payload.toolCallId !== "string" || !payload.toolCallId
        || payload.toolCallId.length > 512) return false;
    if (running && (payload.args as Record<string, unknown> | undefined)?.async === true) return false;
    const key = JSON.stringify([payload.toolCallId, payload.toolCallId]);
    const previous = this.children.get(key);
    const timestamp = Date.now();
    if (!running) {
      if (!previous) return false;
      this.children.set(key, Object.freeze({ ...previous, status: "stopped", observedAt: timestamp,
        reason: payload.isError === true ? "tool error" : previous.reason }));
      return true;
    }
    const args = payload.args && typeof payload.args === "object" ? payload.args as Record<string, unknown> : {};
    if (args.action !== undefined || args.workflow !== undefined || typeof args.agent !== "string" || !args.agent) return false;
    const child: FleetChild = Object.freeze({
      id: payload.toolCallId,
      runId: payload.toolCallId,
      agent: optionalString(args.agent),
      label: optionalString(args.task) ?? optionalString(args.agent),
      status: running ? "running" : "stopped",
      reason: !running && payload.isError === true ? "tool error" : undefined,
      observedAt: timestamp,
    });
    this.children.delete(key);
    this.children.set(key, child);
    if (this.children.size > MAX_CHILDREN) {
      const oldestStopped = [...this.children].find(([, item]) => item.status === "stopped")?.[0];
      this.children.delete(oldestStopped ?? this.children.keys().next().value!);
    }
    return true;
  }

  /** Applies explicit terminal completion telemetry where available (async and foreground runs). */
  observeCompletion(raw: unknown): boolean {
    if (!raw || typeof raw !== "object") return false;
    const event = raw as Record<string, unknown>;
    if (typeof event.runId !== "string" || !event.runId || event.runId.length > 512) return false;
    const terminal = event.state === "complete" || event.state === "completed" || event.state === "failed"
      || event.state === "stopped" || event.state === "interrupted" || event.state === "timed_out";
    if (!terminal) return false;
    const timestamp = typeof event.timestamp === "number" && Number.isFinite(event.timestamp) && event.timestamp >= 0
      ? event.timestamp : Date.now();
    const eventId = optionalString(event.id);
    const taskIndex = typeof event.taskIndex === "number" ? event.taskIndex : undefined;
    let changed = false;
    for (const [key, child] of this.children) {
      const matches = child.childRunId === event.runId
        || (child.runId === event.runId && taskIndex !== undefined && child.stepIndex === taskIndex)
        || (eventId === `${child.runId}:${child.stepIndex}` && child.stepIndex !== undefined);
      if (!matches || child.status === "stopped" || timestamp < child.observedAt) continue;
      this.children.set(key, Object.freeze({ ...child, status: "stopped", observedAt: timestamp,
        reason: child.reason ?? (event.state === "failed" || event.state === "interrupted" || event.state === "timed_out" ? event.state : undefined) }));
      changed = true;
    }
    return changed;
  }

  snapshot(): readonly FleetChild[] {
    return Object.freeze([...this.children.values()]);
  }

  reset(): void {
    this.children.clear();
  }
}
