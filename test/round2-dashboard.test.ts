import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth, stripTerminalSequences } from "@earendil-works/pi-tui";

import {
  SIDE_W,
  SIDE_INNER_W,
  createSidebarControl,
  renderTaskWidget,
  createTaskWidgetComponent,
  renderTeamDashboardPanel,
  createTeamDashboardComponent,
} from "../extensions/omt/features/sidebar/index.ts";

import {
  createSidebarDockComponent,
  createSidebarComponent,
  SidebarDockComponent,
  SidebarComponent,
} from "../extensions/omt/features/sidebar/view.ts";

import type { SidebarState } from "../extensions/omt/features/sidebar/types.ts";
import type { TodoItem } from "../extensions/omt/features/omt-adapters/types.ts";

const mockTheme = {
  bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
  italic: (s: string) => `\x1b[3m${s}\x1b[23m`,
  underline: (s: string) => `\x1b[4m${s}\x1b[24m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[22m`,
  fg: (_color: any, s: string) => s,
  bg: (_color: any, s: string) => s,
  style: (s: string, attrs: any) => {
    let out = s;
    if (attrs?.strikethrough) out = `\x1b[9m${out}\x1b[29m`;
    if (attrs?.bold) out = `\x1b[1m${out}\x1b[22m`;
    return out;
  },
} as any;

function createTestState(): SidebarState {
  return {
    session: {
      id: "test-sess-12345678",
      filePath: "/path/to/session.json",
      firstPrompt: "Fix dashboard parity",
    },
    model: {
      label: "fixture-sonnet-37",
      thinkLevel: "medium",
      thinkLevels: ["off", "low", "medium", "high"],
    },
    recentModels: [
      { id: "fixture-sonnet-37", label: "fixture-sonnet-37", isCurrent: true },
      { id: "gpt-4o", label: "gpt-4o", isCurrent: false },
    ],
    context: {
      percent: 42,
      tokens: 84000,
      contextWindow: 200000,
      autoCompact: false,
    },
    stats: {
      inTokens: 50000,
      outTokens: 12000,
      totalTokens: 62000,
      cacheReadTokens: 22000,
      cacheWriteTokens: 0,
      userMessages: 5,
      assistantMessages: 5,
      totalMessages: 10,
    },
  };
}

