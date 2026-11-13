import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth, stripTerminalSequences } from "@earendil-works/pi-tui";

import {
  SIDE_W,
  SIDE_INNER_W,
  SideLSP,
  SideTodos,
  sideOrder,
  short,
  truncWidth,
  twoCol,
  fmtNum,
  fmtDur,
  fmtComma,
  thinkLevelRows,
  renderThinkRows,
  renderModelSection,
  renderCostSection,
  renderRecentSection,
  renderCommandsSection,
  renderMcpSection,
  renderLspSection,
  renderSubagentsSection,
  renderWorkspaceSection,
  renderSidebar,
  createSidebarControl,
  renderTaskWidget,
  createTaskWidgetComponent,
  renderTeamDashboardPanel,
  createTeamDashboardComponent,
  brighten,
  applyHover,
} from "../extensions/omt/features/sidebar/index.ts";

import {
  createSidebarDockComponent,
  createSidebarComponent,
  SidebarDockComponent,
  SidebarComponent,
} from "../extensions/omt/features/sidebar/view.ts";

import {
  mcpSnapshotToSectionItems,
  subagentSnapshotToSectionItems,
  lspSnapshotToSectionItems,
  buildMcpSnapshot,
  buildSubagentSnapshot,
  buildLspSnapshot,
} from "../extensions/omt/features/omt-adapters/model.ts";

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

test("section order: SideLSP (index 9) must precede SideTodos (index 10) matching OMT sideOrder", () => {
  const lspIndex = sideOrder.indexOf(SideLSP);
  const todosIndex = sideOrder.indexOf(SideTodos);
  assert.equal(lspIndex, 9, `SideLSP must be at index 9, got ${lspIndex}`);
  assert.equal(todosIndex, 10, `SideTodos must be at index 10, got ${todosIndex}`);
  assert.ok(lspIndex < todosIndex, "SideLSP must come before SideTodos");
});

test("defensive formatting: short, truncWidth, twoCol safely handle undefined and null without crashing", () => {
  // Undefined / null inputs must not throw TypeError
  assert.equal(short(undefined, 30), "");
  assert.equal(short(null, 30), "");
  assert.equal(short(123 as any, 30), "123");
  assert.equal(truncWidth(undefined, 30), "");
  assert.equal(truncWidth(null, 30), "");
  assert.equal(truncWidth("", 30), "");

  const colResult = twoCol(undefined, undefined, 30);
  assert.ok(typeof colResult === "string");
  // Source specification pads the left column to 17; outer framing pads to 30.
  assert.equal(colResult, " ".repeat(17));

  const partialCol = twoCol("Key", undefined, 30);
  assert.ok(partialCol.includes("Key"));
  assert.equal(partialCol, "Key" + " ".repeat(14));
});

test("thinking levels: separated by single space, wrapped on overflow, active is bold text", () => {
  const levels = ["off", "minimal", "low", "medium", "high", "max", "extreme"];
  const rows = thinkLevelRows(levels, 30);
  assert.ok(rows.length >= 2, `Levels must wrap onto multiple rows, got ${rows.length}`);

  // Every wrapped line must fit within 30 columns
  for (const row of rows) {
    const joined = row.join(" ");
    assert.ok(visibleWidth(joined) <= 30, `Row "${joined}" exceeds 30 cells: ${visibleWidth(joined)}`);
  }

  const rendered = renderThinkRows(levels, "high", "", 30, mockTheme);
  assert.ok(rendered.length >= 2);
  // Joined by space, not ' · '
  assert.ok(!rendered[0]!.includes(" · "), "Levels must NOT use dot separator");
  assert.ok(rendered.some((line) => line.includes("\x1b[1mhigh\x1b[22m")), "Active level must be bold");

  // Hover level highlighting
  const hovered = renderThinkRows(levels, "off", "medium", 30, mockTheme);
  assert.ok(hovered.some((line) => line.includes("medium")), "Hover level must be rendered");
});

