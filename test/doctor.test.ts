import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  runDiagnostics,
  formatDiagnosticReportText,
  copyDiagnosticReport,
  createDoctorComponent,
  DoctorComponent,
  DIAGNOSTIC_STATUS_MAP,
} from "../extensions/omt/features/doctor/index.ts";
import type { DiagnosticReport } from "../extensions/omt/features/doctor/types.ts";

/**
 * ANSI theme fixture.
 */
function createAnsiTheme(): Theme {
  return {
    appearance: "dark",
    bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
    dim: (text: string) => `\x1b[2m${text}\x1b[22m`,
    fg: (_color: string, text: string) => `\x1b[36m${text}\x1b[39m`,
    bg: (_color: string, text: string) => `\x1b[40m${text}\x1b[49m`,
    style: (text: string) => text,
  } as unknown as Theme;
}

/**
 * Plain theme fixture.
 */
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

test("runDiagnostics: generates comprehensive diagnostic report with all required categories", () => {
  const report = runDiagnostics();

  assert.ok(report.timestamp);
  assert.ok(Array.isArray(report.checks));
  assert.ok(report.checks.length >= 10);
  assert.ok(["healthy", "warnings", "degraded"].includes(report.overallStatus));
  assert.ok(report.summary.length > 0);

  // Validate categories
  const categories = new Set(report.checks.map((c) => c.category));
  assert.ok(categories.has("terminal"), "Should contain terminal category");
  assert.ok(categories.has("encoding"), "Should contain encoding category");
  assert.ok(categories.has("performance"), "Should contain performance category");
  assert.ok(categories.has("environment"), "Should contain environment category");

  // Validate specific required checks
  const checkNames = report.checks.map((c) => c.name);
  assert.ok(checkNames.some((n) => n.includes("TERM")), "Should check TERM variable");
  assert.ok(checkNames.some((n) => n.includes("Truecolor")), "Should check truecolor");
  assert.ok(checkNames.some((n) => n.includes("256 Colors")), "Should check 256 colors");
  assert.ok(checkNames.some((n) => n.includes("UTF-8")), "Should check UTF-8 locale");
  assert.ok(checkNames.some((n) => n.includes("CJK")), "Should check CJK wide chars");
  assert.ok(checkNames.some((n) => n.includes("Emoji")), "Should check Emoji width");
  assert.ok(checkNames.some((n) => n.includes("Memory")), "Should check memory usage");
  assert.ok(checkNames.some((n) => n.includes("Node.js")), "Should check Node.js version");
  assert.ok(checkNames.some((n) => n.includes("Platform")), "Should check platform architecture");
  assert.ok(checkNames.some((n) => n.includes("Dimensions")), "Should check terminal dimensions");
});

test("runDiagnostics: evaluates healthy, warning, and degraded environments correctly", () => {
  // 1. Healthy environment
  const healthyEnv = {
    TERM: "xterm-256color",
    TERM_PROGRAM: "ghostty",
    COLORTERM: "truecolor",
    LANG: "en_US.UTF-8",
  };
  const healthyReport = runDiagnostics(healthyEnv, { columns: 120, rows: 40 });
  assert.equal(healthyReport.overallStatus, "healthy");
  assert.ok(healthyReport.summary.includes("All diagnostic checks passed"));

  // 2. Warning environment (missing COLORTERM or narrow width)
  const warnEnv = {
    TERM: "xterm-256color",
    LANG: "en_US.UTF-8",
    // Missing COLORTERM
  };
  const warnReport = runDiagnostics(warnEnv, { columns: 60, rows: 20 });
  assert.equal(warnReport.overallStatus, "warnings");
  assert.ok(warnReport.checks.some((c) => c.status === "warn"));
  const truecolorCheck = warnReport.checks.find((c) => c.name.includes("Truecolor"));
  assert.ok(truecolorCheck?.recommendation);

  // 3. Degraded environment (TERM=dumb, severely narrow dimensions)
  const degradedEnv = {
    TERM: "dumb",
    LANG: "C",
  };
  const degradedReport = runDiagnostics(degradedEnv, { columns: 30, rows: 10 });
  assert.equal(degradedReport.overallStatus, "degraded");
  assert.ok(degradedReport.checks.some((c) => c.status === "fail"));
  const termCheck = degradedReport.checks.find((c) => c.name === "TERM Variable");
  assert.equal(termCheck?.status, "fail");
  assert.ok(termCheck?.recommendation);
});

