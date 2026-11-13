import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth, stripTerminalSequences } from "@earendil-works/pi-tui";

import {
  PETS,
  PET_NAMES,
  getPet,
  normalize,
  width,
  petFrameFor,
  petLabel,
  petNameRow,
  fmtDur,
  fmtNum,
  fmtComma,
  short,
  shorten,
  twoCol,
  ctxBar,
  sep,
  renderPet,
  renderSidebar,
  extractSidebarState,
  createSidebarControl,
  ART_ROWS,
  SIDE_W,
  SIDE_INNER_W,
  DEFAULT_PET,
} from "../extensions/omt/features/sidebar/index.ts";
import { createSidebarComponent } from "../extensions/omt/features/sidebar/view.ts";
import type { SidebarState, SidebarOptions } from "../extensions/omt/features/sidebar/types.ts";

// Helper mock theme
const mockTheme = {
  bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
  italic: (s: string) => `\x1b[3m${s}\x1b[23m`,
  underline: (s: string) => `\x1b[4m${s}\x1b[24m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[22m`,
  fg: (_color: any, s: string) => s,
  bg: (_color: any, s: string) => s,
} as any;

test("all 25 pets match the catalog and exact axolotl frames", () => {
  // 1. Verify exact count
  assert.equal(PETS.length, 25, "Must contain exactly 25 pets");
  assert.equal(PET_NAMES.length, 25, "Must list exactly 25 pet names");

  // 2. Verify all expected names in order
  const expectedNames = [
    "duck",
    "goose",
    "blob",
    "cat",
    "dragon",
    "octopus",
    "owl",
    "penguin",
    "turtle",
    "snail",
    "ghost",
    "axolotl",
    "capybara",
    "cactus",
    "robot",
    "rabbit",
    "mushroom",
    "chonk",
    "px-cat",
    "px-frog",
    "px-bee",
    "px-crab",
    "px-capybara",
    "px-slime",
    "px-ghost",
  ];
  assert.deepEqual(PET_NAMES, expectedNames);

  // 3. Verify every pet has 2 normalized frames of ArtRows (4) height
  for (const pet of PETS) {
    assert.ok(pet.frames && pet.frames.length === 2, `Pet ${pet.name} must have 2 frames`);
    assert.equal(pet.frames[0].length, ART_ROWS, `Pet ${pet.name} frame 0 height must be ${ART_ROWS}`);
    assert.equal(pet.frames[1].length, ART_ROWS, `Pet ${pet.name} frame 1 height must be ${ART_ROWS}`);
  }

  // 4. Verify normalization: 'cat' has 3 raw lines, normalized with 1 empty line at top
  const cat = getPet("cat");
  assert.equal(cat.frames[0][0], "", "Cat frame 0 top line must be empty padding");
  assert.equal(cat.frames[0][1], " /\\^/\\");
  assert.equal(cat.frames[0][2], " ( o.o )");
  assert.equal(cat.frames[0][3], " > ^ <");
  assert.equal(cat.frames[1][0], "", "Cat frame 1 top line must be empty padding");
  assert.equal(cat.frames[1][1], " /\\^/\\");
  assert.equal(cat.frames[1][2], " ( -.- )");
  assert.equal(cat.frames[1][3], " > ^ <");

  // 5. Verify exact characters of axolotl frames matching specification
  const axolotl = getPet("axolotl");
  assert.ok(axolotl, "axolotl pet must exist");
  assert.deepEqual(
    axolotl.frames[0],
    [
      " }~{_______}~{",
      "}~( : .. : )~{",
      "(  .---.  )",
      "(_/     \\_)",
    ],
    "Axolotl frame 0 must match the expected art",
  );
  assert.deepEqual(
    axolotl.frames[1],
    [
      " }~{_______}~{",
      "}~( - .. - )~{",
      "(  .---.  )",
      "(_/     \\_)",
    ],
    "Axolotl frame 1 must match the expected art",
  );

  // 6. Test normalization helper with arbitrary lines
  const rawLong = ["line1", "line2", "line3", "line4", "line5  \t"];
  const normalizedLong = normalize(rawLong);
  assert.equal(normalizedLong.length, 4);
  assert.equal(normalizedLong[3], "line5", "Must trim trailing spaces/tabs and keep last 4");

  const rawShort = ["top  ", "bottom"];
  const normalizedShort = normalize(rawShort);
  assert.equal(normalizedShort.length, 4);
  assert.equal(normalizedShort[0], "");
  assert.equal(normalizedShort[1], "");
  assert.equal(normalizedShort[2], "top");
  assert.equal(normalizedShort[3], "bottom");
});

