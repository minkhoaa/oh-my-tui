import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, KeybindingsManager, TUI } from "@earendil-works/pi-tui";

export interface QueuedPrompt {
  id: string;
  text: string;
  deliverAs: "steer" | "followUp";
  timestamp: number;
  status: "queued" | "sent" | "cancelled";
}

export interface PromptQueueOptions {
  prompts?: QueuedPrompt[];
  onPromote?: (id: string) => void;
  onRemove?: (id: string) => void;
  onClear?: () => void;
}

export type PromptQueueFactory = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  options?: PromptQueueOptions,
) => Component;

