import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, KeybindingsManager, TUI } from "@earendil-works/pi-tui";

export interface ScrollbackViewOptions {
  initialQuery?: string;
  lines?: string[];
  onCopySelection?: (text: string) => void;
}

export type ScrollbackFactory = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  options?: ScrollbackViewOptions,
) => Component;

