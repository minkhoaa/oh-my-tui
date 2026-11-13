import assert from "node:assert/strict";
import { test } from "node:test";
import {
  initTheme,
  createReadToolDefinition,
  ToolExecutionComponent,
  type ExtensionAPI,
  type ToolRenderers,
  type AgentToolResult,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import {
  createCleanBashRenderer,
  createCleanCustomToolRenderer,
  createCleanEditRenderer,
  createCleanReadRenderer,
  createCleanWriteRenderer,
  createToolsControl,
  determineToolState,
  formatCustomCallDetail,
  formatDisplayPath,
  formatDuration,
  OMT_TOOL_OWNER,
  summarizeDiff,
} from "../extensions/omt/features/tools/index.ts";

import { setActiveTheme } from "../extensions/omt/core/theme.ts";

// Retain the original generic renderer contract on Minimal; faithful presets have separate tests.
initTheme("dark");
setActiveTheme("minimal");

const dummyUi = { requestRender() {} } as unknown as TUI;

function makeResult(content: Array<{ type: "text"; text: string }>, details: any = undefined, isError = false): AgentToolResult {
  return { content, details, isError };
}

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    args: {},
    toolCallId: "call_test",
    invalidate: () => {},
    lastComponent: undefined,
    state: {},
    cwd: "/workspace/my-project",
    executionStarted: true,
    argsComplete: true,
    isPartial: false,
    expanded: false,
    showImages: true,
    isError: false,
    durationMs: 150,
    outputPad: 1,
    keyText: () => "ctrl+o",
    keyHint: (_k: string, desc: string) => `ctrl+o ${desc}`,
    ...overrides,
  } as unknown as Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];
}

// ============================================================================
// Unit Tests: Helpers
// ============================================================================

test("determineToolState distinguishes running, success, failure, and interrupted", () => {
  assert.equal(determineToolState(true, false), "running");
  assert.equal(determineToolState(false, false), "success");
  assert.equal(determineToolState(false, true), "failure");

  // Interrupted by abort/cancel in details
  assert.equal(determineToolState(false, true, { content: [], details: { interrupted: true } }), "interrupted");
  assert.equal(determineToolState(false, true, { content: [], details: { exitCode: 130 } }), "interrupted");

  // Interrupted by text output
  assert.equal(determineToolState(false, true, undefined, "Command aborted"), "interrupted");
  assert.equal(determineToolState(false, true, undefined, "Operation cancelled by user"), "interrupted");
  assert.equal(determineToolState(false, true, undefined, "Process interrupted by SIGINT"), "interrupted");
});

test("formatDuration formats milliseconds below 1s and seconds above", () => {
  assert.equal(formatDuration(0), "0ms");
  assert.equal(formatDuration(50), "50ms");
  assert.equal(formatDuration(999), "999ms");
  assert.equal(formatDuration(1000), "1.0s");
  assert.equal(formatDuration(2450), "2.5s");
});

test("formatDisplayPath relativizes paths to cwd or shortens home path", () => {
  assert.equal(formatDisplayPath("/workspace/my-project/src/index.ts", "/workspace/my-project"), "src/index.ts");
  assert.equal(formatDisplayPath("src/utils.ts", "/workspace/my-project"), "src/utils.ts");
  assert.equal(formatDisplayPath(undefined, "/workspace/my-project"), "(unknown path)");
});

test("summarizeDiff parses unified and edit diffs accurately", () => {
  const unified = `--- a/file.ts\n+++ b/file.ts\n@@ -1,5 +1,6 @@\n const a = 1;\n-const b = 2;\n+const b = 20;\n+const c = 30;\n@@ -10,3 +11,2 @@\n-old line;\n context;`;
  const sumUnified = summarizeDiff(unified);
  assert.equal(sumUnified.additions, 2);
  assert.equal(sumUnified.deletions, 2);
  assert.equal(sumUnified.chunks, 2);

  const editDiff = ` 1 line 1\n-2 line 2 old\n+2 line 2 new\n 3 line 3`;
  const sumEdit = summarizeDiff(editDiff);
  assert.equal(sumEdit.additions, 1);
  assert.equal(sumEdit.deletions, 1);
  assert.equal(sumEdit.chunks, 1);
});

