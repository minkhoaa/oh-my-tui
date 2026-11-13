import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, KeybindingsManager, TUI } from "@earendil-works/pi-tui";

export type NotificationLevel = "info" | "warning" | "error" | "success";

export interface SmartNotification {
  id: string;
  message: string;
  level: NotificationLevel;
  timestamp: number;
  durationMs?: number;
  read?: boolean;
  sticky?: boolean;
}

export interface NotificationCenterOptions {
  notifications?: SmartNotification[];
  onClear?: () => void;
}

export type NotificationCenterFactory = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  options?: NotificationCenterOptions,
) => Component;

