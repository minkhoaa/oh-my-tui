/**
 * Comprehensive Benchmark Suite for Oh My TUI (M34)
 * Measures Native Pi vs OMT Presets under equivalent deterministic conditions.
 * Zero model network calls; deterministic fixtures and in-memory sessions.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import {
  createAgentSession,
  CustomEditor,
  UserMessageComponent,
  AssistantMessageComponent,
  ToolExecutionComponent,
  initTheme,
  getSelectListTheme,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ExtensionUIContext,
  type Theme,
  type KeybindingsManager as PiKeys,
} from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, TUI_KEYBINDINGS, type TUI } from "@earendil-works/pi-tui";
import { configStore } from "../extensions/omt/core/config.ts";
import { setActiveTheme, resetActiveTheme } from "../extensions/omt/core/theme.ts";
import { type ThemeName } from "../extensions/omt/presets/index.ts";
import { CleanEditor } from "../extensions/omt/features/editor/index.ts";
import { formatFooterLine } from "../extensions/omt/features/footer/index.ts";
import { motionCoordinator } from "../extensions/omt/core/motion.ts";

const packageDir = fileURLToPath(new URL("../", import.meta.url));

export interface Stats {
  median: number;
  p95: number;
  min: number;
  max: number;
  mean: number;
  stddev: number;
  count: number;
}

export function computeStats(samples: number[]): Stats {
  if (samples.length === 0) {
    return { median: 0, p95: 0, min: 0, max: 0, mean: 0, stddev: 0, count: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const count = sorted.length;
  const min = sorted[0]!;
  const max = sorted[count - 1]!;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / count;
  const median = count % 2 === 0
    ? (sorted[count / 2 - 1]! + sorted[count / 2]!) / 2
    : sorted[Math.floor(count / 2)]!;
  const p95Idx = Math.min(count - 1, Math.floor(count * 0.95));
  const p95 = sorted[p95Idx]!;
  const variance = sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (count > 1 ? count - 1 : 1);
  const stddev = Math.sqrt(variance);
  return { median, p95, min, max, mean, stddev, count };
}

export type PresetBenchmarkTarget =
  | "native-pi"
  | "omt-native"
  | "omt-signature"
  | "omt-clean"
  | "omt-rail"
  | "omt-ember"
  | "minimal"
  | "signature-noanim"
  | "clean-noanim"
  | "rail-noanim"
  | "ember-noanim";

export interface BenchmarkReport {
  timestamp: string;
  environment: {
    node: string;
    platform: string;
    arch: string;
    cpus: number;
  };
  packageStats: {
    tarballBytes: number;
    unpackedBytes: number;
    fileCount: number;
    moduleImportMs: Stats;
  };
  targets: Record<PresetBenchmarkTarget, TargetResults>;
}

export interface TargetResults {
  coldStartupMs: number;
  emberStartupMs: Stats;
  firstUsableFrameMs: Stats;
  idleCpuPercent: number;
  idleActiveTimers: number;
  activeRenderFrameMs: Stats;
  activeRedrawFps: number;
  inputLatencyMs: Stats;
  memory: {
    baselineRssMb: number;
    baselineHeapUsedMb: number;
    growthRssMb: number;
    growthHeapUsedMb: number;
  };
  toolRenderLatencyMs: {
    short10Lines: Stats;
    medium100Lines: Stats;
    large1000Lines: Stats;
    huge5000Lines: Stats;
    large1000LinesExpanded: Stats;
    huge5000LinesExpanded: Stats;
    diffHunks: Stats;
  };
  transitionLatencyMs: {
    presetSwitchMs: Stats;
    resizeLatencyMs: Stats;
    reloadLatencyMs: Stats;
  };
}

// Ensure theme context is initialized
initTheme("dark");

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

/**
 * Creates an isolated deterministic Pi test session.
 */
