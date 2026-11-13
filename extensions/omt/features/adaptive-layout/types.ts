import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, KeybindingsManager, TUI } from "@earendil-works/pi-tui";

export type LayoutMode = "standard" | "compact" | "focus";

export interface AdaptiveLayoutMetrics {
  mode: LayoutMode;
  width: number;
  height: number;
  isNarrow: boolean;        // width < 60
  isUltraNarrow: boolean;   // width < 30
  contentPadding: number;
  showExtendedStatus: boolean;
  showLineNumbers: boolean;
  maxOutputRows: number;
}

