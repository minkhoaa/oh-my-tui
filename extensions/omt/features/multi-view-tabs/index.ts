import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { Container, type Component, type TUI, matchesKey, Key, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { TabId, TabItem, TabBarOptions, TabBarFactory } from "./types.ts";
import { asciiBorder, accessibilityStore } from "../accessibility/model.ts";

export type { TabId, TabItem, TabBarOptions, TabBarFactory } from "./types.ts";

/**
 * Standard default tabs for Oh My TUI.
 */
export const DEFAULT_TABS: TabItem[] = [
  { id: "chat", label: "Chat", shortcut: "1" },
  { id: "inspector", label: "Inspector", shortcut: "2" },
  { id: "git", label: "Git", shortcut: "3" },
  { id: "sessions", label: "Sessions", shortcut: "4" },
  { id: "doctor", label: "Doctor", shortcut: "5" },
];

/**
 * Multi-View Tabs Component for Oh My TUI.
 */
export class TabBarComponent extends Container implements Component {
  readonly capturesViewportInput: boolean = true;
  readonly wantsKeyRelease: boolean = false;

  private tui: TUI;
  private theme: Theme;
  private options: TabBarOptions;
  private tabs: TabItem[];
  private activeTab: TabId;

  constructor(tui: TUI, theme: Theme, options: TabBarOptions) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.options = options;
    this.tabs =
      options.tabs && Array.isArray(options.tabs) && options.tabs.length > 0
        ? options.tabs.slice()
        : DEFAULT_TABS.slice();
    this.activeTab = options.activeTab;
  }

  getActiveTab(): TabId {
    return this.activeTab;
  }

  setActiveTab(id: TabId): void {
    if (this.activeTab !== id) {
      this.activeTab = id;
      this.options.onSelectTab?.(id);
      this.tui.requestRender?.();
    }
  }

  getTabs(): TabItem[] {
    return [...this.tabs];
  }

  nextTab(): void {
    if (this.tabs.length === 0) return;
    const currentIdx = this.tabs.findIndex((t) => t.id === this.activeTab);
    const nextIdx = (currentIdx + 1) % this.tabs.length;
    this.setActiveTab(this.tabs[nextIdx]!.id);
  }

  prevTab(): void {
    if (this.tabs.length === 0) return;
    const currentIdx = this.tabs.findIndex((t) => t.id === this.activeTab);
    const prevIdx = (currentIdx - 1 + this.tabs.length) % this.tabs.length;
    this.setActiveTab(this.tabs[prevIdx]!.id);
  }

  handleInput(data: string): void {
    // Left arrow: previous tab
    if (
      matchesKey(data, Key.left) ||
      data === "\x1b[D" ||
      data === "h" ||
      data === "["
    ) {
      this.prevTab();
      return;
    }

    // Right arrow: next tab
    if (
      matchesKey(data, Key.right) ||
      data === "\x1b[C" ||
      data === "l" ||
      data === "]"
    ) {
      this.nextTab();
      return;
    }

    // Tab / Shift+Tab cycling
    if (matchesKey(data, Key.tab) || data === "\t") {
      this.nextTab();
      return;
    }
    if (matchesKey(data, Key.shift("tab")) || matchesKey(data, "shift+tab") || data === "\x1b[Z") {
      this.prevTab();
      return;
    }

    // Number keys '1'..'9': select corresponding tab
    const matchedTab = this.tabs.find((t) => t.shortcut === data);
    if (matchedTab) {
      this.setActiveTab(matchedTab.id);
      return;
    }

    const num = parseInt(data, 10);
    if (!Number.isNaN(num) && num >= 1 && num <= this.tabs.length) {
      this.setActiveTab(this.tabs[num - 1]!.id);
      return;
    }
  }

  override render(width: number): string[] {
    const safeWidth = Math.max(1, width);
    const theme = this.theme;

    const boldFn = (s: string) => (theme.bold ? theme.bold(s) : s);
    const fgFn = (color: ThemeColor, s: string) => (theme.fg ? theme.fg(color, s) : s);

    const useAscii = accessibilityStore.isPlainTextAsciiBorders();
    const borderChar = useAscii ? "-" : "─";

    const clamp = (line: string): string => {
      const processed = useAscii ? asciiBorder(line) : line;
      return truncateToWidth(processed, safeWidth, "");
    };

    // Calculate total width of full tab labels
    // Format: "[1:Chat]  [2:Inspector]  [3:Git]  ..."
    const fullTabStrings = this.tabs.map((tab) => {
      const badgeStr = tab.badge ? ` (${tab.badge})` : "";
      return `[${tab.shortcut}:${tab.label}${badgeStr}]`;
    });
    const fullTotalWidth =
      fullTabStrings.reduce((acc, s) => acc + visibleWidth(s), 0) +
      Math.max(0, this.tabs.length - 1) * 2;

    // Calculate collapsed tab labels
    // Format: "[1:C] [2:I] [3:G] [4:S] [5:D]"
    const collapsedTabStrings = this.tabs.map((tab) => {
      const shortChar = tab.label.charAt(0).toUpperCase();
      return `[${tab.shortcut}:${shortChar}]`;
    });
    const collapsedTotalWidth =
      collapsedTabStrings.reduce((acc, s) => acc + visibleWidth(s), 0) +
      Math.max(0, this.tabs.length - 1);

    const renderedTabs: string[] = [];

    if (safeWidth >= fullTotalWidth) {
      // --- Wide Viewport: Full Labels ---
      for (const tab of this.tabs) {
        const isActive = tab.id === this.activeTab;
        const badgeStr = tab.badge ? ` (${tab.badge})` : "";
        const rawLabel = `[${tab.shortcut}:${tab.label}${badgeStr}]`;

        if (isActive) {
          renderedTabs.push(boldFn(fgFn("accent", rawLabel)));
        } else {
          renderedTabs.push(fgFn("muted", rawLabel));
        }
      }
      const tabLine = renderedTabs.join("  ");
      const borderLine = fgFn("border", borderChar.repeat(safeWidth));
      return [clamp(tabLine), clamp(borderLine)];
    } else if (safeWidth >= collapsedTotalWidth) {
      // --- Narrow Viewport: Collapsed Labels ---
      for (const tab of this.tabs) {
        const isActive = tab.id === this.activeTab;
        const shortChar = tab.label.charAt(0).toUpperCase();
        const rawLabel = `[${tab.shortcut}:${shortChar}]`;

        if (isActive) {
          renderedTabs.push(boldFn(fgFn("accent", rawLabel)));
        } else {
          renderedTabs.push(fgFn("muted", rawLabel));
        }
      }
      const tabLine = renderedTabs.join(" ");
      const borderLine = fgFn("border", borderChar.repeat(safeWidth));
      return [clamp(tabLine), clamp(borderLine)];
    } else {
      // --- Ultra-Narrow Viewport (< collapsedTotalWidth) ---
      // Ultra-compact: "1:C 2:I 3:G 4:S 5:D" or active tab indicator
      const ultraCollapsed = this.tabs.map((tab) => {
        const isActive = tab.id === this.activeTab;
        const shortChar = tab.label.charAt(0).toUpperCase();
        const label = `${tab.shortcut}:${shortChar}`;
        return isActive ? boldFn(fgFn("accent", `[${label}]`)) : fgFn("dim", label);
      });
      const tabLine = ultraCollapsed.join(" ");
      const borderLine = fgFn("border", borderChar.repeat(safeWidth));
      return [clamp(tabLine), clamp(borderLine)];
    }
  }
}

/**
 * Tab Bar Component factory conforming to TabBarFactory contract.
 */
export const createTabBarComponent: TabBarFactory = (
  tui: TUI,
  theme: Theme,
  options: TabBarOptions,
): Component => {
  return new TabBarComponent(tui, theme, options);
};
