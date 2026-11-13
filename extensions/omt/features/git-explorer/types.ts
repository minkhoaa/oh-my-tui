import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, KeybindingsManager, TUI } from "@earendil-works/pi-tui";

export type GitFileStatusCode = "modified" | "added" | "deleted" | "renamed" | "untracked";

export interface GitFileStatus {
  path: string;
  oldPath?: string;
  status: GitFileStatusCode;
  staged: boolean;
  additions?: number;
  deletions?: number;
}

export interface GitDiffView {
  filePath: string;
  diffContent: string;
  staged: boolean;
  additions: number;
  deletions: number;
}

export interface GitExplorerOptions {
  initialStaged?: boolean;
  selectedFile?: string;
  files?: GitFileStatus[];
  diffs?: Record<string, string>;
}

export type GitExplorerFactory = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  options?: GitExplorerOptions,
) => Component;

