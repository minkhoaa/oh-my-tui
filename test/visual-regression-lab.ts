import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  InteractiveMode,
  UserMessageComponent,
  AssistantMessageComponent,
  ToolExecutionComponent,
  getSelectListTheme,
  initTheme,
  type KeybindingsManager as PiKeys,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  KeybindingsManager,
  TUI_KEYBINDINGS,
  type TUI,
} from "@earendil-works/pi-tui";
import type { VisualFixture, RegressionComparisonResult } from "./visual-contracts.ts";
import { CleanEditor } from "../extensions/omt/features/editor/index.ts";
import { createUserMessageControl } from "../extensions/omt/features/user-message/index.ts";
import {
  createCleanReadRenderer,
  createCleanWriteRenderer,
  createCleanEditRenderer,
  createCleanBashRenderer,
} from "../extensions/omt/presets/shared/tools.ts";
import { formatFooterLine } from "../extensions/omt/features/footer/index.ts";
import { getActiveTheme, setActiveTheme } from "../extensions/omt/core/theme.ts";
import { resolveThemeName, THEME_NAMES, type ThemeName } from "../extensions/omt/presets/index.ts";
import { workingLine } from "../extensions/omt/presets/shared/working.ts";

export type { VisualFixture, RegressionComparisonResult };

export const SUPPORTED_PRESETS: readonly ThemeName[] = THEME_NAMES;

export const SUPPORTED_STATES: readonly VisualFixture["state"][] = [
  "first-frame",
  "tool",
  "diff",
  "message",
  "thinking",
  "resize",
] as const;

export const DEFAULT_WIDTHS: readonly number[] = [120, 80, 40, 20] as const;

const FIXTURES_DIR = resolve(fileURLToPath(import.meta.url), "../fixtures");
const BASELINES_FILE = resolve(FIXTURES_DIR, "baselines.json");

let cachedBaselines: Record<string, string> | undefined;

// Ensure theme context is initialized for headless mock rendering
initTheme("dark");

export function getFixtureKey(fixture: VisualFixture): string {
  return `${fixture.preset}/${fixture.state}/${fixture.name}/${fixture.width}`;
}

export function loadAllBaselines(): Record<string, string> {
  if (cachedBaselines) return cachedBaselines;
  if (existsSync(BASELINES_FILE)) {
    try {
      const data = readFileSync(BASELINES_FILE, "utf8");
      cachedBaselines = JSON.parse(data) as Record<string, string>;
      return cachedBaselines;
    } catch {
      // Fall through to empty store on read error
    }
  }
  cachedBaselines = {};
  return cachedBaselines;
}

export function saveAllBaselines(baselines: Record<string, string>): void {
  if (!existsSync(FIXTURES_DIR)) {
    mkdirSync(FIXTURES_DIR, { recursive: true });
  }
  writeFileSync(BASELINES_FILE, JSON.stringify(baselines, null, 2), "utf8");
  cachedBaselines = { ...baselines };
}

export function getBaseline(fixture: VisualFixture): string {
  const key = getFixtureKey(fixture);
  const baselines = loadAllBaselines();
  if (key in baselines) {
    return baselines[key]!;
  }
  const rendered = renderFixtureState(fixture);
  baselines[key] = rendered;
  return rendered;
}

export function saveBaseline(fixture: VisualFixture, ansi: string): void {
  const key = getFixtureKey(fixture);
  const baselines = loadAllBaselines();
  baselines[key] = ansi;
  saveAllBaselines(baselines);
}

export function createDeterministicFixture(
  name: string,
  preset: string,
  state: string,
  width: number,
  data?: unknown
): VisualFixture {
  return {
    name,
    preset,
    width,
    state: state as VisualFixture["state"],
    inputData: data,
  };
}

