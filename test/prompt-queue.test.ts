import assert from "node:assert/strict";
import { test } from "node:test";
import { Key, visibleWidth, type KeybindingsManager, type TUI } from "@earendil-works/pi-tui";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  PromptQueueStore,
  formatQueueStatus,
  createPromptQueueComponent,
  PromptQueueComponent,
  type QueuedPrompt,
} from "../extensions/omt/features/prompt-queue/index.ts";

/**
 * Fixture: Theme with ANSI formatting sequences.
 */
function createAnsiTheme(): Theme {
  return {
    appearance: "dark",
    bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
    fg: (_color: string, text: string) => `\x1b[36m${text}\x1b[39m`,
    bg: (_color: string, text: string) => `\x1b[40m${text}\x1b[49m`,
    style: (text: string) => text,
  } as unknown as Theme;
}

/**
 * Fixture: Plain theme without ANSI styling.
 */
function createPlainTheme(): Theme {
  return {
    appearance: "light",
    bold: (text: string) => text,
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    style: (text: string) => text,
  } as unknown as Theme;
}

/**
 * Fixture: Mock TUI.
 */
function createMockTui(): TUI & { renderRequests: number } {
  let count = 0;
  return {
    renderRequests: 0,
    requestRender: () => {
      count++;
    },
    get renderCount() {
      return count;
    },
  } as unknown as TUI & { renderRequests: number };
}

/**
 * Fixture: Mock KeybindingsManager.
 */
function createMockKeybindings(): KeybindingsManager {
  return {
    matches: () => false,
  } as unknown as KeybindingsManager;
}

/**
 * Fixture: Mock ExtensionContext.
 */
function createMockContext(): ExtensionContext {
  return {
    hasUI: true,
    ui: {
      notify: () => {},
    },
  } as unknown as ExtensionContext;
}

test("PromptQueueStore: enqueue, dequeue, peek, and count operations", () => {
  const store = new PromptQueueStore();
  assert.equal(store.count(), 0);
  assert.equal(store.dequeue(), null);
  assert.equal(store.peek(), null);

  const p1 = store.enqueue("First prompt", "followUp");
  assert.ok(p1.id.startsWith("prompt_"));
  assert.equal(p1.text, "First prompt");
  assert.equal(p1.deliverAs, "followUp");
  assert.equal(p1.status, "queued");
  assert.ok(p1.timestamp > 0);
  assert.equal(store.count(), 1);

  const p2 = store.enqueue("Steering prompt", "steer");
  assert.equal(p2.deliverAs, "steer");
  assert.equal(store.count(), 2);
  assert.equal(store.getSteerCount(), 1);

  // Peek returns head without removing
  assert.equal(store.peek()?.id, p1.id);
  assert.equal(store.count(), 2);

  // Dequeue removes head (FIFO)
  const dequeued = store.dequeue();
  assert.equal(dequeued?.id, p1.id);
  assert.equal(store.count(), 1);

  const dequeued2 = store.dequeue();
  assert.equal(dequeued2?.id, p2.id);
  assert.equal(store.count(), 0);
  assert.equal(store.dequeue(), null);
});

test("PromptQueueStore: promote moves prompt to the head of the queue", () => {
  const store = new PromptQueueStore();
  const p1 = store.enqueue("Prompt 1", "followUp");
  const p2 = store.enqueue("Prompt 2", "followUp");
  const p3 = store.enqueue("Prompt 3", "steer");

  assert.equal(store.getAll()[0]?.id, p1.id);
  assert.equal(store.getAll()[1]?.id, p2.id);
  assert.equal(store.getAll()[2]?.id, p3.id);

  // Promoting p3 moves it to index 0
  const promoted = store.promote(p3.id);
  assert.equal(promoted, true);
  assert.equal(store.getAll()[0]?.id, p3.id);
  assert.equal(store.getAll()[1]?.id, p1.id);
  assert.equal(store.getAll()[2]?.id, p2.id);

  // Promoting unknown id returns false
  assert.equal(store.promote("nonexistent-id"), false);
});