test("pet animation cadence, blink timing, name rows, and status labels", () => {
  const cat = getPet("cat");

  // Resting cycle = 8: blink at beat 8 - 3 = 5
  assert.deepEqual(petFrameFor(cat, 0, false), cat.frames[0]);
  assert.deepEqual(petFrameFor(cat, 1, false), cat.frames[0]);
  assert.deepEqual(petFrameFor(cat, 4, false), cat.frames[0]);
  assert.deepEqual(petFrameFor(cat, 5, false), cat.frames[1], "Beat 5 must show blink frame at rest");
  assert.deepEqual(petFrameFor(cat, 6, false), cat.frames[0]);
  assert.deepEqual(petFrameFor(cat, 13, false), cat.frames[1], "Beat 13 % 8 = 5 must show blink frame");

  // Busy cycle = 4: blink at beat 4 - 3 = 1
  assert.deepEqual(petFrameFor(cat, 0, true), cat.frames[0]);
  assert.deepEqual(petFrameFor(cat, 1, true), cat.frames[1], "Beat 1 must show blink frame when busy");
  assert.deepEqual(petFrameFor(cat, 2, true), cat.frames[0]);
  assert.deepEqual(petFrameFor(cat, 3, true), cat.frames[0]);
  assert.deepEqual(petFrameFor(cat, 5, true), cat.frames[1], "Beat 5 % 4 = 1 must show blink frame when busy");

  // petNameRow: first inked row index
  const duck = getPet("duck");
  assert.equal(petNameRow(duck.frames[0]), 0, "Duck starts ink on row 0");
  assert.equal(petNameRow(cat.frames[0]), 1, "Cat starts ink on row 1 (row 0 is padded)");

  // Fallback to row 0 if ink is only on bottom line
  assert.equal(petNameRow(["", "", "", "ink"]), 0);

  // Status labels
  assert.equal(petLabel("idle"), "Ready");
  assert.equal(petLabel("thinking"), "Thinking...");
  assert.equal(petLabel("writing"), "Writing...");
  assert.equal(petLabel("working"), "Working...");
  assert.equal(petLabel("success"), "Done!");
  assert.equal(petLabel("error"), "Error");

  // Status label with elapsed time
  const since = new Date(Date.now() - 5000);
  assert.equal(petLabel("thinking", since), "Thinking... 5s");
});

test("formatting helpers: twoCol, ctxBar, sep, short, shorten, fmtNum, fmtDur", () => {
  // OMT specification fixes the right column at 17, without right alignment.
  const col = twoCol("time 5s", "in 1.2k", 30);
  assert.equal(col, "time 5s" + " ".repeat(10) + "in 1.2k");
  assert.ok(col.startsWith("time 5s"));
  assert.ok(col.endsWith("in 1.2k"));

  // ctxBar: clamps between 0 and w
  assert.equal(ctxBar(0, 10), "░░░░░░░░░░");
  assert.equal(ctxBar(50, 10), "█████░░░░░");
  assert.equal(ctxBar(100, 10), "██████████");
  assert.equal(ctxBar(25, 4), "█░░░");

  // sep: horizontal rule
  assert.equal(sep(30), "─".repeat(30));

  // short: newline flattening and length clamping
  assert.equal(short("hello\nworld", 20), "hello ⏎ world");
  assert.equal(short("a very long string that should be truncated", 10), "a very lo…");
  assert.equal(visibleWidth(short("a very long string that should be truncated", 10)), 10);

  // fmtNum: M, k, or plain integer
  assert.equal(fmtNum(42), "42");
  assert.equal(fmtNum(1234), "1.2k");
  assert.equal(fmtNum(2500000), "2.5M");

  // fmtComma
  assert.equal(fmtComma(1234567), "1,234,567");

  // fmtDur
  assert.equal(fmtDur(3000), "3s");
  assert.equal(fmtDur(65000), "1m5s");
  assert.equal(fmtDur(3665000), "1h1m");
});

