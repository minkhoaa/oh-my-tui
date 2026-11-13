import assert from "node:assert/strict";
import { test } from "node:test";
import { initTheme, InteractiveMode, type Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth, type TUI, type KeybindingsManager } from "@earendil-works/pi-tui";
import {
  createToolInspectorComponent,
  extractSessionToolCalls,
  formatToolSummary,
  parseDiffHunks,
  copyToolContent,
  ToolInspectorComponent,
} from "../extensions/omt/features/tool-inspector/index.ts";
import type { InspectedToolCall } from "../extensions/omt/features/tool-inspector/types.ts";

initTheme("dark");
const defaultTheme = (InteractiveMode.prototype as any).createExtensionUIContext.call({}).theme as Theme;

const dummyTui = {
  requestRender: () => {},
} as unknown as TUI;

const dummyKeybindings = {} as KeybindingsManager;

function makeMockTheme() {
  return {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
    italic: (text: string) => text,
    underline: (text: string) => text,
    inverse: (text: string) => text,
    dim: (text: string) => text,
  };
}

// ============================================================================
// 1. extractSessionToolCalls Tests
// ============================================================================

test("extractSessionToolCalls extracts read, write, edit, bash, and error tool calls", () => {
  const sessionManager = {
    getEntries: () => [
      // 1. read call and result
      {
        type: "message",
        id: "msg_1",
        timestamp: "2025-01-01T10:00:00.000Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "call_read_1",
              name: "read",
              arguments: { path: "src/index.ts" },
            },
          ],
        },
      },
      {
        type: "message",
        id: "msg_2",
        timestamp: "2025-01-01T10:00:00.100Z",
        message: {
          role: "toolResult",
          toolCallId: "call_read_1",
          toolName: "read",
          content: [{ type: "text", text: "import { app } from './app';\napp.start();" }],
          isError: false,
          durationMs: 45,
        },
      },
      // 2. edit call and result
      {
        type: "message",
        id: "msg_3",
        timestamp: "2025-01-01T10:00:01.000Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "call_edit_1",
              name: "edit",
              arguments: { path: "src/index.ts" },
            },
          ],
        },
      },
      {
        type: "message",
        id: "msg_4",
        timestamp: "2025-01-01T10:00:01.200Z",
        message: {
          role: "toolResult",
          toolCallId: "call_edit_1",
          toolName: "edit",
          content: [
            {
              type: "text",
              text: "@@ -1,2 +1,2 @@\n-import { app } from './app';\n+import { app, config } from './app';",
            },
          ],
          isError: false,
          durationMs: 80,
        },
      },
      // 3. write call and result
      {
        type: "message",
        id: "msg_5",
        timestamp: "2025-01-01T10:00:02.000Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "call_write_1",
              name: "write",
              arguments: { path: "src/config.ts", content: "export const config = {};" },
            },
          ],
        },
      },
      {
        type: "message",
        id: "msg_6",
        timestamp: "2025-01-01T10:00:02.050Z",
        message: {
          role: "toolResult",
          toolCallId: "call_write_1",
          toolName: "write",
          content: [{ type: "text", text: "Wrote 25 bytes to src/config.ts" }],
          isError: false,
          durationMs: 15,
        },
      },
      // 4. bash execution message (success)
      {
        type: "message",
        id: "msg_7",
        timestamp: "2025-01-01T10:00:03.000Z",
        message: {
          role: "bashExecution",
          command: "npm test",
          output: "✔ 10 tests passed",
          exitCode: 0,
          cancelled: false,
          durationMs: 520,
        },
      },
      // 5. read call that failed (error)
      {
        type: "message",
        id: "msg_8",
        timestamp: "2025-01-01T10:00:04.000Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "call_read_fail",
              name: "read",
              arguments: { path: "missing.json" },
            },
          ],
        },
      },
      {
        type: "message",
        id: "msg_9",
        timestamp: "2025-01-01T10:00:04.020Z",
        message: {
          role: "toolResult",
          toolCallId: "call_read_fail",
          toolName: "read",
          content: [{ type: "text", text: "Error: ENOENT: no such file missing.json" }],
          isError: true,
          durationMs: 10,
        },
      },
      // 6. bash execution message that failed
      {
        type: "message",
        id: "msg_10",
        timestamp: "2025-01-01T10:00:05.000Z",
        message: {
          role: "bashExecution",
          command: "exit 1",
          output: "Command failed with exit code 1",
          exitCode: 1,
          cancelled: false,
          durationMs: 30,
        },
      },
      // 7. interrupted tool call
      {
        type: "message",
        id: "msg_11",
        timestamp: "2025-01-01T10:00:06.000Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "call_interrupted",
              name: "bash",
              arguments: { command: "sleep 100" },
            },
          ],
        },
      },
      {
        type: "message",
        id: "msg_12",
        timestamp: "2025-01-01T10:00:07.000Z",
        message: {
          role: "toolResult",
          toolCallId: "call_interrupted",
          toolName: "bash",
          content: [{ type: "text", text: "command interrupted" }],
          details: { interrupted: true },
          isError: false,
        },
      },
    ],
  };

  const tools = extractSessionToolCalls(sessionManager);
  assert.equal(tools.length, 7);

  // 1. read
  assert.equal(tools[0]!.name, "read");
  assert.equal((tools[0]!.args as any).path, "src/index.ts");
  assert.equal(tools[0]!.outcome, "success");
  assert.equal(tools[0]!.isError, false);
  assert.equal(tools[0]!.durationMs, 45);
  assert.match(tools[0]!.result!, /import { app }/);

  // 2. edit
  assert.equal(tools[1]!.name, "edit");
  assert.equal((tools[1]!.args as any).path, "src/index.ts");
  assert.equal(tools[1]!.outcome, "success");
  assert.match(tools[1]!.result!, /@@ -1,2 \+1,2 @@/);

  // 3. write
  assert.equal(tools[2]!.name, "write");
  assert.equal((tools[2]!.args as any).path, "src/config.ts");
  assert.equal(tools[2]!.outcome, "success");

  // 4. bash success
  assert.equal(tools[3]!.name, "bash");
  assert.equal((tools[3]!.args as any).command, "npm test");
  assert.equal(tools[3]!.outcome, "success");
  assert.equal(tools[3]!.isError, false);

  // 5. read error
  assert.equal(tools[4]!.name, "read");
  assert.equal(tools[4]!.outcome, "failure");
  assert.equal(tools[4]!.isError, true);
  assert.match(tools[4]!.result!, /ENOENT/);

  // 6. bash failure
  assert.equal(tools[5]!.name, "bash");
  assert.equal(tools[5]!.outcome, "failure");
  assert.equal(tools[5]!.isError, true);

  // 7. interrupted
  assert.equal(tools[6]!.name, "bash");
  assert.equal(tools[6]!.outcome, "interrupted");
});