test("recent models hint: displays dynamic hint based on mouse capability, never hardcoded text", () => {
  const models = [
    { id: "m1", label: "Model 1", isCurrent: true },
    { id: "m2", label: "Model 2", isCurrent: false },
  ];

  // Mouse enabled -> "click to switch · ^↑↓ scroll"
  const mouseLines = renderRecentSection(models, 30, mockTheme, false, true);
  const mouseText = mouseLines.map((l) => stripTerminalSequences(l)).join("\n");
  assert.ok(mouseText.includes("click to switch · ^↑↓ scroll"), "Must show mouse hint when mouse supported");
  assert.ok(!mouseText.includes("Session model history"), "Must not show old hardcoded hint");

  // Mouse disabled -> "^R list · ^↑↓ scroll"
  const noMouseLines = renderRecentSection(models, 30, mockTheme, false, false);
  const noMouseText = noMouseLines.map((l) => stripTerminalSequences(l)).join("\n");
  assert.ok(noMouseText.includes("^R list · ^↑↓ scroll"), "Must show keyboard hint when mouse unsupported");
  assert.ok(!noMouseText.includes("Session model history"), "Must not show old hardcoded hint");
});

test("cost section suppression: hidden when single model session (length <= 1), shown when > 1", () => {
  // Empty -> suppressed
  assert.deepEqual(renderCostSection([], 30, mockTheme), []);

  // Single model session -> suppressed matching OMT len(m.sessBreak) <= 1
  const single = [{ key: "claude-3-7-sonnet", cost: 0.042 }];
  assert.deepEqual(renderCostSection(single, 30, mockTheme), [], "Single model session must suppress COST section");

  // Multiple models -> rendered
  const multi = [
    { key: "claude-3-7-sonnet", cost: 0.042 },
    { key: "gpt-4o", cost: 0.018 },
  ];
  const lines = renderCostSection(multi, 30, mockTheme);
  assert.ok(lines.length > 0, "Multi-model session must render COST section");
  const fullText = lines.map((l) => stripTerminalSequences(l)).join("\n");
  assert.ok(fullText.includes("COST"));
  assert.ok(fullText.includes("$0.042"));
  assert.ok(fullText.includes("$0.018"));
});

test("commands and workspace sections do not emit trailing separators", () => {
  const cmdLines = renderCommandsSection({ ext: 1, prompt: 2, skill: 1, builtin: 5 }, 30, mockTheme);
  const lastCmd = stripTerminalSequences(cmdLines[cmdLines.length - 1] ?? "");
  assert.ok(!lastCmd.startsWith("─"), "COMMANDS must not end with separator line");

  const wsLines = renderWorkspaceSection({ cwd: "/home/user", ok: true }, true, 30, mockTheme);
  const lastWs = stripTerminalSequences(wsLines[wsLines.length - 1] ?? "");
  assert.ok(!lastWs.startsWith("─"), "WORKSPACE must not end with separator line");
});

test("mcp servers: rich status glyphs (●/◐/⊘/○), exposure counts and token metrics", () => {
  const mcpItems = [
    { label: "postgres", name: "postgres", connected: true, direct: 3, total: 3, tokens: 1200 },
    { label: "github", name: "github", connected: true, direct: 1, total: 4, tokens: 450 },
    { label: "slack", name: "slack", disabled: true },
    { label: "remote", name: "remote", connected: false },
  ];

  const lines = renderMcpSection(mcpItems, false, 30, mockTheme);
  const fullText = lines.map((l) => stripTerminalSequences(l)).join("\n");

  assert.ok(fullText.includes("MCP Servers (4) ▾"));
  assert.ok(fullText.includes("postgres"));
  assert.ok(fullText.includes("3/3"));
  assert.ok(fullText.includes("~1,200"));
  assert.ok(fullText.includes("github"));
  assert.ok(fullText.includes("1/4"));
  assert.ok(fullText.includes("slack"));
  assert.ok(fullText.includes("⊘"));
  assert.ok(fullText.includes("remote"));
  assert.ok(fullText.includes("○"));
});

test("subagents: active header count, rich status glyphs (✓/◐/◌/○/!), and elapsed suffix", () => {
  const subagents = [
    { label: "worker-1", name: "worker-1", status: "running", elapsed: "12s" },
    { label: "worker-2", name: "worker-2", status: "completed", elapsed: "45s" },
    { label: "worker-3", name: "worker-3", status: "failed", elapsed: "2s" },
  ];

  const lines = renderSubagentsSection(subagents, 30, mockTheme, true);
  const fullText = lines.map((l) => stripTerminalSequences(l)).join("\n");

  // Active count in title
  assert.ok(fullText.includes("Subagents (1 active)"));
  assert.ok(!fullText.includes("SUBAGENTS"), "Header should use Titlecase matching OMT");
  assert.ok(fullText.includes("worker-1"));
  assert.ok(fullText.includes("◐"));
  assert.ok(fullText.includes("12s"));
  assert.ok(fullText.includes("worker-2"));
  assert.ok(fullText.includes("✓"));
  assert.ok(fullText.includes("worker-3"));
  assert.ok(fullText.includes("!"));
});

