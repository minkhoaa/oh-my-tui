import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { strict as assert } from "node:assert";
import { FleetStore } from "../extensions/omt/features/agent-fleet/store.ts";
import { buildFleetDashboardState } from "../extensions/omt/features/agent-fleet/model.ts";
import { renderFleetDashboardFramed } from "../extensions/omt/features/agent-fleet/view.ts";

const event = (status: string, ts: number, extra: Record<string, unknown> = {}) => ({
  type: "subagent.child-status", version: 1, runId: "run", childId: "child", status, ts, ...extra,
});

test("child events are monotonic and do not invent outcomes", () => {
  const store = new FleetStore();
  assert.equal(store.observeChildStatus(event("started", 10, { agent: "reviewer" })), true);
  assert.equal(store.observeChildStatus(event("started", 10)), false);
  assert.equal(store.observeChildStatus(event("stopped", 20)), true);
  assert.equal(store.observeChildStatus(event("started", 15)), false);
  assert.equal(store.observeChildStatus(event("started", 30)), false);
  assert.deepEqual(store.snapshot().map(({ agent, status }) => ({ agent, status })), [{ agent: "reviewer", status: "stopped" }]);
  store.reset();
  assert.equal(store.snapshot().length, 0);
});

test("direct async lifecycle events remain live until their matching completion", () => {
  const store = new FleetStore();
  assert.equal(store.observeAsyncStarted({ id: "async-1", mode: "single", agent: "reviewer" }), true);
  assert.equal(store.snapshot()[0]?.status, "running");
  assert.equal(store.observeCompletion({ id: "async-1", runId: "async-1", state: "complete", timestamp: Date.now() + 1 }), true);
  assert.equal(store.snapshot()[0]?.status, "stopped");
  assert.equal(store.observeAsyncStarted({ id: "wf-1", mode: "workflow", agent: "workflow" }), false);
});

test("native subagent tool events cover foreground runs with no child-start event", () => {
  const store = new FleetStore();
  const call = { toolName: "subagent", toolCallId: "tool-1", args: { agent: "scout", task: "Inspect source" } };
  assert.equal(store.observeToolExecution(call, true), true);
  assert.equal(store.observeToolExecution({ toolName: "subagent", toolCallId: "async-tool", args: { agent: "scout", async: true } }, true), false);
  assert.deepEqual(store.snapshot().map(({ agent, label, status }) => ({ agent, label, status })), [
    { agent: "scout", label: "Inspect source", status: "running" },
  ]);
  assert.equal(store.observeToolExecution({ toolName: "subagent", toolCallId: "tool-1", isError: true }, false), true);
  assert.deepEqual(store.snapshot().map(({ status, reason }) => ({ status, reason })), [
    { status: "stopped", reason: "tool error" },
  ]);
  assert.equal(store.observeToolExecution({ ...call, args: { action: "status", agent: "scout" } }, true), false);
  assert.equal(store.observeToolExecution({ ...call, args: { workflow: "review" } }, true), false);
});

test("terminal completion events settle only matching observed children", () => {
  const store = new FleetStore();
  store.observeChildStatus(event("started", 10, { childRunId: "child-run", stepIndex: 1 }));
  store.observeChildStatus(event("started", 10, { childId: "unmatched", childRunId: "other-run", stepIndex: 2 }));
  assert.equal(store.observeCompletion({ runId: "other-parent", childRunId: "child-run", state: "failed", timestamp: 20 }), false);
  assert.equal(store.observeCompletion({ runId: "child-run", state: "failed", timestamp: 20 }), true);
  assert.deepEqual(store.snapshot().map(({ id, status, reason }) => ({ id, status, reason })), [
    { id: "child", status: "stopped", reason: "failed" },
    { id: "unmatched", status: "running", reason: undefined },
  ]);
  assert.equal(store.observeCompletion({ runId: "child-run", state: "complete", timestamp: 30 }), false);
  assert.equal(store.observeCompletion({ id: "foreground-run:0", runId: "foreground-run", agent: "scout", state: "complete", success: true, timestamp: 50 }), false);
});

test("validates payloads, scopes child ids, and bounds history", () => {
  const store = new FleetStore();
  assert.equal(store.observeChildStatus(event("completed", 1)), false);
  assert.equal(store.observeChildStatus(event("started", NaN)), false);
  assert.equal(store.observeChildStatus(event("started", 1)), true);
  assert.equal(store.observeChildStatus(event("started", 1, { runId: "other" })), true);
  assert.equal(store.snapshot().length, 2);
  for (let i = 0; i < 300; i++) store.observeChildStatus(event("stopped", i + 2, { childId: String(i) }));
  assert.equal(store.snapshot().length, 256);
  assert.equal(store.snapshot().filter((c) => c.status === "running").length, 2);
  assert.ok(Object.isFrozen(store.snapshot()));
  assert.ok(Object.isFrozen(store.snapshot()[0]));
});

test("dashboard projects live fleet state, clamps selection, and renders within narrow widths", () => {
  const store = new FleetStore();
  store.observeChildStatus(event("started", Date.now(), { agent: "reviewer", label: "Review" }));
  const state = buildFleetDashboardState(store.snapshot(), "inspect", 99);
  assert.equal(state.selectedIndex, 0);
  assert.equal(state.inspectedAgent?.label, "Review");
  for (const width of [34, 20, 10]) {
    const rows = renderFleetDashboardFramed(state, width);
    assert.ok(rows.every((row) => row.length > 0 && visibleWidth(row) <= width));
  }
});
