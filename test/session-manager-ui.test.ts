import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  KeybindingsManager,
  TUI_KEYBINDINGS,
  stripTerminalSequences,
  visibleWidth,
  type TUI,
} from "@earendil-works/pi-tui";
import { type Theme, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  extractSessionList,
  exportConversation,
  formatSessionTimestamp,
  formatTokenCount,
  formatSessionSummary,
  filterSessions,
  createSessionManagerComponent,
  SessionManagerComponent,
  EXPORT_FORMATS,
} from "../extensions/omt/features/session-manager-ui/index.ts";
import type { SessionItem } from "../extensions/omt/features/session-manager-ui/types.ts";

/**
 * Mock theme for test isolation.
 */
function getMockTheme(): Theme {
  return {
    fg: (_c: string, text: string) => text,
    bg: (_c: string, text: string) => text,
    bold: (text: string) => text,
    dim: (text: string) => text,
    italic: (text: string) => text,
    underline: (text: string) => text,
  } as unknown as Theme;
}

/**
 * Mock TUI instance.
 */
function createMockTui(): TUI & { renderRequests: number } {
  const mock = {
    renderRequests: 0,
    requestRender() {
      mock.renderRequests++;
    },
  };
  return mock as unknown as TUI & { renderRequests: number };
}

/**
 * Helper to create a configured KeybindingsManager.
 */
function getKeybindings(): KeybindingsManager {
  return new KeybindingsManager(TUI_KEYBINDINGS);
}

/**
 * Sample session entries representing a realistic conversation.
 */
function createSampleSessionEntries() {
  return [
    {
      type: "session",
      id: "sess-12345678",
      timestamp: "2025-01-15T10:00:00.000Z",
      cwd: "/home/user/project",
    },
    {
      type: "message",
      id: "msg-1",
      timestamp: "2025-01-15T10:01:00.000Z",
      message: {
        role: "user",
        content: "Please inspect parser.ts and fix the <bug> & syntax error.",
      },
    },
    {
      type: "message",
      id: "msg-2",
      timestamp: "2025-01-15T10:01:05.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Checking AST tokenization logic for <bug>..." },
          { type: "text", text: "I will read parser.ts to check the bug." },
          {
            type: "toolCall",
            id: "call-1",
            name: "read",
            arguments: { path: "src/parser.ts" },
          },
        ],
      },
    },
    {
      type: "message",
      id: "msg-3",
      timestamp: "2025-01-15T10:01:10.000Z",
      message: {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "read",
        content: "export function parse() { return true; }",
        isError: false,
      },
    },
    {
      type: "compaction",
      id: "compact-1",
      timestamp: "2025-01-15T10:02:00.000Z",
      summary: "Summarized previous exploration steps",
      tokensBefore: 4500,
    },
    {
      type: "branch_summary",
      id: "branch-1",
      timestamp: "2025-01-15T10:02:30.000Z",
      summary: "Switched to alternative approach for AST",
    },
    {
      type: "message",
      id: "msg-4",
      timestamp: "2025-01-15T10:03:00.000Z",
      message: {
        role: "assistant",
        content: "The fix is ready and verified.",
      },
    },
  ];
}

// ============================================================================
// 1. Session List Extraction & Formatting Tests
// ============================================================================

test("extractSessionList returns options.sessions if provided", async () => {
  const mockSessions: SessionItem[] = [
    {
      id: "sess-1",
      name: "Feature Parser",
      timestamp: "2025-01-15T10:00:00.000Z",
      messageCount: 12,
      tokenUsage: 4500,
      isCurrent: true,
    },
    {
      id: "sess-2",
      name: "Bug Fix AST",
      timestamp: "2025-01-14T09:00:00.000Z",
      messageCount: 5,
      tokenUsage: 1200,
    },
  ];

  const result = await extractSessionList(undefined, { sessions: mockSessions });
  assert.equal(result.length, 2);
  assert.equal(result[0]!.id, "sess-1");
  assert.equal(result[0]!.name, "Feature Parser");
  assert.equal(result[1]!.id, "sess-2");
});

