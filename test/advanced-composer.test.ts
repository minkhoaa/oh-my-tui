import assert from "node:assert/strict";
import { test } from "node:test";
import { Key, visibleWidth, type KeybindingsManager, type TUI } from "@earendil-works/pi-tui";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  calculateComposerMetrics,
  ComposerStash,
  formatComposerStatus,
  createStashPickerComponent,
  StashPickerComponent,
  type ComposerDraft,
} from "../extensions/omt/features/advanced-composer/index.ts";

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

test("ComposerMetrics: calculates metrics for empty buffer", () => {
  const metrics = calculateComposerMetrics("");
  assert.equal(metrics.lines, 1);
  assert.equal(metrics.currentLine, 1);
  assert.equal(metrics.chars, 0);
  assert.equal(metrics.estimatedTokens, 0);
  assert.equal(metrics.isMultiLine, false);
  assert.equal(metrics.hasStash, false);
});

test("ComposerMetrics: calculates metrics for single-line text", () => {
  const text = "Fix the login authentication error";
  const metrics = calculateComposerMetrics(text);
  assert.equal(metrics.lines, 1);
  assert.equal(metrics.currentLine, 1);
  assert.equal(metrics.chars, text.length);
  assert.equal(metrics.estimatedTokens, Math.ceil(text.length / 4));
  assert.equal(metrics.isMultiLine, false);
  assert.equal(metrics.hasStash, false);
});

test("ComposerMetrics: calculates metrics for multi-line text with newlines", () => {
  const text = "First line of prompt\nSecond line\nThird line";
  const metrics = calculateComposerMetrics(text, 2);
  assert.equal(metrics.lines, 3);
  assert.equal(metrics.currentLine, 2);
  assert.equal(metrics.chars, text.length);
  assert.equal(metrics.isMultiLine, true);
  assert.equal(metrics.estimatedTokens, Math.ceil(text.length / 4));
});

test("ComposerMetrics: handles Windows CRLF line endings", () => {
  const text = "Alpha\r\nBeta\r\nGamma\r\nDelta";
  const metrics = calculateComposerMetrics(text, 3);
  assert.equal(metrics.lines, 4);
  assert.equal(metrics.currentLine, 3);
  assert.equal(metrics.isMultiLine, true);
});

test("ComposerMetrics: clamps currentLine within valid 1-indexed range", () => {
  const text = "Line 1\nLine 2";

  // Below bounds clamped to 1
  assert.equal(calculateComposerMetrics(text, 0).currentLine, 1);
  assert.equal(calculateComposerMetrics(text, -10).currentLine, 1);

  // Above bounds clamped to total lines (2)
  assert.equal(calculateComposerMetrics(text, 99).currentLine, 2);

  // Undefined defaults to 1
  assert.equal(calculateComposerMetrics(text, undefined).currentLine, 1);
});

test("ComposerMetrics: handles Unicode and accented characters accurately", () => {
  const text = "Café Münchën résumé ñ";
  const metrics = calculateComposerMetrics(text);
  assert.equal(metrics.lines, 1);
  assert.equal(metrics.chars, text.length);
  assert.equal(metrics.estimatedTokens, Math.ceil(text.length / 4));
});

test("ComposerMetrics: handles emoji and multi-byte characters cleanly", () => {
  const text = "OMT 🚀 ✨ 👨‍👩‍👧‍👦 prompt\nNext line 🌍";
  const metrics = calculateComposerMetrics(text);
  assert.equal(metrics.lines, 2);
  assert.equal(metrics.isMultiLine, true);
  assert.equal(metrics.chars, text.length);
  assert.ok(metrics.estimatedTokens > 0);
});

test("ComposerMetrics: token estimation follows ~4 chars rule of thumb", () => {
  // 4 chars -> 1 token
  assert.equal(calculateComposerMetrics("abcd").estimatedTokens, 1);
  // 5 chars -> 2 tokens (ceil)
  assert.equal(calculateComposerMetrics("abcde").estimatedTokens, 2);
  // 168 chars -> 42 tokens
  const text168 = "a".repeat(168);
  assert.equal(calculateComposerMetrics(text168).estimatedTokens, 42);
});

test("ComposerMetrics: supports boolean and options object for hasStash", () => {
  assert.equal(calculateComposerMetrics("test", 1, true).hasStash, true);
  assert.equal(calculateComposerMetrics("test", 1, false).hasStash, false);
  assert.equal(calculateComposerMetrics("test", 1, { hasStash: true }).hasStash, true);
  assert.equal(calculateComposerMetrics("test", 1, { stashCount: 3 }).hasStash, true);
  assert.equal(calculateComposerMetrics("test", 1, { stashCount: 0 }).hasStash, false);
});