test("PromptQueueStore: remove, clear, and delivery mode updates", () => {
  const store = new PromptQueueStore();
  const p1 = store.enqueue("P1", "followUp");
  const p2 = store.enqueue("P2", "followUp");

  // Remove by ID
  assert.equal(store.remove(p1.id), true);
  assert.equal(store.remove(p1.id), false);
  assert.equal(store.count(), 1);
  assert.equal(store.getAll()[0]?.id, p2.id);

  // Toggle delivery mode
  assert.equal(store.toggleDeliveryMode(p2.id), true);
  assert.equal(store.get(p2.id)?.deliverAs, "steer");
  assert.equal(store.toggleDeliveryMode(p2.id), true);
  assert.equal(store.get(p2.id)?.deliverAs, "followUp");

  // Clear
  store.clear();
  assert.equal(store.count(), 0);
  assert.deepEqual(store.getAll(), []);
});

test("formatQueueStatus: empty queue returns empty string", () => {
  const store = new PromptQueueStore();
  const theme = createPlainTheme();
  assert.equal(formatQueueStatus(store, theme), "");
  assert.equal(formatQueueStatus([], theme), "");
});

test("formatQueueStatus: formats standard follow-up badge [Queue: 2]", () => {
  const store = new PromptQueueStore();
  store.enqueue("Prompt 1", "followUp");
  store.enqueue("Prompt 2", "followUp");
  const theme = createPlainTheme();

  const status = formatQueueStatus(store, theme);
  assert.equal(status, "[Queue: 2]");
});

test("formatQueueStatus: formats steer count [Queue: 2 (1 steer)]", () => {
  const store = new PromptQueueStore();
  store.enqueue("Normal prompt", "followUp");
  store.enqueue("Urgent steer prompt", "steer");
  const theme = createPlainTheme();

  const status = formatQueueStatus(store, theme);
  assert.equal(status, "[Queue: 2 (1 steer)]");
});

test("formatQueueStatus: adapts across terminal widths (120, 40, 20 cols)", () => {
  const store = new PromptQueueStore();
  store.enqueue("P1", "followUp");
  store.enqueue("P2", "steer");
  const theme = createPlainTheme();

  // Wide 120 cols
  const wide = formatQueueStatus(store, theme, 120);
  assert.equal(wide, "[Queue: 2 (1 steer)]");
  assert.ok(visibleWidth(wide) <= 120);

  // Medium 40 cols
  const med = formatQueueStatus(store, theme, 40);
  assert.equal(med, "[Queue: 2 (1s)]");
  assert.ok(visibleWidth(med) <= 40);

  // Ultra-narrow 20 cols
  const narrow = formatQueueStatus(store, theme, 20);
  assert.equal(narrow, "[Q:2(1s)]");
  assert.ok(visibleWidth(narrow) <= 20);
});

test("formatQueueStatus: applies theme ANSI styling properly", () => {
  const store = new PromptQueueStore();
  store.enqueue("P1", "steer");
  const theme = createAnsiTheme();

  const status = formatQueueStatus(store, theme);
  assert.ok(status.includes("["));
  assert.ok(status.includes("]"));
  assert.ok(status.includes("Queue: 1 (1 steer)"));
});

test("PromptQueueComponent: renders empty queue cleanly across widths (120, 80, 40, 20)", () => {
  const tui = createMockTui();
  const theme = createPlainTheme();
  const keybindings = createMockKeybindings();
  const ctx = createMockContext();
  let doneVal: unknown;
  const done = (val?: unknown) => {
    doneVal = val;
  };

  const comp = createPromptQueueComponent(tui, theme, keybindings, done, ctx);

  for (const width of [120, 80, 40, 20]) {
    const lines = comp.render(width);
    assert.ok(Array.isArray(lines));
    assert.ok(lines.length >= 4);

    for (let i = 0; i < lines.length; i++) {
      const w = visibleWidth(lines[i]!);
      assert.ok(
        w <= width,
        `Line ${i} visibleWidth (${w}) exceeded target (${width}): "${lines[i]}"`,
      );
    }

    const full = lines.join("\n");
    assert.match(full, /Queue is empty|Empty queue/);
  }
});