test("extractSessionToolCalls handles array directly, getBranch fallback, and empty inputs", () => {
  assert.deepEqual(extractSessionToolCalls(null), []);
  assert.deepEqual(extractSessionToolCalls(undefined), []);
  assert.deepEqual(extractSessionToolCalls({}), []);
  assert.deepEqual(extractSessionToolCalls([]), []);

  // Raw array of entries
  const directArray = [
    {
      role: "bashExecution",
      command: "echo hi",
      output: "hi",
      exitCode: 0,
      cancelled: false,
    },
  ];
  const fromArray = extractSessionToolCalls(directArray);
  assert.equal(fromArray.length, 1);
  assert.equal(fromArray[0]!.name, "bash");
  assert.equal(fromArray[0]!.result, "hi");

  // getBranch fallback when getEntries is empty
  const branchManager = {
    getEntries: () => [],
    getBranch: () => [
      {
        type: "message",
        message: {
          role: "bashExecution",
          command: "pwd",
          output: "/home/user",
          exitCode: 0,
          cancelled: false,
        },
      },
    ],
  };
  const fromBranch = extractSessionToolCalls(branchManager);
  assert.equal(fromBranch.length, 1);
  assert.equal(fromBranch[0]!.name, "bash");
});

// ============================================================================
// 2. formatToolSummary Tests
// ============================================================================