test("renderSidebar produces exact 34-column outer box (30 inner width) matching sections", () => {
  const sampleState: SidebarState = {
    session: {
      id: "sess_1234567890abcdef",
      firstPrompt: "Implement user authentication with OAuth2",
      filePath: "/home/user/project/session.json",
    },
    model: {
      label: "claude-3-7-sonnet",
      thinkLevel: "high",
      thinkLevels: ["off", "low", "medium", "high"],
    },
    context: {
      percent: 45,
      tokens: 45000,
      contextWindow: 100000,
      autoCompact: false,
    },
    stats: {
      inTokens: 12000,
      outTokens: 4000,
      totalTokens: 16000,
      cacheReadTokens: 5000,
      cacheWriteTokens: 1000,
      userMessages: 4,
      assistantMessages: 4,
      totalMessages: 8,
      elapsedMs: 125000,
      lastDurationMs: 4000,
      lastSpeed: 52,
      cost: 0.12,
    },
    tools: [
      { name: "read", status: "done" },
      { name: "bash", status: "error" },
      { name: "edit", status: "running" },
    ],
    workspace: {
      cwd: "/home/user/project",
      branch: "main",
      ok: true,
      files: [
        { path: "src/auth.ts", add: 42, del: 3 },
        { path: "test/auth.test.ts", add: 80, del: 0 },
      ],
      moreFiles: 1,
      untracked: 2,
    },
    pet: {
      name: "cat",
      status: "working",
      tick: 2,
      since: new Date(Date.now() - 12000),
    },
    recentModels: [
      { id: "claude-3-7-sonnet", label: "Claude 3.7 Sonnet", isCurrent: true },
      { id: "gpt-4o", label: "GPT-4o", isCurrent: false },
    ],
    commands: {
      ext: 4,
      prompt: 8,
      skill: 2,
      builtin: 15,
      queueSteer: 1,
      queueFollow: 2,
    },
  };

  const lines = renderSidebar(sampleState, SIDE_W, mockTheme);
  assert.ok(lines.length > 10, "Sidebar should render multiple lines");

  // Verify EVERY single line has visible width of exactly 34
  for (let i = 0; i < lines.length; i++) {
    const raw = stripTerminalSequences(lines[i]);
    assert.equal(
      visibleWidth(raw),
      SIDE_W,
      `Line ${i} must have visible width ${SIDE_W}, got ${visibleWidth(raw)}: "${raw}"`,
    );
  }

  // First line: ╭ + 32 ─ + ╮
  const firstRaw = stripTerminalSequences(lines[0]);
  assert.ok(firstRaw.startsWith("╭"), "Top border must start with ╭");
  assert.ok(firstRaw.endsWith("╮"), "Top border must end with ╮");

  // Last line: ╰ + 32 ─ + ╯
  const lastRaw = stripTerminalSequences(lines[lines.length - 1]);
  assert.ok(lastRaw.startsWith("╰"), "Bottom border must start with ╰");
  assert.ok(lastRaw.endsWith("╯"), "Bottom border must end with ╯");

  // Middle lines: must start with '│ ' and end with ' │' (2-char border + padding on each side)
  for (let i = 1; i < lines.length - 1; i++) {
    const raw = stripTerminalSequences(lines[i]);
    assert.ok(raw.startsWith("│ "), `Line ${i} must start with '│ '`);
    assert.ok(raw.endsWith(" │"), `Line ${i} must end with ' │'`);
    const innerContent = raw.slice(2, -2);
    assert.equal(
      visibleWidth(innerContent),
      SIDE_INNER_W,
      `Line ${i} inner content must have visible width ${SIDE_INNER_W}`,
    );
  }

  // Verify required sections are present in output
  const fullText = lines.map((l) => stripTerminalSequences(l)).join("\n");
  assert.ok(fullText.includes("cat"), "Pet name must be rendered");
  assert.ok(fullText.includes("Working..."), "Pet status label must be rendered");
  assert.ok(fullText.includes("SESSION"), "SESSION section title must be rendered");
  assert.ok(fullText.includes("model · "), "MODEL section must be rendered");
  assert.ok(fullText.includes("Stats"), "STATS section must be rendered");
  assert.ok(fullText.includes("Tokens"), "Tokens header must be rendered");
  assert.ok(fullText.includes("RECENT MODELS"), "RECENT MODELS section must be rendered");
  assert.ok(fullText.includes("COMMANDS"), "COMMANDS section must be rendered");
  assert.ok(fullText.includes("TOOLS"), "TOOLS section must be rendered");
  assert.ok(fullText.includes("✓ read"), "Completed tool must show ✓");
  assert.ok(fullText.includes("× bash"), "Failed tool must show ×");
  assert.ok(fullText.includes("WORKSPACE · main"), "WORKSPACE with branch must be rendered");
  assert.ok(fullText.includes("+42 -3"), "File diff numbers must be rendered");

  // Verify plain ASCII border mode
  const asciiLines = renderSidebar(sampleState, SIDE_W, mockTheme, { plainAscii: true });
  assert.ok(stripTerminalSequences(asciiLines[0]).startsWith("+"), "Plain ASCII top border starts with +");
  assert.ok(stripTerminalSequences(asciiLines[0]).endsWith("+"), "Plain ASCII top border ends with +");
  assert.ok(stripTerminalSequences(asciiLines[1]).startsWith("| "), "Plain ASCII middle starts with | ");
});

