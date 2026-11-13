import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Theme,
  type ExtensionAPI,
  type ExtensionContext,
  type ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import {
  CleanFooterComponent,
  OMT_FOOTER_OWNER,
  createFooterControl,
  formatActivityDetail,
  formatFooterLine,
  formatTokens,
  sanitizeStatusText,
  type ActivityState,
  type FooterRenderData,
} from "../extensions/omt/features/footer/index.ts";

import { setActiveTheme } from "../extensions/omt/core/theme.ts";
// Generic footer contracts remain on the unchanged Minimal preset.
setActiveTheme("minimal");

// Simple test theme using standard ANSI codes
const testTheme: Theme = {
  fg(color: string, text: string): string {
    const code = color === "dim" ? 8 : color === "muted" ? 7 : color === "accent" ? 6 : color === "warning" ? 3 : color === "error" ? 1 : 15;
    return `\x1b[38;5;${code}m${text}\x1b[0m`;
  },
  bg(_color: string, text: string): string {
    return text;
  },
  bold(text: string): string {
    return `\x1b[1m${text}\x1b[22m`;
  },
  italic(text: string): string {
    return `\x1b[3m${text}\x1b[23m`;
  },
  underline(text: string): string {
    return `\x1b[4m${text}\x1b[24m`;
  },
  inverse(text: string): string {
    return `\x1b[7m${text}\x1b[27m`;
  },
} as unknown as Theme;

test("formatTokens formats token counts cleanly", () => {
  assert.equal(formatTokens(0), "0");
  assert.equal(formatTokens(500), "500");
  assert.equal(formatTokens(999), "999");
  assert.equal(formatTokens(1000), "1.0k");
  assert.equal(formatTokens(2500), "2.5k");
  assert.equal(formatTokens(9900), "9.9k");
  assert.equal(formatTokens(10000), "10k");
  assert.equal(formatTokens(128000), "128k");
  assert.equal(formatTokens(200000), "200k");
  assert.equal(formatTokens(999999), "1000k");
  assert.equal(formatTokens(1000000), "1.0M");
  assert.equal(formatTokens(1500000), "1.5M");
  assert.equal(formatTokens(10000000), "10M");
  assert.equal(formatTokens(-5), "0");
  assert.equal(formatTokens(NaN), "0");
  assert.equal(formatTokens(Infinity), "0");
});

test("sanitizeStatusText removes newlines, tabs, and collapses spaces", () => {
  assert.equal(sanitizeStatusText("  hello   world  "), "hello world");
  assert.equal(sanitizeStatusText("line 1\nline 2\r\nline 3\t"), "line 1 line 2 line 3");
  assert.equal(sanitizeStatusText(""), "");
});

test("formatActivityDetail formats command or path preview cleanly", () => {
  assert.equal(formatActivityDetail("bash", { command: "npm test" }, "/app"), "npm test");
  assert.equal(
    formatActivityDetail("bash", { command: "npm run very-long-command-with-many-arguments" }, "/app"),
    "npm run very-long-comm...",
  );
  assert.equal(
    formatActivityDetail("bash", { command: "line1\nline2" }, "/app"),
    "line1",
  );
  assert.equal(formatActivityDetail("read", { path: "/app/src/index.ts" }, "/app"), "src/index.ts");
  assert.equal(
    formatActivityDetail("read", { path: "/app/very/deeply/nested/path/to/some/source/file.ts" }, "/app"),
    "very/deeply/nested/pat...",
  );
  assert.equal(formatActivityDetail("powershell", { command: "Get-ChildItem -Recurse" }, "/app"), "Get-ChildItem -Recurse");
  assert.equal(formatActivityDetail("search", { query: "find all ts files" }, "/app"), "find all ts files");
  assert.equal(formatActivityDetail("subagent", { task: "refactor test runner" }, "/app"), "refactor test runner");
  assert.equal(formatActivityDetail("other", null, "/app"), undefined);
});

test("formatFooterLine renders full wide layout (120 cols)", () => {
  const data: FooterRenderData = {
    branch: "master",
    extensionStatuses: [],
    activity: { type: "tool", name: "bash", detail: "npm test" },
    contextUsage: { percent: 14.2, contextWindow: 200000 },
    modelId: "fixture-sonnet-35",
    provider: "anthropic",
    hasMultipleProviders: true,
    reasoning: true,
    thinkingLevel: "high",
  };

  const line = formatFooterLine(120, testTheme, data);
  assert.equal(visibleWidth(line), 120);
  assert.ok(line.includes("master"));
  assert.ok(line.includes("bash"));
  assert.ok(line.includes("npm test"));
  assert.ok(line.includes("14%"));
  assert.ok(line.includes("200k"));
  assert.ok(line.includes("fixture-sonnet-35"));
  assert.ok(line.includes("high"));
});

