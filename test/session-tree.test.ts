import assert from "node:assert/strict";
import { test } from "node:test";
import {
  KeybindingsManager,
  TUI_KEYBINDINGS,
  stripTerminalSequences,
  visibleWidth,
  type TUI,
} from "@earendil-works/pi-tui";
import { type Theme, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  buildSessionTreeItems,
  flattenSessionTree,
  filterTreeNodes,
  extractEntrySummary,
  createSessionTreeComponent,
  SessionTreeComponent,
  type DisplayTreeNode,
} from "../extensions/omt/features/session-tree/index.ts";
import type { SessionTreeNodeItem } from "../extensions/omt/features/session-tree/types.ts";

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
 * Helper to get configured KeybindingsManager.
 */
function getKeybindings(): KeybindingsManager {
  return new KeybindingsManager(TUI_KEYBINDINGS);
}

/**
 * Sample flat session entries with branching.
 * Root: node-root
 * Branch 1: node-root -> node-msg1 -> node-leaf1
 * Branch 2: node-root -> node-msg2 -> node-leaf2
 */
function createSampleFlatEntries() {
  return [
    {
      id: "node-root",
      parentId: null,
      type: "message",
      timestamp: "2025-01-15T10:00:00.000Z",
      message: { role: "user", content: "How do I build a parser in TypeScript?" },
    },
    {
      id: "node-msg1",
      parentId: "node-root",
      type: "message",
      timestamp: "2025-01-15T10:00:05.000Z",
      message: { role: "assistant", content: "Use a recursive descent approach." },
    },
    {
      id: "node-leaf1",
      parentId: "node-msg1",
      type: "message",
      timestamp: "2025-01-15T10:00:10.000Z",
      message: { role: "user", content: "Can you show the tokenizer implementation?" },
    },
    {
      id: "node-msg2",
      parentId: "node-root",
      type: "message",
      timestamp: "2025-01-15T10:01:00.000Z",
      message: { role: "assistant", content: "Alternative: use a parser generator like PEG.js." },
    },
    {
      id: "node-leaf2",
      parentId: "node-msg2",
      type: "compaction",
      timestamp: "2025-01-15T10:01:30.000Z",
      summary: "Compacted alternative grammar notes",
    },
    // User label on node-msg1
    {
      id: "label-1",
      parentId: "node-msg1",
      type: "label",
      targetId: "node-msg1",
      label: "recursive-descent-bookmark",
    },
  ];
}

// ============================================================================
// 1. Session Tree Parsing & Branch Resolution Tests
// ============================================================================

test("buildSessionTreeItems parses flat entries into hierarchical tree with branch resolution", () => {
  const entries = createSampleFlatEntries();
  const roots = buildSessionTreeItems(entries, "node-leaf1");

  assert.equal(roots.length, 1);
  const root = roots[0]!;
  assert.equal(root.id, "node-root");
  assert.equal(root.isLeaf, false);
  assert.equal(root.isCurrent, false);
  assert.ok(root.summary?.includes("How do I build a parser"));

  // Root should have 2 children: node-msg1 and node-msg2
  assert.equal(root.children.length, 2);

  const child1 = root.children.find((c) => c.id === "node-msg1");
  assert.ok(child1);
  assert.equal(child1.label, "recursive-descent-bookmark");
  assert.equal(child1.children.length, 1);

  const leaf1 = child1.children[0]!;
  assert.equal(leaf1.id, "node-leaf1");
  assert.equal(leaf1.isLeaf, true);
  assert.equal(leaf1.isCurrent, true); // Active leaf

  const child2 = root.children.find((c) => c.id === "node-msg2");
  assert.ok(child2);
  assert.equal(child2.children.length, 1);

  const leaf2 = child2.children[0]!;
  assert.equal(leaf2.id, "node-leaf2");
  assert.equal(leaf2.isLeaf, true);
  assert.equal(leaf2.isCurrent, false);
  assert.ok(leaf2.summary?.includes("Compaction:"));
});

