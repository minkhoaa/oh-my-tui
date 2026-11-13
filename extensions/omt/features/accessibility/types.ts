import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, KeybindingsManager, TUI } from "@earendil-works/pi-tui";

export interface AccessibilitySettings {
  highContrast: boolean;
  screenReaderFriendly: boolean;
  plainTextAsciiBorders: boolean;
  reducedMotion: boolean;
}

export interface ShortcutHelpEntry {
  key: string;
  description: string;
  category: string;
}