// ============================================================================
// Unit Tests: Renderers (read, write, edit, bash)
// ============================================================================

test("read renderer renders running, collapsed success, expanded success, error and interrupted", () => {
  const renderer = createCleanReadRenderer();
  assert.equal(renderer.renderShell, "self");

  const cwd = "/workspace/my-project";
  const dummyTheme = {
    fg: (_token: string, text: string) => text,
    bold: (text: string) => text,
  } as unknown as Parameters<NonNullable<ToolRenderers["renderCall"]>>[1];

  // 1. Running state
  const runCtx = makeContext({ isPartial: true, cwd });
  const runCall = renderer.renderCall!({ path: "src/index.ts" }, dummyTheme, runCtx);
  assert.ok(stripTerminalSequences(runCall.render(80).join("")).includes("· read src/index.ts"));
  const runRes = renderer.renderResult!(makeResult([]), { expanded: false, isPartial: true }, dummyTheme, runCtx);
  assert.ok(stripTerminalSequences(runRes.render(80).join("")).includes("reading..."));

  // 2. Success state (collapsed)
  const succCtx = makeContext({ isPartial: false, isError: false, durationMs: 45, cwd });
  const succCall = renderer.renderCall!({ path: "src/index.ts", offset: 1, limit: 20 }, dummyTheme, succCtx);
  const callText = stripTerminalSequences(succCall.render(80).join(""));
  assert.ok(callText.includes("+ read src/index.ts"));
  assert.ok(callText.includes(":1-20"));
  assert.ok(callText.includes("(45ms)"));

  const fileContent = "const x = 1;\nconst y = 2;\nconsole.log(x + y);";
  const succRes = renderer.renderResult!(
    makeResult([{ type: "text", text: fileContent }]),
    { expanded: false, isPartial: false },
    dummyTheme,
    succCtx,
  );
  const resText = stripTerminalSequences(succRes.render(80).join(""));
  assert.ok(resText.includes("3 lines"));
  assert.ok(resText.includes("ctrl+o to expand"));

  // 3. Success state (expanded)
  const expRes = renderer.renderResult!(
    makeResult([{ type: "text", text: fileContent }]),
    { expanded: true, isPartial: false },
    dummyTheme,
    makeContext({ args: { path: "src/index.ts" }, isPartial: false, isError: false, cwd }),
  );
  const expLines = expRes.render(80).map(stripTerminalSequences);
  assert.ok(expLines.some((l) => l.includes("const x = 1;")));

  // Missing args in context handled defensively
  const expResNoArgs = renderer.renderResult!(
    makeResult([{ type: "text", text: fileContent }]),
    { expanded: true, isPartial: false },
    dummyTheme,
    makeContext({ args: undefined, isPartial: false, isError: false, cwd }),
  );
  assert.ok(expResNoArgs.render(80).length > 0);
  assert.ok(expLines.some((l) => l.includes("console.log(x + y);")));

  // 4. Failure state
  const errCtx = makeContext({ isError: true, cwd });
  const errCall = renderer.renderCall!({ path: "src/missing.ts" }, dummyTheme, errCtx);
  assert.ok(stripTerminalSequences(errCall.render(80).join("")).includes("- read src/missing.ts"));
  const errRes = renderer.renderResult!(
    makeResult([{ type: "text", text: "ENOENT: no such file" }], undefined, true),
    { expanded: false, isPartial: false },
    dummyTheme,
    errCtx,
  );
  assert.ok(stripTerminalSequences(errRes.render(80).join("")).includes("Error: ENOENT: no such file"));

  // 5. Interrupted state
  const intCtx = makeContext({ isError: true, cwd });
  const intRes = renderer.renderResult!(
    makeResult([{ type: "text", text: "Command aborted" }], undefined, true),
    { expanded: false, isPartial: false },
    dummyTheme,
    intCtx,
  );
  assert.ok(stripTerminalSequences(intRes.render(80).join("")).includes("! Read aborted"));
});

