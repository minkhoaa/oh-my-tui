import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, KeybindingsManager, TUI } from "@earendil-works/pi-tui";

export interface ComposerMetrics {
  lines: number;
  currentLine: number;
  chars: number;
  estimatedTokens: number;
  isMultiLine: boolean;
  hasStash: boolean;
}

export interface ComposerDraft {
  id: string;
  text: string;
  timestamp: number;
  title?: string;
}

export interface AdvancedComposerState {
  stash: ComposerDraft | null;
  showLineNumbers: boolean;
  showTokenEstimate: boolean;
}

