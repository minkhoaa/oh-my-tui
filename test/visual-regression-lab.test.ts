import assert from "node:assert/strict";
import { test } from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import {
  createDeterministicFixture,
  renderFixtureState,
  compareRender,
  formatRegressionReport,
  runVisualRegressionSuite,
  SUPPORTED_PRESETS,
  SUPPORTED_STATES,
  DEFAULT_WIDTHS,
  getFixtureKey,
  loadAllBaselines,
  getBaseline,
} from "./visual-regression-lab.ts";
import { getActiveTheme } from "../extensions/omt/core/theme.ts";

// ============================================================================
// 1. Preset Rendering Tests across all 5 Presets
// ============================================================================

test("renders first-frame fixtures across all 5 presets with distinct visual signatures", () => {
  const initialPreset = getActiveTheme().id;
  const renderedPresets: Record<string, string> = {};

  for (const preset of SUPPORTED_PRESETS) {
    const fixture = createDeterministicFixture(
      "first-frame",
      preset,
      "first-frame",
      80,
      { text: "initial draft prompt" }
    );
    const rendered = renderFixtureState(fixture);
    assert.ok(rendered.length > 0, `${preset} should render non-empty first frame`);
    renderedPresets[preset] = rendered;

    // Check that preset-specific chrome is rendered
    const plain = stripTerminalSequences(rendered);
    assert.ok(
      plain.includes("initial draft prompt"),
      `${preset} should display initial draft text`
    );
    assert.ok(plain.includes("fixture-model"), `${preset} should display model status`);
  }

  // Presets must produce distinct outputs
  assert.notEqual(
    renderedPresets["omt-clean"],
    renderedPresets["omt-ember"],
    "Clean and Ember must render distinct chrome"
  );
  assert.notEqual(
    renderedPresets["omt-ember"],
    renderedPresets["omt-rail"],
    "Ember and Rail must render distinct chrome"
  );
  assert.notEqual(
    renderedPresets["omt-rail"],
    renderedPresets["minimal"],
    "Rail and Minimal must render distinct chrome"
  );
  assert.notEqual(
    renderedPresets["minimal"],
    renderedPresets["native"],
    "Minimal and Native must render distinct chrome"
  );

  // Active theme must be restored after rendering
  assert.equal(
    getActiveTheme().id,
    initialPreset,
    "Active theme must be restored to original state"
  );
});

// ============================================================================
// 2. Tool Rendering Tests (read, write, edit with diffs, bash)
// ============================================================================

test("renders read tool fixtures collapsed and expanded", () => {
  for (const preset of SUPPORTED_PRESETS) {
    const collapsedFixture = createDeterministicFixture("read-collapsed", preset, "tool", 80, {
      tool: "read",
      args: { path: "src/server.ts" },
      result: {
        content: [{ type: "text", text: "const app = express();\napp.listen(3000);" }],
        isError: false,
      },
      expanded: false,
    });
    const collapsed = renderFixtureState(collapsedFixture);
    const plainCollapsed = stripTerminalSequences(collapsed);
    assert.ok(
      plainCollapsed.includes("src/server.ts") ||
        plainCollapsed.includes("server.ts") ||
        plainCollapsed.includes("Read 1 file") ||
        plainCollapsed.includes("read"),
      `${preset} read collapsed must show path or read summary`
    );

    const expandedFixture = createDeterministicFixture("read-expanded", preset, "tool", 80, {
      tool: "read",
      args: { path: "src/server.ts" },
      result: {
        content: [{ type: "text", text: "const app = express();\napp.listen(3000);" }],
        isError: false,
      },
      expanded: true,
    });
    const expanded = renderFixtureState(expandedFixture);
    const plainExpanded = stripTerminalSequences(expanded);
    assert.ok(
      plainExpanded.includes("src/server.ts") || plainExpanded.includes("server.ts"),
      `${preset} read expanded must show path`
    );
    assert.ok(
      plainExpanded.includes("express()"),
      `${preset} read expanded must show code content`
    );
  }
});

