import assert from "node:assert/strict";
import { test } from "node:test";
import {
  KeybindingsManager,
  TUI_KEYBINDINGS,
  stripTerminalSequences,
  visibleWidth,
  type TUI,
} from "@earendil-works/pi-tui";
import { InteractiveMode, initTheme, type Theme, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  NAV_CATEGORIES,
  createConversationNavigatorComponent,
  extractNavigatableEntries,
  filterNavEntries,
  ConversationNavigatorComponent,
} from "../extensions/omt/features/conversation-navigator/index.ts";
import type { NavigatableItem } from "../extensions/omt/features/conversation-navigator/types.ts";

/**
 * Helper to get a real Pi Theme instance.
 */
function getRealTheme(): Theme {
  initTheme("dark");
  const proto = InteractiveMode.prototype as unknown as {
    createExtensionUIContext(this: unknown): { theme: Theme };
  };
  return proto.createExtensionUIContext.call({}).theme;
}

/**
 * Mock minimal theme for test isolation.
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
 * Helper to create a dummy TUI instance.
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
 * Build a representative mock session manager containing all required entry types:
 * - user message
 * - assistant message with reasoning indicator
 * - tool calls and results (success)
 * - failed/interrupted tool call (bash execution with exitCode 1)
 * - assistant error
 * - standalone error entry
 * - label/bookmark entry
 * - entry with getLabel
 * - compaction summary entry
 */
function createMockSessionManager() {
  const entries = [
    {
      type: "session",
      id: "session-hdr",
      version: 3,
      timestamp: "2025-01-15T10:00:00.000Z",
    },
    {
      type: "message",
      id: "user-msg-1",
      timestamp: "2025-01-15T10:01:00.000Z",
      message: {
        role: "user",
        content: "How do I fix bug #42 in the parser?",
      },
    },
    {
      type: "message",
      id: "asst-msg-1",
      timestamp: "2025-01-15T10:01:05.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Inspecting tokenizer grammar..." },
          { type: "text", text: "I found the issue in the parser grammar." },
          {
            type: "toolCall",
            id: "call-1",
            name: "read",
            arguments: { path: "src/parser.ts", offset: 1, limit: 50 },
          },
        ],
      },
    },
    {
      type: "message",
      id: "tool-res-1",
      timestamp: "2025-01-15T10:01:10.000Z",
      message: {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "read",
        content: [{ type: "text", text: "export class Parser { parse() { ... } }" }],
        isError: false,
      },
    },
    {
      type: "message",
      id: "bash-exec-1",
      timestamp: "2025-01-15T10:01:15.000Z",
      message: {
        role: "bashExecution",
        command: "npm test",
        exitCode: 1,
        output: "AssertionError: expected true to be false",
        cancelled: false,
      },
    },
    {
      type: "message",
      id: "asst-err-1",
      timestamp: "2025-01-15T10:01:20.000Z",
      message: {
        role: "assistant",
        errorMessage: "API gateway connection timed out",
        stopReason: "error",
      },
    },
    {
      type: "error",
      id: "raw-err-1",
      timestamp: "2025-01-15T10:01:25.000Z",
      message: "Failed to reload extension plugin",
    },
    {
      type: "label",
      id: "label-entry-1",
      timestamp: "2025-01-15T10:01:30.000Z",
      targetId: "user-msg-1",
      label: "repro-checkpoint",
    },
    {
      type: "compaction",
      id: "compaction-1",
      timestamp: "2025-01-15T10:01:35.000Z",
      summary: "Compacted initial conversation about parser bug #42 and test failures",
      tokensBefore: 48000,
    },
  ];

  const labels = new Map<string, string>([
    ["user-msg-1", "repro-checkpoint"],
    ["asst-msg-1", "root-cause-analysis"],
  ]);

  return {
    getEntries: () => entries,
    getBranch: () => entries,
    getLabel: (id: string) => labels.get(id),
  };
}