test("empty state contains no fake screenshot fixture values", () => {
  const emptyState: SidebarState = {};
  const lines = renderSidebar(emptyState, SIDE_W, mockTheme);
  const text = lines.map((l) => stripTerminalSequences(l)).join("\n");

  // Every line is 34 cols
  for (const ln of lines) {
    assert.equal(visibleWidth(stripTerminalSequences(ln)), SIDE_W);
  }

  // Must NOT contain hardcoded sample strings
  assert.ok(!text.includes("claude-3-7-sonnet"), "Empty state must not contain fake model fixture");
  assert.ok(!text.includes("45,000"), "Empty state must not contain fake token count");
  assert.ok(!text.includes("OAuth2"), "Empty state must not contain fake prompt");
  assert.ok(!text.includes("src/auth.ts"), "Empty state must not contain fake file diffs");

  // Must contain proper empty / default fallbacks
  assert.ok(text.includes("In-memory"), "Empty session file defaults to 'In-memory'");
  assert.ok(text.includes("model · — - off"), "Empty model defaults to '— - off'");
  assert.ok(text.includes("tok —"), "Empty context tokens displays 'tok —'");
  assert.ok(text.includes("time —"), "Empty elapsed time displays 'time —'");
  assert.ok(text.includes("last —"), "Empty last duration displays 'last —'");
  assert.ok(text.includes("speed —"), "Empty speed displays 'speed —'");
  assert.ok(text.includes("in 0"), "Empty in tokens displays 'in 0'");
  assert.ok(text.includes("out 0"), "Empty out tokens displays 'out 0'");
  assert.ok(text.includes("total 0"), "Empty total tokens displays 'total 0'");
  assert.ok(text.includes("turns 0"), "Empty turns displays 'turns 0'");
  assert.ok(text.includes("cache —"), "Empty cache displays 'cache —'");
  assert.ok(text.includes("cost —"), "Empty cost displays 'cost —'");
  assert.ok(text.includes("msgs 0 · u 0 a 0"), "Empty message tally displays 0");
  assert.ok(text.includes("cached — · uncached —"), "Empty cache tokens displays '—'");
  assert.ok(text.includes("COMMANDS"), "Empty state has COMMANDS section");
  assert.ok(/COMMANDS[\s\S]*?[│|]\s+—\s+[│|]/.test(text), "Empty commands displays '—'");
  assert.ok(!text.includes("TOOLS"), "Empty tools list omits TOOLS section entirely");
});