test("write renderer renders running, collapsed success, expanded success, error and interrupted", () => {
  const renderer = createCleanWriteRenderer();
  assert.equal(renderer.renderShell, "self");

  const cwd = "/workspace/my-project";
  const dummyTheme = {
    fg: (_token: string, text: string) => text,
    bold: (text: string) => text,
  } as unknown as Parameters<NonNullable<ToolRenderers["renderCall"]>>[1];

  // 1. Running state with streaming lines
  const runCtx = makeContext({ isPartial: true, cwd });
  const runCall = renderer.renderCall!({ path: "src/new.ts", content: "line 1\nline 2\nline 3" }, dummyTheme, runCtx);
  assert.ok(stripTerminalSequences(runCall.render(80).join("")).includes("· write src/new.ts (3 lines...)"));

  // 2. Success state (collapsed)
  const succCtx = makeContext({
    args: { path: "src/new.ts", content: "line 1\nline 2" },
    isPartial: false,
    isError: false,
    durationMs: 80,
    cwd,
  });
  const succCall = renderer.renderCall!({ path: "src/new.ts", content: "line 1\nline 2" }, dummyTheme, succCtx);
  assert.ok(stripTerminalSequences(succCall.render(80).join("")).includes("+ write src/new.ts (80ms)"));
  const succRes = renderer.renderResult!(
    makeResult([{ type: "text", text: "Successfully wrote" }]),
    { expanded: false, isPartial: false },
    dummyTheme,
    succCtx,
  );
  assert.ok(stripTerminalSequences(succRes.render(80).join("")).includes("Wrote 2 lines"));

  // 3. Success state (expanded)
  const expRes = renderer.renderResult!(
    makeResult([{ type: "text", text: "Successfully wrote" }]),
    { expanded: true, isPartial: false },
    dummyTheme,
    succCtx,
  );
  const expText = stripTerminalSequences(expRes.render(80).join(""));
  assert.ok(expText.includes("line 1"));
  assert.ok(expText.includes("line 2"));

  // 4. Failure state
  const errCtx = makeContext({ isError: true, cwd });
  const errRes = renderer.renderResult!(
    makeResult([{ type: "text", text: "EACCES: permission denied" }], undefined, true),
    { expanded: false, isPartial: false },
    dummyTheme,
    errCtx,
  );
  assert.ok(stripTerminalSequences(errRes.render(80).join("")).includes("Error: EACCES: permission denied"));
});

test("edit renderer renders clean diff summaries and expanded intraline diffs", () => {
  const renderer = createCleanEditRenderer();
  assert.equal(renderer.renderShell, "self");

  const cwd = "/workspace/my-project";
  const dummyTheme = {
    fg: (_token: string, text: string) => text,
    bold: (text: string) => text,
  } as unknown as Parameters<NonNullable<ToolRenderers["renderCall"]>>[1];

  // 1. Call header with multiple edits
  const editCtx = makeContext({ isPartial: false, isError: false, durationMs: 120, cwd });
  const editCall = renderer.renderCall!({ path: "src/app.ts", edits: [{ oldText: "a", newText: "b" }, { oldText: "c", newText: "d" }] }, dummyTheme, editCtx);
  const callText = stripTerminalSequences(editCall.render(80).join(""));
  assert.ok(callText.includes("+ edit src/app.ts"));
  assert.ok(callText.includes("(2 edits)"));

  // 2. Collapsed diff summary
  const diffString = " 1 a = 1;\n-2 b = 2;\n+2 b = 20;\n+3 c = 30;\n 4 d = 4;";
  const resCollapsed = renderer.renderResult!(
    { content: [], details: { diff: diffString } },
    { expanded: false, isPartial: false },
    dummyTheme,
    editCtx,
  );
  const collText = stripTerminalSequences(resCollapsed.render(80).join(""));
  assert.ok(collText.includes("+2 -1 lines"));
  assert.ok(collText.includes("ctrl+o to expand"));

  // 3. Expanded full diff
  const resExpanded = renderer.renderResult!(
    { content: [], details: { diff: diffString } },
    { expanded: true, isPartial: false },
    dummyTheme,
    editCtx,
  );
  const expLines = resExpanded.render(80).map(stripTerminalSequences);
  assert.ok(expLines.some((l) => l.includes("-2 b = 2;")));
  assert.ok(expLines.some((l) => l.includes("+2 b = 20;")));
});