export function renderFixtureState(fixture: VisualFixture): string {
  const previousPreset = getActiveTheme().id;
  const resolvedPreset = resolveThemeName(fixture.preset) ?? fixture.preset;
  setActiveTheme(resolvedPreset);

  const tui = {
    terminal: { rows: fixture.height ?? 32, columns: fixture.width },
    requestRender() {},
  } as unknown as TUI;
  const keys = new KeybindingsManager(TUI_KEYBINDINGS);
  const theme = (
    InteractiveMode.prototype as unknown as {
      createExtensionUIContext(this: unknown): { theme: Theme };
    }
  ).createExtensionUIContext.call({}).theme;
  const cwd = "/workspace/project";

  try {
    switch (fixture.state) {
      case "first-frame": {
        const input = (fixture.inputData as Record<string, unknown> | undefined) ?? {};
        const text =
          typeof fixture.inputData === "string"
            ? fixture.inputData
            : (input.text as string | undefined) ?? "";
        const branch = (input.branch as string | undefined) ?? "main";
        const modelId = (input.modelId as string | undefined) ?? "fixture-model";
        const component = (input.component as string | undefined) ?? "all";

        const editor = new CleanEditor(
          tui,
          { borderColor: (s: string) => s, selectList: getSelectListTheme() },
          keys as unknown as PiKeys,
          () => theme,
          () => "Fixture · local"
        );
        editor.setText(text);
        const editorLines = editor.render(fixture.width);
        const footerLine = formatFooterLine(fixture.width, theme, {
          branch,
          cwd,
          extensionStatuses: [],
          modelId,
          contextUsage: { percent: 0, contextWindow: 200000 },
          reasoning: false,
        });

        if (component === "editor") return editorLines.join("\n");
        if (component === "footer") return footerLine;
        return [...editorLines, footerLine].join("\n");
      }

      case "tool": {
        const input = (fixture.inputData as Record<string, unknown> | undefined) ?? {};
        let toolName = input.tool as string | undefined;
        if (!toolName) {
          const lower = fixture.name.toLowerCase();
          if (lower.includes("bash")) toolName = "bash";
          else if (lower.includes("write")) toolName = "write";
          else if (lower.includes("edit")) toolName = "edit";
          else toolName = "read";
        }
        const expanded = Boolean(input.expanded);
        const isError = Boolean(input.isError);

        const defaultArgs: Record<string, unknown> =
          toolName === "read"
            ? { path: "src/index.ts", offset: 1, limit: 10 }
            : toolName === "write"
            ? { path: "src/generated.ts", content: "export const VERSION = '1.0.0';\n" }
            : toolName === "edit"
            ? { path: "src/utils.ts" }
            : toolName === "bash"
            ? { command: "npm test" }
            : { path: "file.txt" };

        type ToolUpdateResult = Parameters<ToolExecutionComponent["updateResult"]>[0];

        const defaultResult: ToolUpdateResult =
          toolName === "read"
            ? {
                content: [
                  {
                    type: "text",
                    text: "import { config } from './config.ts';\nexport function run() {}\n",
                  },
                ],
                isError,
              }
            : toolName === "write"
            ? {
                content: [{ type: "text", text: "Wrote 35 bytes to src/generated.ts" }],
                isError,
              }
            : toolName === "edit"
            ? {
                content: [{ type: "text", text: "Replaced 1 line" }],
                details: { diff: "-const timeout = 1000;\n+const timeout = 5000;" },
                isError,
              }
            : toolName === "bash"
            ? {
                content: [{ type: "text", text: "PASS test/index.test.ts\n12 tests passed" }],
                details: { exitCode: 0 },
                isError,
              }
            : { content: [{ type: "text", text: "OK" }], isError };

        const args = (input.args as Record<string, unknown> | undefined) ?? defaultArgs;
        const result = (input.result as ToolUpdateResult | undefined) ?? defaultResult;

        const toolRenderer =
          toolName === "read"
            ? createCleanReadRenderer()
            : toolName === "write"
            ? createCleanWriteRenderer()
            : toolName === "edit"
            ? createCleanEditRenderer()
            : createCleanBashRenderer(toolName);

        const comp = new ToolExecutionComponent(
          toolName,
          `fixture-${fixture.name}`,
          args,
          {},
          toolRenderer,
          tui,
          cwd
        );
        comp.updateResult(result);
        if (expanded) comp.setExpanded(true);
        return comp.render(fixture.width).join("\n");
      }

      case "diff": {
        const input = (fixture.inputData as Record<string, unknown> | undefined) ?? {};
        const path = (input.path as string | undefined) ?? "src/app.ts";
        const diffText =
          typeof fixture.inputData === "string"
            ? fixture.inputData
            : (input.diff as string | undefined) ??
              "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -10,4 +10,4 @@\n-const debug = false;\n+const debug = true;\n const maxRetries = 3;";
        const expanded = input.expanded !== false;

        const renderer = createCleanEditRenderer();
        const comp = new ToolExecutionComponent(
          "edit",
          `fixture-diff-${fixture.name}`,
          { path },
          {},
          renderer,
          tui,
          cwd
        );
        comp.updateResult({
          content: [{ type: "text", text: `Updated ${path}` }],
          details: { diff: diffText },
          isError: false,
        });
        if (expanded) comp.setExpanded(true);
        return comp.render(fixture.width).join("\n");
      }

      case "message": {
        const input = (fixture.inputData as Record<string, unknown> | undefined) ?? {};
        const userText =
          typeof fixture.inputData === "string"
            ? fixture.inputData
            : (input.user as string | undefined) ??
              "Please inspect the application performance and propose fixes.";
        const assistantText =
          (input.assistant as string | undefined) ??
          "I have reviewed the codebase and identified 2 key optimizations.";
        const role = (input.role as "user" | "assistant" | "both" | undefined) ?? "both";

        const control = createUserMessageControl(() => theme);
        try {
          control.applyTheme?.();
          const userComp = new UserMessageComponent(userText);
          const assistantComp = new AssistantMessageComponent({
            role: "assistant",
            content: [{ type: "text", text: assistantText }],
            stopReason: "stop",
          } as any);

          if (role === "user") return userComp.render(fixture.width).join("\n");
          if (role === "assistant") return assistantComp.render(fixture.width).join("\n");
          return [...userComp.render(fixture.width), ...assistantComp.render(fixture.width)].join(
            "\n"
          );
        } finally {
          control.cleanup?.();
        }
      }

      case "thinking": {
        const input = (fixture.inputData as Record<string, unknown> | undefined) ?? {};
        const thinkingText =
          typeof fixture.inputData === "string"
            ? fixture.inputData
            : (input.thinking as string | undefined) ??
              "Evaluating constraints, reviewing memory allocation, and validating layout bounds.";
        const answerText = (input.text as string | undefined) ?? "Here is the refined architecture.";
        const showWorking = input.showWorking !== false;
        const elapsed = (input.elapsed as number | undefined) ?? 1200;

        const assistant = new AssistantMessageComponent({
          role: "assistant",
          content: [
            { type: "thinking", thinking: thinkingText },
            { type: "text", text: answerText },
          ],
          stopReason: "stop",
        } as any);
        const asstLines = assistant.render(fixture.width);
        if (!showWorking) return asstLines.join("\n");

        const wl = workingLine(theme, elapsed, "Thinking", "esc", fixture.width);
        const statusLine =
          wl ?? `${getActiveTheme().thinking.indicator} ${getActiveTheme().thinking.label}`;
        return [...asstLines, statusLine].join("\n");
      }

      case "resize": {
        const input = (fixture.inputData as Record<string, unknown> | undefined) ?? {};
        const promptText =
          (input.user as string | undefined) ??
          "Resize test prompt across multiple column widths.";
        const toolComp = new ToolExecutionComponent(
          "read",
          "resize-tool",
          { path: "long/nested/path/to/source/file/implementation.ts" },
          {},
          createCleanReadRenderer(),
          tui,
          cwd
        );
        toolComp.updateResult({
          content: [{ type: "text", text: "File contents loaded successfully." }],
          isError: false,
        });

        const footer = formatFooterLine(fixture.width, theme, {
          branch: "feature/visual-regression-lab",
          cwd,
          extensionStatuses: ["running: verify"],
          modelId: "gpt-4o",
          contextUsage: { percent: 45, contextWindow: 128000 },
          reasoning: true,
          thinkingLevel: "high",
        });

        const control = createUserMessageControl(() => theme);
        try {
          control.applyTheme?.();
          const user = new UserMessageComponent(promptText);
          return [
            ...user.render(fixture.width),
            ...toolComp.render(fixture.width),
            footer,
          ].join("\n");
        } finally {
          control.cleanup?.();
        }
      }

      case "layout": {
        const editor = new CleanEditor(
          tui,
          { borderColor: (s: string) => s, selectList: getSelectListTheme() },
          keys as unknown as PiKeys,
          () => theme,
          () => "Fixture · local"
        );
        editor.setText("Draft input");
        const toolComp = new ToolExecutionComponent(
          "bash",
          "layout-bash",
          { command: "git status --short" },
          {},
          createCleanBashRenderer("bash"),
          tui,
          cwd
        );
        toolComp.updateResult({
          content: [{ type: "text", text: "M src/index.ts" }],
          isError: false,
        });
        const footer = formatFooterLine(fixture.width, theme, {
          branch: "main",
          cwd,
          extensionStatuses: [],
          modelId: "model",
        });
        const control = createUserMessageControl(() => theme);
        try {
          control.applyTheme?.();
          const user = new UserMessageComponent("Layout check prompt");
          return [
            ...user.render(fixture.width),
            ...toolComp.render(fixture.width),
            ...editor.render(fixture.width),
            footer,
          ].join("\n");
        } finally {
          control.cleanup?.();
        }
      }

      default:
        throw new Error(`Unsupported fixture state: ${(fixture as { state: string }).state}`);
    }
  } finally {
    setActiveTheme(previousPreset);
  }
}

