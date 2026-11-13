import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  createScrollbackComponent,
  ScrollbackComponent,
} from "../extensions/omt/features/scrollback-mode/index.ts";

function createMockTheme(): Theme {
  return {
    appearance: "dark",
    bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
    dim: (text: string) => `\x1b[2m${text}\x1b[22m`,
    fg: (_color: string, text: string) => `\x1b[36m${text}\x1b[39m`,
    bg: (_color: string, text: string) => `\x1b[40m${text}\x1b[49m`,
    style: (text: string) => text,
  } as unknown as Theme;
}

function createPlainTheme(): Theme {
  return {
    appearance: "light",
    bold: (text: string) => text,
    dim: (text: string) => text,
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    style: (text: string) => text,
  } as unknown as Theme;
}

const sampleTranscript = [
  "Session started: 2025-01-01 10:00:00",
  "User: Can you inspect the server configuration?",
  "Assistant: Sure, reading src/server.ts now.",
  "Tool: read(src/server.ts)",
  "Outcome: file loaded with 142 lines.",
  "Assistant: Here is the listening port configuration.",
  "User: Please update port to 8080.",
  "Tool: edit(src/server.ts)",
  "Outcome: port updated from 3000 to 8080.",
  "Assistant: Port 8080 successfully applied.",
  "User: Thanks! Let us run test suite.",
  "Tool: bash(npm test)",
  "Outcome: all 42 tests passed.",
  "Assistant: Test suite completed successfully.",
  "Session ended.",
];

test("ScrollbackComponent initializes with custom lines and defaults", () => {
  const fakeTui: any = { requestRender: () => {} };
  let doneCalled = false;
  const done = () => {
    doneCalled = true;
  };

  const comp = new ScrollbackComponent(
    fakeTui,
    createPlainTheme(),
    {} as any,
    done,
    {} as any,
    { lines: sampleTranscript },
  );

  assert.equal(comp.getMode(), "normal");
  assert.equal(comp.getCursorLine(), 0);
  assert.equal(comp.getLines().length, sampleTranscript.length);
  assert.equal(doneCalled, false);
});

test("ScrollbackComponent fallback when lines not provided", () => {
  const fakeTui: any = { requestRender: () => {} };
  const comp = new ScrollbackComponent(
    fakeTui,
    createPlainTheme(),
    {} as any,
    () => {},
    {} as any,
  );

  assert.ok(comp.getLines().length > 0);
  assert.ok(comp.getLines().some((l) => l.includes("Scrollback")));
});

test("ScrollbackComponent line navigation: Up, Down, PageUp, PageDown, g, G", () => {
  let renderCount = 0;
  const fakeTui: any = {
    requestRender: () => {
      renderCount++;
    },
  };

  const comp = new ScrollbackComponent(
    fakeTui,
    createPlainTheme(),
    {} as any,
    () => {},
    {} as any,
    { lines: sampleTranscript },
  );

  // Initial at 0
  assert.equal(comp.getCursorLine(), 0);

  // Down arrow
  comp.handleInput("\x1b[B");
  assert.equal(comp.getCursorLine(), 1);

  // 'j' key
  comp.handleInput("j");
  assert.equal(comp.getCursorLine(), 2);

  // Up arrow
  comp.handleInput("\x1b[A");
  assert.equal(comp.getCursorLine(), 1);

  // 'k' key
  comp.handleInput("k");
  assert.equal(comp.getCursorLine(), 0);

  // Up at 0 clamps to 0
  comp.handleInput("k");
  assert.equal(comp.getCursorLine(), 0);

  // 'G' jumps to bottom (last line index 14)
  comp.handleInput("G");
  assert.equal(comp.getCursorLine(), sampleTranscript.length - 1);

  // 'g' jumps to top (0)
  comp.handleInput("g");
  assert.equal(comp.getCursorLine(), 0);

  // PageDown (\x1b[6~)
  comp.handleInput("\x1b[6~");
  assert.ok(comp.getCursorLine() > 0);

  // PageUp (\x1b[5~)
  comp.handleInput("\x1b[5~");
  assert.equal(comp.getCursorLine(), 0);
});