test("formatToolSummary formats summary strings for read, write, edit, bash, and custom tools", () => {
  const readTool: InspectedToolCall = {
    id: "1",
    name: "read",
    args: { path: "src/main.ts" },
    result: "line 1\nline 2\nline 3",
  };
  assert.equal(formatToolSummary(readTool), "read src/main.ts (3 lines)");

  const writeTool: InspectedToolCall = {
    id: "2",
    name: "write",
    args: { path: "dist/app.js", content: "console.log(1);" },
  };
  assert.equal(formatToolSummary(writeTool), "write dist/app.js (1 line)");

  const editTool: InspectedToolCall = {
    id: "3",
    name: "edit",
    args: { path: "package.json" },
    result: "-  \"version\": \"1.0.0\",\n+  \"version\": \"1.1.0\",\n+  \"description\": \"demo\",",
  };
  assert.equal(formatToolSummary(editTool), "edit package.json (+2/-1)");

  const bashTool: InspectedToolCall = {
    id: "4",
    name: "bash",
    args: { command: "git status --short" },
    durationMs: 120,
  };
  assert.equal(formatToolSummary(bashTool), "bash: git status --short (120ms)");

  const powershellTool: InspectedToolCall = {
    id: "5",
    name: "powershell",
    args: { command: "Get-Process" },
    durationMs: 1500,
  };
  assert.equal(formatToolSummary(powershellTool), "powershell: Get-Process (1.5s)");

  const customTool: InspectedToolCall = {
    id: "6",
    name: "database_query",
    args: { query: "SELECT * FROM users", limit: 50 },
  };
  assert.match(formatToolSummary(customTool), /database_query \(query=SELECT/);
});

// ============================================================================
// 3. parseDiffHunks Tests
// ============================================================================

test("parseDiffHunks parses unified diffs and extracts headers, line types, and line numbers", () => {
  const diffText = `--- a/file.ts
+++ b/file.ts
@@ -10,4 +10,5 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 const d = 5;
@@ -30,3 +31,2 @@
 function run() {
-  start();
   return true;
 }`;

  const hunks = parseDiffHunks(diffText);
  assert.equal(hunks.length, 2);

  // Hunk 1
  assert.match(hunks[0]!.header, /@@ -10,4 \+10,5 @@/);
  assert.equal(hunks[0]!.lines.length, 5);

  assert.equal(hunks[0]!.lines[0]!.type, "context");
  assert.equal(hunks[0]!.lines[0]!.text, "const a = 1;");
  assert.equal(hunks[0]!.lines[0]!.oldLine, 10);
  assert.equal(hunks[0]!.lines[0]!.newLine, 10);

  assert.equal(hunks[0]!.lines[1]!.type, "del");
  assert.equal(hunks[0]!.lines[1]!.text, "const b = 2;");
  assert.equal(hunks[0]!.lines[1]!.oldLine, 11);

  assert.equal(hunks[0]!.lines[2]!.type, "add");
  assert.equal(hunks[0]!.lines[2]!.text, "const b = 3;");
  assert.equal(hunks[0]!.lines[2]!.newLine, 11);

  assert.equal(hunks[0]!.lines[3]!.type, "add");
  assert.equal(hunks[0]!.lines[3]!.text, "const c = 4;");
  assert.equal(hunks[0]!.lines[3]!.newLine, 12);

  assert.equal(hunks[0]!.lines[4]!.type, "context");
  assert.equal(hunks[0]!.lines[4]!.text, "const d = 5;");

  // Hunk 2
  assert.match(hunks[1]!.header, /@@ -30,3 \+31,2 @@/);
  assert.equal(hunks[1]!.lines.length, 4);
  assert.equal(hunks[1]!.lines[1]!.type, "del");
  assert.equal(hunks[1]!.lines[1]!.text, "  start();");
  assert.equal(hunks[1]!.lines[1]!.oldLine, 31);
});

test("parseDiffHunks parses Pi-formatted numbered diffs and diffs without headers", () => {
  // Pi format: "+123 text", "-123 text", " 123 text"
  const piDiff = `@@ -5,3 +5,3 @@
  5 const x = 1;
 -6 const y = 2;
 +6 const y = 3;
  7 const z = 4;`;

  const hunks = parseDiffHunks(piDiff);
  assert.equal(hunks.length, 1);
  assert.equal(hunks[0]!.lines.length, 4);
  assert.equal(hunks[0]!.lines[1]!.type, "del");
  assert.equal(hunks[0]!.lines[1]!.oldLine, 6);
  assert.equal(hunks[0]!.lines[1]!.text, "const y = 2;");
  assert.equal(hunks[0]!.lines[2]!.type, "add");
  assert.equal(hunks[0]!.lines[2]!.newLine, 6);
  assert.equal(hunks[0]!.lines[2]!.text, "const y = 3;");

  // Diff without @@ header
  const noHeaderDiff = `-old line
+new line
 context line`;
  const fallbackHunks = parseDiffHunks(noHeaderDiff);
  assert.equal(fallbackHunks.length, 1);
  assert.equal(fallbackHunks[0]!.lines[0]!.type, "del");
  assert.equal(fallbackHunks[0]!.lines[1]!.type, "add");
  assert.equal(fallbackHunks[0]!.lines[2]!.type, "context");

  // Empty string
  assert.deepEqual(parseDiffHunks(""), []);
});

// ============================================================================
// 4. copyToolContent Fallback Test
// ============================================================================

test("copyToolContent returns boolean and handles unavailable clipboard safely", async () => {
  // In a headless test runner without X11/Wayland/pbcopy, copyToolContent will safely return false
  // without throwing an unhandled rejection.
  const result = await copyToolContent("sample snippet to copy");
  assert.equal(typeof result, "boolean");
});

// ============================================================================
// 5. Component Rendering across Themes and Widths (120, 80, 40 cols)
// ============================================================================

const sampleToolCalls: InspectedToolCall[] = [
  {
    id: "tool_1",
    name: "read",
    args: { path: "src/main.ts" },
    outcome: "success",
    result: "import { serve } from './server';\nserve(3000);",
    durationMs: 25,
  },
  {
    id: "tool_2",
    name: "edit",
    args: { path: "src/server.ts" },
    outcome: "success",
    result: "@@ -1,2 +1,3 @@\n-export function serve(p: number) {}\n+export function serve(port: number) {\n+  console.log('Listening on', port);\n+}",
    durationMs: 40,
  },
  {
    id: "tool_3",
    name: "write",
    args: { path: "src/constants.ts", content: "export const PORT = 3000;\nexport const HOST = 'localhost';" },
    outcome: "success",
    durationMs: 15,
  },
  {
    id: "tool_4",
    name: "bash",
    args: { command: "npm test" },
    outcome: "failure",
    isError: true,
    result: "FAIL: src/server.test.ts\n  ● Port binding failed with EADDRINUSE",
    durationMs: 450,
  },
  {
    id: "tool_5",
    name: "powershell",
    args: { command: "Stop-Process -Name node" },
    outcome: "interrupted",
    result: "Terminated by user",
    durationMs: 90,
  },
];

test("Tool inspector component renders across 120, 80, and 40 columns without overflowing", () => {
  const component = new ToolInspectorComponent(
    dummyTui,
    defaultTheme,
    dummyKeybindings,
    () => {},
    {} as any,
    { toolCalls: sampleToolCalls },
  );

  for (const width of [120, 80, 40]) {
    const lines = component.render(width);
    assert.ok(lines.length > 5, `Expected rendered lines at width ${width}`);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const w = visibleWidth(line);
      assert.ok(
        w <= width,
        `Line ${i} visible width ${w} exceeded target width ${width}: "${stripTerminalSequences(line)}"`,
      );
    }

    // Verify key sections exist
    const plainText = lines.map((l) => stripTerminalSequences(l)).join("\n");
    assert.match(plainText, /Tool Inspector|Inspector/);
    assert.match(plainText, /read/);
    assert.match(plainText, /src\/main\.ts/);
  }
});