test("lsp diagnostics: header badge (●2E !1W), file grouping, and colored severity dots", () => {
  const lspItems = [
    { kind: "file" as const, file: "src/main.ts", label: "src/main.ts", errs: 2, warns: 1 },
    { kind: "diag" as const, file: "src/main.ts", label: "src/main.ts:42", line: 42, severity: "error", message: "Cannot find name 'foo'", source: "ts", code: "2304" },
    { kind: "diag" as const, file: "src/main.ts", label: "src/main.ts:88", line: 88, severity: "warning", message: "Unused variable", source: "ts" },
  ];

  const lines = renderLspSection(lspItems, false, 30, mockTheme);
  const fullText = lines.map((l) => stripTerminalSequences(l)).join("\n");

  // Header badge
  assert.ok(fullText.includes("●2E !1W"));
  // File row with counts hugging right
  assert.ok(fullText.includes("src/main.ts"));
  assert.ok(fullText.includes("2E1W"));
  // Diag lines
  assert.ok(fullText.includes("L42"));
  assert.ok(fullText.includes("Cannot find"));
  assert.ok(fullText.includes("L88"));
  assert.ok(fullText.includes("Unused variable"));
});

test("SidebarComponent modal keeps 34 columns and does not stretch across wide terminals", () => {
  const mockTui = {
    requestRender: () => {},
    terminal: { rows: 50, columns: 192 },
  } as any;
  const mockCtx = { mode: "tui", hasUI: true } as any;

  const component = createSidebarComponent(mockTui, mockTheme, undefined, () => {}, mockCtx);

  // When rendered at 192 columns (terminal width), modal box must remain SIDE_W (34)
  const lines192 = component.render(192);
  assert.ok(lines192.length > 5);
  for (const line of lines192) {
    assert.equal(
      visibleWidth(stripTerminalSequences(line)),
      SIDE_W,
      `Line must not stretch beyond ${SIDE_W} cols: "${stripTerminalSequences(line)}"`,
    );
  }

  // When rendered at 80 columns, modal box must also remain SIDE_W (34)
  const lines80 = component.render(80);
  for (const line of lines80) {
    assert.equal(visibleWidth(stripTerminalSequences(line)), SIDE_W);
  }
});

test("createSidebarDockComponent: true 34-col dock, permanent (no q/Esc close), full height, mouse & folds", () => {
  let renderRequested = false;
  const mockTui = {
    requestRender: () => {
      renderRequested = true;
    },
    terminal: { rows: 45, columns: 192 },
  } as any;
  let selectedModel = "";
  let selectedLevel = "";
  const mockCtx = { mode: "tui", hasUI: true } as any;

  const dock = createSidebarDockComponent(mockTui, mockTheme, undefined, mockCtx, {
    onSelectModel: (id) => {
      selectedModel = id;
    },
    onSelectThinkingLevel: (lvl) => {
      selectedLevel = lvl;
    },
  });

  assert.ok(dock instanceof SidebarDockComponent);

  // 1. Render produces exact 34 columns
  const lines = dock.render(34);
  assert.ok(lines.length > 10);
  for (const ln of lines) {
    assert.equal(visibleWidth(stripTerminalSequences(ln)), SIDE_W);
  }

  // 2. Permanent dock: q and Esc MUST NOT close or destroy the dock
  dock.handleInput("q");
  assert.ok(dock.render(34).length > 0, "Dock must remain active after pressing 'q'");

  dock.handleInput("Q");
  assert.ok(dock.render(34).length > 0, "Dock must remain active after pressing 'Q'");

  dock.handleInput("\x1b");
  assert.ok(dock.render(34).length > 0, "Dock must remain active after pressing Escape");

  // 3. Navigation and scrolling
  assert.equal(dock.getScrollOffset(), 0);
  dock.handleInput("j");
  assert.equal(dock.getScrollOffset(), 1);
  dock.handleInput("k");
  assert.equal(dock.getScrollOffset(), 0);

  // 4. Mouse wheel scrolling
  dock.handleMouse({ type: "wheel", wheelDelta: 3 } as any);
  assert.equal(dock.getScrollOffset(), 3);
  dock.handleMouse({ type: "wheel", wheelDelta: -2 } as any);
  assert.equal(dock.getScrollOffset(), 1);

  // 5. Mouse drag returns undefined (preserves AltScreen text selection)
  const dragResult = dock.handleMouse({ type: "drag" } as any);
  assert.equal(dragResult, undefined, "Mouse drag must return undefined to preserve terminal selection");

  // 6. Mouse move updates hover and requests render
  renderRequested = false;
  const moveResult = dock.handleMouse({ type: "move", x: 10, y: 5 } as any);
  assert.ok(moveResult?.handled, "Mouse move within sidebar must be handled");
  assert.ok(renderRequested, "Mouse move must trigger requestRender");

  // 7. Disposal cleans up cleanly
  dock.dispose();
});