test("ScrollbackComponent search mode: '/' enters search, typing, Enter, n/N match navigation", () => {
  const fakeTui: any = { requestRender: () => {} };
  const comp = new ScrollbackComponent(
    fakeTui,
    createPlainTheme(),
    {} as any,
    () => {},
    {} as any,
    { lines: sampleTranscript },
  );

  // Press '/' to enter search mode
  comp.handleInput("/");
  assert.equal(comp.getMode(), "search");

  // Type search query "port"
  for (const ch of "port") {
    comp.handleInput(ch);
  }

  // Backspace check
  comp.handleInput("x");
  comp.handleInput("\x7f"); // delete 'x'

  // Commit search with Enter
  comp.handleInput("\r");
  assert.equal(comp.getMode(), "normal");
  assert.equal(comp.getSearchQuery(), "port");

  // Matches for "port": lines with "port"
  const matches = comp.getMatchIndices();
  assert.ok(matches.length >= 2, `Expected at least 2 matches for "port", got ${matches.length}`);
  // Should jump to first match
  assert.equal(comp.getCursorLine(), matches[0]);

  // Press 'n' to go to next match
  comp.handleInput("n");
  assert.equal(comp.getCursorLine(), matches[1]);

  // Press 'N' to go back to previous match
  comp.handleInput("N");
  assert.equal(comp.getCursorLine(), matches[0]);

  // Render output contains highlighted match
  const lines = comp.render(80);
  const text = lines.join("\n");
  assert.ok(text.includes("port"));
});

test("ScrollbackComponent search mode cancellation via Esc", () => {
  const fakeTui: any = { requestRender: () => {} };
  const comp = new ScrollbackComponent(
    fakeTui,
    createPlainTheme(),
    {} as any,
    () => {},
    {} as any,
    { lines: sampleTranscript },
  );

  comp.handleInput("/");
  assert.equal(comp.getMode(), "search");

  // Esc cancels search
  comp.handleInput("\x1b");
  assert.equal(comp.getMode(), "normal");
});

test("ScrollbackComponent visual selection mode: 'v', Up/Down extends, 'y' / Enter copies, 'Esc' cancels", () => {
  let copiedText = "";
  const onCopySelection = (text: string) => {
    copiedText = text;
  };

  const fakeTui: any = { requestRender: () => {} };
  const comp = new ScrollbackComponent(
    fakeTui,
    createPlainTheme(),
    {} as any,
    () => {},
    {} as any,
    { lines: sampleTranscript, onCopySelection },
  );

  // Line 2
  comp.handleInput("j");
  comp.handleInput("j");
  assert.equal(comp.getCursorLine(), 2);

  // Press 'v' to enter visual selection mode
  comp.handleInput("v");
  assert.equal(comp.getMode(), "visual");
  assert.deepEqual(comp.getSelectionRange(), [2, 2]);

  // Move Down to line 4
  comp.handleInput("j");
  comp.handleInput("j");
  assert.equal(comp.getCursorLine(), 4);
  assert.deepEqual(comp.getSelectionRange(), [2, 4]);

  // Render output reflects visual selection
  const rendered = comp.render(80);
  assert.ok(rendered.some((l) => l.includes("VISUAL: 3 lines")));

  // Copy with 'y'
  comp.handleInput("y");
  assert.equal(comp.getMode(), "normal"); // Exits visual mode on copy
  assert.equal(
    copiedText,
    [sampleTranscript[2], sampleTranscript[3], sampleTranscript[4]].join("\n"),
  );

  // Re-enter visual mode and test 'Esc' cancellation
  comp.handleInput("v");
  assert.equal(comp.getMode(), "visual");
  comp.handleInput("\x1b"); // Esc
  assert.equal(comp.getMode(), "normal"); // Back to normal, did NOT close scrollback

  // Enter also copies in visual mode
  comp.handleInput("v");
  comp.handleInput("j");
  comp.handleInput("\r"); // Enter
  assert.equal(comp.getMode(), "normal");
});

test("ScrollbackComponent exits on 'q' or 'Esc' in normal mode", () => {
  let doneQ = false;
  const compQ = createScrollbackComponent(
    { requestRender: () => {} } as any,
    createPlainTheme(),
    {} as any,
    () => {
      doneQ = true;
    },
    {} as any,
    { lines: sampleTranscript },
  );

  compQ.handleInput?.("q");
  assert.equal(doneQ, true);

  let doneEsc = false;
  const compEsc = createScrollbackComponent(
    { requestRender: () => {} } as any,
    createPlainTheme(),
    {} as any,
    () => {
      doneEsc = true;
    },
    {} as any,
    { lines: sampleTranscript },
  );

  compEsc.handleInput?.("\x1b");
  assert.equal(doneEsc, true);
});

test("ScrollbackComponent renders cleanly across widths (120, 80, 40, 20 cols) without overflowing", () => {
  const themes = [createMockTheme(), createPlainTheme()];
  const widths = [120, 80, 40, 20];

  for (const theme of themes) {
    for (const width of widths) {
      const comp = createScrollbackComponent(
        { requestRender: () => {} } as any,
        theme,
        {} as any,
        () => {},
        {} as any,
        { lines: sampleTranscript },
      );

      const lines = comp.render(width);
      assert.ok(Array.isArray(lines));
      assert.ok(lines.length >= 5);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const len = visibleWidth(line);
        assert.ok(
          len <= width,
          `Line ${i} visibleWidth (${len}) exceeded target width (${width}) at width ${width}: "${line}"`,
        );
      }
    }
  }
});
