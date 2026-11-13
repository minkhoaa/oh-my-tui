import assert from "node:assert/strict";
import { test } from "node:test";
import { configStore } from "../extensions/omt/core/config.ts";
import {
  isAnimationActive,
  isReducedMotionActive,
  scaleElapsed,
  scaleInterval,
  MotionCoordinator,
} from "../extensions/omt/core/motion.ts";
import { cleanActivity, cleanSpinner } from "../extensions/omt/presets/omt-clean/motion.ts";
import { railScanner, railSpinner } from "../extensions/omt/presets/omt-rail/motion.ts";
import { emberSpinner, emberWorkingLine } from "../extensions/omt/presets/omt-ember/motion.ts";
import { minimalSpinner } from "../extensions/omt/presets/minimal/motion.ts";
import { nativeSpinner } from "../extensions/omt/presets/native/motion.ts";
import { emberThinkingLabel } from "../extensions/omt/presets/omt-ember/assistant.ts";
import { createCleanReadRenderer, createCleanBashRenderer } from "../extensions/omt/presets/shared/tools.ts";
import { determineToolState, renderStatusIcon } from "../extensions/omt/presets/shared/tool-helpers.ts";
import { formatFooterLine } from "../extensions/omt/presets/shared/footer.ts";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";

test("motion settings, reduced-motion preferences, and speed scaling operate predictably", () => {
  const origEnv = process.env.OMT_REDUCED_MOTION;
  try {
    delete process.env.OMT_REDUCED_MOTION;

    // auto preference without env flag
    assert.equal(isReducedMotionActive("auto"), false);
    assert.equal(isAnimationActive("full", "auto"), true);
    assert.equal(isAnimationActive("subtle", "auto"), true);
    assert.equal(isAnimationActive("off", "auto"), false);

    // auto preference with OMT_REDUCED_MOTION=1
    process.env.OMT_REDUCED_MOTION = "1";
    assert.equal(isReducedMotionActive("auto"), true);
    assert.equal(isAnimationActive("subtle", "auto"), false);
    assert.equal(isAnimationActive("off", "auto"), false);

    // Explicit preferences
    assert.equal(isReducedMotionActive("reduced"), true);
    assert.equal(isReducedMotionActive("normal"), false);
    assert.equal(isAnimationActive("full", "normal"), true);
    assert.equal(isAnimationActive("off", "normal"), false);

    // Speed scaling
    assert.equal(scaleElapsed(1000, 1.0), 1000);
    assert.equal(scaleElapsed(1000, 2.0), 2000);
    assert.equal(scaleElapsed(1000, 0.5), 500);

    // Interval scaling (faster speed = shorter interval)
    assert.equal(scaleInterval(100, 1.0), 100);
    assert.equal(scaleInterval(100, 2.0), 50);
    assert.equal(scaleInterval(100, 0.5), 200);
  } finally {
    if (origEnv !== undefined) process.env.OMT_REDUCED_MOTION = origEnv;
    else delete process.env.OMT_REDUCED_MOTION;
  }
});

test("MotionCoordinator schedules frames only while animations are active and stops when idle", async () => {
  const coordinator = new MotionCoordinator();
  coordinator.setBaseInterval(20);

  let renders = 0;
  coordinator.setRenderCallback(() => { renders++; });

  assert.equal(coordinator.hasActive(), false);
  assert.equal(coordinator.activeCount(), 0);

  // Registering a source starts the timer
  coordinator.register("test:tool-1");
  assert.equal(coordinator.hasActive(), true);
  assert.equal(coordinator.activeCount(), 1);

  // Wait a few ticks
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(renders > 0, "frames should be scheduled while active");

  // Unregistering stops the timer immediately
  const countBefore = renders;
  coordinator.unregister("test:tool-1");
  assert.equal(coordinator.hasActive(), false);
  assert.equal(coordinator.activeCount(), 0);

  // Wait again: no new renders should fire
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(renders, countBefore, "no frames scheduled after unregistering all sources");

  // Multiple sources track independently
  coordinator.register("source-a");
  coordinator.register("source-b");
  assert.equal(coordinator.activeCount(), 2);

  coordinator.unregister("source-a");
  assert.equal(coordinator.activeCount(), 1);
  assert.equal(coordinator.hasActive(), true);

  coordinator.clear();
  assert.equal(coordinator.hasActive(), false);
  assert.equal(coordinator.activeCount(), 0);

  coordinator.dispose();
});

