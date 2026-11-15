import test from "node:test";
import assert from "node:assert/strict";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { setActiveTheme, resetActiveTheme, getActiveTheme } from "../extensions/omt/core/theme.ts";
import { resolveThemeName, THEME_NAMES, THEME_PRESETS } from "../extensions/omt/presets/index.ts";
import { obsidianPreset } from "../extensions/omt/presets/omt-obsidian/preset.ts";
import { obsidianUserMessage } from "../extensions/omt/presets/omt-obsidian/user-message.ts";
import { obsidianAssistant } from "../extensions/omt/presets/omt-obsidian/assistant.ts";
import { createObsidianToolRenderer } from "../extensions/omt/presets/omt-obsidian/tools.ts";
import { obsidianFooter } from "../extensions/omt/presets/omt-obsidian/footer.ts";
import { initTheme, InteractiveMode, type Theme } from "@earendil-works/pi-coding-agent";
import { accessibilityStore } from "../extensions/omt/features/accessibility/model.ts";

const proto = InteractiveMode.prototype as unknown as {
  createExtensionUIContext(this: unknown): { theme: Theme };
};

function getTheme(appearance: "dark" | "light" = "dark"): Theme {
  initTheme(appearance);
  return proto.createExtensionUIContext.call({}).theme;
}

test("omt-obsidian preset registration and aliases", () => {
  assert.ok(THEME_NAMES.includes("omt-obsidian"), "THEME_NAMES includes omt-obsidian");
  assert.equal(resolveThemeName("obsidian"), "omt-obsidian");
  assert.equal(resolveThemeName("omt-obsidian"), "omt-obsidian");
  assert.equal(THEME_PRESETS["omt-obsidian"], obsidianPreset);
  assert.equal(THEME_PRESETS.obsidian, obsidianPreset);

  assert.equal(obsidianPreset.id, "omt-obsidian");
  assert.equal(obsidianPreset.label, "OMT Obsidian Studio");
  assert.equal(obsidianPreset.glyph.prompt, "❯");
  assert.equal(obsidianPreset.thinking.indicator, "✦");
  assert.equal(obsidianPreset.thinking.label, "Thinking");
});

test("omt-obsidian UserMessage uses Left-Rail Spine and reclaims horizontal columns", () => {
  const theme = getTheme();
  const layout = obsidianUserMessage(80, 1, theme);
  assert.equal(layout.padding, 0);
  assert.equal(layout.width, 78); // Reclaimed 4 columns (width - 2 instead of width - 6)

  const decorated = layout.decorate!(["hello world from user"]);
  assert.equal(decorated.length, 1);
  const plainRow = stripTerminalSequences(decorated[0]!);
  assert.ok(plainRow.startsWith("▎ hello world from user"), `Expected left-rail spine: ${plainRow}`);
  assert.ok(!plainRow.includes("╭"), "No 4-sided top box border");
  assert.ok(!plainRow.includes("╰"), "No 4-sided bottom box border");

  // Strict ASCII mode
  try {
    accessibilityStore.setPlainTextAsciiBorders(true);
    const asciiLayout = obsidianUserMessage(80, 1, theme);
    const asciiDecorated = asciiLayout.decorate!(["hello ascii"]);
    const plainAscii = stripTerminalSequences(asciiDecorated[0]!);
    assert.ok(plainAscii.startsWith("| hello ascii"), `Expected ASCII spine '|': ${plainAscii}`);
  } finally {
    accessibilityStore.setPlainTextAsciiBorders(false);
  }
});

test("omt-obsidian Assistant renders Left-Rail Spine and Folded Reasoning Capsule", () => {
  const theme = getTheme();
  setActiveTheme("omt-obsidian");
  try {
    const lines = ["Thinking about jwt token", "", "Refactored token handler"];
    const rendered = obsidianAssistant(lines, { lastMessage: { model: "claude-3-5-sonnet" } } as any, theme, 80, {
      proseOffset: 2,
    });
    const plainRows = rendered.map(stripTerminalSequences);
    assert.ok(plainRows.some((r) => r.includes("▎ ◈ Reasoned in")), "Folded reasoning capsule with left-rail spine");
    assert.ok(plainRows.some((r) => r.startsWith("▎ Refactored token handler")), "Prose has left-rail spine");
    assert.ok(!plainRows.some((r) => r.includes("● Refactored")), "No legacy bullet icon");
  } finally {
    resetActiveTheme();
  }
});