test("buildSessionTreeItems parses Pi nested SessionTreeNode[]", () => {
  const piTree = [
    {
      entry: {
        id: "pi-root",
        parentId: null,
        type: "message",
        message: { role: "user", content: "Pi Native Root" },
      },
      label: "root-marker",
      children: [
        {
          entry: {
            id: "pi-leaf",
            parentId: "pi-root",
            type: "message",
            message: { role: "assistant", content: "Pi Native Leaf" },
          },
          children: [],
        },
      ],
    },
  ];

  const roots = buildSessionTreeItems(piTree, "pi-leaf");
  assert.equal(roots.length, 1);
  assert.equal(roots[0]!.id, "pi-root");
  assert.equal(roots[0]!.label, "root-marker");
  assert.equal(roots[0]!.children.length, 1);
  assert.equal(roots[0]!.children[0]!.id, "pi-leaf");
  assert.equal(roots[0]!.children[0]!.isLeaf, true);
  assert.equal(roots[0]!.children[0]!.isCurrent, true);
});

test("buildSessionTreeItems parses pre-nested SessionTreeNodeItem[]", () => {
  const preNested: SessionTreeNodeItem[] = [
    {
      id: "pre-root",
      parentId: null,
      type: "user",
      summary: "User Prompt",
      children: [
        {
          id: "pre-child",
          parentId: "pre-root",
          type: "assistant",
          summary: "Assistant Reply",
          children: [],
        },
      ],
    },
  ];

  const roots = buildSessionTreeItems(preNested, "pre-child");
  assert.equal(roots.length, 1);
  assert.equal(roots[0]!.id, "pre-root");
  assert.equal(roots[0]!.children[0]!.id, "pre-child");
  assert.equal(roots[0]!.children[0]!.isLeaf, true);
  assert.equal(roots[0]!.children[0]!.isCurrent, true);
});

test("extractEntrySummary extracts clean summaries across entry types", () => {
  // 1. User message
  assert.ok(
    extractEntrySummary({ message: { role: "user", content: "Hello world" } }).includes("User: Hello world"),
  );

  // 2. Assistant thinking and text
  assert.ok(
    extractEntrySummary({
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Analyzing..." },
          { type: "text", text: "Got it" },
        ],
      },
    }).includes("Assistant:"),
  );

  // 3. Tool result
  assert.ok(
    extractEntrySummary({
      message: { role: "toolResult", toolName: "read", content: "file content" },
    }).includes("Result (read):"),
  );

  // 4. Compaction
  assert.equal(
    extractEntrySummary({ type: "compaction", summary: "Context compacted" }),
    "Compaction: Context compacted",
  );

  // 5. Model change
  assert.equal(
    extractEntrySummary({ type: "model_change", provider: "anthropic", modelId: "claude-3-5-sonnet" }),
    "Model: anthropic/claude-3-5-sonnet",
  );

  // 6. Thinking level change
  assert.equal(
    extractEntrySummary({ type: "thinking_level_change", thinkingLevel: "high" }),
    "Thinking: high",
  );
});

test("buildSessionTreeItems handles empty, null, and circular parent references safely", () => {
  assert.deepEqual(buildSessionTreeItems([]), []);
  assert.deepEqual(buildSessionTreeItems(null as any), []);

  // Circular parent reference: A -> B -> A
  const circularEntries = [
    { id: "node-A", parentId: "node-B", type: "message", message: { content: "A" } },
    { id: "node-B", parentId: "node-A", type: "message", message: { content: "B" } },
  ];

  const roots = buildSessionTreeItems(circularEntries);
  assert.ok(Array.isArray(roots));
  // Does not loop infinitely
  const flat = flattenSessionTree(roots);
  assert.ok(flat.length <= 2);
});

// ============================================================================
// 2. ASCII Tree Visualization & Formatting Tests
// ============================================================================