test("bash renderer handles short outputs, long outputs, previews, errors and interruption", () => {
  const renderer = createCleanBashRenderer();
  assert.equal(renderer.renderShell, "self");

  const dummyTheme = {
    fg: (_token: string, text: string) => text,
    bold: (text: string) => text,
  } as unknown as Parameters<NonNullable<ToolRenderers["renderCall"]>>[1];

  // 1. Short output (<= 5 lines) shows all lines cleanly
  const shortCtx = makeContext({ args: { command: "npm test" }, durationMs: 250 });
  const shortCall = renderer.renderCall!({ command: "npm test" }, dummyTheme, shortCtx);
  assert.ok(stripTerminalSequences(shortCall.render(80).join("")).includes("+ bash npm test (250ms)"));
  const shortRes = renderer.renderResult!(
    makeResult([{ type: "text", text: "pass 1\npass 2\npass 3" }]),
    { expanded: false, isPartial: false },
    dummyTheme,
    shortCtx,
  );
  const shortLines = shortRes.render(80).map(stripTerminalSequences);
  assert.equal(shortLines.length, 3);
  assert.ok(shortLines[0]!.includes("pass 1"));

  // 2. Long output (> 5 lines, collapsed) shows last 5 lines + earlier lines hint
  const longOutput = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
  const longCtx = makeContext({ args: { command: "npm run build" } });
  const longResCollapsed = renderer.renderResult!(
    makeResult([{ type: "text", text: longOutput }]),
    { expanded: false, isPartial: false },
    dummyTheme,
    longCtx,
  );
  const collText = stripTerminalSequences(longResCollapsed.render(80).join("\n"));
  assert.ok(collText.includes("... (15 earlier lines)"));
  assert.ok(collText.includes("line 20"));
  assert.ok(!collText.includes("line 1\n")); // earlier lines hidden

  // 3. Long output (expanded) shows all 20 lines
  const longResExpanded = renderer.renderResult!(
    makeResult([{ type: "text", text: longOutput }]),
    { expanded: true, isPartial: false },
    dummyTheme,
    longCtx,
  );
  const expLines = longResExpanded.render(80).map(stripTerminalSequences);
  assert.equal(expLines.length, 20);
  assert.ok(expLines[0]!.includes("line 1"));
  assert.ok(expLines[19]!.includes("line 20"));

  // 4. Failure state with exit code
  const errCtx = makeContext({ isError: true });
  const errRes = renderer.renderResult!(
    makeResult([{ type: "text", text: "SyntaxError: Unexpected token" }], { exitCode: 1 }, true),
    { expanded: false, isPartial: false },
    dummyTheme,
    errCtx,
  );
  const errText = stripTerminalSequences(errRes.render(80).join("\n"));
  assert.ok(errText.includes("Exit code 1"));
  assert.ok(errText.includes("SyntaxError: Unexpected token"));

  // 5. Interrupted state
  const intCtx = makeContext({ isError: true });
  const intRes = renderer.renderResult!(
    makeResult([{ type: "text", text: "Building...\nCommand aborted" }], { exitCode: 130 }, true),
    { expanded: false, isPartial: false },
    dummyTheme,
    intCtx,
  );
  assert.ok(stripTerminalSequences(intRes.render(80).join("\n")).includes("! Command interrupted"));
});

// ============================================================================
// Interactive TUI & Component Integration
// ============================================================================

test("ToolExecutionComponent toggles expanded and collapsed on click or setExpanded", () => {
  const readRenderer = createCleanReadRenderer();
  const fileContent = Array.from({ length: 15 }, (_, i) => `row ${i}`).join("\n");
  const comp = new ToolExecutionComponent(
    "read",
    "call_read_1",
    { path: "src/data.txt" },
    {},
    readRenderer,
    dummyUi,
    "/workspace",
  );

  comp.updateResult({ content: [{ type: "text", text: fileContent }], isError: false });

  // Initially collapsed
  const collapsedLines = comp.render(80).map(stripTerminalSequences);
  assert.ok(collapsedLines.some((l) => l.includes("15 lines")));
  assert.ok(!collapsedLines.some((l) => l.includes("row 14")));

  // Click on line 1 to expand
  const mouseHandled = comp.handleMouse({
    type: "click",
    button: "left",
    x: 5,
    y: 1,
    screenX: 5,
    screenY: 1,
    width: 80,
    height: 5,
    shift: false,
    alt: false,
    ctrl: false,
  });
  assert.equal(mouseHandled?.handled, true);

  const expandedLines = comp.render(80).map(stripTerminalSequences);
  assert.ok(expandedLines.some((l) => l.includes("row 14")));

  // setExpanded(false) collapses again
  comp.setExpanded(false);
  const reCollapsedLines = comp.render(80).map(stripTerminalSequences);
  assert.ok(reCollapsedLines.some((l) => l.includes("15 lines")));
  assert.ok(!reCollapsedLines.some((l) => l.includes("row 14")));
});