test("formatFooterLine adapts across widths from 120 down to 5 without overflowing", () => {
  const data: FooterRenderData = {
    branch: "feat/cool-feature",
    extensionStatuses: ["Syncing"],
    activity: { type: "tool", name: "read", detail: "src/components/editor.ts" },
    contextUsage: { percent: 75.4, contextWindow: 128000 },
    modelId: "gpt-5.4-preview",
    provider: "openai",
    hasMultipleProviders: true,
    reasoning: true,
    thinkingLevel: "medium",
  };

  for (const width of [120, 100, 80, 60, 45, 30, 20, 10, 5]) {
    const line = formatFooterLine(width, testTheme, data);
    const vw = visibleWidth(line);
    assert.ok(
      vw <= width,
      `Width ${width} overflowed: visibleWidth=${vw}, text="${line}"`,
    );
    assert.ok(line.length > 0);
  }
});

test("formatFooterLine handles quiet idle state without activity icons", () => {
  const data: FooterRenderData = {
    branch: "master",
    extensionStatuses: [],
    activity: undefined, // Idle
    contextUsage: { percent: 5.0, contextWindow: 200000 },
    modelId: "fixture-sonnet-35",
    provider: "anthropic",
    hasMultipleProviders: false,
    reasoning: false,
  };

  const line = formatFooterLine(80, testTheme, data);
  assert.equal(visibleWidth(line), 80);
  assert.ok(!line.includes("●"), "Idle footer should not show activity indicator");
  assert.ok(line.includes("master"));
  assert.ok(line.includes("5%"));
  assert.ok(line.includes("fixture-sonnet-35"));
});

test("formatFooterLine handles detached Git state and no repo", () => {
  const detachedData: FooterRenderData = {
    branch: "detached",
    extensionStatuses: [],
    modelId: "gpt-4o",
  };
  const detachedLine = formatFooterLine(60, testTheme, detachedData);
  assert.ok(detachedLine.includes("detached"));

  const noRepoData: FooterRenderData = {
    branch: null,
    extensionStatuses: [],
    modelId: "gpt-4o",
  };
  const noRepoLine = formatFooterLine(60, testTheme, noRepoData);
  assert.ok(!noRepoLine.includes("⎇"));
  assert.ok(noRepoLine.includes("gpt-4o"));
});

test("formatFooterLine preserves and displays extension statuses", () => {
  const data: FooterRenderData = {
    branch: "main",
    extensionStatuses: ["Alpha Status", "Beta Status"],
    modelId: "fixture-sonnet-35",
  };
  const line = formatFooterLine(80, testTheme, data);
  assert.ok(line.includes("Alpha Status"));
  assert.ok(line.includes("Beta Status"));
});

test("formatFooterLine applies context threshold colors", () => {
  const normalData: FooterRenderData = {
    branch: "main",
    extensionStatuses: [],
    contextUsage: { percent: 30, contextWindow: 200000 },
    modelId: "m",
  };
  const warningData: FooterRenderData = {
    branch: "main",
    extensionStatuses: [],
    contextUsage: { percent: 75, contextWindow: 200000 },
    modelId: "m",
  };
  const errorData: FooterRenderData = {
    branch: "main",
    extensionStatuses: [],
    contextUsage: { percent: 95, contextWindow: 200000 },
    modelId: "m",
  };

  const normalLine = formatFooterLine(80, testTheme, normalData);
  const warningLine = formatFooterLine(80, testTheme, warningData);
  const errorLine = formatFooterLine(80, testTheme, errorData);

  // Check ANSI color codes (dim = 8, warning = 3, error = 1)
  assert.ok(normalLine.includes("\x1b[38;5;8m30%"));
  assert.ok(warningLine.includes("\x1b[38;5;3m75%"));
  assert.ok(errorLine.includes("\x1b[38;5;1m95%"));
});

test("formatFooterLine displays virtual model routing", () => {
  const data: FooterRenderData = {
    branch: "main",
    extensionStatuses: [],
    modelId: "auto",
    routedModelId: "gpt-5.6-luna",
    routedThinkingLevel: "medium",
    reasoning: true,
  };

  const line = formatFooterLine(100, testTheme, data);
  assert.ok(line.includes("auto"));
  assert.ok(line.includes("→"));
  assert.ok(line.includes("gpt-5.6-luna"));
  assert.ok(line.includes("medium"));
});

test("formatFooterLine handles East Asian wide characters and emoji accurately", () => {
  const data: FooterRenderData = {
    branch: "功能分支",
    extensionStatuses: ["✨ 正在运行"],
    activity: { type: "running", detail: "思考中..." },
    contextUsage: { percent: 50, contextWindow: 128000 },
    modelId: "fixture-sonnet-35",
  };

  for (const width of [120, 80, 50, 30, 15]) {
    const line = formatFooterLine(width, testTheme, data);
    const vw = visibleWidth(line);
    assert.ok(vw <= width, `Width ${width} overflowed with wide chars: ${vw}`);
  }
});

