import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, KeybindingsManager, TUI } from "@earendil-works/pi-tui";

export type NavEntryCategory = "all" | "user" | "assistant" | "tool" | "error" | "bookmark";

export interface NavigatableItem {
  id: string;
  category: "user" | "assistant" | "tool" | "error" | "bookmark";
  role?: string;
  title: string;
  preview: string;
  timestamp?: string;
  targetId?: string;
  label?: string;
  isError?: boolean;
}

export interface ConversationNavigatorOptions {
  initialFilter?: NavEntryCategory;
  onJumpToEntry?: (entryId: string) => void;
}

export type ConversationNavigatorFactory = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  options?: ConversationNavigatorOptions,
) => Component;

