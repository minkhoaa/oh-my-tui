import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, KeybindingsManager, TUI } from "@earendil-works/pi-tui";

export interface VisualFixture {
  name: string;
  preset: string;
  width: number;
  height?: number;
  state: "first-frame" | "tool" | "diff" | "message" | "thinking" | "resize" | "layout";
  inputData?: unknown;
}

export interface RegressionComparisonResult {
  passed: boolean;
  fixtureName: string;
  preset: string;
  width: number;
  diffSummary?: string;
  actualAnsi?: string;
  expectedAnsi?: string;
}