test("ComposerStash: stash, peek, and count operations", () => {
  const stash = new ComposerStash();
  assert.equal(stash.count(), 0);
  assert.equal(stash.peek(), null);

  const draft1 = stash.stash("First draft text", "Title 1");
  assert.ok(draft1.id.startsWith("draft_"));
  assert.equal(draft1.text, "First draft text");
  assert.equal(draft1.title, "Title 1");
  assert.ok(draft1.timestamp > 0);
  assert.equal(stash.count(), 1);

  // Peek returns draft without removing
  const peeked = stash.peek();
  assert.equal(peeked?.id, draft1.id);
  assert.equal(stash.count(), 1);
});

test("ComposerStash: auto-generates default title from first line", () => {
  const stash = new ComposerStash();
  const draft = stash.stash("Implement the authentication controller\nSecond line details");
  assert.ok(draft.title);
  assert.ok(draft.title!.startsWith("Implement the authentication"));
  assert.ok(draft.title!.endsWith("…"));
});

test("ComposerStash: supports LIFO (stack) and FIFO pop order", () => {
  const stash = new ComposerStash();
  stash.stash("Draft A", "Draft A");
  stash.stash("Draft B", "Draft B");
  stash.stash("Draft C", "Draft C");

  assert.equal(stash.count(), 3);

  // LIFO: Default pop returns most recent (Draft C)
  const poppedLifo = stash.pop();
  assert.equal(poppedLifo?.title, "Draft C");
  assert.equal(stash.count(), 2);

  // FIFO: pop("fifo") returns oldest (Draft A)
  const poppedFifo = stash.pop("fifo");
  assert.equal(poppedFifo?.title, "Draft A");
  assert.equal(stash.count(), 1);

  // Remaining is Draft B
  assert.equal(stash.pop()?.title, "Draft B");
  assert.equal(stash.count(), 0);
  assert.equal(stash.pop(), null);
});

test("ComposerStash: get, remove, restore, and clear operations", () => {
  const stash = new ComposerStash();
  const d1 = stash.stash("Draft 1", "D1");
  const d2 = stash.stash("Draft 2", "D2");

  assert.equal(stash.get(d1.id)?.title, "D1");
  assert.equal(stash.get("unknown-id"), null);

  // Remove by ID
  assert.equal(stash.remove(d1.id), true);
  assert.equal(stash.remove(d1.id), false);
  assert.equal(stash.count(), 1);

  // Restore by ID
  const d3 = stash.stash("Draft 3", "D3");
  const restored = stash.restore(d3.id);
  assert.equal(restored?.id, d3.id);
  assert.equal(stash.count(), 1);

  // Clear
  stash.clear();
  assert.equal(stash.count(), 0);
  assert.deepEqual(stash.getAll(), []);
});

test("formatComposerStatus: renders single line badge string without shifting coordinates", () => {
  const theme = createPlainTheme();
  const metrics = calculateComposerMetrics("Hello world\nSecond line\nThird line", 1, true);
  const status = formatComposerStatus(metrics, theme);

  assert.ok(!status.includes("\n"), "Composer status must not contain newline");
  assert.ok(!status.includes("\r"), "Composer status must not contain carriage return");
  assert.match(status, /\[MULTI 3L\]/);
  assert.match(status, /\[~\d+ tok\]/);
  assert.match(status, /\[STASH\]/);
});

test("formatComposerStatus: returns empty string when buffer is empty and no stash", () => {
  const theme = createPlainTheme();
  const metrics = calculateComposerMetrics("");
  const status = formatComposerStatus(metrics, theme);
  assert.equal(status, "");
});

test("formatComposerStatus: renders badges across preset aesthetics", () => {
  const theme = createAnsiTheme();
  const metrics = calculateComposerMetrics("Sample text\nLine 2", 1, true);

  for (const preset of [
    "omt-clean",
    "omt-ember",
    "omt-rail",
    "minimal",
    "native",
  ]) {
    const formatted = formatComposerStatus(metrics, theme, preset);
    assert.ok(formatted.length > 0, `Expected non-empty output for preset ${preset}`);
    assert.ok(!formatted.includes("\n"), `Preset ${preset} must not emit newlines`);
  }
});

test("formatComposerStatus: adapts badges across terminal widths (120, 40, 20 cols)", () => {
  const theme = createPlainTheme();
  const metrics = calculateComposerMetrics("Sample text\nLine 2\nLine 3", 1, true);

  // Wide 120 cols
  const wide = formatComposerStatus(metrics, theme, "omt-clean", 120);
  assert.match(wide, /\[MULTI 3L\]/);
  assert.match(wide, /\[STASH\]/);
  assert.ok(visibleWidth(wide) <= 120);

  // Medium 40 cols
  const med = formatComposerStatus(metrics, theme, "omt-clean", 40);
  assert.match(med, /\[3L\]/);
  assert.ok(visibleWidth(med) <= 40);

  // Narrow 20 cols
  const narrow = formatComposerStatus(metrics, theme, "omt-clean", 20);
  assert.ok(visibleWidth(narrow) <= 20);
});