test("formatDiagnosticReportText and copyDiagnosticReport: formats Markdown and handles clipboard export", async () => {
  const report: DiagnosticReport = {
    timestamp: "2025-05-10T12:00:00.000Z",
    overallStatus: "warnings",
    summary: "1 warning detected.",
    checks: [
      {
        category: "terminal",
        name: "TERM Variable",
        status: "pass",
        value: "xterm-256color",
      },
      {
        category: "terminal",
        name: "COLORTERM (Truecolor)",
        status: "warn",
        value: "(not set)",
        recommendation: "Export COLORTERM=truecolor",
      },
      {
        category: "encoding",
        name: "UTF-8 Locale",
        status: "pass",
        value: "en_US.UTF-8",
      },
    ],
  };

  const md = formatDiagnosticReportText(report);
  assert.ok(md.includes("# Oh My TUI - System Diagnostics & Compatibility Report"));
  assert.ok(md.includes("Overall Health: WARNINGS"));
  assert.ok(md.includes("## Terminal Checks"));
  assert.ok(md.includes("[PASS] TERM Variable: xterm-256color"));
  assert.ok(md.includes("[WARN] COLORTERM (Truecolor): (not set)"));
  assert.ok(md.includes("Recommendation: Export COLORTERM=truecolor"));
  assert.ok(md.includes("## Actionable Recommendations"));

  // copyDiagnosticReport should return boolean without throwing
  const copied = await copyDiagnosticReport(report);
  assert.ok(typeof copied === "boolean");
});

test("DoctorComponent: renders across 120, 80, 40, 20 columns without horizontal overflow", () => {
  const dummyTui: any = { requestRender: () => {} };
  const done = () => {};
  const ctx: any = { mode: "tui" };

  const testReport: DiagnosticReport = {
    timestamp: "2025-05-10T12:00:00.000Z",
    overallStatus: "warnings",
    summary: "1 warning detected. Terminal is functional.",
    checks: [
      {
        category: "terminal",
        name: "TERM Variable",
        status: "pass",
        value: "xterm-256color",
      },
      {
        category: "terminal",
        name: "COLORTERM (Truecolor)",
        status: "warn",
        value: "(not set)",
        recommendation: "Set COLORTERM=truecolor for full RGB palette.",
      },
      {
        category: "encoding",
        name: "UTF-8 Locale",
        status: "pass",
        value: "en_US.UTF-8",
      },
      {
        category: "performance",
        name: "Memory Usage (Heap/RSS)",
        status: "pass",
        value: "Heap 45MB / 80MB (RSS 120MB)",
      },
      {
        category: "environment",
        name: "Terminal Dimensions",
        status: "pass",
        value: "100 cols x 30 rows",
      },
    ],
  };

  const themes = [createPlainTheme(), createAnsiTheme()];
  const widths = [120, 80, 40, 20];

  for (const theme of themes) {
    for (const width of widths) {
      const comp = createDoctorComponent(
        dummyTui,
        theme,
        {} as any,
        done,
        ctx,
        { report: testReport },
      );

      const lines = comp.render(width);
      assert.ok(Array.isArray(lines));
      assert.ok(lines.length >= 6, `Expected multiple lines at width ${width}`);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const len = visibleWidth(line);
        assert.ok(
          len <= width,
          `Line ${i} visibleWidth (${len}) exceeded target width (${width}): "${line}"`,
        );
      }

      const joined = lines.join("\n");
      assert.ok(
        joined.includes("Doctor") || joined.includes("[") || joined.includes("]"),
        `Expected doctor content at width ${width}`,
      );
    }
  }
});

test("DoctorComponent: keyboard navigation, re-run diagnostics, export report, and exit", async () => {
  let renderCount = 0;
  const dummyTui: any = {
    requestRender: () => {
      renderCount++;
    },
  };

  let doneCalled = false;
  const done = () => {
    doneCalled = true;
  };

  let exportedReport: DiagnosticReport | null = null;
  const onExportReport = (rep: DiagnosticReport) => {
    exportedReport = rep;
  };

  const comp = new DoctorComponent(
    dummyTui,
    createPlainTheme(),
    {} as any,
    done,
    {} as any,
    { onExportReport },
  );

  assert.equal(comp.getScrollOffset(), 0);
  assert.ok(comp.getReport().checks.length > 0);

  // Scroll Down ('j' or Down arrow)
  comp.handleInput("\x1b[B");
  assert.equal(comp.getScrollOffset(), 1);

  // Scroll Up ('k' or Up arrow)
  comp.handleInput("\x1b[A");
  assert.equal(comp.getScrollOffset(), 0);

  // Re-run diagnostics ('r')
  comp.handleInput("r");
  assert.equal(comp.getToastMessage(), "Diagnostics re-run completed!");

  // Copy report to clipboard ('c')
  comp.handleInput("c");
  assert.ok(exportedReport !== null);
  assert.equal((exportedReport as DiagnosticReport).overallStatus, comp.getReport().overallStatus);

  // Await any async clipboard copy resolution
  await new Promise((resolve) => setTimeout(resolve, 50));

  // Close ('q' or Esc)
  assert.equal(doneCalled, false);
  comp.handleInput("q");
  assert.equal(doneCalled, true);
});

test("DoctorComponent: defensive rendering with missing or partial checks array", () => {
  const comp = new DoctorComponent(
    {} as any,
    createPlainTheme(),
    {} as any,
    () => {},
    {} as any,
    { report: { overallStatus: "healthy", summary: "Empty checks" } as any },
  );
  assert.doesNotThrow(() => comp.render(80));
  const lines = comp.render(80);
  assert.ok(lines.length > 0);
});