test("CleanFooterComponent renders with real Pi Theme instance across terminal widths", () => {
  const realTheme = new Theme(
    {
      dim: "#777777",
      muted: "#aaaaaa",
      text: "#eeeeee",
      warning: "#ffaa00",
      error: "#ff0000",
      accent: "#00aaff",
      toolTitle: "#55aaff",
      thinkingXhigh: "#eeeeee",
    } as unknown as ConstructorParameters<typeof Theme>[0],
    { userMessageBg: "#202020", selectedBg: "#303030" } as unknown as ConstructorParameters<typeof Theme>[1],
    "truecolor",
  );

  const mockTui = {
    requestRender: () => {},
  } as unknown as TUI;

  const mockFooterData: ReadonlyFooterDataProvider = {
    getGitBranch: () => "main",
    getExtensionStatuses: () => new Map([["agent-status", "Thinking..."]]),
    getAvailableProviderCount: () => 2,
    onBranchChange: () => () => {},
  };

  const mockCtx = {
    cwd: "/workspace/project",
    model: { id: "fixture-sonnet-35", provider: "anthropic", contextWindow: 200000, reasoning: true },
    getContextUsage: () => ({ percent: 42.5, contextWindow: 200000 }),
    thinkingLevel: "medium",
  } as unknown as ExtensionContext;

  const activity: ActivityState = {
    type: "tool",
    name: "bash",
    args: { command: "npm run test" },
  };

  const comp = new CleanFooterComponent(
    mockTui,
    realTheme,
    mockFooterData,
    () => mockCtx,
    () => activity,
  );

  for (const width of [120, 80, 50, 30, 15, 8]) {
    const lines = comp.render(width);
    assert.equal(lines.length, 1, `Must render exactly 1 line at width ${width}`);
    const vw = visibleWidth(lines[0]!);
    assert.ok(vw <= width, `Rendered width ${vw} exceeds terminal width ${width}`);
  }
});

test("CleanFooterComponent implements Component and lifecycle", () => {

  let renders = 0;
  const mockTui = {
    requestRender: () => { renders++; },
  } as unknown as TUI;

  let branchCb: (() => void) | undefined;
  let unsubCalled = false;
  const mockFooterData: ReadonlyFooterDataProvider = {
    getGitBranch: () => "master",
    getExtensionStatuses: () => new Map([["key", "Active"]]),
    getAvailableProviderCount: () => 1,
    onBranchChange: (cb) => {
      branchCb = cb;
      return () => { unsubCalled = true; };
    },
  };

  const mockCtx = {
    cwd: "/app",
    model: { id: "test-model", provider: "test", contextWindow: 100000 },
    getContextUsage: () => ({ percent: 20, contextWindow: 100000 }),
    thinkingLevel: "off",
  } as unknown as ExtensionContext;

  let activity: ActivityState | undefined = { type: "running" };

  const comp = new CleanFooterComponent(
    mockTui,
    testTheme,
    mockFooterData,
    () => mockCtx,
    () => activity,
  );

  assert.equal((comp as unknown as Record<symbol, unknown>)[OMT_FOOTER_OWNER], true);

  const lines = comp.render(80);
  assert.equal(lines.length, 1);
  assert.ok(lines[0]!.includes("master"));
  assert.ok(lines[0]!.includes("Active"));

  // Trigger branch change callback
  assert.ok(branchCb);
  branchCb!();
  assert.equal(renders, 1);

  // Invalidate is safe
  comp.invalidate();

  // Dispose cleans up branch listener
  comp.dispose();
  assert.equal(unsubCalled, true);
});