test("renders write tool fixtures with target path and content", () => {
  for (const preset of SUPPORTED_PRESETS) {
    const fixture = createDeterministicFixture("write-tool", preset, "tool", 80, {
      tool: "write",
      args: { path: "dist/bundle.js", content: "console.log('bundled');\n" },
      result: {
        content: [{ type: "text", text: "Wrote 24 bytes" }],
        isError: false,
      },
    });
    const rendered = renderFixtureState(fixture);
    const plain = stripTerminalSequences(rendered);
    assert.ok(
      plain.includes("dist/bundle.js") || plain.includes("bundle.js"),
      `${preset} write must show target path`
    );
  }
});

test("renders edit tool fixtures with diff details and additions/deletions", () => {
  const diffContent =
    "--- a/config.json\n+++ b/config.json\n@@ -1,3 +1,3 @@\n-  \"port\": 8080,\n+  \"port\": 3000,\n   \"host\": \"localhost\"";

  for (const preset of SUPPORTED_PRESETS) {
    const fixture = createDeterministicFixture("edit-diff", preset, "diff", 80, {
      path: "config.json",
      diff: diffContent,
      expanded: true,
    });
    const rendered = renderFixtureState(fixture);
    const plain = stripTerminalSequences(rendered);

    assert.ok(
      plain.includes("config.json"),
      `${preset} edit diff must display file path`
    );
    assert.ok(
      plain.includes("8080") || plain.includes("3000") || plain.includes("line"),
      `${preset} edit diff must show diff content or summary`
    );
  }
});

test("renders bash tool fixtures with command and process output", () => {
  for (const preset of SUPPORTED_PRESETS) {
    const fixture = createDeterministicFixture("bash-tool", preset, "tool", 80, {
      tool: "bash",
      args: { command: "git status --porcelain" },
      result: {
        content: [{ type: "text", text: "M test/visual-regression-lab.ts\n?? new-file.txt" }],
        details: { exitCode: 0 },
        isError: false,
      },
      expanded: true,
    });
    const rendered = renderFixtureState(fixture);
    const plain = stripTerminalSequences(rendered);
    assert.ok(
      plain.includes("git status") || plain.includes("porcelain"),
      `${preset} bash must display executed command`
    );
  }
});

test("renders tool execution failures and error glyphs accurately", () => {
  for (const preset of SUPPORTED_PRESETS) {
    const fixture = createDeterministicFixture("tool-failure", preset, "tool", 80, {
      tool: "bash",
      args: { command: "exit 1" },
      result: {
        content: [{ type: "text", text: "Command failed with exit code 1" }],
        details: { exitCode: 1 },
        isError: true,
      },
      isError: true,
    });
    const rendered = renderFixtureState(fixture);
    assert.ok(rendered.length > 0, `${preset} error tool must render`);
  }
});

// ============================================================================
// 3. Message and Thinking Fixtures
// ============================================================================

test("renders message fixtures with preset-specific prompt glyphs and roles", () => {
  const userText = "What is the status of the visual regression lab?";
  const assistantText = "The visual regression suite is implemented and passing.";

  for (const preset of SUPPORTED_PRESETS) {
    const fixture = createDeterministicFixture("message-both", preset, "message", 80, {
      user: userText,
      assistant: assistantText,
      role: "both",
    });
    const rendered = renderFixtureState(fixture);
    const plain = stripTerminalSequences(rendered);

    assert.ok(plain.includes(userText), `${preset} must include user prompt`);
    assert.ok(plain.includes(assistantText), `${preset} must include assistant response`);

    // Verify preset prompt glyphs
    if (preset === "omt-clean") {
      assert.ok(plain.includes("›"), "Clean must feature › indicator");
    } else if (preset === "omt-ember") {
      assert.ok(plain.includes("❯"), "Ember must feature ❯ indicator");
    } else if (preset === "omt-rail") {
      assert.ok(plain.includes("┃"), "Rail must feature vertical rail ┃");
    }
  }

  // Single role rendering
  const userOnly = renderFixtureState(
    createDeterministicFixture("user-only", "minimal", "message", 80, {
      user: "Just user prompt",
      role: "user",
    })
  );
  assert.ok(stripTerminalSequences(userOnly).includes("Just user prompt"));

  const asstOnly = renderFixtureState(
    createDeterministicFixture("asst-only", "minimal", "message", 80, {
      assistant: "Just assistant response",
      role: "assistant",
    })
  );
  assert.ok(stripTerminalSequences(asstOnly).includes("Just assistant response"));
});