export function compareRender(
  fixture: VisualFixture,
  actualAnsi: string,
  expectedAnsi: string
): RegressionComparisonResult {
  if (actualAnsi === expectedAnsi) {
    return {
      passed: true,
      fixtureName: fixture.name,
      preset: fixture.preset,
      width: fixture.width,
      actualAnsi,
      expectedAnsi,
    };
  }

  const actualLines = actualAnsi.split("\n");
  const expectedLines = expectedAnsi.split("\n");
  const maxLines = Math.max(actualLines.length, expectedLines.length);
  const diffEntries: string[] = [];

  for (let i = 0; i < maxLines; i++) {
    const act = actualLines[i];
    const exp = expectedLines[i];
    if (act !== exp) {
      diffEntries.push(
        `Line ${i + 1}:\n  - expected: ${JSON.stringify(exp ?? "<EOF>")}\n  + actual:   ${JSON.stringify(act ?? "<EOF>")}`
      );
    }
  }

  const diffSummary = [
    `Regression detected in "${fixture.name}" [preset: ${fixture.preset}, width: ${fixture.width}]:`,
    `${diffEntries.length} line(s) differed:`,
    ...diffEntries.slice(0, 10),
    ...(diffEntries.length > 10 ? [`... and ${diffEntries.length - 10} more line(s)`] : []),
  ].join("\n");

  return {
    passed: false,
    fixtureName: fixture.name,
    preset: fixture.preset,
    width: fixture.width,
    diffSummary,
    actualAnsi,
    expectedAnsi,
  };
}