test("flattenSessionTree formats tree with clean ASCII connectors (├──, └──, │)", () => {
  const tree: SessionTreeNodeItem[] = [
    {
      id: "root",
      parentId: null,
      type: "user",
      summary: "Root question",
      children: [
        {
          id: "child-1",
          parentId: "root",
          type: "assistant",
          summary: "First branch",
          children: [
            {
              id: "grandchild-1",
              parentId: "child-1",
              type: "tool",
              summary: "Tool call",
              children: [],
              isLeaf: true,
            },
          ],
        },
        {
          id: "child-2",
          parentId: "root",
          type: "assistant",
          summary: "Second branch",
          children: [],
          isLeaf: true,
        },
      ],
    },
  ];

  const flat = flattenSessionTree(tree);

  assert.equal(flat.length, 4);

  // Root node prefix
  assert.equal(flat[0]!.node.id, "root");
  assert.equal(flat[0]!.prefix, "• ");

  // Child 1 (first child -> ├── )
  assert.equal(flat[1]!.node.id, "child-1");
  assert.ok(flat[1]!.prefix.includes("├── "));

  // Grandchild 1 (only child of Child 1 -> └── with guide from parent)
  assert.equal(flat[2]!.node.id, "grandchild-1");
  assert.ok(flat[2]!.prefix.includes("│   └── ") || flat[2]!.prefix.includes("└── "));

  // Child 2 (last child of root -> └── )
  assert.equal(flat[3]!.node.id, "child-2");
  assert.ok(flat[3]!.prefix.includes("└── "));
});

test("filterTreeNodes filters nodes by ID, role, summary, or label", () => {
  const items: DisplayTreeNode[] = [
    {
      node: { id: "node-alpha", parentId: null, type: "user", summary: "Compile parser", children: [] },
      depth: 0,
      prefix: "├── ",
      connector: "├── ",
      guidePrefix: "",
      isLastChild: false,
    },
    {
      node: { id: "node-beta", parentId: null, type: "assistant", summary: "Grammar verified", label: "my-label", children: [] },
      depth: 0,
      prefix: "└── ",
      connector: "└── ",
      guidePrefix: "",
      isLastChild: true,
    },
  ];

  assert.equal(filterTreeNodes(items, "").length, 2);
  assert.equal(filterTreeNodes(items, "alpha").length, 1);
  assert.equal(filterTreeNodes(items, "assistant").length, 1);
  assert.equal(filterTreeNodes(items, "verified").length, 1);
  assert.equal(filterTreeNodes(items, "my-label").length, 1);
  assert.equal(filterTreeNodes(items, "unknown").length, 0);
});

// ============================================================================
// 3. SessionTreeComponent Interactive UI & Keyboard Navigation
// ============================================================================

test("SessionTreeComponent renders cleanly across 120, 80, 40, and 20 columns", () => {
  const theme = getMockTheme();
  const tui = createMockTui();
  const keybindings = getKeybindings();
  const treeRoots = buildSessionTreeItems(createSampleFlatEntries(), "node-leaf1");

  let doneValue: unknown = undefined;
  const done = (val?: unknown) => {
    doneValue = val;
  };
  const ctx = { cwd: "/tmp" } as ExtensionContext;

  const component = new SessionTreeComponent(tui, theme, keybindings, done, ctx, {
    tree: treeRoots,
    currentLeafId: "node-leaf1",
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
        `Tree row width ${width} must not exceed viewport width ${w} (row: "${stripped}")`,
      );
    }
  }
});

test("SessionTreeComponent displays leaf markers (leaf) and current position marker *", () => {
  const theme = getMockTheme();
  const tui = createMockTui();
  const keybindings = getKeybindings();
  const treeRoots = buildSessionTreeItems(createSampleFlatEntries(), "node-leaf1");

  const component = new SessionTreeComponent(tui, theme, keybindings, () => {}, {} as any, {
    tree: treeRoots,
    currentLeafId: "node-leaf1",
  });

  const lines = component.render(120);
  const fullText = lines.map(stripTerminalSequences).join("\n");

  assert.ok(fullText.includes("(leaf)"), "Renders (leaf) marker for leaf nodes");
  assert.ok(fullText.includes("*"), "Renders * marker for current position");
  assert.ok(fullText.includes("recursive-descent-bookmark"), "Renders label/bookmark");
});