test("PromptQueueComponent: renders queued prompts with delivery mode badges across widths", () => {
  const tui = createMockTui();
  const theme = createAnsiTheme();
  const keybindings = createMockKeybindings();
  const ctx = createMockContext();
  const done = () => {};

  const prompts: QueuedPrompt[] = [
    {
      id: "p1",
      text: "Please optimize the database queries in auth.ts",
      deliverAs: "followUp",
      timestamp: Date.now() - 30000,
      status: "queued",
    },
    {
      id: "p2",
      text: "Stop and review current file edits first!",
      deliverAs: "steer",
      timestamp: Date.now() - 10000,
      status: "queued",
    },
  ];

  const comp = new PromptQueueComponent(tui, theme, keybindings, done, ctx, { prompts });

  for (const width of [120, 80, 40, 20]) {
    const lines = comp.render(width);
    assert.ok(Array.isArray(lines));
    assert.ok(lines.length >= 6);

    for (let i = 0; i < lines.length; i++) {
      const w = visibleWidth(lines[i]!);
      assert.ok(
        w <= width,
        `Line ${i} visibleWidth (${w}) exceeded target (${width}): "${lines[i]}"`,
      );
    }
  }
});

test("PromptQueueComponent: keyboard navigation and promote command", () => {
  const tui = createMockTui();
  const theme = createPlainTheme();
  const keybindings = createMockKeybindings();
  const ctx = createMockContext();
  let promotedId: string | null = null;
  const done = () => {};

  const prompts: QueuedPrompt[] = [
    {
      id: "p1",
      text: "First queued prompt",
      deliverAs: "followUp",
      timestamp: Date.now() - 20000,
      status: "queued",
    },
    {
      id: "p2",
      text: "Second queued prompt (to be promoted)",
      deliverAs: "steer",
      timestamp: Date.now() - 10000,
      status: "queued",
    },
  ];

  const comp = new PromptQueueComponent(tui, theme, keybindings, done, ctx, {
    prompts,
    onPromote: (id) => {
      promotedId = id;
    },
  });

  assert.equal(comp.getSelectedIndex(), 0);

  // Down arrow moves selection to p2
  comp.handleInput("\x1b[B");
  assert.equal(comp.getSelectedIndex(), 1);

  // 'p' promotes p2 to head of queue
  comp.handleInput("p");
  assert.equal(promotedId, "p2");
  assert.equal(comp.getQueue().getAll()[0]?.id, "p2");
  assert.equal(comp.getSelectedIndex(), 0);
});

test("PromptQueueComponent: delete, clear, and close keyboard commands", () => {
  const tui = createMockTui();
  const theme = createPlainTheme();
  const keybindings = createMockKeybindings();
  const ctx = createMockContext();
  let removedId: string | null = null;
  let cleared = false;
  let doneVal: unknown;
  const done = (val?: unknown) => {
    doneVal = val;
  };

  const prompts: QueuedPrompt[] = [
    {
      id: "p1",
      text: "Item 1",
      deliverAs: "followUp",
      timestamp: Date.now(),
      status: "queued",
    },
    {
      id: "p2",
      text: "Item 2",
      deliverAs: "followUp",
      timestamp: Date.now(),
      status: "queued",
    },
  ];

  const comp = new PromptQueueComponent(tui, theme, keybindings, done, ctx, {
    prompts,
    onRemove: (id) => {
      removedId = id;
    },
    onClear: () => {
      cleared = true;
    },
  });

  assert.equal(comp.getQueue().count(), 2);

  // 'd' removes selected item (p1)
  comp.handleInput("d");
  assert.equal(removedId, "p1");
  assert.equal(comp.getQueue().count(), 1);

  // 'c' clears remaining
  comp.handleInput("c");
  assert.equal(cleared, true);
  assert.equal(comp.getQueue().count(), 0);

  // 'q' closes component
  comp.handleInput("q");
  assert.ok(comp.isClosed());
});

test("PromptQueueComponent: enter confirms and closes with selected item", () => {
  const tui = createMockTui();
  const theme = createPlainTheme();
  const keybindings = createMockKeybindings();
  const ctx = createMockContext();
  let doneVal: unknown;
  const done = (val?: unknown) => {
    doneVal = val;
  };

  const prompts: QueuedPrompt[] = [
    {
      id: "p1",
      text: "Target prompt",
      deliverAs: "steer",
      timestamp: Date.now(),
      status: "queued",
    },
  ];

  const comp = new PromptQueueComponent(tui, theme, keybindings, done, ctx, { prompts });
  comp.handleInput("\r");

  assert.ok(comp.isClosed());
  assert.equal((doneVal as QueuedPrompt)?.id, "p1");
});