test("StashPickerComponent: renders empty stash without crashing across widths (120, 80, 40, 20)", () => {
  const tui = createMockTui();
  const theme = createPlainTheme();
  const keybindings = createMockKeybindings();
  const ctx = createMockContext();
  let doneVal: unknown;
  const done = (val?: unknown) => {
    doneVal = val;
  };

  const picker = createStashPickerComponent(tui, theme, keybindings, done, ctx);

  for (const width of [120, 80, 40, 20]) {
    const lines = picker.render(width);
    assert.ok(Array.isArray(lines));
    assert.ok(lines.length >= 4);

    for (let i = 0; i < lines.length; i++) {
      const w = visibleWidth(lines[i]!);
      assert.ok(
        w <= width,
        `Line ${i} visibleWidth (${w}) exceeded width (${width}): "${lines[i]}"`,
      );
    }

    const full = lines.join("\n");
    assert.match(full, /No (stashed )?drafts/);
  }
});

test("StashPickerComponent: renders populated stash across widths (120, 80, 40, 20)", () => {
  const tui = createMockTui();
  const theme = createAnsiTheme();
  const keybindings = createMockKeybindings();
  const ctx = createMockContext();
  let doneVal: unknown;
  const done = (val?: unknown) => {
    doneVal = val;
  };

  const stash = new ComposerStash();
  stash.stash("Refactor database queries for performance", "DB Query Refactor");
  stash.stash("Fix CSS alignment in header badge", "CSS Badge Fix");
  stash.stash("Add unit tests for prompt queue component", "Queue Tests");

  const picker = new StashPickerComponent(tui, theme, keybindings, done, ctx, { stash });

  for (const width of [120, 80, 40, 20]) {
    const lines = picker.render(width);
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

test("StashPickerComponent: keyboard navigation and item restoration", () => {
  const tui = createMockTui();
  const theme = createPlainTheme();
  const keybindings = createMockKeybindings();
  const ctx = createMockContext();
  let restoredDraft: ComposerDraft | null = null;
  let doneVal: unknown;
  const done = (val?: unknown) => {
    doneVal = val;
  };

  const stash = new ComposerStash();
  stash.stash("Draft One", "D1");
  stash.stash("Draft Two", "D2");
  stash.stash("Draft Three", "D3");

  const picker = new StashPickerComponent(tui, theme, keybindings, done, ctx, {
    stash,
    onRestore: (d) => {
      restoredDraft = d;
    },
  });

  assert.equal(picker.getSelectedIndex(), 0);

  // Down arrow moves selection down
  picker.handleInput("\x1b[B");
  assert.equal(picker.getSelectedIndex(), 1);

  picker.handleInput("\x1b[B");
  assert.equal(picker.getSelectedIndex(), 2);

  // Wraps around to 0
  picker.handleInput("\x1b[B");
  assert.equal(picker.getSelectedIndex(), 0);

  // Up arrow wraps backwards to 2
  picker.handleInput("\x1b[A");
  assert.equal(picker.getSelectedIndex(), 2);

  // Enter restores selected item
  picker.handleInput("\r");
  assert.ok(picker.isClosed());
  assert.equal((restoredDraft as any)?.title, "D3");
  assert.equal((doneVal as ComposerDraft)?.title, "D3");
});

test("StashPickerComponent: delete and clear keyboard commands", () => {
  const tui = createMockTui();
  const theme = createPlainTheme();
  const keybindings = createMockKeybindings();
  const ctx = createMockContext();
  let deletedDraft: ComposerDraft | null = null;
  let cleared = false;
  const done = () => {};

  const stash = new ComposerStash();
  stash.stash("Draft One", "D1");
  stash.stash("Draft Two", "D2");

  const picker = new StashPickerComponent(tui, theme, keybindings, done, ctx, {
    stash,
    onDelete: (d) => {
      deletedDraft = d;
    },
    onClear: () => {
      cleared = true;
    },
  });

  assert.equal(picker.getStash().count(), 2);

  // 'd' deletes current item
  picker.handleInput("d");
  assert.equal((deletedDraft as any)?.title, "D1");
  assert.equal(picker.getStash().count(), 1);

  // 'c' clears remaining drafts
  picker.handleInput("c");
  assert.equal(cleared, true);
  assert.equal(picker.getStash().count(), 0);

  // 'q' closes the picker
  picker.handleInput("q");
  assert.ok(picker.isClosed());
});