async function createIsolatedSession(loadOmt: boolean) {
  const sandbox = await mkdtemp(join(tmpdir(), "omt-bench-"));
  const cleanup = async () => {
    try {
      await rm(sandbox, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  };

  const settingsManager = SettingsManager.inMemory();
  if (loadOmt) {
    settingsManager.setPackages([packageDir]);
  }

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

  return { session, sandbox, cleanup };
}

/**
 * Measures Module Import Overhead
 */
function measurePackageOverhead(sampleCount = 10) {
  // 1. Tarball & unpacked stats
  let tarballBytes = 0;
  let unpackedBytes = 0;
  let fileCount = 0;
  try {
    const packJson = execSync("npm pack --dry-run --json", { cwd: packageDir, encoding: "utf8" });
    const parsed = JSON.parse(packJson);
    if (Array.isArray(parsed) && parsed.length > 0) {
      tarballBytes = parsed[0].size ?? 0;
      unpackedBytes = parsed[0].unpackedSize ?? 0;
      fileCount = parsed[0].entryCount ?? 0;
    }
  } catch {
    // Fallback if npm pack json parse fails
  }

  // 2. Pure import time in child processes (isolating V8 cache)
  const importTimes: number[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const start = performance.now();
    execSync("node --experimental-strip-types -e 'await import(\"./extensions/omt/index.ts\")'", {
      cwd: packageDir,
      stdio: "ignore",
    });
    importTimes.push(performance.now() - start);
  }

  return {
    tarballBytes,
    unpackedBytes,
    fileCount,
    moduleImportMs: computeStats(importTimes),
  };
}

/**
 * Run benchmarks for a specific target configuration.
 */
export async function benchmarkTarget(
  target: PresetBenchmarkTarget,
  options: { samples?: number; toolIterations?: number } = {}
): Promise<TargetResults> {
  const samples = options.samples ?? 15;
  const isOmt = target !== "native-pi";
  const animOff = target.endsWith("-noanim");
  const basePreset = target.replace("-noanim", "") as ThemeName | "native-pi" | "omt-native";
  const actualPreset: ThemeName =
    basePreset === "native-pi" ? "native"
    : basePreset === "omt-native" ? "native"
    : (basePreset as ThemeName);

  // Apply animation override
  configStore.clearSessionOverrides();
  if (animOff) {
    configStore.setAnimationOverride("mode", "off");
  } else {
    configStore.setAnimationOverride("mode", "full");
  }
  if (isOmt) {
    setActiveTheme(actualPreset);
  } else {
    resetActiveTheme();
  }

  // 1. Cold startup (first time session creation + bindExtensions)
  let coldStartupMs = 0;
  {
    const t0 = performance.now();
    const { session, cleanup } = await createIsolatedSession(isOmt);
    await session.bindExtensions({ mode: "tui" });
    coldStartupMs = performance.now() - t0;
    await session.dispose();
    await cleanup();
  }

  // 2. Ember startup
  const emberStartupSamples: number[] = [];
  for (let i = 0; i < samples; i++) {
    const t0 = performance.now();
    const { session, cleanup } = await createIsolatedSession(isOmt);
    await session.bindExtensions({ mode: "tui" });
    emberStartupSamples.push(performance.now() - t0);
    await session.dispose();
    await cleanup();
  }

  // 3. Time to first usable frame
  const firstFrameSamples: number[] = [];
  for (let i = 0; i < samples; i++) {
    const t0 = performance.now();
    const { session, cleanup } = await createIsolatedSession(isOmt);
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

    // Render initial composer + footer frame
    if (editorFactory) {
      const editor = editorFactory(tui, { borderColor: (s: string) => s, selectList: getSelectListTheme() }, keys);
      editor.render(80);
    }
    if (footerFactory) {
      const footer = footerFactory(tui, theme, () => {});
      footer.render(80);
    }

    firstFrameSamples.push(performance.now() - t0);
    await session.dispose();
    await cleanup();
  }

  // Setup long-lived session for interaction, rendering, and memory tests
  const { session, cleanup } = await createIsolatedSession(isOmt);
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
  const editor = editorFactory
    ? editorFactory(tui, { borderColor: (s: string) => s, selectList: getSelectListTheme() }, keys)
    : new CustomEditor(tui, { borderColor: (s: string) => s, selectList: getSelectListTheme() }, keys);

  // 4. Idle CPU & Active Timers
  if (globalThis.gc) globalThis.gc();
  const startCpu = process.cpuUsage();
  const idleStart = performance.now();
  await new Promise((resolve) => setTimeout(resolve, 200));
  const idleCpuDiff = process.cpuUsage(startCpu);
  const idleElapsedMs = performance.now() - idleStart;
  const idleTotalUs = idleCpuDiff.user + idleCpuDiff.system;
  const idleCpuPercent = Number(((idleTotalUs / (idleElapsedMs * 1000)) * 100).toFixed(2));

  const activeResources = (process as any).getActiveResourcesInfo ? (process as any).getActiveResourcesInfo() : [];
  const idleActiveTimers = activeResources.filter((r: string) => r === "Timeout" || r === "Timer").length;

  // 5. Active Rendering Frame Latency & Redraw Frequency
  const frameSamples: number[] = [];
  const renderStart = performance.now();
  let frameCount = 0;
  // Measure rendering frame latency for 100 render loops
  for (let i = 0; i < 100; i++) {
    const f0 = performance.now();
    editor.render(80);
    if (footerFactory) {
      const footer = footerFactory(tui, theme, () => {});
      footer.render(80);
    }
    frameSamples.push(performance.now() - f0);
    frameCount++;
  }
  const renderElapsed = performance.now() - renderStart;
  const activeRedrawFps = Number(((frameCount / renderElapsed) * 1000).toFixed(1));

  // 6. Keyboard & Input Responsiveness (handleInput across 500 keys)
  const inputSamples: number[] = [];
  const sampleKeys = ["a", "b", "c", "d", " ", "\n", "中", "文", "\x1b[D", "\x1b[C", "\x7f"];
  for (let i = 0; i < 500; i++) {
    const key = sampleKeys[i % sampleKeys.length]!;
    const k0 = performance.now();
    editor.handleInput(key);
    inputSamples.push(performance.now() - k0);
  }

  // 7. Memory & Leak Detection
  if (globalThis.gc) globalThis.gc();
  const memBefore = process.memoryUsage();
  const baselineRssMb = Number((memBefore.rss / 1024 / 1024).toFixed(2));
  const baselineHeapUsedMb = Number((memBefore.heapUsed / 1024 / 1024).toFixed(2));

  // Simulate 300 tool turns
  const mockContext = {
    isPartial: false,
    isError: false,
    expanded: false,
    outputPad: 0,
    cwd: "/workspace",
    keyText: () => "Ctrl+O",
    args: {},
    state: {},
  };
  const resolved = session.extensionRunner.resolveToolRenderers("bash", () => session.getToolDefinition("bash"));

  for (let i = 0; i < 300; i++) {
    if (resolved?.renderCall) resolved.renderCall({ command: `npm test --turn=${i}` }, theme, mockContext as any);
    if (resolved?.renderResult) {
      resolved.renderResult(
        { content: [{ type: "text", text: `Output line from test turn ${i}\nDone in ${i}ms` }], details: {} },
        { expanded: false, isPartial: false },
        theme,
        mockContext as any
      );
    }
  }
  if (globalThis.gc) globalThis.gc();
  const memAfter = process.memoryUsage();
  const growthRssMb = Number(((memAfter.rss - memBefore.rss) / 1024 / 1024).toFixed(2));
  const growthHeapUsedMb = Number(((memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024).toFixed(2));

  // 8. Tool-Result Rendering & Long-Output Performance
  const toolIterations = options.toolIterations ?? 20;

  const measureToolOutput = (lineCount: number, expanded = false) => {
    const lines = Array.from({ length: lineCount }, (_, i) => `Log line [${i}] stdout output entry data trace 1234567890`);
    const outputText = lines.join("\n");
    const samples: number[] = [];
    for (let i = 0; i < toolIterations; i++) {
      const t0 = performance.now();
      if (resolved?.renderResult) {
        const comp = resolved.renderResult(
          { content: [{ type: "text", text: outputText }], details: {} },
          { expanded, isPartial: false },
          theme,
          mockContext as any
        );
        if (comp && typeof (comp as any).render === "function") {
          (comp as any).render(80);
        }
      }
      samples.push(performance.now() - t0);
    }
    return computeStats(samples);
  };

  const short10Lines = measureToolOutput(10, false);
  const medium100Lines = measureToolOutput(100, false);
  const large1000Lines = measureToolOutput(1000, false);
  const huge5000Lines = measureToolOutput(5000, false);
  const large1000LinesExpanded = measureToolOutput(1000, true);
  const huge5000LinesExpanded = measureToolOutput(5000, true);

  // Measure diff hunks rendering
  const diffHunkLines: string[] = [
    "@@ -1,5 +1,6 @@",
    " const a = 1;",
    "-const b = 2;",
    "+const b = 20;",
    "+const c = 30;",
    " const d = 4;",
  ];
  const fullDiffText = Array.from({ length: 50 }, (_, i) => `--- a/file${i}.ts\n+++ b/file${i}.ts\n` + diffHunkLines.join("\n")).join("\n");
  const diffSamples: number[] = [];
  const editResolved = session.extensionRunner.resolveToolRenderers("edit", () => session.getToolDefinition("edit"));
  for (let i = 0; i < toolIterations; i++) {
    const t0 = performance.now();
    if (editResolved?.renderResult) {
      const comp = editResolved.renderResult(
        { content: [{ type: "text", text: "Edits applied" }], details: { diff: fullDiffText } },
        { expanded: false, isPartial: false },
        theme,
        mockContext as any
      );
      if (comp && typeof (comp as any).render === "function") {
        (comp as any).render(80);
      }
    }
    diffSamples.push(performance.now() - t0);
  }
  const diffHunks = computeStats(diffSamples);

  // 9. Preset Switching, Resize, and Reload Latency
  const switchSamples: number[] = [];
  const presetsToCycle: ThemeName[] = ["omt-signature", "omt-clean", "omt-rail", "omt-ember", "minimal", "native"];
  for (let i = 0; i < 20; i++) {
    const nextPreset = presetsToCycle[i % presetsToCycle.length]!;
    const t0 = performance.now();
    setActiveTheme(nextPreset);
    if (editorFactory) {
      editor.render(80);
    }
    switchSamples.push(performance.now() - t0);
  }
  const presetSwitchMs = computeStats(switchSamples);

  const resizeSamples: number[] = [];
  const widths = [120, 80, 60, 40, 20, 40, 80, 120];
  for (let i = 0; i < 30; i++) {
    const w = widths[i % widths.length]!;
    const t0 = performance.now();
    editor.render(w);
    if (footerFactory) {
      const footer = footerFactory(tui, theme, () => {});
      footer.render(w);
    }
    resizeSamples.push(performance.now() - t0);
  }
  const resizeLatencyMs = computeStats(resizeSamples);

  const reloadSamples: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    await session.reload();
    reloadSamples.push(performance.now() - t0);
  }
  const reloadLatencyMs = computeStats(reloadSamples);

  await session.dispose();
  await cleanup();

  return {
    coldStartupMs,
    emberStartupMs: computeStats(emberStartupSamples),
    firstUsableFrameMs: computeStats(firstFrameSamples),
    idleCpuPercent,
    idleActiveTimers,
    activeRenderFrameMs: computeStats(frameSamples),
    activeRedrawFps,
    inputLatencyMs: computeStats(inputSamples),
    memory: {
      baselineRssMb,
      baselineHeapUsedMb,
      growthRssMb,
      growthHeapUsedMb,
    },
    toolRenderLatencyMs: {
      short10Lines,
      medium100Lines,
      large1000Lines,
      huge5000Lines,
      large1000LinesExpanded,
      huge5000LinesExpanded,
      diffHunks,
    },
    transitionLatencyMs: {
      presetSwitchMs,
      resizeLatencyMs,
      reloadLatencyMs,
    },
  };
}

/**
 * Execute full benchmark across all required configurations.
 */
export async function runFullBenchmarkSuite(): Promise<BenchmarkReport> {
  const os = await import("node:os");
  const packageStats = measurePackageOverhead();

  const targets: PresetBenchmarkTarget[] = [
    "native-pi",
    "omt-native",
    "omt-signature",
    "omt-clean",
    "omt-rail",
    "omt-ember",
    "minimal",
    "signature-noanim",
    "clean-noanim",
    "rail-noanim",
    "ember-noanim",
  ];

  const results = {} as Record<PresetBenchmarkTarget, TargetResults>;

  for (const target of targets) {
    results[target] = await benchmarkTarget(target);
  }

  return {
    timestamp: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpus: os.cpus().length,
    },
    packageStats,
    targets: results,
  };
}

// CLI runner if executed directly
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const isJson = process.argv.includes("--json");
  if (!isJson) console.log("Running OMT Performance & Readiness Benchmark Suite...");
  runFullBenchmarkSuite().then((report) => {
    if (isJson) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log("\n=======================================================");
      console.log(`OMT Performance Benchmark Report — ${report.timestamp}`);
      console.log(`Node: ${report.environment.node} | Platform: ${report.environment.platform} (${report.environment.arch}) | CPUs: ${report.environment.cpus}`);
      console.log(`Package: Tarball ${report.packageStats.tarballBytes}B | Unpacked ${report.packageStats.unpackedBytes}B | Files: ${report.packageStats.fileCount}`);
      console.log(`Module Import Time: ${report.packageStats.moduleImportMs.median.toFixed(2)}ms (p95: ${report.packageStats.moduleImportMs.p95.toFixed(2)}ms)`);
      console.log("=======================================================\n");

      console.table(
        Object.entries(report.targets).map(([name, data]) => ({
          Target: name,
          "Cold Start (ms)": data.coldStartupMs.toFixed(1),
          "Ember Start (ms)": data.emberStartupMs.median.toFixed(1),
          "First Frame (ms)": data.firstUsableFrameMs.median.toFixed(1),
          "Idle CPU %": data.idleCpuPercent,
          "Idle Timers": data.idleActiveTimers,
          "Frame Latency (ms)": data.activeRenderFrameMs.median.toFixed(3),
          "Input Latency (ms)": data.inputLatencyMs.median.toFixed(3),
          "RSS Base/Growth (MB)": `${data.memory.baselineRssMb} / +${data.memory.growthRssMb}`,
          "Heap Base/Growth (MB)": `${data.memory.baselineHeapUsedMb} / +${data.memory.growthHeapUsedMb}`,
          "Tool 1k Lines (ms)": data.toolRenderLatencyMs.large1000Lines.median.toFixed(2),
          "Tool 5k Lines (ms)": data.toolRenderLatencyMs.huge5000Lines.median.toFixed(2),
          "Tool 1k Exp (ms)": data.toolRenderLatencyMs.large1000LinesExpanded.median.toFixed(2),
          "Tool 5k Exp (ms)": data.toolRenderLatencyMs.huge5000LinesExpanded.median.toFixed(2),
        }))
      );
    }
  }).catch((err) => {
    console.error("Benchmark failed:", err);
    process.exit(1);
  });
}
