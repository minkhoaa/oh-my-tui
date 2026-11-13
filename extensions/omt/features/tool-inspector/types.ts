import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, KeybindingsManager, TUI } from "@earendil-works/pi-tui";

export interface InspectedToolCall {
  id: string;
  name: string;
  args: Record<string, unknown> | string | unknown;
  outcome?: "running" | "success" | "failure" | "interrupted";
  result?: string;
  isError?: boolean;
  timestamp?: string;
  durationMs?: number;
}

export interface ToolInspectorOptions {
  initialToolId?: string;
  toolCalls?: InspectedToolCall[];
}

export type ToolInspectorFactory = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  options?: ToolInspectorOptions,
) => Component;