test("Tool inspector component renders cleanly with mock minimal theme", () => {
  const mockTheme = makeMockTheme();
  const component = new ToolInspectorComponent(
    dummyTui,
    mockTheme as any,
    dummyKeybindings,
    () => {},
    {} as any,
    { toolCalls: sampleToolCalls },
  );

  const lines = component.render(80);
  assert.ok(lines.length > 0);
  const plain = lines.map((l) => stripTerminalSequences(l)).join("\n");
  assert.match(plain, /Tool Inspector/);
  assert.match(plain, /read/);
  assert.match(plain, /edit/);
});

// ============================================================================
// 6. Keyboard Navigation Tests (Up, Down, Tab, Esc)
// ============================================================================

test("Keyboard navigation handles Up, Down, Tab, Shift+Tab, and Esc", () => {
  let doneCalled = false;
  let renderRequested = false;
  const mockTui = {
    requestRender: () => {
      renderRequested = true;
    },
  } as unknown as TUI;

  const component = createToolInspectorComponent(
    mockTui,
    defaultTheme,
    dummyKeybindings,
    () => {
      doneCalled = true;
    },
    {} as any,
    { toolCalls: sampleToolCalls },
  ) as ToolInspectorComponent;

  // Initial state: index 0, focus: list
  assert.equal(component.getSelectedIndex(), 0);
  assert.equal(component.getFocus(), "list");
  assert.equal(component.getSelectedTool()?.name, "read");

  // Down arrow moves selection
  renderRequested = false;
  component.handleInput("\x1b[B"); // Down arrow
  assert.equal(component.getSelectedIndex(), 1);
  assert.equal(component.getSelectedTool()?.name, "edit");
  assert.equal(renderRequested, true);

  // Another Down arrow
  component.handleInput("\x1b[B");
  assert.equal(component.getSelectedIndex(), 2);
  assert.equal(component.getSelectedTool()?.name, "write");

  // Up arrow moves selection back
  component.handleInput("\x1b[A"); // Up arrow
  assert.equal(component.getSelectedIndex(), 1);
  assert.equal(component.getSelectedTool()?.name, "edit");

  // Tab switches focus to detail
  component.handleInput("\t");
  assert.equal(component.getFocus(), "detail");

  // While focus is detail, Down scrolls output lines rather than changing tool
  const initialIndex = component.getSelectedIndex();
  assert.equal(component.getScrollOffset(), 0);
  component.handleInput("\x1b[B"); // Down in detail
  assert.equal(component.getSelectedIndex(), initialIndex);
  assert.equal(component.getScrollOffset(), 1);

  // Up in detail scrolls back up
  component.handleInput("\x1b[A"); // Up in detail
  assert.equal(component.getScrollOffset(), 0);

  // Tab switches back to list
  component.handleInput("\t");
  assert.equal(component.getFocus(), "list");

  // Escape calls done()
  assert.equal(doneCalled, false);
  component.handleInput("\x1b"); // Escape
  assert.equal(doneCalled, true);
});