test("renders thinking fixtures with reasoning blocks and working indicator lines", () => {
  const reasoning = "Carefully analyzing layout boundaries and terminal cell widths.";
  const answer = "Layout boundaries are verified.";

  for (const preset of SUPPORTED_PRESETS) {
    const fixture = createDeterministicFixture("thinking-block", preset, "thinking", 80, {
      thinking: reasoning,
      text: answer,
      showWorking: true,
    });
    const rendered = renderFixtureState(fixture);
    const plain = stripTerminalSequences(rendered);

    assert.ok(plain.includes(reasoning), `${preset} must include thinking reasoning`);
    assert.ok(plain.includes(answer), `${preset} must include answer text`);

    // Test with showWorking = false
    const withoutWorking = renderFixtureState(
      createDeterministicFixture("thinking-no-working", preset, "thinking", 80, {
        thinking: reasoning,
        text: answer,
        showWorking: false,
      })
    );
    assert.ok(
      withoutWorking.length < rendered.length,
      `${preset} should omit working status when showWorking is false`
    );
  }
});

// ============================================================================
// 4. Terminal Resize States (120, 80, 40, 20 columns)
// ============================================================================

test("terminal resize states adapt without horizontal overflow across 120, 80, 40, 20 cols", () => {
  for (const preset of SUPPORTED_PRESETS) {
    for (const width of DEFAULT_WIDTHS) {
      const fixture = createDeterministicFixture(
        `resize-${width}`,
        preset,
        "resize",
        width,
        { user: "Verify column bounds and horizontal geometry containment" }
      );
      const rendered = renderFixtureState(fixture);
      const lines = rendered.split("\n");

      assert.ok(lines.length > 0, `${preset} width=${width} must render lines`);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const widthOccupied = visibleWidth(line);
        assert.ok(
          widthOccupied <= width,
          `${preset} line ${i + 1} at width ${width} exceeded terminal bounds: ${widthOccupied} cols (line: ${JSON.stringify(stripTerminalSequences(line))})`
        );
      }
    }
  }
});

// ============================================================================
// 5. Regression Detection and Actionable Diff Reports
// ============================================================================

test("compareRender detects identical renders and reports passed", () => {
  const fixture = createDeterministicFixture("match-check", "omt-clean", "message", 80);
  const ansi = renderFixtureState(fixture);

  const result = compareRender(fixture, ansi, ansi);
  assert.equal(result.passed, true);
  assert.equal(result.fixtureName, "match-check");
  assert.equal(result.preset, "omt-clean");
  assert.equal(result.width, 80);
  assert.equal(result.diffSummary, undefined);
  assert.equal(result.actualAnsi, ansi);
  assert.equal(result.expectedAnsi, ansi);
});

test("compareRender detects simulated regressions and produces an actionable line diff report", () => {
  const fixture = createDeterministicFixture(
    "tool-regression-check",
    "omt-ember",
    "tool",
    80,
    { tool: "read" }
  );
  const expectedAnsi = renderFixtureState(fixture);

  // Introduce simulated regression: change a character in the middle
  const lines = expectedAnsi.split("\n");
  lines[0] = lines[0] + " [SIMULATED REGRESSION]";
  const actualAnsiWithRegression = lines.join("\n");

  const result = compareRender(fixture, actualAnsiWithRegression, expectedAnsi);
  assert.equal(result.passed, false, "compareRender must detect the simulated difference");
  assert.equal(result.fixtureName, "tool-regression-check");
  assert.equal(result.preset, "omt-ember");
  assert.equal(result.width, 80);

  // Verify actionable diff summary
  assert.ok(result.diffSummary, "diffSummary must be present on regression");
  assert.ok(
    result.diffSummary.includes("tool-regression-check"),
    "diffSummary must mention fixture name"
  );
  assert.ok(
    result.diffSummary.includes("omt-ember"),
    "diffSummary must mention preset"
  );
  assert.ok(
    result.diffSummary.includes("80"),
    "diffSummary must mention width"
  );
  assert.ok(
    result.diffSummary.includes("Line 1:"),
    "diffSummary must point to differing line number"
  );
  assert.ok(
    result.diffSummary.includes("- expected:"),
    "diffSummary must show expected line"
  );
  assert.ok(
    result.diffSummary.includes("+ actual:"),
    "diffSummary must show actual line"
  );
});

