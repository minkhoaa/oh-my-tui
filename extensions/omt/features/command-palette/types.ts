import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, KeybindingsManager, TUI } from "@earendil-works/pi-tui";

export interface PaletteAction {
  id: string;
  title: string;
  description?: string;
  category: "preset" | "component" | "navigation" | "tool" | "layout" | "general";
  run: (ctx: ExtensionContext) => Promise<void> | void;
  shortcut?: string;
}

export type CommandPaletteFactory = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  actions: PaletteAction[],
) => Component;

