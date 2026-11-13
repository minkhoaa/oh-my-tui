import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, KeybindingsManager, TUI } from "@earendil-works/pi-tui";

export interface SessionItem {
  id: string;
  filePath?: string;
  name?: string;
  timestamp?: string;
  messageCount?: number;
  tokenUsage?: number;
  isCurrent?: boolean;
}

export type ExportFormat = "markdown" | "json" | "html" | "text";

export interface ConversationExportOptions {
  format?: ExportFormat;
  includeTools?: boolean;
  includeSystem?: boolean;
  targetPath?: string;
}

export interface SessionManagerOptions {
  sessions?: SessionItem[];
  onSelectSession?: (session: SessionItem) => void;
  onExport?: (format: ExportFormat) => void;
}

export type SessionManagerFactory = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  options?: SessionManagerOptions,
) => Component;