test("extractNavigatableEntries extracts user, assistant, tool, error, label, and compaction entries safely", () => {
  const sessionManager = createMockSessionManager();
  const items = extractNavigatableEntries(sessionManager);

  assert.ok(Array.isArray(items), "Expected array of NavigatableItem");
  assert.ok(items.length >= 8, `Expected at least 8 items, got ${items.length}`);

  // 1. User message
  const userItem = items.find((i) => i.id === "user-msg-1");
  assert.ok(userItem, "User message item must be extracted");
  assert.equal(userItem.category, "user");
  assert.equal(userItem.role, "user");
  assert.match(userItem.title, /How do I fix bug #42/);
  assert.match(userItem.preview, /How do I fix bug #42 in the parser\?/);
  assert.equal(userItem.label, "repro-checkpoint");

  // 2. Assistant message with reasoning indicator
  const asstItem = items.find((i) => i.id === "asst-msg-1");
  assert.ok(asstItem, "Assistant message item must be extracted");
  assert.equal(asstItem.category, "assistant");
  assert.equal(asstItem.role, "assistant");
  assert.match(asstItem.title, /Assistant \[thinking\]/);
  assert.match(asstItem.preview, /\[thinking\]/);
  assert.equal(asstItem.label, "root-cause-analysis");

  // 3. Tool call / result
  const toolItem = items.find((i) => i.id === "tool-res-1");
  assert.ok(toolItem, "Tool result item must be extracted");
  assert.equal(toolItem.category, "tool");
  assert.equal(toolItem.role, "toolResult");
  assert.match(toolItem.title, /Tool: read \(success\)/);
  assert.match(toolItem.preview, /src\/parser\.ts/);

  // 4. Failed bash execution
  const bashItem = items.find((i) => i.id === "bash-exec-1");
  assert.ok(bashItem, "Bash execution item must be extracted");
  assert.equal(bashItem.category, "error");
  assert.equal(bashItem.isError, true);
  assert.match(bashItem.title, /Bash: npm test \(error\)/);
  assert.match(bashItem.preview, /AssertionError/);

  // 5. Assistant error
  const asstErrItem = items.find((i) => i.id === "asst-err-1");
  assert.ok(asstErrItem, "Assistant error item must be extracted");
  assert.equal(asstErrItem.category, "error");
  assert.equal(asstErrItem.isError, true);
  assert.match(asstErrItem.preview, /API gateway connection timed out/);

  // 6. Standalone error
  const rawErrItem = items.find((i) => i.id === "raw-err-1");
  assert.ok(rawErrItem, "Standalone error item must be extracted");
  assert.equal(rawErrItem.category, "error");
  assert.equal(rawErrItem.isError, true);
  assert.match(rawErrItem.preview, /Failed to reload extension plugin/);

  // 7. Label entry
  const labelItem = items.find((i) => i.id === "label-entry-1");
  assert.ok(labelItem, "Label entry item must be extracted");
  assert.equal(labelItem.category, "bookmark");
  assert.equal(labelItem.role, "bookmark");
  assert.equal(labelItem.label, "repro-checkpoint");
  assert.equal(labelItem.targetId, "user-msg-1");

  // 8. Compaction entry
  const compactionItem = items.find((i) => i.id === "compaction-1");
  assert.ok(compactionItem, "Compaction item must be extracted");
  assert.equal(compactionItem.category, "assistant");
  assert.equal(compactionItem.role, "compaction");
  assert.match(compactionItem.title, /Compaction \(48k tokens\)/);
  assert.match(compactionItem.preview, /Compacted initial conversation/);
});

test("filterNavEntries filters by category across 'all', 'user', 'assistant', 'tool', 'error', 'bookmark'", () => {
  const sessionManager = createMockSessionManager();
  const allItems = extractNavigatableEntries(sessionManager);

  // Category 'all'
  const allFiltered = filterNavEntries(allItems, "", "all");
  assert.equal(allFiltered.length, allItems.length);

  // Category 'user'
  const userFiltered = filterNavEntries(allItems, "", "user");
  assert.ok(userFiltered.length > 0);
  assert.ok(userFiltered.every((i) => i.category === "user" || i.role === "user"));
  assert.ok(userFiltered.some((i) => i.id === "user-msg-1"));

  // Category 'assistant'
  const asstFiltered = filterNavEntries(allItems, "", "assistant");
  assert.ok(asstFiltered.length > 0);
  assert.ok(asstFiltered.every((i) => i.category === "assistant" || i.role === "assistant"));
  assert.ok(asstFiltered.some((i) => i.id === "asst-msg-1"));
  assert.ok(asstFiltered.some((i) => i.id === "compaction-1"));

  // Category 'tool'
  const toolFiltered = filterNavEntries(allItems, "", "tool");
  assert.ok(toolFiltered.length > 0);
  assert.ok(
    toolFiltered.every(
      (i) =>
        i.category === "tool" ||
        i.role === "toolResult" ||
        i.role === "bashExecution" ||
        i.role === "tool",
    ),
  );
  assert.ok(toolFiltered.some((i) => i.id === "tool-res-1"));
  assert.ok(toolFiltered.some((i) => i.id === "bash-exec-1"));

  // Category 'error'
  const errorFiltered = filterNavEntries(allItems, "", "error");
  assert.ok(errorFiltered.length >= 3);
  assert.ok(errorFiltered.every((i) => i.category === "error" || i.isError === true));
  assert.ok(errorFiltered.some((i) => i.id === "bash-exec-1"));
  assert.ok(errorFiltered.some((i) => i.id === "asst-err-1"));
  assert.ok(errorFiltered.some((i) => i.id === "raw-err-1"));

  // Category 'bookmark'
  const bookmarkFiltered = filterNavEntries(allItems, "", "bookmark");
  assert.ok(bookmarkFiltered.length >= 2);
  assert.ok(bookmarkFiltered.every((i) => i.category === "bookmark" || Boolean(i.label)));
  assert.ok(bookmarkFiltered.some((i) => i.id === "label-entry-1"));
  assert.ok(bookmarkFiltered.some((i) => i.id === "user-msg-1" && i.label === "repro-checkpoint"));
  assert.ok(bookmarkFiltered.some((i) => i.id === "asst-msg-1" && i.label === "root-cause-analysis"));
});

test("filterNavEntries filters by search query matching title, preview, role, or label", () => {
  const sessionManager = createMockSessionManager();
  const allItems = extractNavigatableEntries(sessionManager);

  // Match title
  const matchTitle = filterNavEntries(allItems, "bug #42", "all");
  assert.ok(matchTitle.length >= 2);
  assert.ok(matchTitle.some((i) => i.id === "user-msg-1"));
  assert.ok(matchTitle.some((i) => i.id === "compaction-1"));

  // Match preview
  const matchPreview = filterNavEntries(allItems, "AssertionError", "all");
  assert.equal(matchPreview.length, 1);
  assert.equal(matchPreview[0]?.id, "bash-exec-1");

  // Match role
  const matchRole = filterNavEntries(allItems, "compaction", "all");
  assert.ok(matchRole.some((i) => i.id === "compaction-1"));

  // Match label
  const matchLabel = filterNavEntries(allItems, "root-cause-analysis", "all");
  assert.ok(matchLabel.some((i) => i.id === "asst-msg-1"));

  // Case-insensitive matching
  const matchCase = filterNavEntries(allItems, "PARSER", "all");
  assert.ok(matchCase.length >= 2);

  // Combined search query with category filter
  const matchCategoryAndQuery = filterNavEntries(allItems, "timeout", "error");
  assert.equal(matchCategoryAndQuery.length, 1);
  assert.equal(matchCategoryAndQuery[0]?.id, "asst-err-1");

  // Non-matching query returns empty array
  const noMatch = filterNavEntries(allItems, "xyz-nonexistent-query-987", "all");
  assert.equal(noMatch.length, 0);
});

test("component renders cleanly across widths (120, 80, 40, 20 cols) and themes without overflowing", () => {
  const sessionManager = createMockSessionManager();
  const realTheme = getRealTheme();
  const mockTheme = getMockTheme();
  const keybindings = new KeybindingsManager(TUI_KEYBINDINGS);

  for (const theme of [realTheme, mockTheme]) {
    for (const width of [120, 80, 40, 20]) {
      const tui = createMockTui();
      let closedValue: unknown;
      const done = (val?: unknown) => {
        closedValue = val;
      };

      const ctx = { sessionManager } as unknown as ExtensionContext;
      const component = createConversationNavigatorComponent(tui, theme, keybindings, done, ctx);

      assert.ok(component, `Component should be created for width ${width}`);
      const lines = component.render(width);

      assert.ok(Array.isArray(lines), `Lines should be an array for width ${width}`);
      assert.ok(lines.length >= 10, `Expected at least 10 lines rendered, got ${lines.length}`);

      // Verify no line exceeds the requested width
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const clean = stripTerminalSequences(line);
        const w = visibleWidth(clean);
        assert.ok(
          w <= width,
          `Line ${i} visible width (${w}) exceeds terminal width (${width}) for line: "${clean}"`,
        );
      }

      // Verify title or navigator marker is present
      const fullText = lines.map((l) => stripTerminalSequences(l)).join("\n");
      if (width >= 30) {
        assert.match(fullText, /Conversation Navigator/);
      } else {
        assert.match(fullText, /Navigator/);
      }

      // Verify category indicators are rendered
      assert.match(fullText, /Filter:/);

      // Verify entry badges are visible
      assert.match(fullText, /\[USER\]|\[ASST\]|\[TOOL\]|\[ERR \]|\[MARK\]/);
    }
  }
});

test("keyboard navigation updates search query, selection, category cycling, and actions", () => {
  const sessionManager = createMockSessionManager();
  const theme = getMockTheme();
  const keybindings = new KeybindingsManager(TUI_KEYBINDINGS);
  const tui = createMockTui();

  let jumpTargetId: string | undefined;
  let closedResult: unknown;

  const done = (val?: unknown) => {
    closedResult = val;
  };

  const ctx = { sessionManager } as unknown as ExtensionContext;
  const component = new ConversationNavigatorComponent(tui, theme, keybindings, done, ctx, {
    onJumpToEntry: (id) => {
      jumpTargetId = id;
    },
  });

  // Initial state
  assert.equal(component.getSearchQuery(), "");
  assert.equal(component.getCurrentCategory(), "all");
  assert.equal(component.getSelectedIndex(), 0);
  assert.ok(component.getFilteredEntries().length > 0);

  // 1. Typing characters updates search filter
  component.handleInput("p");
  component.handleInput("a");
  component.handleInput("r");
  component.handleInput("s");
  component.handleInput("e");
  component.handleInput("r");

  assert.equal(component.getSearchQuery(), "parser");
  const filtered = component.getFilteredEntries();
  assert.ok(filtered.length > 0);
  assert.ok(
    filtered.every((item) =>
      item.title.toLowerCase().includes("parser") ||
      item.preview.toLowerCase().includes("parser") ||
      (item.label && item.label.toLowerCase().includes("parser")),
    ),
  );

  // 2. Backspace removes last character
  component.handleInput("\x7f");
  assert.equal(component.getSearchQuery(), "parse");

  // Clear query by backspacing all remaining chars
  component.handleInput("\x7f");
  component.handleInput("\x7f");
  component.handleInput("\x7f");
  component.handleInput("\x7f");
  component.handleInput("\x7f");
  assert.equal(component.getSearchQuery(), "");

  // 3. Down arrow increments selection
  const totalItems = component.getFilteredEntries().length;
  assert.equal(component.getSelectedIndex(), 0);

  component.handleInput("\x1b[B"); // Down arrow
  assert.equal(component.getSelectedIndex(), 1);

  component.handleInput("\x1b[B"); // Down arrow
  assert.equal(component.getSelectedIndex(), 2);

  // 4. Up arrow decrements selection
  component.handleInput("\x1b[A"); // Up arrow
  assert.equal(component.getSelectedIndex(), 1);

  // Wraparound on Up arrow from 0
  component.handleInput("\x1b[A"); // to 0
  assert.equal(component.getSelectedIndex(), 0);
  component.handleInput("\x1b[A"); // wrap to bottom
  assert.equal(component.getSelectedIndex(), totalItems - 1);

  // Wraparound on Down arrow from bottom
  component.handleInput("\x1b[B"); // wrap to 0
  assert.equal(component.getSelectedIndex(), 0);

  // 5. Category cycling forward via Tab and Right arrow
  assert.equal(component.getCurrentCategory(), "all");

  component.handleInput("\t"); // Tab -> user
  assert.equal(component.getCurrentCategory(), "user");

  component.handleInput("\x1b[C"); // Right arrow -> assistant
  assert.equal(component.getCurrentCategory(), "assistant");

  component.handleInput("\t"); // Tab -> tool
  assert.equal(component.getCurrentCategory(), "tool");

  component.handleInput("\t"); // Tab -> error
  assert.equal(component.getCurrentCategory(), "error");

  component.handleInput("\t"); // Tab -> bookmark
  assert.equal(component.getCurrentCategory(), "bookmark");

  component.handleInput("\t"); // Tab -> back to all
  assert.equal(component.getCurrentCategory(), "all");

  // 6. Category cycling backward via Shift+Tab and Left arrow
  component.handleInput("\x1b[Z"); // Shift+Tab -> bookmark
  assert.equal(component.getCurrentCategory(), "bookmark");

  component.handleInput("\x1b[D"); // Left arrow -> error
  assert.equal(component.getCurrentCategory(), "error");

  // 7. Enter selects entry and invokes onJumpToEntry
  const selectedBeforeEnter = component.getSelectedEntry();
  assert.ok(selectedBeforeEnter, "Should have a selected entry");

  component.handleInput("\r"); // Enter
  assert.equal(jumpTargetId, selectedBeforeEnter.id);
  assert.equal((closedResult as NavigatableItem)?.id, selectedBeforeEnter.id);

  // 8. Esc calls done()
  let escClosed = false;
  const escComponent = new ConversationNavigatorComponent(
    tui,
    theme,
    keybindings,
    () => {
      escClosed = true;
    },
    ctx,
  );

  escComponent.handleInput("\x1b"); // Escape
  assert.equal(escClosed, true);
});

test("empty session and invalid session manager handle gracefully without crashing", () => {
  const theme = getMockTheme();
  const keybindings = new KeybindingsManager(TUI_KEYBINDINGS);
  const tui = createMockTui();

  // Test extractNavigatableEntries with missing/invalid inputs
  assert.deepEqual(extractNavigatableEntries(null), []);
  assert.deepEqual(extractNavigatableEntries(undefined), []);
  assert.deepEqual(extractNavigatableEntries("not-an-object"), []);
  assert.deepEqual(extractNavigatableEntries(42), []);
  assert.deepEqual(extractNavigatableEntries({}), []);
  assert.deepEqual(extractNavigatableEntries({ getEntries: () => [] }), []);
  assert.deepEqual(
    extractNavigatableEntries({
      getEntries: () => {
        throw new Error("Disk read failure");
      },
    }),
    [],
  );

  // Test filterNavEntries with empty or invalid inputs
  assert.deepEqual(filterNavEntries([], "", "all"), []);
  assert.deepEqual(filterNavEntries(null as any, "test", "user"), []);

  // Test component initialized with empty session
  let closed = false;
  const emptyCtx = { sessionManager: { getEntries: () => [] } } as unknown as ExtensionContext;
  const emptyComponent = new ConversationNavigatorComponent(
    tui,
    theme,
    keybindings,
    () => {
      closed = true;
    },
    emptyCtx,
  );

  assert.equal(emptyComponent.getAllEntries().length, 0);
  assert.equal(emptyComponent.getFilteredEntries().length, 0);
  assert.equal(emptyComponent.getSelectedEntry(), undefined);

  // Render empty state across widths
  for (const width of [120, 80, 40, 20]) {
    const lines = emptyComponent.render(width);
    assert.ok(Array.isArray(lines));
    assert.ok(lines.length >= 6);

    const fullText = lines.map((l) => stripTerminalSequences(l)).join("\n");
    assert.match(fullText, /No conversation/);

    for (let i = 0; i < lines.length; i++) {
      const clean = stripTerminalSequences(lines[i]!);
      const w = visibleWidth(clean);
      assert.ok(w <= width, `Line ${i} width (${w}) exceeds terminal width (${width})`);
    }
  }

  // Key navigation on empty component does not throw
  emptyComponent.handleInput("\x1b[B"); // Down
  emptyComponent.handleInput("\x1b[A"); // Up
  emptyComponent.handleInput("\t"); // Tab
  emptyComponent.handleInput("search"); // Typing
  emptyComponent.handleInput("\x7f"); // Backspace

  // Enter on empty component closes safely
  emptyComponent.handleInput("\r");
  assert.equal(closed, true);
});

test("initialFilter option preselects category on initialization", () => {
  const sessionManager = createMockSessionManager();
  const theme = getMockTheme();
  const keybindings = new KeybindingsManager(TUI_KEYBINDINGS);
  const tui = createMockTui();
  const ctx = { sessionManager } as unknown as ExtensionContext;

  for (const cat of NAV_CATEGORIES) {
    const comp = new ConversationNavigatorComponent(
      tui,
      theme,
      keybindings,
      () => {},
      ctx,
      { initialFilter: cat },
    );
    assert.equal(comp.getCurrentCategory(), cat);
  }
});