test("extractSessionList reads and parses session files from directory", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "omt-session-test-"));

  try {
    // Session 1: JSONL with session header, session_info, messages, usage
    const session1Lines = [
      JSON.stringify({ type: "session", id: "sess-alpha", timestamp: "2025-01-10T12:00:00.000Z" }),
      JSON.stringify({ type: "session_info", name: "Alpha Exploration" }),
      JSON.stringify({
        type: "message",
        timestamp: "2025-01-10T12:01:00.000Z",
        message: { role: "user", content: "Hello alpha" },
      }),
      JSON.stringify({
        type: "message",
        timestamp: "2025-01-10T12:01:05.000Z",
        message: { role: "assistant", content: "Alpha reply" },
      }),
      JSON.stringify({ type: "usage", usage: { totalTokens: 850 } }),
    ];
    await fs.writeFile(path.join(tmpDir, "sess-alpha.jsonl"), session1Lines.join("\n"));

    // Session 2: Newer session without session_info (extracts name from first user message)
    const session2Lines = [
      JSON.stringify({ type: "session", id: "sess-beta", timestamp: "2025-01-15T15:00:00.000Z" }),
      JSON.stringify({
        type: "message",
        timestamp: "2025-01-15T15:01:00.000Z",
        message: { role: "user", content: "Optimize database query performance" },
      }),
      JSON.stringify({ type: "usage", usage: { totalTokens: 2500 } }),
    ];
    await fs.writeFile(path.join(tmpDir, "sess-beta.jsonl"), session2Lines.join("\n"));

    // Session 3: Corrupted / invalid file (should be ignored gracefully)
    await fs.writeFile(path.join(tmpDir, "corrupted.jsonl"), "not a json line\n{broken");

    // Session 4: Empty file (should be ignored gracefully)
    await fs.writeFile(path.join(tmpDir, "empty.jsonl"), "");

    const sessions = await extractSessionList(tmpDir);

    assert.equal(sessions.length, 2);
    // Newest first
    assert.equal(sessions[0]!.id, "sess-beta");
    assert.equal(sessions[0]!.name, "Optimize database query performance");
    assert.equal(sessions[0]!.tokenUsage, 2500);

    assert.equal(sessions[1]!.id, "sess-alpha");
    assert.equal(sessions[1]!.name, "Alpha Exploration");
    assert.equal(sessions[1]!.messageCount, 2);
    assert.equal(sessions[1]!.tokenUsage, 850);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("extractSessionList returns empty array for non-existent directory", async () => {
  const result = await extractSessionList("/non/existent/path/for/omt/sessions");
  assert.deepEqual(result, []);
});

test("formatTokenCount formats token numbers cleanly", () => {
  assert.equal(formatTokenCount(undefined), "0 tokens");
  assert.equal(formatTokenCount(0), "0 tokens");
  assert.equal(formatTokenCount(750), "750 tokens");
  assert.equal(formatTokenCount(1500), "1.5k tokens");
  assert.equal(formatTokenCount(250000), "250.0k tokens");
  assert.equal(formatTokenCount(1500000), "1.50M tokens");
});

test("formatSessionTimestamp formats date strings cleanly", () => {
  assert.equal(formatSessionTimestamp(undefined), "N/A");
  const formatted = formatSessionTimestamp("2025-01-15T10:30:00.000Z");
  assert.match(formatted, /^2025-01-15/);
});

test("formatSessionSummary formats comprehensive summary block", () => {
  const item: SessionItem = {
    id: "sess-999",
    name: "Refactor API",
    timestamp: "2025-01-15T12:00:00.000Z",
    messageCount: 8,
    tokenUsage: 12000,
    filePath: "/tmp/sess-999.jsonl",
  };
  const summary = formatSessionSummary(item);
  assert.ok(summary.includes("Session ID: sess-999"));
  assert.ok(summary.includes("Name: Refactor API"));
  assert.ok(summary.includes("Messages: 8"));
  assert.ok(summary.includes("Tokens: 12000"));
  assert.ok(summary.includes("File: /tmp/sess-999.jsonl"));
});

test("filterSessions filters by ID, name, or timestamp", () => {
  const list: SessionItem[] = [
    { id: "alpha-001", name: "Build Pipeline", timestamp: "2025-01-10" },
    { id: "beta-002", name: "Fix Parser Bug", timestamp: "2025-01-12" },
    { id: "gamma-003", name: "Test Harness", timestamp: "2025-01-14" },
  ];

  assert.equal(filterSessions(list, "").length, 3);
  assert.equal(filterSessions(list, "alpha").length, 1);
  assert.equal(filterSessions(list, "parser").length, 1);
  assert.equal(filterSessions(list, "2025-01-14").length, 1);
  assert.equal(filterSessions(list, "nonexistent").length, 0);
});

// ============================================================================
// 2. Export Engine Across Markdown, JSON, HTML, Text
// ============================================================================

test("exportConversation formats Markdown correctly", () => {
  const entries = createSampleSessionEntries();
  const md = exportConversation(entries, { format: "markdown", includeTools: true });

  assert.ok(md.includes("# Conversation Export"));
  assert.ok(md.includes("## User"));
  assert.ok(md.includes("Please inspect parser.ts"));
  assert.ok(md.includes("## Assistant"));
  assert.ok(md.includes("> **Thinking:**"));
  assert.ok(md.includes("Checking AST tokenization logic"));
  assert.ok(md.includes("**Tool Call: `read`**"));
  assert.ok(md.includes('"path": "src/parser.ts"'));
  assert.ok(md.includes("**Tool Result (`read`):**"));
  assert.ok(md.includes("export function parse()"));
  assert.ok(md.includes("Compaction Summary:"));
  assert.ok(md.includes("Branch Summary:"));
});

test("exportConversation respects includeTools: false in Markdown", () => {
  const entries = createSampleSessionEntries();
  const md = exportConversation(entries, { format: "markdown", includeTools: false });

  assert.ok(!md.includes("**Tool Call: `read`**"));
  assert.ok(!md.includes("**Tool Result (`read`):**"));
  assert.ok(md.includes("The fix is ready and verified."));
});

test("exportConversation formats structured JSON correctly", () => {
  const entries = createSampleSessionEntries();
  const jsonStr = exportConversation(entries, { format: "json", includeTools: true });

  const parsed = JSON.parse(jsonStr);
  assert.ok(parsed.exportDate);
  assert.ok(Array.isArray(parsed.messages));
  assert.ok(parsed.messages.length > 0);

  const userMsg = parsed.messages.find((m: any) => m.role === "user");
  assert.ok(userMsg);
  assert.ok(userMsg.content.includes("Please inspect parser.ts"));

  const asstMsg = parsed.messages.find((m: any) => m.role === "assistant");
  assert.ok(asstMsg);
  assert.ok(asstMsg.thinking.includes("Checking AST tokenization"));
  assert.equal(asstMsg.toolCalls[0].name, "read");
});

test("exportConversation formats clean semantic HTML with CSS and escaping", () => {
  const entries = createSampleSessionEntries();
  const html = exportConversation(entries, { format: "html", includeTools: true });

  assert.ok(html.includes("<!DOCTYPE html>"));
  assert.ok(html.includes("<style>"));
  assert.ok(html.includes("<h1>Conversation Export</h1>"));
  assert.ok(html.includes('class="message message-user"'));
  assert.ok(html.includes('class="badge badge-user"'));
  assert.ok(html.includes('class="thinking"'));
  assert.ok(html.includes('class="tool-call"'));
  assert.ok(html.includes('class="tool-result"'));

  // Ensure HTML special characters are properly escaped (e.g. <bug> & syntax)
  assert.ok(!html.includes("<bug>"));
  assert.ok(html.includes("&lt;bug&gt;"));
  assert.ok(html.includes("&amp;"));
});

test("exportConversation formats clean plain text", () => {
  const entries = createSampleSessionEntries();
  const text = exportConversation(entries, { format: "text", includeTools: true });

  assert.ok(text.includes("CONVERSATION EXPORT"));
  assert.ok(text.includes("[USER]"));
  assert.ok(text.includes("Please inspect parser.ts"));
  assert.ok(text.includes("[ASSISTANT]"));
  assert.ok(text.includes("Thinking:"));
  assert.ok(text.includes("Tool Call: read"));
  assert.ok(text.includes("Tool Result (read):"));
});

test("exportConversation handles empty sessions safely across all formats", () => {
  for (const fmt of EXPORT_FORMATS) {
    const output = exportConversation([], { format: fmt });
    assert.equal(typeof output, "string");
    assert.ok(output.length > 0);
  }
});

// ============================================================================
// 3. SessionManagerComponent Interactive UI & Keyboard Navigation
// ============================================================================

test("SessionManagerComponent renders cleanly across 120, 80, 40, and 20 columns", () => {
  const theme = getMockTheme();
  const tui = createMockTui();
  const keybindings = getKeybindings();
  const sessions: SessionItem[] = [
    {
      id: "sess-11112222",
      name: "Fix Parser AST Grammar Bug",
      timestamp: "2025-01-15T10:00:00.000Z",
      messageCount: 42,
      tokenUsage: 15400,
      isCurrent: true,
    },
    {
      id: "sess-33334444",
      name: "Refactor Session Manager Engine",
      timestamp: "2025-01-14T09:00:00.000Z",
      messageCount: 18,
      tokenUsage: 8200,
    },
  ];

  let completedValue: unknown = undefined;
  const done = (val?: unknown) => {
    completedValue = val;
  };
  const ctx = { cwd: "/tmp" } as ExtensionContext;

  const component = new SessionManagerComponent(tui, theme, keybindings, done, ctx, {
    sessions,
  });

  const widths = [120, 80, 40, 20];
  for (const w of widths) {
    const lines = component.render(w);
    assert.ok(Array.isArray(lines));
    assert.ok(lines.length > 0, `Component should produce lines for width ${w}`);

    for (const line of lines) {
      const stripped = stripTerminalSequences(line);
      const width = visibleWidth(stripped);
      assert.ok(
        width <= w,
        `Line width ${width} must not exceed viewport width ${w} (line: "${stripped}")`,
      );
    }
  }
});

test("Keyboard navigation: Up/Down arrow moves selection index", () => {
  const theme = getMockTheme();
  const tui = createMockTui();
  const keybindings = getKeybindings();
  const sessions: SessionItem[] = [
    { id: "s-1", name: "Session 1" },
    { id: "s-2", name: "Session 2" },
    { id: "s-3", name: "Session 3" },
  ];

  const component = new SessionManagerComponent(tui, theme, keybindings, () => {}, {} as any, {
    sessions,
  });

  assert.equal(component.getSelectedIndex(), 0);

  // Down arrow
  component.handleInput("\x1b[B");
  assert.equal(component.getSelectedIndex(), 1);

  component.handleInput("\x1b[B");
  assert.equal(component.getSelectedIndex(), 2);

  // Wrap around to 0
  component.handleInput("\x1b[B");
  assert.equal(component.getSelectedIndex(), 0);

  // Up arrow wraps to end
  component.handleInput("\x1b[A");
  assert.equal(component.getSelectedIndex(), 2);
});

test("Actions: Enter selects session and calls onSelectSession callback", () => {
  const theme = getMockTheme();
  const tui = createMockTui();
  const keybindings = getKeybindings();
  const sessions: SessionItem[] = [
    { id: "s-alpha", name: "Session Alpha" },
    { id: "s-beta", name: "Session Beta" },
  ];

  let selectedFromCallback: SessionItem | undefined;
  let doneValue: unknown = undefined;

  const component = new SessionManagerComponent(
    tui,
    theme,
    keybindings,
    (val) => {
      doneValue = val;
    },
    {} as any,
    {
      sessions,
      onSelectSession: (s) => {
        selectedFromCallback = s;
      },
    },
  );

  // Press Enter
  component.handleInput("\r");

  assert.equal(selectedFromCallback?.id, "s-alpha");
  assert.equal((doneValue as SessionItem)?.id, "s-alpha");
});

test("Actions: 'e' triggers export callback and Tab cycles formats", () => {
  const theme = getMockTheme();
  const tui = createMockTui();
  const keybindings = getKeybindings();
  const sessions: SessionItem[] = [{ id: "s-1", name: "Session 1" }];

  let exportedFormat: string | undefined;

  const component = new SessionManagerComponent(tui, theme, keybindings, () => {}, {} as any, {
    sessions,
    onExport: (fmt) => {
      exportedFormat = fmt;
    },
  });

  assert.equal(component.getActiveExportFormat(), "markdown");

  // Press 'e'
  component.handleInput("e");
  assert.equal(exportedFormat, "markdown");

  // Press Tab to cycle to JSON
  component.handleInput("\t");
  assert.equal(component.getActiveExportFormat(), "json");

  // Press Tab to cycle to HTML
  component.handleInput("\t");
  assert.equal(component.getActiveExportFormat(), "html");

  // Press Tab to cycle to Text
  component.handleInput("\t");
  assert.equal(component.getActiveExportFormat(), "text");
});

test("Search filtering: typing characters updates filtered list and selection", () => {
  const theme = getMockTheme();
  const tui = createMockTui();
  const keybindings = getKeybindings();
  const sessions: SessionItem[] = [
    { id: "session-rust", name: "Rust Compiler" },
    { id: "session-typescript", name: "TypeScript AST" },
    { id: "session-go", name: "Go Concurrency" },
  ];

  const component = new SessionManagerComponent(tui, theme, keybindings, () => {}, {} as any, {
    sessions,
  });

  // Focus search with '/' and type 't' 'y' 'p' 'e'
  component.handleInput("/");
  component.handleInput("t");
  component.handleInput("y");
  component.handleInput("p");
  component.handleInput("e");

  assert.equal(component.getQuery(), "type");
  assert.equal(component.getSelectedSession()?.id, "session-typescript");

  // Backspace
  component.handleInput("\x7f");
  assert.equal(component.getQuery(), "typ");
});

test("Actions: 'c' copies summary and Esc closes component", () => {
  const theme = getMockTheme();
  const tui = createMockTui();
  const keybindings = getKeybindings();
  const sessions: SessionItem[] = [{ id: "s-copy-test", name: "Clipboard Test" }];

  let closed = false;
  const component = new SessionManagerComponent(
    tui,
    theme,
    keybindings,
    () => {
      closed = true;
    },
    {} as any,
    { sessions },
  );

  // Press 'c'
  component.handleInput("c");

  // Press Esc to close
  component.handleInput("\x1b");
  assert.equal(closed, true);
});

test("createSessionManagerComponent factory satisfies factory interface", () => {
  const theme = getMockTheme();
  const tui = createMockTui();
  const keybindings = getKeybindings();
  let doneCalled = false;

  const comp = createSessionManagerComponent(
    tui,
    theme,
    keybindings,
    () => {
      doneCalled = true;
    },
    {} as any,
    { sessions: [] },
  );

  assert.ok(comp);
  assert.equal(typeof comp.render, "function");
  assert.equal(typeof comp.handleInput, "function");
});