test("state extraction reflects genuine Pi session state", () => {
  const mockContext = {
    mode: "tui",
    hasUI: true,
    cwd: "/workspace/my-project",
    sessionManager: {
      getSessionId: () => "sess-test-987654321",
      getSessionName: () => "Test Pi Session",
      getSessionFile: () => "/workspace/my-project/.pi/sessions/test.json",
      getHeader: () => ({ id: "sess-test-987654321", timestamp: new Date("2025-01-01T12:00:00Z").toISOString() }),
      getEntries: () => [
        {
          type: "message",
          message: {
            role: "user",
            content: "Write a high-performance HTTP server",
          },
        },
        {
          type: "message",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "I will read the configuration first." },
              { type: "toolCall", id: "call_1", name: "read", arguments: {} },
              { type: "toolCall", id: "call_2", name: "bash", arguments: {} },
            ],
            usage: {
              input: 1500,
              output: 400,
              cacheRead: 200,
              cacheWrite: 50,
              cost: { total: 0.008 },
            },
          },
        },
        {
          type: "message",
          message: {
            role: "toolResult",
            toolCallId: "call_1",
            isError: false,
          },
        },
        {
          type: "message",
          message: {
            role: "toolResult",
            toolCallId: "call_2",
            isError: true,
          },
        },
      ],
    },
    model: {
      id: "deepseek-coder",
      name: "DeepSeek Coder",
      contextWindow: 64000,
      thinkingLevels: ["off", "low", "high"],
    },
    thinkingLevel: "high",
    getContextUsage: () => ({
      tokens: 2150,
      contextWindow: 64000,
      percent: 3.36,
    }),
    isIdle: () => false,
  } as any;

  const state = extractSidebarState(mockContext);

  assert.equal(state.session?.id, "sess-test-987654321");
  assert.equal(state.session?.name, "Test Pi Session");
  assert.equal(state.session?.firstPrompt, "Write a high-performance HTTP server");
  assert.equal(state.model?.label, "DeepSeek Coder");
  assert.equal(state.model?.thinkLevel, "high");
  assert.deepEqual(state.model?.thinkLevels, ["off", "low", "high"]);

  assert.equal(state.context?.tokens, 2150);
  assert.equal(state.context?.contextWindow, 64000);
  assert.equal(state.context?.percent, 3.36);

  assert.equal(state.stats?.inTokens, 1500);
  assert.equal(state.stats?.outTokens, 400);
  assert.equal(state.stats?.cacheReadTokens, 200);
  assert.equal(state.stats?.cacheWriteTokens, 50);
  assert.equal(state.stats?.totalTokens, 2150);
  assert.equal(state.stats?.userMessages, 1);
  assert.equal(state.stats?.assistantMessages, 1);
  assert.equal(state.stats?.totalMessages, 4);
  assert.equal(state.stats?.cost, 0.008);

  assert.equal(state.tools?.length, 2);
  assert.equal(state.tools?.[0].name, "read");
  assert.equal(state.tools?.[1].name, "bash");
  assert.equal(state.tools?.[1].status, "error");

  assert.equal(state.workspace?.cwd, "/workspace/my-project");
  assert.equal(state.pet?.status, "working", "Busy alone does not prove the agent is thinking");
});

