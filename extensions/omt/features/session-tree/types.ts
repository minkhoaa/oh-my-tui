import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, KeybindingsManager, TUI } from "@earendil-works/pi-tui";

export interface SessionTreeNodeItem {
  id: string;
  parentId: string | null;
  label?: string;
  summary?: string;
  type: string;
  timestamp?: string;
  children: SessionTreeNodeItem[];
  isLeaf?: boolean;
  isCurrent?: boolean;
}

export interface SessionTreeOptions {
  tree?: SessionTreeNodeItem[];
  currentLeafId?: string;
  onJumpToNode?: (nodeId: string) => void;
  onForkNode?: (nodeId: string) => void;
}

export type SessionTreeFactory = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  options?: SessionTreeOptions,
) => Component;