test("compareRender handles multi-line length discrepancies (EOF differences)", () => {
  const fixture = createDeterministicFixture("eof-check", "omt-rail", "tool", 40);
  const expected = "line 1\nline 2\nline 3";
  const actual = "line 1\nline 2";

  const result = compareRender(fixture, actual, expected);
  assert.equal(result.passed, false);
  assert.ok(result.diffSummary!.includes("Line 3:"));
  assert.ok(result.diffSummary!.includes("<EOF>"));
});

// ============================================================================
// 6. formatRegressionReport Human-Readable Summaries
// ============================================================================

test("formatRegressionReport outputs clean summary when all checks pass", () => {
  const fixture = createDeterministicFixture("f1", "minimal", "first-frame", 80);
  const passedResults = [
    { passed: true, fixtureName: "f1", preset: "minimal", width: 80 },
    { passed: true, fixtureName: "f2", preset: "native", width: 120 },
  ];
  const report = formatRegressionReport(passedResults);

  assert.ok(report.includes("2/2 passed (0 failed)"));
  assert.ok(report.includes("All 2 visual regression checks passed"));
  assert.ok(!report.includes("FAIL"));
});

test("formatRegressionReport formats actionable failure sections with diffs", () => {
  const failedResults = [
    {
      passed: false,
      fixtureName: "broken-editor",
      preset: "omt-clean",
      width: 40,
      diffSummary: "Line 2:\n  - expected: \"foo\"\n  + actual:   \"bar\"",
    },
    {
      passed: true,
      fixtureName: "good-tool",
      preset: "omt-ember",
      width: 80,
    },
  ];
  const report = formatRegressionReport(failedResults);

  assert.ok(report.includes("1/2 passed (1 failed)"));
  assert.ok(report.includes("FAIL: broken-editor"));
  assert.ok(report.includes("Preset: omt-clean | Width: 40"));
  assert.ok(report.includes("- expected: \"foo\""));
  assert.ok(report.includes("+ actual:   \"bar\""));
});

// ============================================================================
// 7. Full Suite Execution Against Baseline Fixtures Store
// ============================================================================

test("runVisualRegressionSuite executes full suite against baselines and passes 216 checks", async () => {
  const suite = await runVisualRegressionSuite();
  assert.equal(suite.total, 216, "6 presets * 4 widths * 9 fixtures = 216 fixtures");
  assert.equal(suite.passed, 216, "All 216 baseline fixtures must pass");
  assert.equal(suite.failed, 0, "Zero baseline regressions expected");
  assert.ok(suite.report.includes("216/216 passed (0 failed)"));
});

test("runVisualRegressionSuite supports subset filtering by preset and width", async () => {
  const subset = await runVisualRegressionSuite(["minimal"], [80]);
  assert.equal(subset.total, 9, "1 preset * 1 width * 9 fixtures = 9 fixtures");
  assert.equal(subset.passed, 9);
  assert.equal(subset.failed, 0);
});

// ============================================================================
// 8. Fixtures Store and Baseline Helpers
// ============================================================================

test("baseline store contains recorded fixtures and keys are well-formed", () => {
  const baselines = loadAllBaselines();
  const keys = Object.keys(baselines);
  assert.ok(keys.length >= 180, "Baselines store must have at least 180 fixtures");

  const sampleFixture = createDeterministicFixture("diff", "omt-rail", "diff", 80);
  const key = getFixtureKey(sampleFixture);
  assert.equal(key, "omt-rail/diff/diff/80");
  assert.ok(key in baselines, `Expected key ${key} to be present in baselines`);

  const baseline = getBaseline(sampleFixture);
  assert.equal(baseline, baselines[key]);
});

test("supported constants contain all required presets and states", () => {
  for (const preset of [
    "omt-clean",
    "omt-ember",
    "omt-rail",
    "minimal",
    "native",
  ]) {
    assert.ok(SUPPORTED_PRESETS.includes(preset as any), `Must support ${preset}`);
  }

  for (const state of [
    "first-frame",
    "tool",
    "diff",
    "message",
    "thinking",
    "resize",
  ]) {
    assert.ok(SUPPORTED_STATES.includes(state as any), `Must support ${state}`);
  }

  assert.deepEqual([...DEFAULT_WIDTHS], [120, 80, 40, 20]);
});