test("SidebarControl.setDocked: suppresses 2-row companion widget ONLY while permanent dock mounted", () => {
  const control = createSidebarControl();
  let mountedKey = "";
  let mountedFactory: any = null;
  let renderCount = 0;

  const tuiCtx = {
    mode: "tui",
    hasUI: true,
    ui: {
      setWidget: (key: string, factory: any) => {
        mountedKey = key;
        mountedFactory = factory;
      },
      requestRender: () => {
        renderCount++;
      },
    },
  } as any;

  control.on(tuiCtx);
  assert.equal(control.isEnabled(), true);
  assert.ok(typeof mountedFactory === "function");

  const widget = mountedFactory({ requestRender: () => {} }, mockTheme);

  // Initial state: undocked -> renders 2 companion rows
  const normalRows = widget.render(80);
  assert.equal(normalRows.length, 2, "Undocked companion must render 2 rows");

  // Parent mounts lateral dock -> calls setDocked(true)
  assert.ok(typeof control.setDocked === "function", "setDocked must be implemented on SidebarControl");
  control.setDocked(true, tuiCtx);
  assert.ok(renderCount > 0, "setDocked must request host repaint");

  // Companion widget is now suppressed (0 rows)
  const dockedRows = widget.render(80);
  assert.equal(dockedRows.length, 0, "When docked, companion widget must be suppressed (0 rows)");

  // State, enabled flag, and controls remain preserved
  assert.equal(control.isEnabled(), true, "SidebarControl must remain enabled");

  // Parent unmounts lateral dock -> calls setDocked(false)
  control.setDocked(false, tuiCtx);
  const restoredRows = widget.render(80);
  assert.equal(restoredRows.length, 2, "When undocked, companion widget must restore 2 rows");

  // Cleanup
  control.cleanup?.(tuiCtx);
  assert.equal(control.isEnabled(), false);
});

test("task widget: renders exact above-editor header, active task spinner/tokens, and strikethrough completed", () => {
  const tasks = [
    {
      id: "1",
      content: "Implement OAuth2 login flow",
      status: "in_progress" as const,
      subAction: "Connecting to provider",
      updatedAt: 1000,
    },
    {
      id: "2",
      content: "Write unit tests",
      status: "completed" as const,
      updatedAt: 900,
    },
    {
      id: "3",
      content: "Deploy to production",
      status: "pending" as const,
      blockedBy: ["1", "2"],
      updatedAt: 800,
    },
  ];

  const lines = renderTaskWidget(tasks, 80, {
    activeTaskId: "1",
    startedAt: Date.now() - 5000,
    inputTokens: 8400,
    outputTokens: 2800,
    tick: 2,
    theme: mockTheme,
  });

  assert.ok(lines.length >= 4);
  const text = lines.map((l) => stripTerminalSequences(l)).join("\n");

  // Header
  assert.ok(text.includes("3 tasks (1 done, 1 in progress, 1 open)"));

  // Active task with tokens and spinner
  assert.ok(text.includes("#1"));
  assert.ok(text.includes("Connecting to provider"));
  assert.ok(text.includes("↑ 8.4k"));
  assert.ok(text.includes("↓ 2.8k"));

  // Completed task
  assert.ok(text.includes("✔"));
  assert.ok(text.includes("#2 Write unit tests"));

  // Blocked task
  assert.ok(text.includes("#3 Deploy to production"));
  assert.ok(text.includes("[blocked by #1, #2]"));

  // Mount contract
  const comp = createTaskWidgetComponent(() => tasks);
  assert.ok(typeof comp.render === "function");
  assert.ok(comp.render(80).length > 0);
});