test("SidebarControl lifecycle and unsupported hosts remain safe", () => {
  const control = createSidebarControl();
  assert.equal(control.isEnabled(), false, "Sidebar control starts disabled");

  // Non-TUI mode context fails safely without throwing
  const nonTuiCtx = { mode: "rpc", hasUI: true } as any;
  const result = control.on(nonTuiCtx);
  assert.ok(result.includes("unavailable"), "Should report unavailable in non-TUI mode");
  assert.equal(control.isEnabled(), false);

  // TUI mode context activates
  let mountedWidgetKey = "";
  let mountedWidgetFactory: any = null;
  const tuiCtx = {
    mode: "tui",
    hasUI: true,
    ui: {
      setWidget: (key: string, factory: any) => {
        mountedWidgetKey = key;
        mountedWidgetFactory = factory;
      },
    },
  } as any;

  const onResult = control.on(tuiCtx);
  assert.equal(onResult, "OMT sidebar on (compact one-column companion).");
  assert.equal(control.isEnabled(), true);
  assert.equal(mountedWidgetKey, "omt-sidebar");
  assert.ok(typeof mountedWidgetFactory === "function");

  // Mounted widget renders correctly
  const widgetComponent = mountedWidgetFactory({ requestRender: () => {} }, mockTheme);
  const widgetLines = widgetComponent.render(80);
  assert.equal(widgetLines.length, 2, "companion reserves only two native widget rows");
  assert.ok(widgetLines.every((line: string) => visibleWidth(line) <= 80));
  assert.match(stripTerminalSequences(widgetLines[1]), /full dashboard/);

  // Toggle turns it off
  const toggleResult = control.toggle(tuiCtx);
  assert.equal(toggleResult, "OMT sidebar off.");
  assert.equal(control.isEnabled(), false);

  // Toggle turns it back on
  control.toggle(tuiCtx);
  assert.equal(control.isEnabled(), true);

  // Cleanup resets everything safely
  control.cleanup?.(tuiCtx);
  assert.equal(control.isEnabled(), false);
});

test("SidebarComponent handles scrolling, keyboard input, pet cycling, and disposal", () => {
  let doneCalled = false;
  let renderRequested = false;
  const mockTui = {
    requestRender: () => {
      renderRequested = true;
    },
  } as any;

  const mockCtx = {
    mode: "tui",
    hasUI: true,
  } as any;

  let cycledPetName = "";
  const component = createSidebarComponent(
    mockTui,
    mockTheme,
    undefined,
    () => {
      doneCalled = true;
    },
    mockCtx,
    {
      onCyclePet: (name) => {
        cycledPetName = name;
      },
    },
  );

  assert.ok(component, "Component must be created");

  // Render keeps 34 cols without stretching across the terminal (OMT sideW = 34)
  const rendered = component.render(80);
  assert.ok(rendered.length > 5);
  for (const ln of rendered) {
    assert.equal(visibleWidth(stripTerminalSequences(ln)), SIDE_W);
  }

  // 'p' key cycles to next pet in table: cat is index 3, next is dragon (index 4)
  component.handleInput("p");
  assert.equal(cycledPetName, "dragon", "First cycle from cat must select dragon (index 4)");
  assert.equal(component.getState().pet?.name, "dragon");
  assert.ok(renderRequested);

  // Down arrow scrolls down
  assert.equal(component.getScrollOffset(), 0);
  component.handleInput("j");
  assert.equal(component.getScrollOffset(), 1);

  // Up arrow scrolls up
  component.handleInput("k");
  assert.equal(component.getScrollOffset(), 0);

  // 'q' closes the component
  component.handleInput("q");
  assert.ok(doneCalled, "Key 'q' must call done()");

  // Disposal cleans up cleanly
  component.dispose();
});
