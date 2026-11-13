import { Container, Key, Text, matchesKey, truncateToWidth, type Component, type KeybindingsManager, type TUI } from "@earendil-works/pi-tui";
import { DynamicBorder, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import type { ConversationNavigatorFactory, ConversationNavigatorOptions, NavEntryCategory, NavigatableItem } from "./types.ts";
import { getBorderStyler } from "../../presets/shared/style.ts";
import { NAV_CATEGORIES, safeFg, safeBold, formatTimestamp, formatCategoryBadge, formatCategoryBadgeStyled, wrapOrSlicePreview, extractNavigatableEntries, filterNavEntries } from "./model.ts";

export class ConversationNavigatorComponent extends Container implements Component {
  readonly capturesViewportInput: boolean = true;

  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly keybindings: KeybindingsManager;
  private readonly done: (value?: unknown) => void;
  private readonly ctx: ExtensionContext;
  private readonly options?: ConversationNavigatorOptions;

  private readonly allEntries: NavigatableItem[];
  private filteredEntries: NavigatableItem[];
  private searchQuery: string = "";
  private currentCategory: NavEntryCategory = "all";
  private selectedIndex: number = 0;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (value?: unknown) => void,
    ctx: ExtensionContext,
    options?: ConversationNavigatorOptions,
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done;
    this.ctx = ctx;
    this.options = options;

    if (options?.initialFilter && NAV_CATEGORIES.includes(options.initialFilter)) {
      this.currentCategory = options.initialFilter;
    }

    this.allEntries = extractNavigatableEntries(ctx?.sessionManager);
    this.filteredEntries = filterNavEntries(this.allEntries, this.searchQuery, this.currentCategory);
  }

  getSearchQuery(): string {
    return this.searchQuery;
  }

  getCurrentCategory(): NavEntryCategory {
    return this.currentCategory;
  }

  getFilteredEntries(): NavigatableItem[] {
    return [...this.filteredEntries];
  }

  getAllEntries(): NavigatableItem[] {
    return [...this.allEntries];
  }

  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  getSelectedEntry(): NavigatableItem | undefined {
    return this.filteredEntries[this.selectedIndex];
  }

  private applyFilter(): void {
    this.filteredEntries = filterNavEntries(
      this.allEntries,
      this.searchQuery,
      this.currentCategory,
    );
    if (this.selectedIndex >= this.filteredEntries.length) {
      this.selectedIndex = Math.max(0, this.filteredEntries.length - 1);
    }
  }

  handleInput(data: string): void {
    // 1. Esc -> dismiss/close navigator via done()
    if (
      matchesKey(data, Key.escape) ||
      data === "\x1b" ||
      (this.keybindings && this.keybindings.matches(data, "tui.select.cancel"))
    ) {
      this.done();
      return;
    }

    // 2. Enter -> select entry (invokes options.onJumpToEntry or closes with entry)
    if (
      matchesKey(data, Key.enter) ||
      data === "\r" ||
      data === "\n" ||
      (this.keybindings && this.keybindings.matches(data, "tui.select.confirm"))
    ) {
      const selected = this.filteredEntries[this.selectedIndex];
      if (selected) {
        this.options?.onJumpToEntry?.(selected.id);
        this.done(selected);
      } else {
        this.done();
      }
      return;
    }

    // 3. Up -> move selection up (with wraparound)
    if (
      matchesKey(data, Key.up) ||
      data === "\x1b[A" ||
      (this.keybindings && this.keybindings.matches(data, "tui.select.up"))
    ) {
      if (this.filteredEntries.length > 0) {
        this.selectedIndex =
          this.selectedIndex > 0 ? this.selectedIndex - 1 : this.filteredEntries.length - 1;
        this.tui?.requestRender?.();
      }
      return;
    }

    // 4. Down -> move selection down (with wraparound)
    if (
      matchesKey(data, Key.down) ||
      data === "\x1b[B" ||
      (this.keybindings && this.keybindings.matches(data, "tui.select.down"))
    ) {
      if (this.filteredEntries.length > 0) {
        this.selectedIndex =
          this.selectedIndex < this.filteredEntries.length - 1 ? this.selectedIndex + 1 : 0;
        this.tui?.requestRender?.();
      }
      return;
    }

    // 5. Tab or Right -> cycle category forward
    if (
      matchesKey(data, Key.tab) ||
      data === "\t" ||
      matchesKey(data, Key.right) ||
      data === "\x1b[C"
    ) {
      const curIdx = NAV_CATEGORIES.indexOf(this.currentCategory);
      const nextIdx = (curIdx + 1) % NAV_CATEGORIES.length;
      this.currentCategory = NAV_CATEGORIES[nextIdx]!;
      this.selectedIndex = 0;
      this.applyFilter();
      this.tui?.requestRender?.();
      return;
    }

    // 6. Shift+Tab or Left -> cycle category backward
    if (
      matchesKey(data, Key.shift(Key.tab)) ||
      data === "\x1b[Z" ||
      matchesKey(data, Key.left) ||
      data === "\x1b[D"
    ) {
      const curIdx = NAV_CATEGORIES.indexOf(this.currentCategory);
      const prevIdx = (curIdx - 1 + NAV_CATEGORIES.length) % NAV_CATEGORIES.length;
      this.currentCategory = NAV_CATEGORIES[prevIdx]!;
      this.selectedIndex = 0;
      this.applyFilter();
      this.tui?.requestRender?.();
      return;
    }

    // 7. Backspace -> remove character from search filter
    if (matchesKey(data, Key.backspace) || data === "\x7f" || data === "\b") {
      if (this.searchQuery.length > 0) {
        this.searchQuery = this.searchQuery.slice(0, -1);
        this.selectedIndex = 0;
        this.applyFilter();
        this.tui?.requestRender?.();
      }
      return;
    }

    // 8. Typing text -> update search query
    if (!data.startsWith("\x1b") && /^[\P{Cc}]+$/u.test(data)) {
      this.searchQuery += data;
      this.selectedIndex = 0;
      this.applyFilter();
      this.tui?.requestRender?.();
      return;
    }
  }

  override render(width: number): string[] {
    const safeWidth = Math.max(10, width);
    this.clear();

    const borderFn = getBorderStyler(this.theme);

    // 1. Top border
    this.addChild(new DynamicBorder(borderFn));

    // 2. Header and Category Bar
    const isNarrow = safeWidth < 50;
    const isUltraNarrow = safeWidth < 30;

    // Title line
    const titleText = isUltraNarrow ? "Navigator" : "Conversation Navigator";
    const styledTitle = safeBold(this.theme, safeFg(this.theme, "accent", titleText));

    let headerLine = styledTitle;
    if (!isNarrow) {
      const hint = safeFg(
        this.theme,
        "dim",
        " [↑↓: Navigate · Tab: Category · Enter: Select · Esc: Close]",
      );
      headerLine += hint;
    }
    this.addChild(new Text(truncateToWidth(headerLine, safeWidth), 0, 0));

    // Search input line
    let searchLine = "";
    if (this.searchQuery.length > 0) {
      const searchPrefix = safeFg(this.theme, "muted", "Search: ");
      const queryStyled = safeBold(this.theme, safeFg(this.theme, "accent", this.searchQuery));
      searchLine = `${searchPrefix}${queryStyled}`;
    } else {
      searchLine = `${safeFg(this.theme, "muted", "Search: ")}${safeFg(this.theme, "dim", isNarrow ? "Type..." : "Type to filter...")}`;
    }
    this.addChild(new Text(truncateToWidth(searchLine, safeWidth), 0, 0));

    // Category bar
    if (isNarrow) {
      const catLabel = `Filter: [${this.currentCategory.toUpperCase()}]`;
      const styledCat = safeBold(this.theme, safeFg(this.theme, "accent", catLabel));
      this.addChild(new Text(truncateToWidth(styledCat, safeWidth), 0, 0));
    } else {
      const pills = NAV_CATEGORIES.map((cat) => {
        const isCur = cat === this.currentCategory;
        if (isCur) {
          return safeBold(this.theme, safeFg(this.theme, "accent", `[${cat.toUpperCase()}]`));
        }
        return safeFg(this.theme, "dim", ` ${cat} `);
      }).join("");
      const filterPrefix = safeFg(this.theme, "muted", "Filter: ");
      this.addChild(new Text(truncateToWidth(`${filterPrefix}${pills}`, safeWidth), 0, 0));
    }

    // Separator border
    this.addChild(new DynamicBorder(borderFn));

    // 3. Entry list or empty state
    if (this.filteredEntries.length === 0) {
      if (this.allEntries.length === 0) {
        const emptyMsg1 = safeFg(this.theme, "muted", "  No conversation entries found");
        const emptyMsg2 = safeFg(
          this.theme,
          "dim",
          "  Session is empty or has no navigatable history.",
        );
        this.addChild(new Text(truncateToWidth(emptyMsg1, safeWidth), 0, 0));
        this.addChild(new Text(truncateToWidth(emptyMsg2, safeWidth), 0, 0));
      } else {
        const noMatch1 = safeFg(
          this.theme,
          "muted",
          `  No entries match "${this.searchQuery}" in category "${this.currentCategory}"`,
        );
        const noMatch2 = safeFg(
          this.theme,
          "dim",
          "  Press Backspace to edit search or Tab to change category",
        );
        this.addChild(new Text(truncateToWidth(noMatch1, safeWidth), 0, 0));
        this.addChild(new Text(truncateToWidth(noMatch2, safeWidth), 0, 0));
      }
    } else {
      const maxVisible = 6;
      const startIndex = Math.max(
        0,
        Math.min(
          this.selectedIndex - Math.floor(maxVisible / 2),
          this.filteredEntries.length - maxVisible,
        ),
      );
      const endIndex = Math.min(startIndex + maxVisible, this.filteredEntries.length);

      for (let i = startIndex; i < endIndex; i++) {
        const item = this.filteredEntries[i]!;
        const isSelected = i === this.selectedIndex;

        const cursor = isSelected ? safeFg(this.theme, "accent", "› ") : "  ";

        const badgeText = formatCategoryBadge(item.category);
        const styledBadge = formatCategoryBadgeStyled(this.theme, item.category, badgeText);

        let timeBadge = "";
        if (safeWidth >= 70 && item.timestamp) {
          const timeStr = formatTimestamp(item.timestamp);
          timeBadge = `${safeFg(this.theme, "dim", timeStr)} `;
        }

        const titleStyled = isSelected
          ? safeBold(this.theme, safeFg(this.theme, "accent", item.title))
          : item.title;

        let labelBadge = "";
        if (item.label && item.category !== "bookmark") {
          labelBadge = `${safeFg(this.theme, "accent", `[#${item.label}]`)} `;
        }

        const previewSnippet = item.preview ? ` - ${item.preview}` : "";
        const styledPreview = safeFg(this.theme, "muted", previewSnippet);

        const fullRow = `${cursor}${timeBadge}${styledBadge} ${labelBadge}${titleStyled}${styledPreview}`;
        this.addChild(new Text(truncateToWidth(fullRow, safeWidth), 0, 0));
      }

      if (this.filteredEntries.length > maxVisible) {
        const scrollStr = `  (${this.selectedIndex + 1}/${this.filteredEntries.length})`;
        const scrollInfo = safeFg(this.theme, "dim", scrollStr);
        this.addChild(new Text(truncateToWidth(scrollInfo, safeWidth), 0, 0));
      }
    }

    // 4. Detailed Preview Pane for Selected Entry
    if (this.filteredEntries.length > 0) {
      const selected = this.filteredEntries[this.selectedIndex]!;
      this.addChild(new DynamicBorder(borderFn));

      const previewHeader = `${safeFg(this.theme, "dim", "─ Preview: ")}${safeBold(this.theme, selected.title)}`;
      this.addChild(new Text(truncateToWidth(previewHeader, safeWidth), 0, 0));

      const metaParts = [`Category: ${selected.category}`];
      if (selected.timestamp) metaParts.push(`Time: ${formatTimestamp(selected.timestamp)}`);
      if (selected.label) metaParts.push(`Label: ${selected.label}`);
      if (selected.isError) metaParts.push("Status: ERROR");
      const metaLine = safeFg(this.theme, "dim", `  ${metaParts.join(" | ")}`);
      this.addChild(new Text(truncateToWidth(metaLine, safeWidth), 0, 0));

      if (selected.preview) {
        const maxPreviewLines = isNarrow ? 1 : 2;
        const previewLines = wrapOrSlicePreview(selected.preview, safeWidth - 4, maxPreviewLines);
        for (const pl of previewLines) {
          const lineText = `  ${pl}`;
          this.addChild(new Text(truncateToWidth(lineText, safeWidth), 0, 0));
        }
      }
    }

    // 5. Bottom border and footer hints
    this.addChild(new DynamicBorder(borderFn));
    const footerHint = isNarrow
      ? "Enter: Jump · Tab: Cat · Esc: Close"
      : "Enter: Jump · Tab: Category · Esc: Close · Type to Search";
    const styledFooter = safeFg(this.theme, "dim", ` ${footerHint}`);
    this.addChild(new Text(truncateToWidth(styledFooter, safeWidth), 0, 0));

    return super.render(safeWidth);
  }
}

/**
 * ConversationNavigatorFactory export matching ConversationNavigatorFactory interface.
 */
export const createConversationNavigatorComponent: ConversationNavigatorFactory = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  options?: ConversationNavigatorOptions,
): Component => {
  return new ConversationNavigatorComponent(
    tui,
    theme,
    keybindings,
    done,
    ctx,
    options,
  );
};