test("handles terminal widths from 120 down to narrow widths without crashing or overflowing", () => {
  const bashRenderer = createCleanBashRenderer();
  const comp = new ToolExecutionComponent(
    "bash",
    "call_bash_w",
    { command: "npm test -- --coverage --verbose --watchAll=false" },
    {},
    bashRenderer,
    dummyUi,
    "/workspace",
  );

  comp.updateResult({
    content: [{ type: "text", text: "PASS test/app.test.ts\nTests: 15 passed, 15 total" }],
    isError: false,
  });

  for (const width of [120, 80, 40, 20, 8]) {
    const lines = comp.render(width);
    assert.ok(lines.length > 0);
    for (const line of lines) {
      assert.ok(visibleWidth(line) <= width, `visibleWidth <= ${width}`);
    }
  }
});

test("handles multiline text, Unicode, and emoji cleanly", () => {
  const readRenderer = createCleanReadRenderer();
  const unicodeContent = "你好 👩🏽‍💻 🇻🇳 e\u0301\nLine 2 with emojis 🚀✨\nLine 3";
  const comp = new ToolExecutionComponent(
    "read",
    "call_uni",
    { path: "src/unicode-你好.ts" },
    {},
    readRenderer,
    dummyUi,
    "/workspace",
  );

  comp.updateResult({ content: [{ type: "text", text: unicodeContent }], isError: false });

  for (const width of [80, 40, 25]) {
    const lines = comp.render(width);
    for (const line of lines) {
      assert.ok(visibleWidth(line) <= width, `Unicode fits at width ${width}`);
    }
  }
});

// ============================================================================
// Controls & Fallbacks
// ============================================================================

test("createToolsControl registers resolver, toggles on/off and yields to unknown tools", () => {
  let registeredResolver: Parameters<ExtensionAPI["registerToolRenderer"]>[0] | undefined;
  const mockPi = {
    registerToolRenderer: (fn) => {
      registeredResolver = fn;
    },
  } as ExtensionAPI;

  const control = createToolsControl(mockPi);
  assert.ok(registeredResolver);
  assert.equal(control.isEnabled(), true);

  // 1. Resolves clean renderers for read, write, edit, bash when enabled
  const baseDef = createReadToolDefinition(process.cwd()) as unknown as ToolRenderers;
  const resolvedRead = registeredResolver!("read", () => baseDef);
  assert.notEqual(resolvedRead, baseDef);
  assert.equal(resolvedRead?.renderShell, "self");
  assert.ok((resolvedRead as unknown as Record<symbol, unknown>)[OMT_TOOL_OWNER]);

  // 2. Unknown tools yield to baseDef
  const resolvedGrep = registeredResolver!("grep", () => baseDef);
  assert.equal(resolvedGrep, baseDef);

  const resolvedCustom = registeredResolver!("my_custom_tool", () => baseDef);
  assert.equal(resolvedCustom, baseDef);

  // 3. Toggling off yields all tools to baseDef
  assert.equal(control.off(), "OMT tools off (native rendering).");
  assert.equal(control.isEnabled(), false);
  assert.equal(registeredResolver!("read", () => baseDef), baseDef);
  assert.equal(registeredResolver!("bash", () => baseDef), baseDef);

  // 4. Toggling on re-enables clean tools
  assert.equal(control.on(), "OMT tools on.");
  assert.equal(control.isEnabled(), true);
  assert.equal(registeredResolver!("read", () => baseDef)?.renderShell, "self");

  // 5. Cleanup disables tools
  control.cleanup?.();
  assert.equal(control.isEnabled(), false);
  assert.equal(registeredResolver!("read", () => baseDef), baseDef);
});