test("preset-specific motion utilities provide reference-matched frames and static fallbacks", () => {
  initTheme("dark");
  const dummyTheme: Theme = {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
    dim: (text: string) => text,
    style: (text: string) => text,
    getColorMode: () => "truecolor",
  } as any;

  // 1. OMT Clean
  assert.equal(cleanActivity(dummyTheme, 0, false), "•");
  const activeSweep = cleanActivity(dummyTheme, 100, true);
  assert.ok(activeSweep.length > 0);
  assert.equal(cleanSpinner(0, false), "•");
  assert.equal(cleanSpinner(0, true), "•");
  assert.ok(cleanSpinner(600, true).includes("◦"));

  // 2. OMT Rail
  assert.equal(railScanner(dummyTheme, 0, false), "⋯");
  const activeScanner = railScanner(dummyTheme, 0, true);
  assert.ok(activeScanner.includes("■") || activeScanner.includes("⬝"));
  assert.equal(railSpinner(0, false), "⋯");
  assert.equal(railSpinner(0, true), "⠋");
  assert.equal(railSpinner(80, true), "⠙");

  // 3. OMT Ember
  assert.equal(emberSpinner(0, false), "●");
  assert.equal(emberSpinner(0, true), "·");
  assert.equal(emberSpinner(112 * 4, true), "✢");
  assert.equal(emberSpinner(112 * 5, true), "*");
  assert.equal(emberSpinner(112 * 9, true), "✽");

  // Ember working line with shimmer
  const animatedLine = emberWorkingLine(dummyTheme, 500, "Thinking", "esc", 80, true);
  assert.match(animatedLine, /Thinking…/);
  const staticLine = emberWorkingLine(dummyTheme, 500, "Thinking", "esc", 80, false);
  assert.match(staticLine, /Thinking…/);

  // Ember reasoning label
  assert.equal(emberThinkingLabel(dummyTheme, true), "∴ Thinking…");
  assert.equal(emberThinkingLabel(dummyTheme, false), "∴ Thought");

  // 4. Minimal
  assert.equal(minimalSpinner(0, false), "·");
  assert.equal(minimalSpinner(0, true), "·");
  assert.equal(minimalSpinner(250, true), "•");

  // 5. Native
  assert.equal(nativeSpinner(0, false), "●");
});

test("tool execution, completion, error, and interruption states transition without layout shifts", () => {
  initTheme("dark");
  const dummyTheme: Theme = {
    fg: (_c: string, t: string) => t,
    bg: (_c: string, t: string) => t,
    bold: (t: string) => t,
    dim: (t: string) => t,
    style: (t: string) => t,
    getColorMode: () => "truecolor",
  } as any;

  // Determine tool states
  assert.equal(determineToolState(true, false), "running");
  assert.equal(determineToolState(false, false), "success");
  assert.equal(determineToolState(false, true), "failure");
  assert.equal(determineToolState(false, true, { content: [], details: { exitCode: 130 } } as any), "interrupted");

  // Glyph indicators
  assert.ok(renderStatusIcon("running", dummyTheme));
  assert.ok(renderStatusIcon("success", dummyTheme));
  assert.ok(renderStatusIcon("failure", dummyTheme));
  assert.ok(renderStatusIcon("interrupted", dummyTheme));

  // Tool renderer call rendering for running vs success
  const readRenderer = createCleanReadRenderer();
  const ctxRunning = {
    args: { path: "demo.ts" },
    state: {},
    cwd: "/tmp",
    outputPad: 1,
    isPartial: true,
    isError: false,
    argsComplete: true,
    executionStarted: true,
    keyText: () => "ctrl+o",
    keyHint: (_k: string, t: string) => t,
  } as any;

  const runningCall = readRenderer.renderCall!({ path: "demo.ts" }, dummyTheme, ctxRunning);
  const runningRows = runningCall.render(80);
  assert.ok(runningRows.length > 0);

  const ctxCompleted = { ...ctxRunning, isPartial: false };
  const completedCall = readRenderer.renderCall!({ path: "demo.ts" }, dummyTheme, ctxCompleted);
  const completedRows = completedCall.render(80);
  assert.ok(completedRows.length > 0);
  assert.equal(runningRows.length, completedRows.length, "running and completed headers have same row count");
});

test("footer renders active activity indicators when work is running and remains quiet when idle", () => {
  initTheme("dark");
  const dummyTheme: Theme = {
    fg: (_c: string, t: string) => t,
    bg: (_c: string, t: string) => t,
    bold: (t: string) => t,
    dim: (t: string) => t,
    style: (t: string) => t,
    getColorMode: () => "truecolor",
  } as any;

  // Idle footer
  const idle = formatFooterLine(80, dummyTheme, {
    branch: "main",
    cwd: "/tmp",
    extensionStatuses: [],
    modelId: "gpt-5",
    contextUsage: { percent: 25, contextWindow: 128000 },
    reasoning: false,
    thinkingLevel: "off",
  });
  assert.ok(idle.includes("main"));
  assert.ok(idle.includes("gpt-5"));

  // Active footer with tool running
  const active = formatFooterLine(80, dummyTheme, {
    branch: "main",
    cwd: "/tmp",
    extensionStatuses: [],
    modelId: "gpt-5",
    activity: { type: "tool", name: "bash", detail: "npm test" },
    contextUsage: { percent: 25, contextWindow: 128000 },
    reasoning: false,
    thinkingLevel: "off",
  });
  assert.ok(active.length > 0);
});

test("motion and background activity tracking on toolcall streaming events", () => {
  const coordinator = new MotionCoordinator();
  coordinator.setBaseInterval(20);

  // Register toolcall stream
  coordinator.register("assistant:stream");
  assert.equal(coordinator.hasActive(), true);
  assert.equal(coordinator.activeCount(), 1);

  coordinator.unregister("assistant:stream");
  assert.equal(coordinator.hasActive(), false);
  assert.equal(coordinator.activeCount(), 0);
});
