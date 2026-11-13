import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, KeybindingsManager, TUI } from "@earendil-works/pi-tui";

export type TabId = "chat" | "inspector" | "git" | "sessions" | "doctor";

export interface TabItem {
  id: TabId;
  label: string;
  shortcut: string;
  badge?: string;
}

export interface TabBarOptions {
  activeTab: TabId;
  tabs?: TabItem[];
  onSelectTab?: (tabId: TabId) => void;
}

export type TabBarFactory = (
  tui: TUI,
  theme: Theme,
  options: TabBarOptions,
) => Component;