test("team dashboard panel: renders workers table, tabs, and status indicators", () => {
  const data = {
    title: "Swarm Herd",
    summary: "3 workers active · 1 idle",
    workers: [
      { id: "w1", label: "coder-agent", agentName: "coder", status: "running", elapsedMs: 15000 },
      { id: "w2", label: "tester-agent", agentName: "tester", status: "completed", elapsedMs: 8000 },
      { id: "w3", label: "linter-agent", agentName: "linter", status: "failed", elapsedMs: 1200 },
    ],
  };

  const lines = renderTeamDashboardPanel(data, 80, mockTheme);
  assert.ok(lines.length > 5);
  const text = lines.map((l) => stripTerminalSequences(l)).join("\n");

  assert.ok(text.includes("Swarm Herd"));
  assert.ok(text.includes("[1 Workers]"));
  assert.ok(text.includes("coder-agent"));
  assert.ok(text.includes("running"));
  assert.ok(text.includes("tester-agent"));
  assert.ok(text.includes("completed"));
  assert.ok(text.includes("linter-agent"));

  // Mount contract
  const comp = createTeamDashboardComponent(() => data, mockTheme);
  assert.ok(typeof comp.render === "function");
  assert.ok(comp.render(80).length > 0);
});

test("adapters: snapshots correctly produce rich section items for MCP, subagents, and LSP", () => {
  // MCP adapter
  const mcpSnap = buildMcpSnapshot([
    { name: "srv1", connectionState: "connected", detail: "tools: 2", directTools: 2, totalTools: 2 } as any,
  ]);
  const mcpItems = mcpSnapshotToSectionItems(mcpSnap);
  assert.equal(mcpItems.length, 1);
  assert.equal(mcpItems[0]!.name, "srv1");
  assert.equal(mcpItems[0]!.connected, true);
  assert.equal(mcpItems[0]!.direct, 2);

  // Subagents adapter
  const subSnap = buildSubagentSnapshot([
    {
      id: "s1",
      name: "sub1",
      agentName: "researcher",
      task: "gather info",
      tool: "subagent",
      status: "running",
      isError: false,
      startedAt: Date.now() - 5000,
    },
  ]);
  const subItems = subagentSnapshotToSectionItems(subSnap);
  assert.equal(subItems.length, 1);
  assert.equal(subItems[0]!.name, "researcher");
  assert.equal(subItems[0]!.status, "running");
  assert.ok(subItems[0]!.elapsed);

  // LSP adapter
  const lspOutput = `src/app.ts:10:5: error: ts 1234: bad type`;
  const lspSnap = buildLspSnapshot(lspOutput);
  const lspItems = lspSnapshotToSectionItems(lspSnap);
  assert.equal(lspItems.length, 2, "LSP should produce file group row and diagnostic row");
  assert.equal(lspItems[0]!.kind, "file");
  assert.equal(lspItems[0]!.file, "src/app.ts");
  assert.equal(lspItems[1]!.kind, "diag");
  assert.equal(lspItems[1]!.line, 10);
  assert.equal(lspItems[1]!.message, "bad type");
});

test("brighten and applyHover: bold survives SGR resets", () => {
  const line = "normal \x1b[0m reset \x1b[m";
  const brightened = brighten(line);
  assert.ok(brightened.startsWith("\x1b[22;1m"));
  assert.ok(brightened.includes("\x1b[0m\x1b[22;1m"));
  assert.ok(brightened.includes("\x1b[m\x1b[22;1m"));

  const lines = ["Line 1", "Line 2", "Line 3"];
  const hovered = applyHover(lines, 1, undefined, mockTheme);
  assert.equal(hovered.length, 3);
  assert.equal(hovered[0], "Line 1");
  assert.ok(hovered[1]!.includes("\x1b[1m"), "Hovered row must have bold styling");
  assert.equal(hovered[2], "Line 3");
});