test("yields to arbitrary foreign tool renderers without private ownership markers", () => {
  let registeredResolver: Parameters<ExtensionAPI["registerToolRenderer"]>[0] | undefined;
  const mockPi = {
    registerToolRenderer: (fn) => {
      registeredResolver = fn;
    },
  } as ExtensionAPI;

  createToolsControl(mockPi);

  const foreignDef = {
    renderCall: () => null,
  } as unknown as ToolRenderers;

  const resolved = registeredResolver!("read", () => foreignDef);
  assert.equal(resolved, foreignDef, "must yield to another extension owner");
});

test("reports unavailable when registerToolRenderer API is not available", () => {
  const mockPi = {} as ExtensionAPI;
  const control = createToolsControl(mockPi);
  assert.match(control.on(), /unavailable/);
  assert.match(control.off(), /unavailable/);
  assert.equal(control.isEnabled(), false);
});

// ============================================================================
// M10: State Synchronization & Custom Tools
// ============================================================================

test("call header synchronously updates to interrupted glyph on interrupted result", () => {
  const dummyTheme = {
    fg: (_token: string, text: string) => text,
    bold: (text: string) => text,
  } as unknown as Parameters<NonNullable<ToolRenderers["renderCall"]>>[1];

  const renderer = createCleanBashRenderer();
  const sharedState = {};
  const runCtx = makeContext({ state: sharedState, isPartial: true, isError: false });

  // 1. Initially running
  const callComp = renderer.renderCall!({ command: "npm test" }, dummyTheme, runCtx);
  assert.ok(stripTerminalSequences(callComp.render(80).join("")).includes("· bash npm test"));

  // 2. Interrupted result arrives
  const intCtx = makeContext({ state: sharedState, isPartial: false, isError: true });
  const resultComp = renderer.renderResult!(
    makeResult([{ type: "text", text: "Cancelled" }], { interrupted: true, exitCode: 130 }, true),
    { expanded: false, isPartial: false },
    dummyTheme,
    intCtx,
  );

  // Result displays interrupted line
  assert.ok(stripTerminalSequences(resultComp.render(80).join("")).includes("! Command interrupted"));

  // Call header is synchronized to interrupted glyph
  assert.ok(stripTerminalSequences(callComp.render(80).join("")).includes("! bash npm test"));
});

test("ToolExecutionComponent renders unified interrupted state across header and result", () => {
  const bashRenderer = createCleanBashRenderer();
  const comp = new ToolExecutionComponent(
    "bash",
    "call_int_sync",
    { command: "python script.py" },
    {},
    bashRenderer,
    dummyUi,
    "/workspace",
  );

  comp.markExecutionStarted();
  comp.updateResult(
    { content: [{ type: "text", text: "Processing...\nAborted" }], details: { exitCode: 130, interrupted: true }, isError: true },
    false,
  );

  const lines = comp.render(80).map(stripTerminalSequences);
  // Header line must have Minimal's interrupted glyph !
  assert.ok(lines.some((l) => l.includes("! bash python script.py")), "header must have interrupted glyph");
  // Result must have interrupted status
  assert.ok(lines.some((l) => l.includes("! Command interrupted")), "result must have interrupted text");
});

test("formatCustomCallDetail extracts concise preview from varied argument shapes", () => {
  const cwd = "/workspace/project";
  // Path argument
  assert.equal(formatCustomCallDetail({ path: "/workspace/project/src/index.ts" }, cwd), "src/index.ts");
  // Command argument
  assert.equal(formatCustomCallDetail({ command: "git status --porcelain" }, cwd), "git status --porcelain");
  // Query argument
  assert.equal(formatCustomCallDetail({ query: "how to use pi" }, cwd), '"how to use pi"');
  // Task argument
  assert.equal(formatCustomCallDetail({ task: "run tests and fix failures" }, cwd), "run tests and fix failures");
  // Pattern argument
  assert.equal(formatCustomCallDetail({ pattern: "export const" }, cwd), "/export const/");
  // Generic key-value
  assert.equal(formatCustomCallDetail({ action: "inspect", count: 5 }, cwd), 'action="inspect"');
  // Empty or non-object arguments
  assert.equal(formatCustomCallDetail({}, cwd), "");
  assert.equal(formatCustomCallDetail(null, cwd), "");
  assert.equal(formatCustomCallDetail(undefined, cwd), "");
});