test("Keyboard navigation: Up/Down arrow moves selection index", () => {
  const theme = getMockTheme();
  const tui = createMockTui();
  const keybindings = getKeybindings();
  const treeRoots = buildSessionTreeItems(createSampleFlatEntries(), "node-leaf1");

  const component = new SessionTreeComponent(tui, theme, keybindings, () => {}, {} as any, {
    tree: treeRoots,
  });

  assert.equal(component.getSelectedIndex(), 0);

  // Down arrow
  component.handleInput("\x1b[B");
  assert.equal(component.getSelectedIndex(), 1);

  // Down arrow again
  component.handleInput("\x1b[B");
  assert.equal(component.getSelectedIndex(), 2);

  // Up arrow
  component.handleInput("\x1b[A");
  assert.equal(component.getSelectedIndex(), 1);
});

test("Actions: Enter jumps to selected node and calls onJumpToNode callback", () => {
  const theme = getMockTheme();
  const tui = createMockTui();
  const keybindings = getKeybindings();
  const treeRoots = buildSessionTreeItems(createSampleFlatEntries(), "node-leaf1");

  let jumpedNodeId: string | undefined;
  let doneVal: unknown = undefined;

  const component = new SessionTreeComponent(
    tui,
    theme,
    keybindings,
    (val) => {
      doneVal = val;
    },
    {} as any,
    {
      tree: treeRoots,
      onJumpToNode: (id) => {
        jumpedNodeId = id;
      },
    },
  );

  // Move down to first child
  component.handleInput("\x1b[B");
  const expectedId = component.getSelectedNode()?.id;

  // Press Enter
  component.handleInput("\r");

  assert.equal(jumpedNodeId, expectedId);
  assert.equal(doneVal, expectedId);
});

test("Actions: 'f' forks from selected node and calls onForkNode callback", () => {
  const theme = getMockTheme();
  const tui = createMockTui();
  const keybindings = getKeybindings();
  const treeRoots = buildSessionTreeItems(createSampleFlatEntries(), "node-leaf1");

  let forkedNodeId: string | undefined;

  const component = new SessionTreeComponent(tui, theme, keybindings, () => {}, {} as any, {
    tree: treeRoots,
    onForkNode: (id) => {
      forkedNodeId = id;
    },
  });

  const targetId = component.getSelectedNode()?.id;
  // Press 'f'
  component.handleInput("f");

  assert.equal(forkedNodeId, targetId);
});

test("Search filtering: '/' activates search and filters tree items", () => {
  const theme = getMockTheme();
  const tui = createMockTui();
  const keybindings = getKeybindings();
  const treeRoots = buildSessionTreeItems(createSampleFlatEntries(), "node-leaf1");

  const component = new SessionTreeComponent(tui, theme, keybindings, () => {}, {} as any, {
    tree: treeRoots,
  });

  // Press '/' to search
  component.handleInput("/");
  // Type 't' 'o' 'k' 'e' 'n'
  component.handleInput("t");
  component.handleInput("o");
  component.handleInput("k");
  component.handleInput("e");
  component.handleInput("n");

  assert.equal(component.getQuery(), "token");
  assert.ok(component.getSelectedNode()?.summary?.includes("tokenizer"));

  // Press Esc to clear search query
  component.handleInput("\x1b");
  assert.equal(component.getQuery(), "");
});

test("Actions: 'c' copies node info and 'q' closes component", () => {
  const theme = getMockTheme();
  const tui = createMockTui();
  const keybindings = getKeybindings();
  const treeRoots = buildSessionTreeItems(createSampleFlatEntries(), "node-leaf1");

  let closed = false;
  const component = new SessionTreeComponent(
    tui,
    theme,
    keybindings,
    () => {
      closed = true;
    },
    {} as any,
    { tree: treeRoots },
  );

  // Press 'c' to copy
  component.handleInput("c");

  // Press 'q' to close
  component.handleInput("q");
  assert.equal(closed, true);
});

test("createSessionTreeComponent factory satisfies factory interface", () => {
  const theme = getMockTheme();
  const tui = createMockTui();
  const keybindings = getKeybindings();

  const comp = createSessionTreeComponent(
    tui,
    theme,
    keybindings,
    () => {},
    {} as any,
    { tree: [] },
  );

  assert.ok(comp);
  assert.equal(typeof comp.render, "function");
  assert.equal(typeof comp.handleInput, "function");
});