test("Key 'q' closes the component and initialToolId selects specified tool", () => {
  let doneCalled = false;
  const component = createToolInspectorComponent(
    dummyTui,
    defaultTheme,
    dummyKeybindings,
    () => {
      doneCalled = true;
    },
    {} as any,
    { toolCalls: sampleToolCalls, initialToolId: "tool_4" },
  ) as ToolInspectorComponent;

  assert.equal(component.getSelectedIndex(), 3);
  assert.equal(component.getSelectedTool()?.id, "tool_4");
  assert.equal(component.getSelectedTool()?.name, "bash");

  // 'q' closes inspector
  component.handleInput("q");
  assert.equal(doneCalled, true);
});

// ============================================================================
// 7. Narrow Terminal Rendering Tests (20-30 cols)
// ============================================================================

test("Tool inspector handles narrow terminal widths (20 to 35 cols) without crashing or overflowing", () => {
  const component = new ToolInspectorComponent(
    dummyTui,
    defaultTheme,
    dummyKeybindings,
    () => {},
    {} as any,
    { toolCalls: sampleToolCalls },
  );

  for (const width of [20, 25, 30, 35]) {
    const lines = component.render(width);
    assert.ok(lines.length > 0);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const w = visibleWidth(line);
      assert.ok(
        w <= width,
        `Line ${i} visible width ${w} exceeded ${width} at narrow size: "${stripTerminalSequences(line)}"`,
      );
    }
  }
});