test("createCleanCustomToolRenderer renders running, collapsed, expanded, error, and interrupted states", () => {
  const renderer = createCleanCustomToolRenderer("search");
  assert.equal(renderer.renderShell, "self");
  assert.ok((renderer as unknown as Record<symbol, unknown>)[OMT_TOOL_OWNER]);

  const dummyTheme = {
    fg: (_token: string, text: string) => text,
    bold: (text: string) => text,
  } as unknown as Parameters<NonNullable<ToolRenderers["renderCall"]>>[1];

  // 1. Running state
  const runCtx = makeContext({ isPartial: true });
  const runCall = renderer.renderCall!({ query: "pi extensions" }, dummyTheme, runCtx);
  assert.ok(stripTerminalSequences(runCall.render(80).join("")).includes('· search "pi extensions"'));
  const runRes = renderer.renderResult!(makeResult([]), { expanded: false, isPartial: true }, dummyTheme, runCtx);
  assert.ok(stripTerminalSequences(runRes.render(80).join("")).includes("executing..."));

  // 2. Success state (collapsed)
  const succCtx = makeContext({ isPartial: false, isError: false, durationMs: 200 });
  const succCall = renderer.renderCall!({ query: "pi extensions" }, dummyTheme, succCtx);
  assert.ok(stripTerminalSequences(succCall.render(80).join("")).includes('+ search "pi extensions" (200ms)'));

  const jsonResult = JSON.stringify({ results: [{ title: "Ext A" }, { title: "Ext B" }] }, null, 2);
  const succRes = renderer.renderResult!(
    makeResult([{ type: "text", text: jsonResult }]),
    { expanded: false, isPartial: false },
    dummyTheme,
    succCtx,
  );
  const succText = stripTerminalSequences(succRes.render(80).join(""));
  assert.ok(succText.includes("lines"));
  assert.ok(succText.includes("ctrl+o to expand"));

  // 3. Success state (expanded with JSON syntax highlighting)
  const expRes = renderer.renderResult!(
    makeResult([{ type: "text", text: jsonResult }]),
    { expanded: true, isPartial: false },
    dummyTheme,
    succCtx,
  );
  const expLines = expRes.render(80).map(stripTerminalSequences);
  assert.ok(expLines.some((l) => l.includes("Ext A")));

  // 4. Failure state
  const errCtx = makeContext({ isError: true });
  const errRes = renderer.renderResult!(
    makeResult([{ type: "text", text: "Rate limit exceeded" }], undefined, true),
    { expanded: false, isPartial: false },
    dummyTheme,
    errCtx,
  );
  assert.ok(stripTerminalSequences(errRes.render(80).join("")).includes("Error: Rate limit exceeded"));

  // 5. Interrupted state
  const intCtx = makeContext({ isError: true });
  const intRes = renderer.renderResult!(
    makeResult([{ type: "text", text: "Searching aborted" }], { interrupted: true }, true),
    { expanded: false, isPartial: false },
    dummyTheme,
    intCtx,
  );
  assert.ok(stripTerminalSequences(intRes.render(80).join("")).includes("! search aborted"));
});

test("createToolsControl registers custom tools and resolves them when enabled", () => {
  let registeredResolver: Parameters<ExtensionAPI["registerToolRenderer"]>[0] | undefined;
  const mockPi = {
    registerToolRenderer: (fn) => {
      registeredResolver = fn;
    },
  } as ExtensionAPI;

  const control = createToolsControl(mockPi);
  assert.ok(registeredResolver);

  // Register custom tool
  control.registerCustomTool?.("subagent", {
    name: "subagent",
    runningText: "delegating...",
  });

  // Resolves registered custom tool when downstream is undefined
  const resolved = registeredResolver!("subagent", () => undefined as any);
  assert.notEqual(resolved, undefined);
  assert.equal(resolved?.renderShell, "self");
  assert.ok((resolved as unknown as Record<symbol, unknown>)[OMT_TOOL_OWNER]);

  // Still yields when foreign renderer is present
  const foreignRenderer = { renderCall: () => null } as unknown as ToolRenderers;
  const foreignResolved = registeredResolver!("subagent", () => foreignRenderer);
  assert.equal(foreignResolved, foreignRenderer, "must yield to foreign custom renderer");
});