export function formatRegressionReport(results: RegressionComparisonResult[]): string {
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;

  const lines: string[] = [];
  lines.push("=======================================================");
  lines.push(`Visual Regression Report: ${passed}/${total} passed (${failed} failed)`);
  lines.push("=======================================================");

  if (failed === 0) {
    lines.push(`All ${total} visual regression checks passed.`);
    return lines.join("\n");
  }

  lines.push("");
  lines.push(`Failures (${failed}):`);
  for (const failure of results.filter((r) => !r.passed)) {
    lines.push("-------------------------------------------------------");
    lines.push(`FAIL: ${failure.fixtureName}`);
    lines.push(`Preset: ${failure.preset} | Width: ${failure.width}`);
    if (failure.diffSummary) {
      lines.push(failure.diffSummary);
    }
  }
  lines.push("-------------------------------------------------------");

  return lines.join("\n");
}

export function generateDefaultFixtures(
  presets: readonly string[] = SUPPORTED_PRESETS,
  widths: readonly number[] = DEFAULT_WIDTHS
): VisualFixture[] {
  const fixtures: VisualFixture[] = [];
  for (const preset of presets) {
    for (const width of widths) {
      fixtures.push(createDeterministicFixture("first-frame", preset, "first-frame", width));
      fixtures.push(createDeterministicFixture("tool-read", preset, "tool", width, { tool: "read" }));
      fixtures.push(createDeterministicFixture("tool-write", preset, "tool", width, { tool: "write" }));
      fixtures.push(createDeterministicFixture("tool-edit", preset, "tool", width, { tool: "edit" }));
      fixtures.push(createDeterministicFixture("tool-bash", preset, "tool", width, { tool: "bash" }));
      fixtures.push(createDeterministicFixture("diff", preset, "diff", width));
      fixtures.push(createDeterministicFixture("message", preset, "message", width));
      fixtures.push(createDeterministicFixture("thinking", preset, "thinking", width));
      fixtures.push(createDeterministicFixture("resize", preset, "resize", width));
    }
  }
  return fixtures;
}

export function rebuildAllBaselines(): Record<string, string> {
  const fixtures = generateDefaultFixtures();
  const baselines: Record<string, string> = {};
  for (const fixture of fixtures) {
    const key = getFixtureKey(fixture);
    baselines[key] = renderFixtureState(fixture);
  }
  saveAllBaselines(baselines);
  return baselines;
}

export async function runVisualRegressionSuite(
  presets?: string[],
  widths?: number[]
): Promise<{
  total: number;
  passed: number;
  failed: number;
  results: RegressionComparisonResult[];
  report: string;
}> {
  const targetPresets = presets && presets.length > 0 ? presets : SUPPORTED_PRESETS;
  const targetWidths = widths && widths.length > 0 ? widths : DEFAULT_WIDTHS;
  const fixtures = generateDefaultFixtures(targetPresets, targetWidths);

  const results: RegressionComparisonResult[] = [];
  for (const fixture of fixtures) {
    const actualAnsi = renderFixtureState(fixture);
    const expectedAnsi = getBaseline(fixture);
    const result = compareRender(fixture, actualAnsi, expectedAnsi);
    results.push(result);
  }

  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;
  const report = formatRegressionReport(results);

  return { total, passed, failed, results, report };
}