test("Keyboard navigation handles Left/Right, Enter, PageUp/PageDown, and copy commands", async () => {
  let renderCount = 0;
  const mockTui = {
    requestRender: () => {
      renderCount++;
    },
  } as unknown as TUI;

  const component = createToolInspectorComponent(
    mockTui,
    defaultTheme,
    dummyKeybindings,
    () => {},
    {} as any,
    { toolCalls: sampleToolCalls },
  ) as ToolInspectorComponent;

  // Initial focus is list
  assert.equal(component.getFocus(), "list");

  // Right arrow switches focus to detail
  component.handleInput("\x1b[C"); // Right
  assert.equal(component.getFocus(), "detail");

  // Left arrow switches focus back to list
  component.handleInput("\x1b[D"); // Left
  assert.equal(component.getFocus(), "list");

  // Enter on list switches focus to detail
  component.handleInput("\r"); // Enter
  assert.equal(component.getFocus(), "detail");

  // PageDown increases scroll offset
  const beforeScroll = component.getScrollOffset();
  component.handleInput("\x1b[6~"); // PageDown
  assert.ok(component.getScrollOffset() >= beforeScroll);

  // PageUp decreases scroll offset back to 0
  component.handleInput("\x1b[5~"); // PageUp
  assert.equal(component.getScrollOffset(), 0);

  // 'c' triggers copy
  const rendersBeforeCopy = renderCount;
  component.handleInput("c");
  assert.ok(renderCount > rendersBeforeCopy);
  await new Promise((resolve) => setTimeout(resolve, 50));

  // 'y' triggers copy as well
  component.handleInput("y");
});

test("Detailed views render accurately for read, write, edit, bash, and custom tools", () => {
  const customTool: InspectedToolCall = {
    id: "tool_custom",
    name: "fetch_api",
    args: { endpoint: "https://api.example.com", method: "GET" },
    outcome: "success",
    result: '{"status": "ok", "items": [1, 2, 3]}',
    durationMs: 120,
  };

  const allTools = [...sampleToolCalls, customTool];

  for (let idx = 0; idx < allTools.length; idx++) {
    const comp = new ToolInspectorComponent(
      dummyTui,
      defaultTheme,
      dummyKeybindings,
      () => {},
      {} as any,
      { toolCalls: allTools, initialToolId: allTools[idx]!.id },
    );

    const lines = comp.render(80);
    const plain = lines.map((l) => stripTerminalSequences(l)).join("\n");
    const current = allTools[idx]!;

    if (current.name === "read") {
      assert.match(plain, /src\/main\.ts/);
      assert.match(plain, /import { serve }/);
    } else if (current.name === "edit") {
      assert.match(plain, /src\/server\.ts/);
      assert.match(plain, /Changes:/);
      assert.match(plain, /\+/);
      assert.match(plain, /-/);
    } else if (current.name === "write") {
      assert.match(plain, /src\/constants\.ts/);
      assert.match(plain, /PORT = 3000/);
    } else if (current.name === "bash") {
      assert.match(plain, /npm test/);
      assert.match(plain, /FAIL: src\/server\.test\.ts/);
    } else if (current.name === "fetch_api") {
      assert.match(plain, /fetch_api/);
      assert.match(plain, /https:\/\/api\.example\.com/);
      assert.match(plain, /"status": "ok"/);
    }
  }
});

test("Tool inspector handles empty tool list gracefully", () => {
  const component = new ToolInspectorComponent(
    dummyTui,
    defaultTheme,
    dummyKeybindings,
    () => {},
    {} as any,
    { toolCalls: [] },
  );

  const lines = component.render(80);
  assert.ok(lines.length > 0);
  const plain = lines.map((l) => stripTerminalSequences(l)).join("\n");
  assert.match(plain, /No tool calls recorded/);
  assert.equal(component.getSelectedIndex(), -1);
  assert.equal(component.getSelectedTool(), undefined);
});