test("createFooterControl provides session-local on/off and yields to foreign footers", () => {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  const mockPi: ExtensionAPI = {
    on(event: string, handler: (...args: unknown[]) => void) {
      listeners[event] = listeners[event] || [];
      listeners[event].push(handler);
      return () => {};
    },
  } as unknown as ExtensionAPI;

  const control = createFooterControl(mockPi);
  assert.equal(control.isEnabled(), true);

  // Unsupported host mode
  const nonTuiCtx = { mode: "rpc", ui: {} } as unknown as ExtensionContext;
  assert.equal(
    control.on(nonTuiCtx),
    "OMT footer unavailable: native footer ownership API required in TUI mode.",
  );
  assert.equal(
    control.off(nonTuiCtx),
    "OMT footer unavailable: native footer ownership API required in TUI mode.",
  );

  // Compatible TUI host
  let currentFooter: unknown = undefined;
  const tuiCtx = {
    mode: "tui",
    cwd: "/app",
    model: { id: "fixture-sonnet-35", provider: "anthropic" },
    getContextUsage: () => ({ percent: 10, contextWindow: 200000 }),
    ui: {
      setFooter: (f: unknown) => { currentFooter = f; },
      getFooterComponent: () => currentFooter,
    },
  } as unknown as ExtensionContext;

  // Enable footer
  const onRes = control.on(tuiCtx);
  assert.equal(onRes, "OMT footer on.");
  assert.notEqual(currentFooter, undefined);

  // Disable footer
  const offRes = control.off(tuiCtx);
  assert.equal(offRes, "OMT footer off (native footer restored).");
  assert.equal(currentFooter, undefined);

  // Re-enable
  control.on(tuiCtx);
  assert.notEqual(currentFooter, undefined);

  // Foreign footer ownership
  const foreignFactory = () => ({ render: () => ["foreign"], invalidate: () => {} });
  tuiCtx.ui.setFooter(foreignFactory);

  // OMT yields when another owner exists
  assert.equal(
    control.on(tuiCtx),
    "OMT footer inactive: another extension owns the footer.",
  );

  // OMT off does not clear foreign footer
  assert.equal(
    control.off(tuiCtx),
    "OMT footer off; other footer left unchanged.",
  );
  assert.equal(currentFooter, foreignFactory);

  // Lifecycle event triggers
  assert.ok(listeners["turn_start"]?.length);
  assert.ok(listeners["tool_execution_start"]?.length);
  listeners["tool_execution_start"]![0]!({ toolName: "bash", args: { command: "ls" } });
  listeners["tool_execution_end"]![0]!();
  listeners["turn_end"]![0]!();

  control.cleanup?.(tuiCtx);
});

test("createFooterControl tracks concurrent tools and suppresses renders when disabled", () => {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  const mockPi: ExtensionAPI = {
    on(event: string, handler: (...args: unknown[]) => void) {
      listeners[event] = listeners[event] || [];
      listeners[event].push(handler);
      return () => {};
    },
    getSettings: () => ({ outputPad: 1 }),
  } as unknown as ExtensionAPI;

  const control = createFooterControl(mockPi);
  let renders = 0;
  const tui = { requestRender: () => { renders++; } } as unknown as TUI;
  let currentFooter: any = undefined;
  const tuiCtx = {
    mode: "tui",
    cwd: "/app",
    model: { id: "test-model" },
    ui: {
      theme: { fg: (_c: string, t: string) => t, bg: (_c: string, t: string) => t },
      setFooter: (f: any) => { currentFooter = f; },
      getFooterComponent: () => currentFooter,
    },
  } as unknown as ExtensionContext;

  control.on(tuiCtx);
  const comp = currentFooter(tui, tuiCtx.ui.theme, { getGitBranch: () => "main" });

  listeners["turn_start"]![0]!();
  assert.equal(renders, 1);
  assert.ok(comp.render(80)[0].includes("running"));

  // Start tool 1
  listeners["tool_execution_start"]![0]!({ toolCallId: "call-1", toolName: "read", args: { path: "a.ts" } });
  assert.equal(renders, 2);
  assert.ok(comp.render(80)[0].includes("read"));

  // Start tool 2 concurrently
  listeners["tool_execution_start"]![0]!({ toolCallId: "call-2", toolName: "bash", args: { command: "test" } });
  assert.equal(renders, 3);
  assert.ok(comp.render(80)[0].includes("bash"));

  // Tool 2 ends first; tool 1 is still active
  listeners["tool_execution_end"]![0]!({ toolCallId: "call-2", toolName: "bash" });
  assert.equal(renders, 4);
  assert.ok(comp.render(80)[0].includes("read"), "footer still shows remaining active tool");

  // Tool 1 ends; transitions to running
  listeners["tool_execution_end"]![0]!({ toolCallId: "call-1", toolName: "read" });
  assert.equal(renders, 5);
  assert.ok(comp.render(80)[0].includes("running"), "transitions to running when all tools complete");

  // Turn ends; idle
  listeners["turn_end"]![0]!();
  assert.equal(renders, 6);
  assert.ok(!comp.render(80)[0].includes("running"));

  // Disable footer: subsequent events must not request renders
  control.off(tuiCtx);
  const rendersBefore = renders;
  listeners["turn_start"]![0]!();
  listeners["tool_execution_start"]![0]!({ toolCallId: "call-3", toolName: "bash" });
  listeners["tool_execution_end"]![0]!({ toolCallId: "call-3" });
  listeners["turn_end"]![0]!();
  assert.equal(renders, rendersBefore, "no render requests when footer is disabled");

  control.cleanup?.(tuiCtx);
  comp.dispose();
});
