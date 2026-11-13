import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, KeybindingsManager, TUI } from "@earendil-works/pi-tui";

export type DiagnosticStatus = "pass" | "warn" | "fail" | "info";

export interface DiagnosticCheck {
  category: "terminal" | "encoding" | "performance" | "environment";
  name: string;
  status: DiagnosticStatus;
  value: string;
  recommendation?: string;
}

export interface DiagnosticReport {
  timestamp: string;
  checks: DiagnosticCheck[];
  overallStatus: "healthy" | "warnings" | "degraded";
  summary: string;
}

export interface DoctorOptions {
  report?: DiagnosticReport;
  onExportReport?: (report: DiagnosticReport) => void;
}

export type DoctorFactory = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  options?: DoctorOptions,
) => Component;