test("SidebarDock switches between Overview and live Fleet, selects agents, and inspects without closing", () => {
  const tui = { requestRender() {}, terminal: { rows: 18, columns: 120 } } as any;
  const children = Array.from({ length: 24 }, (_, index) => ({ id: `worker-${index}`, runId: "run-1", agent: "reviewer", label: `Review ${index}`, status: "running" as const, observedAt: Date.now() }));
  const dock = createSidebarDockComponent(tui, mockTheme, undefined, { mode: "tui", hasUI: true } as any, {
    state: createTestState(), getFleetChildren: () => children,
  });
  const overview = dock.render(SIDE_W);
  assert.ok(overview.every(row => visibleWidth(stripTerminalSequences(row)) === SIDE_W), "shared Overview frame stays exactly 34 columns");
  assert.match(stripTerminalSequences(overview.join("\n")), /Session|Overview/i);
  const sessionRow = overview.findIndex(line => stripTerminalSequences(line).includes("SESSION"));
  assert.ok(sessionRow >= 3, "dock overview includes sidebar sections below its three-row header");
  dock.handleMouse({ type: "move", button: "none", x: 4, y: sessionRow } as any);
  const hovered = dock.render(SIDE_W);
  assert.match(hovered[sessionRow]!, /\x1b\[1m/, "hover highlight aligns with the mouse row after the dock header");
  const fleetTabRow = overview.findIndex(line => stripTerminalSequences(line).includes("Agents (24)"));
  assert.ok(fleetTabRow >= 0, "overview exposes the unified Agents tab");
  dock.handleMouse({ type: "click", button: "left", x: 18, y: fleetTabRow } as any);
  const agentsView = stripTerminalSequences(dock.render(SIDE_W).join("\n"));
  assert.match(agentsView, /Agent Fleet/);
  assert.match(agentsView, /Overview.*Agents \(24\)/);
  assert.equal(agentsView.match(/Overview/g)?.length, 1, "shared tab row is the only Overview navigation");
  dock.handleMouse({ type: "click", button: "left", x: 5, y: 6 } as any);
  assert.match(stripTerminalSequences(dock.render(SIDE_W).join("\n")), /Review 0/);
  dock.handleMouse({ type: "click", button: "left", x: 5, y: 6 } as any);
  assert.match(stripTerminalSequences(dock.render(SIDE_W).join("\n")), /ID: worker-0/);
  dock.handleMouse({ type: "click", button: "left", x: 18, y: 1 } as any);
  for (let i = 0; i < 5; i++) dock.handleMouse({ type: "wheel", wheelDelta: 3 } as any);
  const fleetRows = dock.render(SIDE_W);
  assert.ok(fleetRows.every(row => visibleWidth(stripTerminalSequences(row)) <= SIDE_W), "shared Agents view never overflows the dock");
  const fleetScreen = stripTerminalSequences(fleetRows.join("\n"));
  assert.match(fleetScreen, /Review 15/);
  assert.match(fleetScreen, /earlier agents/);
  assert.equal(dock.render(SIDE_W).length, 18, "fleet viewport remains terminal-height bounded");
  dock.handleMouse({ type: "click", button: "left", x: 5, y: 10 } as any);
  dock.handleMouse({ type: "click", button: "left", x: 5, y: 10 } as any);
  assert.match(stripTerminalSequences(dock.render(SIDE_W).join("\n")), /ID: worker-16/);
  dock.handleMouse({ type: "click", button: "left", x: 5, y: 1 } as any);
  assert.match(stripTerminalSequences(dock.render(SIDE_W).join("\n")), /Session|Overview/i);
  dock.dispose();
});

test("SidebarDock continuous resize: 49 -> 20 -> 60 rows without sticking to initial height", () => {
  const terminal = { rows: 49, columns: 192 };
  const mockTui = {
    requestRender: () => {},
    terminal,
  } as any;
  const mockCtx = { mode: "tui", hasUI: true } as any;

  const dock = createSidebarDockComponent(mockTui, mockTheme, undefined, mockCtx, {
    state: createTestState(),
  });

  // Render 1: at terminal height 49
  const lines49 = dock.render(SIDE_W);
  assert.equal(lines49.length, 49, `Initial render must have 49 rows, got ${lines49.length}`);
  for (const ln of lines49) {
    assert.equal(visibleWidth(stripTerminalSequences(ln)), SIDE_W);
  }

  // Resize 1: terminal shrinks to 20 rows
  terminal.rows = 20;
  const lines20 = dock.render(SIDE_W);
  assert.equal(lines20.length, 20, `Shrunk render must have 20 rows, got ${lines20.length}`);
  for (const ln of lines20) {
    assert.equal(visibleWidth(stripTerminalSequences(ln)), SIDE_W);
  }

  // Resize 2: terminal expands to 60 rows
  terminal.rows = 60;
  const lines60 = dock.render(SIDE_W);
  assert.equal(lines60.length, 60, `Expanded render must have 60 rows, got ${lines60.length}`);
  for (const ln of lines60) {
    assert.equal(visibleWidth(stripTerminalSequences(ln)), SIDE_W);
  }
});

test("SidebarDock preserves caller-explicit viewportHeight override across terminal resizes", () => {
  const terminal = { rows: 49, columns: 192 };
  const mockTui = {
    requestRender: () => {},
    terminal,
  } as any;
  const mockCtx = { mode: "tui", hasUI: true } as any;

  const explicitHeight = 25;
  const dock = createSidebarDockComponent(mockTui, mockTheme, undefined, mockCtx, {
    state: createTestState(),
    viewportHeight: explicitHeight,
  });

  // With explicit viewportHeight=25, terminal rows 49 must NOT override it
  assert.equal(dock.render(SIDE_W).length, explicitHeight);

  // When terminal changes to 20 or 60, caller explicit override must remain 25
  terminal.rows = 20;
  assert.equal(dock.render(SIDE_W).length, explicitHeight);

  terminal.rows = 60;
  assert.equal(dock.render(SIDE_W).length, explicitHeight);
});

test("SidebarDock renders full-height outer border when all sections are hidden/folded", () => {
  const terminal = { rows: 49, columns: 192 };
  const mockTui = {
    requestRender: () => {},
    terminal,
  } as any;
  const mockCtx = { mode: "tui", hasUI: true } as any;

  // Hide every section so content is minimal (0 inner rows)
  const dock = createSidebarDockComponent(mockTui, mockTheme, undefined, mockCtx, {
    state: createTestState(),
    visibleSections: {
      pet: false,
      session: false,
      model: false,
      stats: false,
      cost: false,
      recent: false,
      commands: false,
      plugins: false,
      mcp: false,
      todos: false,
      lsp: false,
      tools: false,
      skills: false,
      subagents: false,
      workspace: false,
    },
  });

  const lines = dock.render(SIDE_W);
  assert.equal(lines.length, 49, `Must return full 49 rows even when all sections hidden, got ${lines.length}`);

  // Line 0 is top rounded border
  const top = stripTerminalSequences(lines[0]!);
  assert.ok(top.startsWith("╭") && top.endsWith("╮"), `Top border expected, got: "${top}"`);
  assert.equal(visibleWidth(top), SIDE_W);

  // Line 48 is bottom rounded border
  const bot = stripTerminalSequences(lines[48]!);
  assert.ok(bot.startsWith("╰") && bot.endsWith("╯"), `Bottom border expected, got: "${bot}"`);
  assert.equal(visibleWidth(bot), SIDE_W);

  // Lines 1..47 are empty bordered rows
  for (let i = 1; i < 48; i++) {
    const raw = stripTerminalSequences(lines[i]!);
    assert.ok((raw.startsWith("│") && raw.endsWith("│")) || (raw.startsWith("├") && raw.endsWith("┤")), `Row ${i} must retain dashboard framing, got: "${raw}"`);
    assert.equal(visibleWidth(raw), SIDE_W);
  }
});

test("SidebarDock renders full-height outer border when content is short", () => {
  const terminal = { rows: 49, columns: 192 };
  const mockTui = {
    requestRender: () => {},
    terminal,
  } as any;
  const mockCtx = { mode: "tui", hasUI: true } as any;

  // Only session section visible (produces ~4 inner rows)
  const dock = createSidebarDockComponent(mockTui, mockTheme, undefined, mockCtx, {
    state: {
      session: { id: "s1", firstPrompt: "hello" },
    },
    visibleSections: {
      pet: false,
      session: true,
      model: false,
      stats: false,
      cost: false,
      recent: false,
      commands: false,
      plugins: false,
      mcp: false,
      todos: false,
      lsp: false,
      tools: false,
      skills: false,
      subagents: false,
      workspace: false,
    },
  });

  const lines = dock.render(SIDE_W);
  assert.equal(lines.length, 49, `Must return exactly 49 rows for short content, got ${lines.length}`);
  assert.equal(visibleWidth(stripTerminalSequences(lines[0]!)), SIDE_W);
  assert.equal(visibleWidth(stripTerminalSequences(lines[48]!)), SIDE_W);

  // Inner lines must contain SESSION and padded empty rows
  const fullText = lines.map((l) => stripTerminalSequences(l)).join("\n");
  assert.ok(fullText.includes("SESSION"));

  // Bottom row is bottom border
  const bot = stripTerminalSequences(lines[48]!);
  assert.ok(bot.startsWith("╰") && bot.endsWith("╯"));
});

test("SidebarDock positions quitArmed footer at the bottom row above bottom border", () => {
  const terminal = { rows: 20, columns: 192 };
  const mockTui = {
    requestRender: () => {},
    terminal,
  } as any;
  const mockCtx = { mode: "tui", hasUI: true } as any;

  const dock = createSidebarDockComponent(mockTui, mockTheme, undefined, mockCtx, {
    state: { session: { id: "s1" } },
    quitArmed: true,
    visibleSections: {
      pet: false,
      session: true,
      model: false,
      stats: false,
      cost: false,
      recent: false,
      commands: false,
      plugins: false,
      mcp: false,
      todos: false,
      lsp: false,
      tools: false,
      skills: false,
      subagents: false,
      workspace: false,
    },
  });

  const lines = dock.render(SIDE_W);
  assert.equal(lines.length, 20);

  // Footer warning must sit at index 18 (row 19 of 20, immediately above bottom border at index 19)
  const warnRow = stripTerminalSequences(lines[18]!);
  assert.ok(warnRow.includes("press Ctrl+C again to quit"), `Expected quit warning on row 18, got: "${warnRow}"`);
  assert.ok(warnRow.startsWith("│") && warnRow.endsWith("│"));

  const botRow = stripTerminalSequences(lines[19]!);
  assert.ok(botRow.startsWith("╰") && botRow.endsWith("╯"));
});

test("SidebarDock input contract: q, Q, Esc, tui.select.cancel NEVER close or disappear dock", () => {
  let closed = false;
  const mockTui = {
    requestRender: () => {},
    terminal: { rows: 40, columns: 192 },
  } as any;
  const mockCtx = { mode: "tui", hasUI: true } as any;

  const dock = createSidebarDockComponent(mockTui, mockTheme, undefined, mockCtx, {
    state: createTestState(),
  });

  for (const key of ["q", "Q", "\x1b", "\x1b[Z"]) {
    dock.handleInput(key);
    const lines = dock.render(SIDE_W);
    assert.equal(lines.length, 40, `Dock must remain fully rendered after sending "${key}"`);
  }
});

test("model operation safety: callback absent must NOT fake a successful model change", () => {
  const mockTui = { requestRender: () => {}, terminal: { rows: 40, columns: 192 } } as any;
  const mockCtx = { mode: "tui", hasUI: true } as any;

  const state = createTestState();
  const originalLabel = state.model!.label;

  // Dock created WITHOUT onSelectModel
  const dock = createSidebarDockComponent(mockTui, mockTheme, undefined, mockCtx, {
    state,
  });

  // 1. Explicit selectModel call without callback
  dock.selectModel("gpt-4o");
  assert.equal(dock.getState().model?.label, originalLabel, "Model label must not change when onSelectModel is absent");

  // 2. cycleRecentModel call without callback
  const cycleResult = dock.cycleRecentModel();
  assert.equal(cycleResult, undefined, "cycleRecentModel must return undefined when onSelectModel is absent");
  assert.equal(dock.getState().model?.label, originalLabel);

  // 3. Number shortcut '2' without callback
  dock.handleInput("2");
  assert.equal(dock.getState().model?.label, originalLabel, "Key shortcut must not mutate model when onSelectModel is absent");
});

test("thinking operation safety: callback absent must NOT fake a successful thinking change", () => {
  const mockTui = { requestRender: () => {}, terminal: { rows: 40, columns: 192 } } as any;
  const mockCtx = { mode: "tui", hasUI: true } as any;

  const state = createTestState();
  const originalLevel = state.model!.thinkLevel;

  // Dock created WITHOUT onSelectThinkingLevel
  const dock = createSidebarDockComponent(mockTui, mockTheme, undefined, mockCtx, {
    state,
  });

  // 1. Explicit selectThinkingLevel call without callback
  dock.selectThinkingLevel("high");
  assert.equal(dock.getState().model?.thinkLevel, originalLevel, "Thinking level must not change when onSelectThinkingLevel is absent");

  // 2. cycleThinkingLevel call without callback
  const cycleResult = dock.cycleThinkingLevel();
  assert.equal(cycleResult, undefined, "cycleThinkingLevel must return undefined when onSelectThinkingLevel is absent");
  assert.equal(dock.getState().model?.thinkLevel, originalLevel);

  // 3. 't' shortcut without callback
  dock.handleInput("t");
  assert.equal(dock.getState().model?.thinkLevel, originalLevel, "Key shortcut must not mutate thinking level when callback is absent");
});

test("model/thinking operation error handling: rejected promise must NOT fake success", async () => {
  const mockTui = { requestRender: () => {}, terminal: { rows: 40, columns: 192 } } as any;
  const mockCtx = { mode: "tui", hasUI: true } as any;

  const state = createTestState();
  const originalLabel = state.model!.label;
  const originalLevel = state.model!.thinkLevel;

  const dock = createSidebarDockComponent(mockTui, mockTheme, undefined, mockCtx, {
    state,
    onSelectModel: async () => {
      throw new Error("Provider rejected model change");
    },
    onSelectThinkingLevel: async () => {
      throw new Error("Provider rejected thinking level change");
    },
  });

  dock.selectModel("gpt-4o");
  dock.selectThinkingLevel("high");

  // Allow microtasks to settle
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(dock.getState().model?.label, originalLabel, "Model must not be updated if onSelectModel rejects");
  assert.equal(dock.getState().model?.thinkLevel, originalLevel, "Thinking level must not be updated if onSelectThinkingLevel rejects");
});

test("model/thinking operations succeed when callback resolves", async () => {
  const mockTui = { requestRender: () => {}, terminal: { rows: 40, columns: 192 } } as any;
  const mockCtx = { mode: "tui", hasUI: true } as any;

  const state = createTestState();
  let modelCalled = "";
  let levelCalled = "";

  const dock = createSidebarDockComponent(mockTui, mockTheme, undefined, mockCtx, {
    state,
    onSelectModel: (id) => {
      modelCalled = id;
    },
    onSelectThinkingLevel: (lvl) => {
      levelCalled = lvl;
    },
  });

  dock.selectModel("gpt-4o");
  assert.equal(modelCalled, "gpt-4o");
  assert.equal(dock.getState().model?.label, "gpt-4o");

  dock.selectThinkingLevel("high");
  assert.equal(levelCalled, "high");
  assert.equal(dock.getState().model?.thinkLevel, "high");
});

test("SidebarControl.setDocked suppresses companion widget only while permanent dock is mounted", () => {
  let capturedWidget: any = null;
  const mockCtx = {
    mode: "tui",
    hasUI: true,
    ui: {
      setWidget: (_key: string, factory: any) => {
        capturedWidget = factory ? factory(null, mockTheme) : null;
      },
    },
  } as any;

  const control = createSidebarControl();
  control.on(mockCtx);
  assert.ok(capturedWidget, "Widget must be registered");

  // Initially not docked: widget renders 2 rows
  const normalRows = capturedWidget.render(80);
  assert.equal(normalRows.length, 2, "Companion widget must render 2 rows when not docked");

  // When docked: widget must suppress itself and render []
  control.setDocked?.(true, mockCtx);
  const dockedRows = capturedWidget.render(80);
  assert.equal(dockedRows.length, 0, "Companion widget must return [] when permanent dock is mounted");

  // When un-docked: widget resumes rendering 2 rows
  control.setDocked?.(false, mockCtx);
  const undockedRows = capturedWidget.render(80);
  assert.equal(undockedRows.length, 2, "Companion widget must resume rendering when dock is released");

  control.cleanup?.();
});

test("SidebarDock disposal unregisters motion and renders empty", () => {
  const mockTui = { requestRender: () => {}, terminal: { rows: 40, columns: 192 } } as any;
  const mockCtx = { mode: "tui", hasUI: true } as any;

  const dock = createSidebarDockComponent(mockTui, mockTheme, undefined, mockCtx, {
    state: createTestState(),
  });

  assert.equal(dock.render(SIDE_W).length, 40);

  dock.dispose();

  // After disposal, render returns [] and inputs are inert
  assert.deepEqual(dock.render(SIDE_W), []);
  dock.handleInput("j");
  assert.equal(dock.getScrollOffset(), 0);
  const mouseResult = dock.handleMouse({ type: "click", button: "left", x: 5, y: 5 } as any);
  assert.equal(mouseResult, undefined);
});

test("task widget and team dashboard present observed data without fake activity", () => {
  // Empty tasks -> returns []
  const emptyTaskLines = renderTaskWidget([], 80);
  assert.deepEqual(emptyTaskLines, [], "Empty task list must return []");

  // Real observed tasks
  const tasks: TodoItem[] = [
    { id: "1", content: "Implement parity", status: "completed" },
    { id: "2", content: "Run isolated gates", status: "in_progress" },
    { id: "3", content: "Export evidence patch", status: "pending" },
  ];
  const taskLines = renderTaskWidget(tasks, 80, { theme: mockTheme });
  assert.ok(taskLines.length >= 4);
  const taskText = taskLines.map((l) => stripTerminalSequences(l)).join("\n");
  assert.ok(taskText.includes("3 tasks"));
  assert.ok(taskText.includes("1 done"));
  assert.ok(taskText.includes("1 in progress"));
  assert.ok(taskText.includes("1 open"));

  // Team dashboard with empty workers
  const emptyTeam = renderTeamDashboardPanel({ workers: [] }, 80, mockTheme);
  const emptyTeamText = emptyTeam.map((l) => stripTerminalSequences(l)).join("\n");
  assert.ok(emptyTeamText.includes("Team Dashboard"));
  assert.ok(!emptyTeamText.includes("worker-1"), "Must not invent fake workers");

  // Team dashboard with observed workers
  const team = renderTeamDashboardPanel(
    {
      workers: [
        { id: "w1", label: "indexer", status: "running", elapsedMs: 5000 },
        { id: "w2", label: "tester", status: "completed", elapsedMs: 12000 },
        { id: "w3", label: "builder", status: "failed", elapsedMs: 1000 },
      ],
    },
    80,
    mockTheme,
  );
  const teamText = team.map((l) => stripTerminalSequences(l)).join("\n");
  assert.ok(teamText.includes("indexer"));
  assert.ok(teamText.includes("●"), "Running worker must have ● dot");
  assert.ok(teamText.includes("tester"));
  assert.ok(teamText.includes("✓"), "Completed worker must have ✓ dot");
  assert.ok(teamText.includes("builder"));
  assert.ok(teamText.includes("!"), "Failed worker must have ! dot");
});