test("omt-obsidian Tools render Solid Inverted Chips and clamp outputs", () => {
  const theme = getTheme();
  setActiveTheme("omt-obsidian");
  try {
    // 1. Tool Call header with Solid Inverted Chip
    const readRenderer = createObsidianToolRenderer("read");
    const callComponent = readRenderer.renderCall!({ path: "src/auth/jwt.ts" }, theme, {
      expanded: false,
      cwd: "/workspace",
      state: {},
    } as any);
    const callRows = callComponent.render(80).map(stripTerminalSequences);
    assert.ok(callRows[0]!.includes("▎ ▊ READ"), `Expected Solid Chip: ${callRows[0]}`);
    assert.ok(callRows[0]!.includes("src/auth/jwt.ts"), "Includes file path");

    // 2. Read Tool Output Clamping (max 12 lines)
    const twentyLines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
    const readResult = readRenderer.renderResult!(
      { content: [{ type: "text", text: twentyLines }], details: {} } as any,
      { expanded: true, isPartial: false },
      theme,
      { args: { path: "src/auth/jwt.ts" }, cwd: "/workspace" } as any,
    );
    const readResultRows = readResult.render(80).map(stripTerminalSequences);
    assert.ok(readResultRows.some((r) => r.includes("line 1")), "Shows line 1");
    assert.ok(readResultRows.some((r) => r.includes("line 12")), "Shows line 12");
    assert.ok(!readResultRows.some((r) => r.includes("line 13")), "Clamps line 13");
    assert.ok(readResultRows.some((r) => r.includes("... 8 lines hidden ...")), "Shows 8 lines hidden notice");

    // 3. Bash Tool Output Clamping (max 8 lines)
    const bashRenderer = createObsidianToolRenderer("bash");
    const twentyBashLines = Array.from({ length: 20 }, (_, i) => `bash log ${i + 1}`).join("\n");
    const bashResult = bashRenderer.renderResult!(
      { content: [{ type: "text", text: twentyBashLines }], details: {} } as any,
      { expanded: true, isPartial: false },
      theme,
      { args: { command: "npm test" }, cwd: "/workspace" } as any,
    );
    const bashResultRows = bashResult.render(80).map(stripTerminalSequences);
    assert.ok(bashResultRows.some((r) => r.includes("bash log 1")), "Shows line 1");
    assert.ok(bashResultRows.some((r) => r.includes("bash log 8")), "Shows line 8");
    assert.ok(!bashResultRows.some((r) => r.includes("bash log 9")), "Clamps line 9");
    assert.ok(bashResultRows.some((r) => r.includes("... 12 lines hidden ...")), "Shows 12 lines hidden notice");
  } finally {
    resetActiveTheme();
  }
});

test("omt-obsidian Footer renders Context Fuel Gauge", () => {
  const theme = getTheme();
  setActiveTheme("omt-obsidian");
  try {
    const footer = obsidianFooter(100, theme, {
      modelId: "claude-3-5-sonnet",
      branch: "main",
      extensionStatuses: [],
      contextUsage: { percent: 38, contextWindow: 128000 },
    });
    const plain = stripTerminalSequences(footer);
    assert.ok(plain.includes("claude-3-5-sonnet"), "Includes model id");
    assert.ok(plain.includes("▰▰▰▱▱▱▱▱ 38%"), `Expected Fuel Gauge at 38%: ${plain}`);

    // Strict ASCII mode
    try {
      accessibilityStore.setPlainTextAsciiBorders(true);
      const asciiFooter = obsidianFooter(100, theme, {
        modelId: "claude-3-5-sonnet",
        branch: "main",
        extensionStatuses: [],
        contextUsage: { percent: 38, contextWindow: 128000 },
      });
      const plainAscii = stripTerminalSequences(asciiFooter);
      assert.ok(plainAscii.includes("[===-----] 38%"), `Expected ASCII Fuel Gauge: ${plainAscii}`);
    } finally {
      accessibilityStore.setPlainTextAsciiBorders(false);
    }
  } finally {
    resetActiveTheme();
  }
});
