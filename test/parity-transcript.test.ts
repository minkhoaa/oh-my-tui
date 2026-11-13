import assert from "node:assert/strict";
import { test } from "node:test";
import {
  initTheme,
  InteractiveMode,
  Theme,
  AssistantMessageComponent,
  UserMessageComponent,
  getMarkdownTheme,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { createSignatureToolRenderer } from "../extensions/omt/presets/omt-signature/tools.ts";
import { setActiveTheme, resetActiveTheme } from "../extensions/omt/core/theme.ts";
import { signatureAssistant } from "../extensions/omt/presets/omt-signature/assistant.ts";
import { signatureThinkingLabel } from "../extensions/omt/presets/omt-signature/message-model.ts";
import { signatureUserMessage } from "../extensions/omt/presets/omt-signature/user-message.ts";
import { createAssistantPresentation } from "../extensions/omt/presets/shared/assistant.ts";
import { assistantFixture } from "./assistant-fixture.ts";

const proto = InteractiveMode.prototype as unknown as { createExtensionUIContext(this: unknown): { theme: Theme } };
function getTestTheme(): Theme {
  initTheme("dark");
  return proto.createExtensionUIContext.call({}).theme;
}

function makeContext(overrides: Record<string, unknown> = {}): any {
  return {
    args: {},
    toolCallId: "call_test_1",
    state: {},
    cwd: "/workspace/project",
    outputPad: 0,
    isPartial: false,
    isError: false,
    expanded: false,
    showImages: true,
    durationMs: 150,
    keyText: () => "ctrl+g",
    keyHint: (_id: string, description: string) => `ctrl+g ${description}`,
    ...overrides,
  };
}

test("compact tool headers match expected presentation with a one-cell inset", () => {
  const theme = getTestTheme();
  setActiveTheme("omt-signature");
  try {
    const readRenderer = createSignatureToolRenderer("read");
    const readCall = readRenderer.renderCall!({ path: "src/app/view.ts" }, theme, makeContext());
    const readLines = readCall.render(80);
    const readPlain = stripTerminalSequences(readLines[0]!);

    assert.equal(readPlain, " ● Read(src/app/view.ts)", "compact header keeps the requested path visible");
    assert.ok(!readLines.some((l) => /[╭╮╰╯│─]/.test(stripTerminalSequences(l))), "tool call must never be framed (AUD-03)");
    assert.ok(!readPlain.includes("to expand"), "collapsed header must not include expand label");

    // Write tool with line count
    const writeRenderer = createSignatureToolRenderer("write");
    const content = "line1\nline2\nline3";
    const writeCall = writeRenderer.renderCall!({ path: "game.js", content }, theme, makeContext());
    const writeLines = writeCall.render(80);
    const writePlain = stripTerminalSequences(writeLines[0]!);

    assert.equal(writePlain, " ● Write(game.js +3)", "compact header summarizes the changed file");
  } finally {
    resetActiveTheme();
  }
});

test("source grammar: expanded diff retains compactDiffRows plus one-cell inset", () => {
  const theme = getTestTheme();
  setActiveTheme("omt-signature");
  try {
    const editRenderer = createSignatureToolRenderer("edit");
    const diff = "--- a/src/file.ts\n+++ b/src/file.ts\n@@ -1,2 +1,2 @@\n-const oldVal = 1;\n+const newVal = 2;\n";
    const editResult = editRenderer.renderResult!(
      { content: [], details: { diff } },
      { expanded: true, isPartial: false },
      theme,
      makeContext({ args: { path: "src/file.ts" } }),
    );
    const editLines = editResult.render(80).map(stripTerminalSequences);

    assert.ok(editLines[0]?.includes("Updated src/file.ts (+1 -1)"), "first line is title with counts");
    assert.ok(editLines[0]?.startsWith("   ⎿ "), "title line uses inset and hook prefix");
    assert.ok(editLines.some((l) => l.startsWith("     -const oldVal = 1;")), "deletion row has inset and 4-space gutter");
    assert.ok(editLines.some((l) => l.startsWith("     +const newVal = 2;")), "addition row has inset and 4-space gutter");
    assert.ok(!editLines.some((l) => /[╭╮╰╯│]/.test(l)), "diff view is completely unframed");
  } finally {
    resetActiveTheme();
  }
});

test("parity: collapsed reasoning displays 160-col preview and flattens newlines to ⏎", () => {
  const theme = getTestTheme();
  setActiveTheme("omt-signature");
  try {
    const rawThinking = "Analyzing the problem\nChecking edge cases\nDone reasoning";
    const formatted = signatureThinkingLabel(theme, false, rawThinking);
    const plain = stripTerminalSequences(formatted);

    assert.equal(plain, "○ Analyzing the problem ⏎ Checking edge cases ⏎ Done reasoning", "collapsed thinking preview flattens line breaks");

    // Very long thinking gets truncated to 160 visual columns with trailing '…'
    const longThinking = "step ".repeat(60);
    const longFormatted = signatureThinkingLabel(theme, false, longThinking);
    assert.ok(visibleWidth(stripTerminalSequences(longFormatted)) <= 165);
    assert.ok(stripTerminalSequences(longFormatted).endsWith("…"));

    // Fallback when thinking text is empty
    const streamingEmpty = signatureThinkingLabel(theme, true, "");
    assert.ok(stripTerminalSequences(streamingEmpty).includes("Reasoning…"));
    const settledEmpty = signatureThinkingLabel(theme, false, "");
    assert.ok(stripTerminalSequences(settledEmpty).includes("Thought"));
  } finally {
    resetActiveTheme();
  }
});

test("parity: real AssistantMessageComponent with thinking and prose isolates ○ and ● gutters", () => {
  const theme = getTestTheme();
  setActiveTheme("omt-signature");
  try {
    const message = {
      ...assistantFixture(),
      content: [
        { type: "thinking" as const, thinking: "Pondering the solution\nChecking steps" },
        { type: "text" as const, text: "Here is the verified answer." },
      ],
    };

    const comp = new AssistantMessageComponent(message, true, getMarkdownTheme(), "Reasoning", 0);
    const presentation = createAssistantPresentation(() => true, () => theme, comp.render);
    comp.render = presentation.render;

    const rendered = comp.render(80);
    const lines = rendered.map(stripTerminalSequences).filter((l) => l.trim().length > 0);

    // Check thinking line has '○', not '● ○'
    assert.ok(lines[0]?.trim().startsWith("○"), "thinking line starts with ○");
    assert.ok(!lines[0]?.includes("●"), "thinking line does not contain ●");
    assert.ok(lines[0]?.includes("Pondering the solution ⏎ Checking steps"), "thinking line contains flattened preview");

    // Check assistant prose line has '●', not '○'
    assert.ok(lines[1]?.trim().startsWith("●"), "assistant text starts with ●");
    assert.ok(!lines[1]?.includes("○"), "assistant text line does not contain ○");
    assert.ok(lines[1]?.includes("Here is the verified answer."), "assistant text content preserved");
  } finally {
    resetActiveTheme();
  }
});

test("parity: real AssistantMessageComponent with preformatted table applies 2-cell gutterBox", () => {
  const theme = getTestTheme();
  setActiveTheme("omt-signature");
  try {
    const tableText = "| Col1 | Col2 |\n| --- | --- |\n| A | B |";
    const message = {
      ...assistantFixture(),
      content: [{ type: "text" as const, text: tableText }],
    };

    const comp = new AssistantMessageComponent(message, false, getMarkdownTheme(), "Thinking...", 0);
    const presentation = createAssistantPresentation(() => true, () => theme, comp.render);
    comp.render = presentation.render;

    const rendered = comp.render(80);
    const lines = rendered.map(stripTerminalSequences).filter((l) => l.trim().length > 0);

    // The requested inset precedes the icon or the two-cell continuation gutter.
    assert.ok(lines[0]?.startsWith(" ● "), "table first row has one inset cell before ●");
    assert.ok(lines[1]?.startsWith("   "), "table separator row has inset plus 2-space gutter");
    assert.ok(lines[2]?.startsWith("   "), "table data row has inset plus 2-space gutter");
  } finally {
    resetActiveTheme();
  }
});

test("parity: foreign-owned expanded thinking preserves native Markdown and does not overwrite text", () => {
  const theme = getTestTheme();
  setActiveTheme("omt-signature");
  try {
    const thinkingText = "Detailed multi-step reasoning:\n1. First step\n2. Second step";
    const message = {
      ...assistantFixture(),
      content: [
        { type: "thinking" as const, thinking: thinkingText },
        { type: "text" as const, text: "Final result." },
      ],
    };

    // A foreign label is deliberately not replaced by OMT's default raw preview.
    // hideThinkingBlock = false retains that owner's expanded Markdown.
    const comp = new AssistantMessageComponent(message, false, getMarkdownTheme(), "Thinking...", 0);
    const presentation = createAssistantPresentation(() => true, () => theme, comp.render);
    comp.render = presentation.render;

    const rendered = comp.render(80);
    const text = rendered.map(stripTerminalSequences).join("\n");

    // Full multi-line reasoning is preserved
    assert.ok(text.includes("First step"));
    assert.ok(text.includes("Second step"));
    assert.ok(text.includes("Final result."));
  } finally {
    resetActiveTheme();
  }
});

test("parity: settled turn foot adheres to OMT format and suppression during streaming", () => {
  const theme = getTestTheme();
  setActiveTheme("omt-signature");
  try {
    const baseLines = ["● Hello world"];
    const settled = signatureAssistant(baseLines, { isStreaming: false, hasToolCalls: false, lastMessage: { model: "gpt-4o" } } as any, theme, 80, {
      metadata: {
        model: "fixture-sonnet-35",
        thinkingLevel: "high",
        durationMs: 4200,
        settledAt: new Date("2026-11-11T12:00:00Z"),
      },
    });
    const settledPlain = settled.map(stripTerminalSequences);
    const footLine = settledPlain.at(-1)!;
    assert.ok(footLine.includes("  ▣"), "settled footer opens with   ▣");
    assert.ok(footLine.includes("fixture-sonnet-35"), "includes model");
    assert.ok(footLine.includes("high"), "includes thinking level");
    assert.ok(footLine.includes("4s"), "includes formatted duration");
    assert.ok(footLine.includes("done"), "includes settled time");

    // Suppressed while streaming
    const streaming = signatureAssistant(baseLines, { isStreaming: true, hasToolCalls: false } as any, theme, 80);
    assert.ok(!streaming.map(stripTerminalSequences).some((l) => l.includes("▣")));
  } finally {
    resetActiveTheme();
  }
});
