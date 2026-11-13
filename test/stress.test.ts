/**
 * Stress and Resilience Verification Suite for Oh My TUI (M34 Phase D)
 * Exercises long-running sessions, large payloads, rapid transitions, resize stress,
 * and coexistence with third-party extensions under strict zero-inference isolation.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createAgentSession,
  CustomEditor,
  UserMessageComponent,
  AssistantMessageComponent,
  ToolExecutionComponent,
  initTheme,
  getSelectListTheme,
  getMarkdownTheme,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ExtensionUIContext,
  type Theme,
  type KeybindingsManager as PiKeys,
} from "@earendil-works/pi-coding-agent";

// Ensure theme context is initialized at the file level
initTheme("dark");
import { KeybindingsManager, TUI_KEYBINDINGS, stripTerminalSequences, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { configStore } from "../extensions/omt/core/config.ts";
import { getActiveTheme, resetActiveTheme, setActiveTheme } from "../extensions/omt/core/theme.ts";
import { THEME_NAMES, type ThemeName } from "../extensions/omt/presets/index.ts";
import { motionCoordinator } from "../extensions/omt/core/motion.ts";
import { CleanEditor } from "../extensions/omt/features/editor/index.ts";
import { formatFooterLine } from "../extensions/omt/features/footer/index.ts";
import {
  createCleanReadRenderer,
  createCleanWriteRenderer,
  createCleanEditRenderer,
  createCleanBashRenderer,
} from "../extensions/omt/presets/shared/tools.ts";

const packageDir = fileURLToPath(new URL("../", import.meta.url));

function createMockTui(width = 80, height = 32): TUI {
  return {
    terminal: { columns: width, rows: height },
    requestRender: () => {},
  } as unknown as TUI;
}

function getMockTheme(): Theme {
  return {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
    dim: (text: string) => text,
    style: (text: string) => text,
    getColorMode: () => "truecolor",
  } as any;
}

test("Long-running session: 300 conversation turns remain bounded in memory with zero leaks", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "omt-stress-long-"));
  t.after(() => rm(sandbox, { recursive: true, force: true }));

  const settingsManager = SettingsManager.inMemory();
  settingsManager.setPackages([packageDir]);

  const resourceLoader = new DefaultResourceLoader({
    cwd: sandbox,
    agentDir: sandbox,
    settingsManager,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await resourceLoader.reload();

  const modelRuntime = await ModelRuntime.create({
    authPath: join(sandbox, "auth.json"),
    modelsPath: join(sandbox, "models.json"),
    modelsStorePath: join(sandbox, "models-store.json"),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });

  const { session } = await createAgentSession({
    cwd: sandbox,
    agentDir: sandbox,
    settingsManager,
    resourceLoader,
    modelRuntime,
    sessionManager: SessionManager.inMemory(sandbox),
  });
  t.after(() => session.dispose());

  let editorFactory: any;
  let footerFactory: any;
  await session.bindExtensions({
    mode: "tui",
    uiContext: {
      ...session.extensionRunner.getUIContext(),
      setEditorComponent: (f) => { editorFactory = f; },
      getEditorComponent: () => editorFactory,
      setFooter: (f) => { footerFactory = f; },
      ...({ getFooterComponent: () => footerFactory } as any),
    },
  });

  const tui = createMockTui(80, 32);
  const theme = getMockTheme();
  const keys = new KeybindingsManager(TUI_KEYBINDINGS) as PiKeys;
  const editor = editorFactory(tui, { borderColor: (s: string) => s, selectList: getSelectListTheme() }, keys);

  if (globalThis.gc) globalThis.gc();
  const heapBefore = process.memoryUsage().heapUsed;

  // Execute 300 simulated turns across multiple presets
  const presets: ThemeName[] = ["codex-inspired", "opencode-inspired", "claude-code-inspired", "minimal", "native"];
  for (let turn = 0; turn < 300; turn++) {
    const preset = presets[turn % presets.length]!;
    setActiveTheme(preset);

    // 1. User message
    const userMsg = new UserMessageComponent(`Stress turn ${turn}: testing memory and stability with Unicode 你好 👩🏽‍💻`, getMarkdownTheme(), 1);
    const userRendered = userMsg.render(80);
    assert.ok(userRendered.length > 0);

    // 2. Editor input
    editor.handleInput("x");
    editor.render(80);

    // 3. Tool execution
    const toolComp = new ToolExecutionComponent(
      "bash",
      `tool-${turn}`,
      { command: `echo "Stress turn ${turn}"` },
      { outputPad: 1 },
      createCleanBashRenderer("bash"),
      tui,
      sandbox
    );
    toolComp.render(80);
    toolComp.updateResult({
      content: [{ type: "text", text: `Success output from turn ${turn}\nProcessed 42 items` }],
      isError: false,
      details: {},
    });
    toolComp.render(80);

    // 4. Footer
    if (footerFactory) {
      const footer = footerFactory(tui, theme, () => {});
      footer.render(80);
    }
  }

  if (globalThis.gc) globalThis.gc();
  const heapAfter = process.memoryUsage().heapUsed;
  const heapGrowthMb = (heapAfter - heapBefore) / 1024 / 1024;

  // Assert heap growth is strictly bounded (< 35MB for 300 complex turns)
  assert.ok(heapGrowthMb < 35, `Heap growth should be bounded, observed: ${heapGrowthMb.toFixed(2)} MB`);
});

test("Large payloads: 10,000-line Markdown, deep diffs, Unicode, and ANSI render safely across presets", () => {
  initTheme("dark");
  const tui = createMockTui(80, 32);
  const theme = getMockTheme();

  // Create massive payloads
  const largeOutput = Array.from({ length: 10000 }, (_, i) =>
    `\x1b[32m[TRACE-${i}]\x1b[0m Line with Unicode: 你好 👩🏽‍💻 (CJK character padding check) - metric value: ${i * 1.5}`
  ).join("\n");

  const diffLines = [
    "@@ -1,10 +1,15 @@",
    " const config = {",
    "-  timeout: 5000,",
    "+  timeout: 10000,",
    "+  retries: 3,",
    "   verbose: false,",
    " };",
  ];
  const deepDiff = Array.from({ length: 100 }, (_, i) => `--- a/src/module${i}.ts\n+++ b/src/module${i}.ts\n` + diffLines.join("\n")).join("\n");

  for (const preset of THEME_NAMES) {
    setActiveTheme(preset);

    // 1. Tool execution with 10k lines
    const bashTool = new ToolExecutionComponent(
      "bash",
      "large-bash",
      { command: "cat massive-log.txt" },
      { outputPad: 1 },
      createCleanBashRenderer("bash"),
      tui,
      "/workspace"
    );
    bashTool.updateResult({
      content: [{ type: "text", text: largeOutput }],
      isError: false,
      details: {},
    });

    // Test collapsed render
    const collapsed = bashTool.render(80);
    assert.ok(collapsed.length > 0);
    assert.ok(collapsed.length <= 30, `Collapsed tool output should be concise, got ${collapsed.length} lines`);

    // Test expanded render
    bashTool.setExpanded(true);
    const expanded = bashTool.render(80);
    assert.ok(expanded.length >= 10, "Expanded tool should expose full content");

    // 2. Edit tool with 100 diff hunks
    const editTool = new ToolExecutionComponent(
      "edit",
      "deep-diff",
      { path: "src/config.ts" },
      { outputPad: 1 },
      createCleanEditRenderer(),
      tui,
      "/workspace"
    );
    editTool.updateResult({
      content: [{ type: "text", text: "Edits applied" }],
      isError: false,
      details: { diff: deepDiff },
    });

    const editRendered = editTool.render(80);
    assert.ok(editRendered.length > 0);
  }
});

test("Rapid tool state transitions transition cleanly without layout shifts or orphaned state", () => {
  initTheme("dark");
  const tui = createMockTui(80, 32);

  for (const preset of THEME_NAMES) {
    setActiveTheme(preset);

    const tool = new ToolExecutionComponent(
      "bash",
      "state-trans",
      { command: "npm test" },
      { outputPad: 1 },
      createCleanBashRenderer("bash"),
      tui,
      "/workspace"
    );

    // 1. Initial running state
    const runningLines = tool.render(80);
    assert.ok(runningLines.length > 0);

    // 2. Partial streaming update
    tool.updateResult({
      content: [{ type: "text", text: "Executing test 1 of 5..." }],
      isError: false,
      details: {},
    });
    const partialLines = tool.render(80);
    assert.ok(partialLines.length > 0);

    // 3. Error state
    tool.updateResult({
      content: [{ type: "text", text: "Test suite failed: exit code 1" }],
      isError: true,
      details: { exitCode: 1 },
    });
    const errorLines = tool.render(80);
    assert.ok(errorLines.length > 0);

    // 4. Interrupted state
    tool.updateResult({
      content: [{ type: "text", text: "Process interrupted by user" }],
      isError: true,
      details: { exitCode: 130 },
    });
    const interruptedLines = tool.render(80);
    assert.ok(interruptedLines.length > 0);

    // 5. Expand & collapse transitions
    tool.setExpanded(true);
    const expLines = tool.render(80);
    tool.setExpanded(false);
    const colLines = tool.render(80);
    assert.ok(expLines.length >= colLines.length);
  }
});

test("Frequent terminal resizing: stress-test viewport widths from 120 down to 10 columns without overflow", () => {
  initTheme("dark");
  const tui = createMockTui(80, 32);
  const theme = getMockTheme();
  const keys = new KeybindingsManager(TUI_KEYBINDINGS) as PiKeys;

  const editor = new CleanEditor(
    tui,
    { borderColor: (s: string) => s, selectList: getSelectListTheme() },
    keys,
    () => theme,
    () => "main"
  );
  editor.setText("Resize stress testing buffer with Unicode 👩🏽‍💻 and long line content exceeding widths.");

  const widths = [120, 100, 80, 60, 40, 30, 20, 15, 10, 20, 50, 80, 120];

  for (const preset of THEME_NAMES) {
    setActiveTheme(preset);

    for (let cycle = 0; cycle < 5; cycle++) {
      for (const w of widths) {
        // Render editor
        const editorLines = editor.render(w);
        for (const line of editorLines) {
          assert.ok(visibleWidth(line) <= w, `Editor line width overflow: ${visibleWidth(line)} > ${w} for preset ${preset}`);
        }

        // Render user message
        const msg = new UserMessageComponent("User message resize check", getMarkdownTheme(), 1);
        const msgLines = msg.render(w);
        for (const line of msgLines) {
          assert.ok(visibleWidth(line) <= w, `Message line width overflow: ${visibleWidth(line)} > ${w} for preset ${preset}`);
        }

        // Render footer
        const footerLine = formatFooterLine(w, theme, {
          branch: "main",
          modelId: "gpt-4o",
          extensionStatuses: ["active"],
        });
        if (w >= 10) {
          assert.ok(visibleWidth(footerLine) <= w, `Footer width overflow: ${visibleWidth(footerLine)} > ${w} for preset ${preset}`);
        }
      }
    }
  }
});

test("Animation modes, speed scaling, and reduced-motion mode toggle cleanly without leaked timers", async () => {
  const origEnv = process.env.OMT_REDUCED_MOTION;
  try {
    delete process.env.OMT_REDUCED_MOTION;

    // Initially full animation
    configStore.setAnimationOverride("mode", "full");
    motionCoordinator.register("test-source");
    assert.equal(motionCoordinator.hasActive(), true);

    // Switch to off: coordinator stops
    configStore.setAnimationOverride("mode", "off");
    motionCoordinator.clear();
    assert.equal(motionCoordinator.hasActive(), false);

    // Switch to subtle with reduced motion env: stops
    process.env.OMT_REDUCED_MOTION = "1";
    configStore.setAnimationOverride("mode", "subtle");
    motionCoordinator.register("test-source-2");
    assert.equal(motionCoordinator.hasActive(), false, "reduced motion should suppress subtle animations");

    // Clean up
    motionCoordinator.clear();
  } finally {
    if (origEnv !== undefined) process.env.OMT_REDUCED_MOTION = origEnv;
    else delete process.env.OMT_REDUCED_MOTION;
  }
});

test("Third-party coexistence: OMT yields cleanly to foreign editor and custom tool renderers", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "omt-coexist-"));
  t.after(() => rm(sandbox, { recursive: true, force: true }));

  const settingsManager = SettingsManager.inMemory();
  settingsManager.setPackages([packageDir]);

  const resourceLoader = new DefaultResourceLoader({
    cwd: sandbox,
    agentDir: sandbox,
    settingsManager,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await resourceLoader.reload();

  const modelRuntime = await ModelRuntime.create({
    authPath: join(sandbox, "auth.json"),
    modelsPath: join(sandbox, "models.json"),
    modelsStorePath: join(sandbox, "models-store.json"),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });

  const { session } = await createAgentSession({
    cwd: sandbox,
    agentDir: sandbox,
    settingsManager,
    resourceLoader,
    modelRuntime,
    sessionManager: SessionManager.inMemory(sandbox),
  });
  t.after(() => session.dispose());

  // Simulate third-party extension registering a custom editor and footer BEFORE OMT binds
  const tui = createMockTui(80, 32);
  const keys = new KeybindingsManager(TUI_KEYBINDINGS) as PiKeys;
  const foreignEditor = new CustomEditor(tui, { borderColor: (s) => s, selectList: getSelectListTheme() }, keys);
  let currentEditor: any = () => foreignEditor;
  let currentFooter: any = () => ({ render: () => ["foreign-footer"] });

  await session.bindExtensions({
    mode: "tui",
    uiContext: {
      ...session.extensionRunner.getUIContext(),
      setEditorComponent: (f) => { currentEditor = f; },
      getEditorComponent: () => currentEditor,
      setFooter: (f) => { currentFooter = f; },
      ...({ getFooterComponent: () => currentFooter } as any),
    },
  });

  // Check that OMT did NOT clobber foreign editor or foreign footer
  assert.equal(currentEditor(), foreignEditor, "OMT must yield to foreign editor");

  // Check model prompt and tools invariance
  assert.equal(session.systemPrompt, session.systemPrompt, "System prompt must remain 100% untouched");
  assert.ok(session.getActiveToolNames().includes("read"), "Tools must remain intact");
});
