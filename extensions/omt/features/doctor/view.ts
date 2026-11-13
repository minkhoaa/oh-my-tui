import { Container, visibleWidth, truncateToWidth, matchesKey, Key, type Component, type KeybindingsManager, type TUI } from "@earendil-works/pi-tui";
import { DynamicBorder, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import type { DiagnosticReport, DoctorOptions, DoctorFactory } from "./types.ts";
import { getBorderStyler } from "../../presets/shared/style.ts";
import { DIAGNOSTIC_STATUS_MAP, fgSafe, boldSafe, dimSafe, runDiagnostics, copyDiagnosticReport } from "./model.ts";

export class DoctorComponent extends Container {
  private tui: TUI;
  private theme: Theme;
  private keybindings: KeybindingsManager;
  private done: (value?: unknown) => void;
  private ctx: ExtensionContext;
  private options?: DoctorOptions;

  private report: DiagnosticReport;
  private topBorder: DynamicBorder;
  private midBorder: DynamicBorder;
  private botBorder: DynamicBorder;
  private scrollOffset = 0;
  private toastMessage: string | null = null;
  private isClosed = false;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (value?: unknown) => void,
    ctx: ExtensionContext,
    options?: DoctorOptions,
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done;
    this.ctx = ctx;
    this.options = options;

    this.report = options?.report ?? runDiagnostics();

    const borderStyle = getBorderStyler(theme);
    this.topBorder = new DynamicBorder(borderStyle);
    this.midBorder = new DynamicBorder(borderStyle);
    this.botBorder = new DynamicBorder(borderStyle);

    this.addChild(this.topBorder);
    this.addChild(this.midBorder);
    this.addChild(this.botBorder);
  }

  getReport(): DiagnosticReport {
    return this.report;
  }

  getScrollOffset(): number {
    return this.scrollOffset;
  }

  getToastMessage(): string | null {
    return this.toastMessage;
  }

  reRunDiagnostics(): void {
    this.report = runDiagnostics();
    this.toastMessage = "Diagnostics re-run completed!";
    this.tui.requestRender?.();
  }

  private close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.done();
  }

  handleInput(data: string): void {
    if (this.isClosed) return;

    // Esc / 'q' / 'Q' -> Close
    if (
      this.keybindings?.matches?.(data, "tui.select.cancel") ||
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.esc) ||
      data === "\x1b" ||
      data === "q" ||
      data === "Q"
    ) {
      this.close();
      return;
    }

    // 'c' / 'C' -> Copy report to clipboard
    if (data === "c" || data === "C") {
      this.options?.onExportReport?.(this.report);
      void copyDiagnosticReport(this.report).then(() => {
        this.toastMessage = "Report copied to clipboard!";
        this.tui.requestRender?.();
      });
      return;
    }

    // 'r' / 'R' -> Re-run diagnostics
    if (data === "r" || data === "R") {
      this.reRunDiagnostics();
      return;
    }

    // Up Arrow / 'k' -> Scroll checks up
    if (
      this.keybindings?.matches?.(data, "tui.select.up") ||
      matchesKey(data, Key.up) ||
      data === "\x1b[A" ||
      data === "k"
    ) {
      if (this.scrollOffset > 0) {
        this.scrollOffset--;
        this.tui.requestRender?.();
      }
      return;
    }

    // Down Arrow / 'j' -> Scroll checks down
    if (
      this.keybindings?.matches?.(data, "tui.select.down") ||
      matchesKey(data, Key.down) ||
      data === "\x1b[B" ||
      data === "j"
    ) {
      this.scrollOffset++;
      this.tui.requestRender?.();
      return;
    }
  }

  override render(width: number): string[] {
    const safeWidth = Math.max(1, width);
    const theme = this.theme;
    const report = this.report;

    const clamp = (line: string): string => {
      if (visibleWidth(line) > safeWidth) {
        return truncateToWidth(line, safeWidth, "");
      }
      return line;
    };

    const lines: string[] = [];

    // --- 1. Header Title ---
    if (safeWidth >= 65) {
      const title = boldSafe(theme, fgSafe(theme, "accent", "◆ TUI Diagnostics & Compatibility Doctor"));
      const hint = dimSafe(theme, "c: copy · r: re-run · Esc/q: exit");
      const pad = Math.max(1, safeWidth - visibleWidth(title) - visibleWidth(hint));
      lines.push(clamp(`${title}${" ".repeat(pad)}${hint}`));
    } else if (safeWidth >= 38) {
      lines.push(clamp(boldSafe(theme, fgSafe(theme, "accent", "◆ TUI Doctor"))));
    } else if (safeWidth >= 20) {
      lines.push(clamp(boldSafe(theme, "[TUI Doctor]")));
    } else {
      lines.push(clamp("[Doctor]"));
    }

    // --- 2. Top Border ---
    lines.push(clamp(this.topBorder.render(safeWidth)[0] ?? "─".repeat(safeWidth)));

    // --- 3. Overall Health Status Banner ---
    let overallBadge = "";
    if (report.overallStatus === "healthy") {
      overallBadge = boldSafe(theme, fgSafe(theme, "success", "✔ HEALTHY - All systems operational"));
    } else if (report.overallStatus === "warnings") {
      overallBadge = boldSafe(theme, fgSafe(theme, "warning", "⚠ WARNINGS - Minor compatibility issues"));
    } else {
      overallBadge = boldSafe(theme, fgSafe(theme, "error", "✖ DEGRADED - Critical issues detected"));
    }

    if (safeWidth >= 40) {
      lines.push(clamp(`  ${overallBadge}`));
      lines.push(clamp(`  ${dimSafe(theme, report.summary)}`));
    } else {
      lines.push(clamp(`  ${overallBadge}`));
    }

    // --- 4. Checks Table ---
    lines.push(clamp(this.midBorder.render(safeWidth)[0] ?? "─".repeat(safeWidth)));

    const checks = report?.checks ?? [];
    const maxVisible = 8;
    const maxScroll = Math.max(0, checks.length - maxVisible);
    if (this.scrollOffset > maxScroll) {
      this.scrollOffset = maxScroll;
    }
    const visibleChecks = checks.slice(this.scrollOffset, this.scrollOffset + maxVisible);

    for (const ch of visibleChecks) {
      const info = DIAGNOSTIC_STATUS_MAP[ch.status] ?? DIAGNOSTIC_STATUS_MAP.info;
      const badgeStr = fgSafe(
        theme,
        info.color,
        safeWidth >= 50 ? info.badge : info.shortBadge,
      );

      let rowLine = "";
      if (safeWidth >= 70) {
        const catTag = dimSafe(theme, `[${ch.category.slice(0, 4)}]`);
        const nameStr = boldSafe(theme, ch.name.padEnd(28));
        rowLine = `  ${badgeStr} ${catTag} ${nameStr} ${ch.value}`;
      } else if (safeWidth >= 45) {
        const nameStr = boldSafe(theme, ch.name);
        rowLine = `  ${badgeStr} ${nameStr}: ${ch.value}`;
      } else if (safeWidth >= 25) {
        rowLine = `  ${badgeStr} ${ch.name}`;
      } else {
        rowLine = `${info.icon} ${ch.name}`;
      }

      lines.push(clamp(rowLine));
    }

    if (checks.length > maxVisible && safeWidth >= 30) {
      lines.push(
        clamp(
          `  ${dimSafe(
            theme,
            `[Scroll ${this.scrollOffset + 1}-${Math.min(checks.length, this.scrollOffset + maxVisible)} of ${checks.length} (↑↓ scroll)]`,
          )}`,
        ),
      );
    }

    // Recommendations section if present and space permits
    const recommendations = checks.filter((c) => c.recommendation);
    if (recommendations.length > 0 && safeWidth >= 45) {
      lines.push(clamp(`  ${boldSafe(theme, "Actionable Recommendations:")}`));
      for (const rec of recommendations.slice(0, 2)) {
        lines.push(clamp(`  ${fgSafe(theme, "warning", "•")} ${dimSafe(theme, `${rec.name}: ${rec.recommendation}`)}`));
      }
    }

    // --- 5. Bottom Border ---
    lines.push(clamp(this.botBorder.render(safeWidth)[0] ?? "─".repeat(safeWidth)));

    // --- 6. Toast or Controls Footer ---
    if (this.toastMessage) {
      lines.push(clamp(`  ${boldSafe(theme, fgSafe(theme, "accent", `✔ ${this.toastMessage}`))}`));
    } else if (safeWidth >= 65) {
      lines.push(clamp(`  ${dimSafe(theme, "c: copy report · r: re-run diagnostics · Esc/q: exit")}`));
    } else if (safeWidth >= 38) {
      lines.push(clamp(`  ${dimSafe(theme, "c:copy · r:rerun · q:exit")}`));
    } else if (safeWidth >= 20) {
      lines.push(clamp(`  ${dimSafe(theme, "c:cpy q:ext")}`));
    } else {
      lines.push(clamp(`  ${dimSafe(theme, "q:ext")}`));
    }

    return lines;
  }
}

/**
 * Factory creating interactive Doctor Component.
 */
export const createDoctorComponent: DoctorFactory = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  options?: DoctorOptions,
): Component => {
  return new DoctorComponent(tui, theme, keybindings, done, ctx, options);
};
