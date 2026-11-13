import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, KeybindingsManager, TUI } from "@earendil-works/pi-tui";

export type DangerLevel = "low" | "medium" | "high" | "critical";

export interface PermissionRequest {
  id: string;
  type: "tool" | "bash" | "file_write" | "file_delete" | "trust";
  toolName?: string;
  command?: string;
  path?: string;
  dangerLevel: DangerLevel;
  explanation: string;
  diffPreview?: string;
  timestamp: number;
}

export interface PermissionReviewOptions {
  request: PermissionRequest;
  onApprove?: () => void;
  onReject?: () => void;
  onApproveAlways?: () => void;
}

export type PermissionReviewFactory = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (result?: { approved: boolean; remember?: boolean }) => void,
  ctx: ExtensionContext,
  options: PermissionReviewOptions,
) => Component;

