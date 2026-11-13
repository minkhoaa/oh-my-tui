/**
 * View components and factories for the OMT Dialog Toolkit.
 */

import { Container, Text, visibleWidth, truncateToWidth, matchesKey, Key, type Component, type Focusable, type KeybindingsManager, type TUI } from "@earendil-works/pi-tui";
import { DynamicBorder, type ExtensionContext, type Theme, type ThemeColor } from "@earendil-works/pi-coding-agent";
import { getBorderStyler } from "../../presets/shared/style.ts";
import type {
  BlockActionOption,
  BlockActionsDialogOptions,
  ModelPickerOptions,
  ModelSpec,
  PetItem,
  PetSelectorOptions,
  OmtNotificationItem,
  OmtNotificationOptions,
  OmtTreeDialogOptions,
  OmtTreeNode,
  PsecId,
  PsecRowItem,
  ResumeDialogOptions,
  ResumeSessionItem,
  SettingsHubOptions,
  ThemeItem,
  BackgroundItem,
  ThemePickerOptions,
  TraceStep,
  TrajectoryDialogOptions,
  TreeFilterMode,
  TreeSummaryChoice,
} from "./types.ts";
import { classifyDiffLine, copyToClipboard, extractBlockContent, buildBlockOptions, filterItems, filterTreeNodesByMode, fit, fixedWin, flattenOmtTree, formatAgo, formatCostPair, formatDuration, formatNumber, resolveStableCursor, SETTINGS_HUB_SECTIONS, shorten } from "./model.ts";

function fgSafe(theme: Theme | undefined, color: ThemeColor, text: string): string {
  try {
    return theme?.fg ? theme.fg(color, text) : text;
  } catch {
    return text;
  }
}

function boldSafe(theme: Theme | undefined, text: string): string {
  try {
    return theme?.bold ? theme.bold(text) : text;
  } catch {
    return text;
  }
}

function dimSafe(theme: Theme | undefined, text: string): string {
  try {
    if (typeof (theme as any)?.dim === "function") {
      return (theme as any).dim(text);
    }
    return typeof theme?.fg === "function" ? theme.fg("dim", text) : text;
  } catch {
    return text;
  }
}

// =============================================================================
// 1. OMT Settings Hub Component (14 Sections)
// =============================================================================

export class OmtSettingsHubComponent extends Container implements Component, Focusable {
  focused = true;
  readonly capturesViewportInput = true;

  private tui: TUI;
  private theme: Theme;
  private keybindings?: KeybindingsManager;
  private done: (value?: unknown) => void;
  private ctx: ExtensionContext;
  private options: SettingsHubOptions;

  private sections: PsecId[] = [
    "agent",
    "command",
    "shortcut",
    "skill",
    "prompt",
    "extension",
    "plugin",
    "market",
    "mcp",
    "tool",
    "tasks",
    "side",
    "theme",
    "login",
  ];
  private sectionCursor: number = 0;
  private itemCursor: number = 0;
  private themeCursor: number = 0;
  private bgCursor: number = 0;
  private isRightPaneFocused: boolean = false;
  private isBgColumnFocused: boolean = false; // in Theme section: palettes vs backgrounds
  private query: string = "";
  private feedbackText: string = "";
  private feedbackTimer?: NodeJS.Timeout;
  private closed: boolean = false;

  private topBorder: DynamicBorder;
  private headerText: Text;
  private midBorder: DynamicBorder;
  private bodyText: Text;
  private footerText: Text;
  private botBorder: DynamicBorder;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (value?: unknown) => void,
    ctx: ExtensionContext,
    options: SettingsHubOptions = {},
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done;
    this.ctx = ctx;
    this.options = options;

    if (options.initialSection) {
      const idx = this.sections.indexOf(options.initialSection);
      if (idx >= 0) this.sectionCursor = idx;
    }

    const borderStyle = getBorderStyler(theme);
    this.topBorder = new DynamicBorder(borderStyle);
    this.headerText = new Text("", 0, 0);
    this.midBorder = new DynamicBorder(borderStyle);
    this.bodyText = new Text("", 0, 0);
    this.footerText = new Text("", 0, 0);
    this.botBorder = new DynamicBorder(borderStyle);

    this.addChild(this.topBorder);
    this.addChild(this.headerText);
    this.addChild(this.midBorder);
    this.addChild(this.bodyText);
    this.addChild(this.footerText);
    this.addChild(this.botBorder);
  }

  getCurrentSection(): PsecId {
    return this.sections[this.sectionCursor] ?? "agent";
  }

  setSection(sec: PsecId): void {
    const idx = this.sections.indexOf(sec);
    if (idx >= 0) {
      this.sectionCursor = idx;
      this.itemCursor = 0;
      this.isRightPaneFocused = false;
      this.isBgColumnFocused = false;
      this.query = "";
      this.tui.requestRender?.();
    }
  }

  setFeedback(msg: string): void {
    this.feedbackText = msg;
    this.tui.requestRender?.();
  }

  private close(result?: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.done(result);
  }

  private getSectionItems(sec: PsecId): PsecRowItem[] {
    if (this.options.sections?.[sec]) {
      return this.options.sections[sec]!;
    }

    switch (sec) {
      case "agent":
        return [
          {
            label: "Open agent settings →",
            desc: "model · thinking · steering · images · skills · (pi parity)",
            payload: "@agent",
          },
        ];
      case "command": {
        const cmds = this.options.commands || [
          { name: "omt settings", description: "Open interactive settings dialog", tag: "omt" },
          { name: "omt palette", description: "Open command palette", tag: "omt" },
          { name: "omt theme", description: "Switch visual preset", tag: "omt" },
          { name: "omt session", description: "Browse sessions and trees", tag: "omt" },
          { name: "omt doctor", description: "Run diagnostics check", tag: "omt" },
        ];
        return cmds.map((c) => ({
          label: `/${c.name}`,
          desc: `${shorten(c.description, 40)} [${c.tag || "cmd"}]`,
          payload: c.name,
        }));
      }
      case "shortcut": {
        const shortcuts = this.options.shortcuts || [];
        return shortcuts.map((s) => ({
          label: s.key,
          desc: `${shorten(s.description, 40)} [${s.category || "key"}]`,
          payload: s.command || s.key,
        }));
      }
      case "skill": {
        const skills = this.options.skills || [];
        if (skills.length === 0) {
          return [{ label: "— no skills —", desc: "No skills configured in workspace", disabled: true }];
        }
        return skills.map((s) => ({
          label: `/${s.name}`,
          desc: shorten(s.description, 44),
          payload: s.name,
        }));
      }
      case "prompt": {
        const prompts = this.options.prompts || [];
        if (prompts.length === 0) {
          return [{ label: "— no prompts —", desc: "No prompt templates loaded", disabled: true }];
        }
        return prompts.map((p) => ({
          label: `/${p.name}`,
          desc: shorten(p.description, 44),
          payload: p.name,
        }));
      }
      case "extension": {
        const exts = this.options.extensions || [
          { name: "oh-my-tui", description: "Modular presentation enhancements for Pi", tag: "omt" },
        ];
        return exts.map((e) => ({
          label: `/${e.name}`,
          desc: `${shorten(e.description, 40)} [${e.tag || "ext"}]`,
          payload: e.name,
        }));
      }
      case "plugin": {
        const plugins = this.options.plugins || [
          { name: "pi-lens", spec: "npm:pi-lens", description: "Visual workspace inspection", suggested: true },
        ];
        return plugins.map((p) => ({
          label: `${p.suggested ? "★ " : ""}${p.name}`,
          desc: `${p.busy ? "working · " : ""}${shorten(p.description || p.spec, 40)}`,
          payload: `plugin:${p.spec}`,
          installed: true,
          suggested: p.suggested,
        }));
      }
      case "market": {
        if (this.options.marketLoading) {
          return [{ label: "— loading packages… —", desc: "Searching npm package registry", disabled: true }];
        }
        if (this.options.marketError) {
          return [{ label: "— market unavailable —", desc: shorten(this.options.marketError, 50), disabled: true }];
        }
        const market = this.options.marketplace || [
          { name: "oh-my-tui", version: "0.1.0", desc: "Modular terminal UI presentation layer", stars: 120, installed: true },
          { name: "pi-lens", version: "1.2.0", desc: "Interactive workspace file tree and diff viewer", stars: 45 },
        ];
        return market.map((m) => ({
          label: m.name,
          desc: `${m.installed ? "✓ installed · " : ""}${m.stars ? `★${m.stars} ` : ""}${m.version ? `v${m.version} ` : ""}— ${shorten(m.desc, 36)}`,
          payload: `market:${m.name}`,
          installed: m.installed,
          stars: m.stars,
        }));
      }
      case "mcp": {
        const mcp = this.options.mcpServers || [
          { name: "mcp", status: "connected" as const },
        ];
        return mcp.map((s) => ({
          label: s.name === "mcp" ? "Open MCP manager →" : s.name,
          desc: s.status === "connected"
            ? (s.direct ? `● ${s.direct}/${s.total} direct · ~${s.tokens} tok` : "server manager · /mcp")
            : s.status === "disabled"
            ? "disabled in mcp.json · /mcp can enable it"
            : "○ not connected · /mcp shows why",
          payload: "mcp",
          badge: s.status === "connected" ? "●" : "○",
        }));
      }
      case "tool": {
        const tools = this.options.toolStats || [];
        return tools.map((t) => ({
          label: t.name,
          desc: `${t.count} calls · ${formatDuration(t.durationMs)}${t.errors ? ` · ${t.errors} errors` : ""}`,
          payload: "",
        }));
      }
      case "tasks": {
        const tasks = this.options.taskSettings || [
          { key: "auto_detect", label: "Auto-detect project tasks", value: "enabled", values: ["enabled", "disabled"] },
          { key: "sort_mode", label: "Task sort order", value: "priority", values: ["priority", "created", "status"] },
          { key: "widget", label: "Show task widget above editor", value: "on", values: ["on", "off"] },
        ];
        return tasks.map((t) => ({
          label: t.label,
          desc: `${t.value} · Enter cycles`,
          payload: `tasks:${t.key}`,
        }));
      }
      case "side": {
        const side = this.options.sidebarSections || [
          { key: "model", label: "Model & Tokens", visible: true },
          { key: "context", label: "Context Window", visible: true },
          { key: "stats", label: "Session Stats", visible: true },
          { key: "tools", label: "Tool Calls", visible: true },
          { key: "pet", label: "Companion Pet", visible: true },
          { key: "lsp", label: "LSP Diagnostics", visible: false },
        ];
        return side.map((s) => ({
          label: s.label,
          desc: `${s.visible ? "shown" : "hidden"} · Enter: toggle`,
          payload: `side:${s.key}`,
          badge: s.visible ? "✓" : " ",
        }));
      }
      case "theme": {
        const palettes = this.options.palettes || [
          "omt-signature",
          "one-dark",
          "dracula",
          "gruvbox",
          "tokyo-night",
          "nord",
          "catppuccin-mocha",
          "solarized-dark",
        ];
        const currentTheme = this.options.currentTheme || "omt-signature";
        const paletteItems: PsecRowItem[] = palettes.map((p) => ({
          label: p,
          desc: p === currentTheme ? "✓ current palette" : "palette",
          payload: `theme:${p}`,
          isCurrent: p === currentTheme,
        }));

        const bgs = this.options.backgrounds || [
          "transparent",
          "matrix",
          "snow",
          "stars",
          "waves",
          "neon-rain",
          "sakura-dusk",
        ];
        const currentBg = this.options.currentBackground || "transparent";
        const bgItems: PsecRowItem[] = bgs.map((b) => ({
          label: b,
          desc: b === currentBg ? "✓ current surface" : "surface",
          payload: `bg:${b}`,
          isCurrent: b === currentBg,
        }));

        return [...paletteItems, ...bgItems];
      }
      case "login":
        return [
          {
            label: "Open login →",
            desc: "providers · API keys · OAuth flows",
            payload: "@login",
          },
        ];
    }
  }

  private getFilteredItems(): PsecRowItem[] {
    const raw = this.getSectionItems(this.getCurrentSection());
    return filterItems(raw, this.query, (i) => [i.label, i.desc, i.payload]);
  }

  private getThemeCols() {
    const items = this.getFilteredItems();
    const palItems = items.filter((i) => i.payload?.startsWith("theme:"));
    const bgItems = items.filter((i) => i.payload?.startsWith("bg:"));
    return { palItems, bgItems };
  }

  handleInput(data: string): void {
    if (this.closed) return;

    // Esc: clear search first; second Esc closes
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.esc) || data === "\x1b") {
      if (this.query.length > 0) {
        this.query = "";
        this.itemCursor = 0;
        this.tui.requestRender?.();
        return;
      }
      this.close();
      return;
    }

    // Up / Down navigation
    if (matchesKey(data, Key.up) || data === "\x1b[A" || data === "k") {
      if (!this.isRightPaneFocused) {
        this.sectionCursor = (this.sectionCursor - 1 + this.sections.length) % this.sections.length;
        this.itemCursor = 0;
        this.themeCursor = 0;
        this.bgCursor = 0;
        this.query = "";
      } else if (this.getCurrentSection() === "theme") {
        const { palItems, bgItems } = this.getThemeCols();
        if (this.isBgColumnFocused) {
          if (bgItems.length > 0) {
            this.bgCursor = (this.bgCursor - 1 + bgItems.length) % bgItems.length;
          }
        } else {
          if (palItems.length > 0) {
            this.themeCursor = (this.themeCursor - 1 + palItems.length) % palItems.length;
            const p = palItems[this.themeCursor]?.payload?.replace("theme:", "");
            if (p) this.options.onSelectTheme?.(p);
          }
        }
      } else {
        const items = this.getFilteredItems();
        if (items.length > 0) {
          this.itemCursor = (this.itemCursor - 1 + items.length) % items.length;
        }
      }
      this.tui.requestRender?.();
      return;
    }

    if (matchesKey(data, Key.down) || data === "\x1b[B" || data === "j") {
      if (!this.isRightPaneFocused) {
        this.sectionCursor = (this.sectionCursor + 1) % this.sections.length;
        this.itemCursor = 0;
        this.themeCursor = 0;
        this.bgCursor = 0;
        this.query = "";
      } else if (this.getCurrentSection() === "theme") {
        const { palItems, bgItems } = this.getThemeCols();
        if (this.isBgColumnFocused) {
          if (bgItems.length > 0) {
            this.bgCursor = (this.bgCursor + 1) % bgItems.length;
          }
        } else {
          if (palItems.length > 0) {
            this.themeCursor = (this.themeCursor + 1) % palItems.length;
            const p = palItems[this.themeCursor]?.payload?.replace("theme:", "");
            if (p) this.options.onSelectTheme?.(p);
          }
        }
      } else {
        const items = this.getFilteredItems();
        if (items.length > 0) {
          this.itemCursor = (this.itemCursor + 1) % items.length;
        }
      }
      this.tui.requestRender?.();
      return;
    }

    // Left / Right / Tab pane switching
    if (matchesKey(data, Key.left) || data === "\x1b[D") {
      if (this.isRightPaneFocused) {
        if (this.getCurrentSection() === "theme" && this.isBgColumnFocused) {
          this.isBgColumnFocused = false;
        } else {
          this.isRightPaneFocused = false;
        }
        this.tui.requestRender?.();
      }
      return;
    }

    if (matchesKey(data, Key.right) || data === "\x1b[C") {
      if (!this.isRightPaneFocused) {
        this.isRightPaneFocused = true;
      } else if (this.getCurrentSection() === "theme" && !this.isBgColumnFocused) {
        this.isBgColumnFocused = true;
      }
      this.tui.requestRender?.();
      return;
    }

    if (matchesKey(data, Key.tab) || data === "\t") {
      if (!this.isRightPaneFocused) {
        this.isRightPaneFocused = true;
      } else if (this.getCurrentSection() === "theme") {
        this.isBgColumnFocused = !this.isBgColumnFocused;
      } else {
        this.isRightPaneFocused = false;
      }
      this.tui.requestRender?.();
      return;
    }

    // Ctrl+S: shortcut assignment
    if (data === "\x13") { // Ctrl+S
      const items = this.getFilteredItems();
      const item = items[this.itemCursor];
      if (item && item.payload) {
        if (this.options.onAssignShortcut) {
          this.options.onAssignShortcut(item.payload);
        } else {
          this.setFeedback("Shortcut assignment unavailable; use native keybindings settings.");
        }
      }
      return;
    }

    // Enter confirmation / action dispatch
    if (matchesKey(data, Key.enter) || data === "\r" || data === "\n") {
      if (!this.isRightPaneFocused) {
        this.isRightPaneFocused = true;
        this.tui.requestRender?.();
        return;
      }

      if (this.getCurrentSection() === "theme") {
        const { palItems, bgItems } = this.getThemeCols();
        if (this.isBgColumnFocused) {
          const bg = bgItems[this.bgCursor];
          if (bg && bg.payload) {
            const name = bg.payload.replace("bg:", "");
            this.options.onSelectBackground?.(name);
            this.setFeedback(`Applied surface: ${name}`);
          }
        } else {
          const p = palItems[this.themeCursor];
          if (p && p.payload) {
            const name = p.payload.replace("theme:", "");
            this.options.onSelectTheme?.(name);
            this.setFeedback(`Applied theme: ${name}`);
          }
        }
        return;
      }

      const items = this.getFilteredItems();
      const item = items[this.itemCursor];
      if (!item || item.disabled) return;

      const payload = item.payload || "";

      // 1. Delegation: Native-only settings / login / mcp
      if (payload === "@agent") {
        if (this.options.onDelegateCommand) {
          this.close();
          this.options.onDelegateCommand("settings");
          return;
        }
        if (typeof this.ctx.ui?.setEditorText === "function") {
          this.close();
          this.ctx.ui.setEditorText("/settings");
          return;
        }
        this.setFeedback("— unavailable: requires native pi UI —");
        return;
      }

      if (payload === "@login") {
        if (this.options.onDelegateCommand) {
          this.close();
          this.options.onDelegateCommand("login");
          return;
        }
        if (typeof this.ctx.ui?.setEditorText === "function") {
          this.close();
          this.ctx.ui.setEditorText("/login");
          return;
        }
        this.setFeedback("— unavailable: requires native pi UI —");
        return;
      }

      if (payload === "mcp") {
        if (this.options.onDelegateCommand) {
          this.close();
          this.options.onDelegateCommand("mcp");
          return;
        }
        if (typeof this.ctx.ui?.setEditorText === "function") {
          this.close();
          this.ctx.ui.setEditorText("/mcp");
          return;
        }
        this.setFeedback("— unavailable: requires native pi UI —");
        return;
      }

      // 2. Package install / mutations
      if (payload.startsWith("market:") || payload.startsWith("plugin:")) {
        const spec = payload.replace(/^(market|plugin):/, "");
        if (this.options.onInstallPlugin) {
          this.options.onInstallPlugin(spec);
          this.setFeedback(`Installing ${spec}…`);
        } else if (typeof this.ctx.ui?.setEditorText === "function") {
          this.close();
          this.ctx.ui.setEditorText(`/package install ${spec.startsWith("npm:") ? spec : `npm:${spec}`}`);
          return;
        } else {
          this.setFeedback("— unavailable: package mutations require native pi UI —");
        }
        return;
      }

      // 3. Side section toggling
      if (payload.startsWith("side:")) {
        const key = payload.replace("side:", "");
        if (this.options.onToggleSideSection) {
          this.options.onToggleSideSection(key);
        }
        this.setFeedback(`Toggled sidebar section: ${key}`);
        return;
      }

      // 4. Tasks setting cycling
      if (payload.startsWith("tasks:")) {
        const key = payload.replace("tasks:", "");
        if (this.options.onCycleTaskSetting) {
          this.options.onCycleTaskSetting(key, "next");
        }
        this.setFeedback(`Cycled task setting: ${key}`);
        return;
      }

      // 5. Theme selection
      if (payload.startsWith("theme:")) {
        const themeName = payload.replace("theme:", "");
        if (this.options.onSelectTheme) {
          this.options.onSelectTheme(themeName);
        }
        this.setFeedback(`Applied theme: ${themeName}`);
        return;
      }

      // 6. Background selection
      if (payload.startsWith("bg:")) {
        const bgName = payload.replace("bg:", "");
        if (this.options.onSelectBackground) {
          this.options.onSelectBackground(bgName);
        }
        this.setFeedback(`Applied surface: ${bgName}`);
        return;
      }

      // 7. General command prefill
      if (payload) {
        if (typeof this.ctx.ui?.setEditorText === "function") {
          this.close();
          this.ctx.ui.setEditorText(payload.startsWith("/") ? payload : `/${payload}`);
          return;
        }
        if (this.options.onDelegateCommand) {
          this.close();
          this.options.onDelegateCommand(payload);
          return;
        }
        this.setFeedback(`Filled: /${payload}`);
        return;
      }

      return;
    }

    // Delete / Backspace: plugin uninstall or filter editing
    if (matchesKey(data, Key.backspace) || data === "\x7f" || data === "\b") {
      if (this.query.length > 0) {
        this.query = this.query.slice(0, -1);
        this.itemCursor = 0;
        this.tui.requestRender?.();
      }
      return;
    }

    // Delete key (Delete plugin if query empty in Plugins)
    if (data === "\x1b[3~" || data === "delete") {
      if (this.getCurrentSection() === "plugin" && this.isRightPaneFocused && this.query.length === 0) {
        const items = this.getFilteredItems();
        const item = items[this.itemCursor];
        if (item && item.payload) {
          const spec = item.payload.replace("plugin:", "");
          if (this.options.onUninstallPlugin) {
            this.options.onUninstallPlugin(spec);
            this.setFeedback(`Uninstalled ${spec}`);
          } else if (typeof this.ctx.ui?.setEditorText === "function") {
            this.close();
            this.ctx.ui.setEditorText(`/package remove ${spec}`);
            return;
          } else {
            this.setFeedback("— unavailable: package uninstall requires native pi UI —");
          }
        }
      }
      return;
    }

    // Printable runes append to filter
    if (data.length === 1 && data >= " " && data <= "~") {
      this.query += data;
      this.itemCursor = 0;
      this.isRightPaneFocused = true;
      if (this.getCurrentSection() === "market" && this.options.onSearchMarketplace) {
        this.options.onSearchMarketplace(this.query);
      }
      this.tui.requestRender?.();
      return;
    }
  }

  render(width: number): string[] {
    const safeWidth = Math.max(20, width);
    const boxW = Math.min(Math.max(safeWidth - 4, 20), 120);

    // 1. Header line
    const secMeta = SETTINGS_HUB_SECTIONS[this.getCurrentSection()] || SETTINGS_HUB_SECTIONS.agent;
    const titleStr = boldSafe(this.theme, fgSafe(this.theme, "accent", "Settings Hub"));
    const hintStr = dimSafe(this.theme, secMeta.hint);
    const filterLabel = this.getCurrentSection() === "market" ? "search: " : "filter: ";
    const filterDisplay = dimSafe(this.theme, `${filterLabel}${this.query}▌`);

    const headLine = truncateToWidth(
      `${titleStr}  ${filterDisplay}${" ".repeat(Math.max(1, boxW - visibleWidth(titleStr) - visibleWidth(filterDisplay) - 4))}`,
      boxW,
      "",
    );
    this.headerText.setText(headLine);

    // 2. Multi-pane Layout Calculation
    let leftW = 24;
    if (boxW < 60) {
      leftW = Math.max(12, Math.floor(boxW * 0.35));
    } else if (boxW >= 100) {
      leftW = 28;
    }
    const rightW = Math.max(12, boxW - leftW - 3);
    const win = 12; // constant window height prevents jitter!

    // Left pane rows (Sections)
    const { start: secStart, end: secEnd, hasAbove: secAbove, hasBelow: secBelow } = fixedWin(
      this.sectionCursor,
      this.sections.length,
      win,
    );

    const leftLines: string[] = [];
    if (secAbove) {
      leftLines.push(dimSafe(this.theme, shorten(`…(+${secStart} above)`, leftW)));
    }
    for (let i = secStart; i < secEnd; i++) {
      const s = this.sections[i];
      const isSel = i === this.sectionCursor && !this.isRightPaneFocused;
      const meta = SETTINGS_HUB_SECTIONS[s];
      const prefix = isSel ? fgSafe(this.theme, "accent", "▸ ") : "  ";
      const badge = meta.badge ? ` [${meta.badge}]` : "";
      const text = `${meta.label}${badge}`;
      const styled = isSel
        ? boldSafe(this.theme, fgSafe(this.theme, "accent", fit(text, leftW - 2)))
        : fit(text, leftW - 2);
      leftLines.push(truncateToWidth(`${prefix}${styled}`, leftW, ""));
    }
    if (secBelow) {
      leftLines.push(dimSafe(this.theme, shorten(`…(+${this.sections.length - secEnd} below)`, leftW)));
    }
    while (leftLines.length < win) {
      leftLines.push(" ".repeat(leftW));
    }

    // Right pane rows (Current Section Items)
    const items = this.getFilteredItems();
    const { start: itStart, end: itEnd, hasAbove: itAbove, hasBelow: itBelow } = fixedWin(
      this.itemCursor,
      items.length,
      win,
    );

    const rightLines: string[] = [];
    if (items.length === 0) {
      rightLines.push(dimSafe(this.theme, "  — no items match filter —"));
      while (rightLines.length < win) rightLines.push(" ".repeat(rightW));
    } else {
      if (itAbove) {
        rightLines.push(dimSafe(this.theme, shorten(`…(+${itStart} above)`, rightW)));
      }
      for (let i = itStart; i < itEnd; i++) {
        const item = items[i];
        const isSel = i === this.itemCursor && this.isRightPaneFocused;
        const prefix = isSel ? fgSafe(this.theme, "accent", "→ ") : "  ";
        const labelPart = item.isCurrent ? `${item.label} (current)` : item.label;
        const descPart = item.desc ? ` · ${item.desc}` : "";
        const rowText = `${labelPart}${descPart}`;
        const styled = isSel
          ? boldSafe(this.theme, fgSafe(this.theme, "accent", fit(rowText, rightW - 2)))
          : fit(rowText, rightW - 2);
        rightLines.push(truncateToWidth(`${prefix}${styled}`, rightW, ""));
      }
      if (itBelow) {
        rightLines.push(dimSafe(this.theme, shorten(`…(+${items.length - itEnd} below)`, rightW)));
      }
      while (rightLines.length < win) {
        rightLines.push(" ".repeat(rightW));
      }
    }

    // Combine Left and Right columns with separator │
    const combinedLines: string[] = [];
    for (let r = 0; r < win; r++) {
      const l = leftLines[r] ?? " ".repeat(leftW);
      const rg = rightLines[r] ?? " ".repeat(rightW);
      const sep = dimSafe(this.theme, "│");
      combinedLines.push(truncateToWidth(`${l} ${sep} ${rg}`, boxW, ""));
    }
    this.bodyText.setText(combinedLines.join("\n"));

    // 3. Footer / Status Line
    const footerMsg = this.feedbackText || secMeta.hint;
    const footStyled = this.feedbackText
      ? boldSafe(this.theme, fgSafe(this.theme, "success", this.feedbackText))
      : dimSafe(this.theme, footerMsg);
    this.footerText.setText(truncateToWidth(footStyled, boxW, ""));

    return super.render(safeWidth);
  }
}

export function createOmtSettingsHubComponent(
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  options: SettingsHubOptions = {},
): Component {
  return new OmtSettingsHubComponent(tui, theme, keybindings, done, ctx, options);
}

// =============================================================================
// 2. OMT Model Picker Component (Provider / Model / Spec / Recent / Favorite)
// =============================================================================

export class OmtModelPickerComponent extends Container implements Component, Focusable {
  focused = true;
  readonly capturesViewportInput = true;

  private tui: TUI;
  private theme: Theme;
  private keybindings?: KeybindingsManager;
  private done: (value?: unknown) => void;
  private ctx: ExtensionContext;
  private options: ModelPickerOptions;

  private providers: string[] = [];
  private providerCursor: number = 0;
  private modelCursor: number = 0;
  private isModelListFocused: boolean = false;
  private query: string = "";
  private favorites: Set<string>;
  private recents: Set<string>;
  private feedbackText: string = "";
  private feedbackTimer?: NodeJS.Timeout;
  private closed: boolean = false;

  private topBorder: DynamicBorder;
  private headerText: Text;
  private midBorder: DynamicBorder;
  private bodyText: Text;
  private footerText: Text;
  private botBorder: DynamicBorder;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (value?: unknown) => void,
    ctx: ExtensionContext,
    options: ModelPickerOptions,
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done;
    this.ctx = ctx;
    this.options = options;

    this.favorites = new Set(options.favoriteModelIds || []);
    this.recents = new Set(options.recentModelIds || []);

    const provSet = new Set<string>();
    for (const m of options.models) {
      if (m.provider) provSet.add(m.provider);
    }
    this.providers = Array.from(provSet);
    if (this.providers.length === 0) this.providers = ["all"];

    const borderStyle = getBorderStyler(theme);
    this.topBorder = new DynamicBorder(borderStyle);
    this.headerText = new Text("", 0, 0);
    this.midBorder = new DynamicBorder(borderStyle);
    this.bodyText = new Text("", 0, 0);
    this.footerText = new Text("", 0, 0);
    this.botBorder = new DynamicBorder(borderStyle);

    this.addChild(this.topBorder);
    this.addChild(this.headerText);
    this.addChild(this.midBorder);
    this.addChild(this.bodyText);
    this.addChild(this.footerText);
    this.addChild(this.botBorder);
  }

  getCurrentProvider(): string {
    return this.providers[this.providerCursor] ?? "all";
  }

  getFilteredModels(): ModelSpec[] {
    const curProv = this.getCurrentProvider();
    const list =
      curProv === "all"
        ? this.options.models
        : this.options.models.filter((m) => m.provider === curProv);

    return filterItems(list, this.query, (m) => [m.id, m.name, m.provider]);
  }

  getSelectedModel(): ModelSpec | undefined {
    const models = this.getFilteredModels();
    return models[this.modelCursor];
  }

  toggleFavorite(modelId: string): void {
    if (this.favorites.has(modelId)) {
      this.favorites.delete(modelId);
      this.options.onToggleFavorite?.(modelId, false);
      this.setFeedback(`Removed ${modelId} from favorites`);
    } else {
      this.favorites.add(modelId);
      this.options.onToggleFavorite?.(modelId, true);
      this.setFeedback(`Added ${modelId} to favorites ★`);
    }
    this.tui.requestRender?.();
  }

  setFeedback(msg: string): void {
    this.feedbackText = msg;
    this.tui.requestRender?.();
  }

  private close(result?: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.done(result);
  }

  handleInput(data: string): void {
    if (this.closed) return;

    if (matchesKey(data, Key.escape) || matchesKey(data, Key.esc) || data === "\x1b") {
      if (this.query.length > 0) {
        this.query = "";
        this.modelCursor = 0;
        this.tui.requestRender?.();
        return;
      }
      this.close();
      return;
    }

    if (matchesKey(data, Key.up) || data === "\x1b[A" || data === "k") {
      if (!this.isModelListFocused) {
        this.providerCursor = (this.providerCursor - 1 + this.providers.length) % this.providers.length;
        this.modelCursor = 0;
      } else {
        const models = this.getFilteredModels();
        if (models.length > 0) {
          this.modelCursor = (this.modelCursor - 1 + models.length) % models.length;
        }
      }
      this.tui.requestRender?.();
      return;
    }

    if (matchesKey(data, Key.down) || data === "\x1b[B" || data === "j") {
      if (!this.isModelListFocused) {
        this.providerCursor = (this.providerCursor + 1) % this.providers.length;
        this.modelCursor = 0;
      } else {
        const models = this.getFilteredModels();
        if (models.length > 0) {
          this.modelCursor = (this.modelCursor + 1) % models.length;
        }
      }
      this.tui.requestRender?.();
      return;
    }

    if (matchesKey(data, Key.left) || data === "\x1b[D") {
      this.isModelListFocused = false;
      this.tui.requestRender?.();
      return;
    }

    if (matchesKey(data, Key.right) || data === "\x1b[C" || matchesKey(data, Key.tab) || data === "\t") {
      this.isModelListFocused = !this.isModelListFocused;
      this.tui.requestRender?.();
      return;
    }

    // Toggle favorite: 'f' or 'F' or Ctrl+F ('\x06') or '*'
    if (data === "f" || data === "F" || data === "\x06" || data === "*") {
      const sel = this.getSelectedModel();
      if (sel) {
        this.toggleFavorite(sel.id);
      }
      return;
    }

    if (matchesKey(data, Key.enter) || data === "\r" || data === "\n") {
      if (!this.isModelListFocused) {
        this.isModelListFocused = true;
        this.tui.requestRender?.();
        return;
      }
      const sel = this.getSelectedModel();
      if (sel) {
        this.options.onSelectModel(sel);
        this.close(sel);
      }
      return;
    }

    if (matchesKey(data, Key.backspace) || data === "\x7f" || data === "\b") {
      if (this.query.length > 0) {
        this.query = this.query.slice(0, -1);
        this.modelCursor = 0;
        this.tui.requestRender?.();
      }
      return;
    }

    if (data.length === 1 && data >= " " && data <= "~" && data !== "f" && data !== "F" && data !== "*") {
      this.query += data;
      this.modelCursor = 0;
      this.isModelListFocused = true;
      this.tui.requestRender?.();
      return;
    }
  }

  render(width: number): string[] {
    const safeWidth = Math.max(20, width);
    const boxW = Math.min(Math.max(safeWidth - 4, 20), 120);

    const titleStr = boldSafe(this.theme, fgSafe(this.theme, "accent", "Model Picker"));
    const filterDisplay = dimSafe(this.theme, `filter: ${this.query}▌`);
    this.headerText.setText(
      truncateToWidth(`${titleStr}  ${filterDisplay}`, boxW, ""),
    );

    const leftW = Math.max(12, Math.min(22, Math.floor(boxW * 0.22)));
    const specW = boxW >= 90 ? 36 : 0;
    const midW = Math.max(12, boxW - leftW - specW - (specW > 0 ? 6 : 3));
    const win = 12;

    // 1. Providers column
    const { start: pStart, end: pEnd, hasAbove: pAbove, hasBelow: pBelow } = fixedWin(
      this.providerCursor,
      this.providers.length,
      win,
    );
    const provLines: string[] = [];
    if (pAbove) provLines.push(dimSafe(this.theme, shorten(`…(+${pStart} above)`, leftW)));
    for (let i = pStart; i < pEnd; i++) {
      const p = this.providers[i];
      const isSel = i === this.providerCursor && !this.isModelListFocused;
      const prefix = isSel ? fgSafe(this.theme, "accent", "▸ ") : "  ";
      const styled = isSel
        ? boldSafe(this.theme, fgSafe(this.theme, "accent", fit(p, leftW - 2)))
        : fit(p, leftW - 2);
      provLines.push(truncateToWidth(`${prefix}${styled}`, leftW, ""));
    }
    if (pBelow) provLines.push(dimSafe(this.theme, shorten(`…(+${this.providers.length - pEnd} below)`, leftW)));
    while (provLines.length < win) provLines.push(" ".repeat(leftW));

    // 2. Models column
    const models = this.getFilteredModels();
    const { start: mStart, end: mEnd, hasAbove: mAbove, hasBelow: mBelow } = fixedWin(
      this.modelCursor,
      models.length,
      win,
    );
    const modelLines: string[] = [];
    if (models.length === 0) {
      modelLines.push(dimSafe(this.theme, "  — no models —"));
      while (modelLines.length < win) modelLines.push(" ".repeat(midW));
    } else {
      if (mAbove) modelLines.push(dimSafe(this.theme, shorten(`…(+${mStart} above)`, midW)));
      for (let i = mStart; i < mEnd; i++) {
        const m = models[i];
        const isSel = i === this.modelCursor && this.isModelListFocused;
        const prefix = isSel ? fgSafe(this.theme, "accent", "→ ") : "  ";
        const favStar = this.favorites.has(m.id) ? "★ " : "";
        const recMarker = this.recents.has(m.id) ? "● " : "";
        const rowText = `${favStar}${recMarker}${m.id}`;
        const styled = isSel
          ? boldSafe(this.theme, fgSafe(this.theme, "accent", fit(rowText, midW - 2)))
          : fit(rowText, midW - 2);
        modelLines.push(truncateToWidth(`${prefix}${styled}`, midW, ""));
      }
      if (mBelow) modelLines.push(dimSafe(this.theme, shorten(`…(+${models.length - mEnd} below)`, midW)));
      while (modelLines.length < win) modelLines.push(" ".repeat(midW));
    }

    // 3. Spec detail column (if wide enough)
    const specLines: string[] = [];
    if (specW > 0) {
      const sel = this.getSelectedModel();
      if (!sel) {
        specLines.push(dimSafe(this.theme, "  — no model selected —"));
      } else {
        specLines.push(boldSafe(this.theme, fgSafe(this.theme, "accent", fit(sel.id, specW))));
        specLines.push(dimSafe(this.theme, `Provider: ${sel.provider}`));
        specLines.push(dimSafe(this.theme, `Context : ${formatNumber(sel.contextWindow)}`));
        specLines.push(dimSafe(this.theme, `Max Out : ${formatNumber(sel.maxTokens)}`));
        specLines.push(dimSafe(this.theme, `In / Out: ${formatCostPair(sel.costInput, sel.costOutput)}`));
        specLines.push(dimSafe(this.theme, `Thinking: ${sel.thinking ? "supported" : "—"}`));
        specLines.push(
          sel.keyStatus === "ready"
            ? fgSafe(this.theme, "success", "Key     : ready ✓")
            : sel.keyStatus === "missing"
            ? fgSafe(this.theme, "warning", "Key     : missing key ⚠")
            : dimSafe(this.theme, "Key     : —"),
        );
      }
      while (specLines.length < win) specLines.push(" ".repeat(specW));
    }

    // Combine columns
    const combined: string[] = [];
    for (let r = 0; r < win; r++) {
      const p = provLines[r] ?? " ".repeat(leftW);
      const m = modelLines[r] ?? " ".repeat(midW);
      const sep = dimSafe(this.theme, "│");
      if (specW > 0) {
        const s = specLines[r] ?? " ".repeat(specW);
        combined.push(truncateToWidth(`${p} ${sep} ${m} ${sep} ${s}`, boxW, ""));
      } else {
        combined.push(truncateToWidth(`${p} ${sep} ${m}`, boxW, ""));
      }
    }
    this.bodyText.setText(combined.join("\n"));

    const hints = "↑↓ move · ←/→/Tab switch · Enter select · 'f' toggle favorite ★ · Esc close";
    this.footerText.setText(
      truncateToWidth(
        this.feedbackText
          ? boldSafe(this.theme, fgSafe(this.theme, "success", this.feedbackText))
          : dimSafe(this.theme, hints),
        boxW,
        "",
      ),
    );

    return super.render(safeWidth);
  }
}

export function createOmtModelPickerComponent(
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  options: ModelPickerOptions,
): Component {
  return new OmtModelPickerComponent(tui, theme, keybindings, done, ctx, options);
}

// =============================================================================
// 3. OMT Theme & Background Picker Component (2 Columns)
// =============================================================================

export class OmtThemePickerComponent extends Container implements Component, Focusable {
  focused = true;
  readonly capturesViewportInput = true;

  private tui: TUI;
  private theme: Theme;
  private keybindings?: KeybindingsManager;
  private done: (value?: unknown) => void;
  private ctx: ExtensionContext;
  private options: ThemePickerOptions;

  private themes: ThemeItem[];
  private backgrounds: BackgroundItem[];
  private themeCursor: number = 0;
  private bgCursor: number = 0;
  private isBgFocused: boolean = false;
  private query: string = "";
  private feedbackText: string = "";
  private closed: boolean = false;

  private topBorder: DynamicBorder;
  private headerText: Text;
  private midBorder: DynamicBorder;
  private bodyText: Text;
  private footerText: Text;
  private botBorder: DynamicBorder;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (value?: unknown) => void,
    ctx: ExtensionContext,
    options: ThemePickerOptions,
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done;
    this.ctx = ctx;
    this.options = options;

    this.themes = options.themes || [];
    this.backgrounds = options.backgrounds || [];

    if (options.currentTheme) {
      const idx = this.themes.findIndex((t) => t.id === options.currentTheme);
      if (idx >= 0) this.themeCursor = idx;
    }

    if (options.currentBackground) {
      const idx = this.backgrounds.findIndex((b) => b.id === options.currentBackground);
      if (idx >= 0) this.bgCursor = idx;
    }

    const borderStyle = getBorderStyler(theme);
    this.topBorder = new DynamicBorder(borderStyle);
    this.headerText = new Text("", 0, 0);
    this.midBorder = new DynamicBorder(borderStyle);
    this.bodyText = new Text("", 0, 0);
    this.footerText = new Text("", 0, 0);
    this.botBorder = new DynamicBorder(borderStyle);

    this.addChild(this.topBorder);
    this.addChild(this.headerText);
    this.addChild(this.midBorder);
    this.addChild(this.bodyText);
    this.addChild(this.footerText);
    this.addChild(this.botBorder);
  }

  private close(result?: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.done(result);
  }

  handleInput(data: string): void {
    if (this.closed) return;

    if (matchesKey(data, Key.escape) || matchesKey(data, Key.esc) || data === "\x1b") {
      if (this.query.length > 0) {
        this.query = "";
        this.tui.requestRender?.();
        return;
      }
      this.close();
      return;
    }

    if (matchesKey(data, Key.up) || data === "\x1b[A" || data === "k") {
      if (!this.isBgFocused) {
        if (this.themes.length > 0) {
          this.themeCursor = (this.themeCursor - 1 + this.themes.length) % this.themes.length;
          this.options.onPreviewTheme?.(this.themes[this.themeCursor].id);
        }
      } else {
        if (this.backgrounds.length > 0) {
          this.bgCursor = (this.bgCursor - 1 + this.backgrounds.length) % this.backgrounds.length;
        }
      }
      this.tui.requestRender?.();
      return;
    }

    if (matchesKey(data, Key.down) || data === "\x1b[B" || data === "j") {
      if (!this.isBgFocused) {
        if (this.themes.length > 0) {
          this.themeCursor = (this.themeCursor + 1) % this.themes.length;
          this.options.onPreviewTheme?.(this.themes[this.themeCursor].id);
        }
      } else {
        if (this.backgrounds.length > 0) {
          this.bgCursor = (this.bgCursor + 1) % this.backgrounds.length;
        }
      }
      this.tui.requestRender?.();
      return;
    }

    if (
      matchesKey(data, Key.left) ||
      matchesKey(data, Key.right) ||
      matchesKey(data, Key.tab) ||
      data === "\t"
    ) {
      this.isBgFocused = !this.isBgFocused;
      this.tui.requestRender?.();
      return;
    }

    if (matchesKey(data, Key.enter) || data === "\r" || data === "\n") {
      if (!this.isBgFocused) {
        const sel = this.themes[this.themeCursor];
        if (sel) {
          this.options.onSelectTheme(sel.id);
          this.feedbackText = `Applied theme: ${sel.name}`;
          this.close(sel);
        }
      } else {
        const sel = this.backgrounds[this.bgCursor];
        if (sel) {
          this.options.onSelectBackground(sel.id);
          this.feedbackText = `Applied background: ${sel.name}`;
          this.close(sel);
        }
      }
      return;
    }

    if (matchesKey(data, Key.backspace) || data === "\x7f" || data === "\b") {
      if (this.query.length > 0) {
        this.query = this.query.slice(0, -1);
        this.tui.requestRender?.();
      }
      return;
    }

    if (data.length === 1 && data >= " " && data <= "~") {
      this.query += data;
      this.tui.requestRender?.();
      return;
    }
  }

  render(width: number): string[] {
    const safeWidth = Math.max(20, width);
    const boxW = Math.min(Math.max(safeWidth - 4, 20), 100);

    const titleStr = boldSafe(this.theme, fgSafe(this.theme, "accent", "Theme & Backgrounds"));
    this.headerText.setText(truncateToWidth(titleStr, boxW, ""));

    const colW = Math.max(12, Math.floor((boxW - 3) / 2));
    const win = 10;

    // Left column: Themes
    const { start: tStart, end: tEnd, hasAbove: tAbove, hasBelow: tBelow } = fixedWin(
      this.themeCursor,
      this.themes.length,
      win,
    );
    const themeLines: string[] = [];
    if (tAbove) themeLines.push(dimSafe(this.theme, shorten(`…(+${tStart} above)`, colW)));
    for (let i = tStart; i < tEnd; i++) {
      const t = this.themes[i];
      const isSel = i === this.themeCursor && !this.isBgFocused;
      const prefix = isSel ? fgSafe(this.theme, "accent", "▸ ") : "  ";
      const isCurr = t.id === this.options.currentTheme ? " ✓" : "";
      const text = `${t.name}${isCurr}`;
      const styled = isSel
        ? boldSafe(this.theme, fgSafe(this.theme, "accent", fit(text, colW - 2)))
        : fit(text, colW - 2);
      themeLines.push(truncateToWidth(`${prefix}${styled}`, colW, ""));
    }
    if (tBelow) themeLines.push(dimSafe(this.theme, shorten(`…(+${this.themes.length - tEnd} below)`, colW)));
    while (themeLines.length < win) themeLines.push(" ".repeat(colW));

    // Right column: Backgrounds
    const { start: bStart, end: bEnd, hasAbove: bAbove, hasBelow: bBelow } = fixedWin(
      this.bgCursor,
      this.backgrounds.length,
      win,
    );
    const bgLines: string[] = [];
    if (bAbove) bgLines.push(dimSafe(this.theme, shorten(`…(+${bStart} above)`, colW)));
    for (let i = bStart; i < bEnd; i++) {
      const b = this.backgrounds[i];
      const isSel = i === this.bgCursor && this.isBgFocused;
      const prefix = isSel ? fgSafe(this.theme, "accent", "▸ ") : "  ";
      const isCurr = b.id === this.options.currentBackground ? " ✓" : "";
      const text = `${b.name}${isCurr}`;
      const styled = isSel
        ? boldSafe(this.theme, fgSafe(this.theme, "accent", fit(text, colW - 2)))
        : fit(text, colW - 2);
      bgLines.push(truncateToWidth(`${prefix}${styled}`, colW, ""));
    }
    if (bBelow) bgLines.push(dimSafe(this.theme, shorten(`…(+${this.backgrounds.length - bEnd} below)`, colW)));
    while (bgLines.length < win) bgLines.push(" ".repeat(colW));

    const combined: string[] = [];
    for (let r = 0; r < win; r++) {
      const l = themeLines[r] ?? " ".repeat(colW);
      const rg = bgLines[r] ?? " ".repeat(colW);
      const sep = dimSafe(this.theme, "│");
      combined.push(truncateToWidth(`${l} ${sep} ${rg}`, boxW, ""));
    }
    this.bodyText.setText(combined.join("\n"));

    const hints = "↑↓ previews · ←/→/Tab switch column · Enter applies · Esc close";
    this.footerText.setText(truncateToWidth(dimSafe(this.theme, hints), boxW, ""));

    return super.render(safeWidth);
  }
}

export function createOmtThemePickerComponent(
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  options: ThemePickerOptions,
): Component {
  return new OmtThemePickerComponent(tui, theme, keybindings, done, ctx, options);
}

// =============================================================================
// 4. OMT Pet Selector Component (List + Demo Art Preview)
// =============================================================================

export class OmtPetSelectorComponent extends Container implements Component, Focusable {
  focused = true;
  readonly capturesViewportInput = true;

  private tui: TUI;
  private theme: Theme;
  private keybindings?: KeybindingsManager;
  private done: (value?: unknown) => void;
  private ctx: ExtensionContext;
  private options: PetSelectorOptions;

  private pets: PetItem[];
  private petCursor: number = 0;
  private query: string = "";
  private closed: boolean = false;

  private topBorder: DynamicBorder;
  private headerText: Text;
  private midBorder: DynamicBorder;
  private bodyText: Text;
  private footerText: Text;
  private botBorder: DynamicBorder;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (value?: unknown) => void,
    ctx: ExtensionContext,
    options: PetSelectorOptions,
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done;
    this.ctx = ctx;
    this.options = options;

    this.pets = options.pets || [];
    if (options.currentPet) {
      const idx = this.pets.findIndex((p) => p.name === options.currentPet || p.id === options.currentPet);
      if (idx >= 0) this.petCursor = idx;
    }

    const borderStyle = getBorderStyler(theme);
    this.topBorder = new DynamicBorder(borderStyle);
    this.headerText = new Text("", 0, 0);
    this.midBorder = new DynamicBorder(borderStyle);
    this.bodyText = new Text("", 0, 0);
    this.footerText = new Text("", 0, 0);
    this.botBorder = new DynamicBorder(borderStyle);

    this.addChild(this.topBorder);
    this.addChild(this.headerText);
    this.addChild(this.midBorder);
    this.addChild(this.bodyText);
    this.addChild(this.footerText);
    this.addChild(this.botBorder);
  }

  private close(result?: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.done(result);
  }

  handleInput(data: string): void {
    if (this.closed) return;

    if (matchesKey(data, Key.escape) || matchesKey(data, Key.esc) || data === "\x1b") {
      if (this.query.length > 0) {
        this.query = "";
        this.tui.requestRender?.();
        return;
      }
      this.close();
      return;
    }

    if (matchesKey(data, Key.up) || data === "\x1b[A" || data === "k") {
      if (this.pets.length > 0) {
        this.petCursor = (this.petCursor - 1 + this.pets.length) % this.pets.length;
        this.options.onPreviewPet?.(this.pets[this.petCursor].name);
      }
      this.tui.requestRender?.();
      return;
    }

    if (matchesKey(data, Key.down) || data === "\x1b[B" || data === "j") {
      if (this.pets.length > 0) {
        this.petCursor = (this.petCursor + 1) % this.pets.length;
        this.options.onPreviewPet?.(this.pets[this.petCursor].name);
      }
      this.tui.requestRender?.();
      return;
    }

    if (matchesKey(data, Key.enter) || data === "\r" || data === "\n") {
      const sel = this.pets[this.petCursor];
      if (sel) {
        this.options.onSelectPet(sel.name);
        this.close(sel);
      }
      return;
    }

    if (matchesKey(data, Key.backspace) || data === "\x7f" || data === "\b") {
      if (this.query.length > 0) {
        this.query = this.query.slice(0, -1);
        this.tui.requestRender?.();
      }
      return;
    }

    if (data.length === 1 && data >= " " && data <= "~") {
      this.query += data;
      this.tui.requestRender?.();
      return;
    }
  }

  render(width: number): string[] {
    const safeWidth = Math.max(20, width);
    const boxW = Math.min(Math.max(safeWidth - 4, 20), 80);

    const titleStr = boldSafe(this.theme, fgSafe(this.theme, "accent", "Companion Pets"));
    this.headerText.setText(truncateToWidth(titleStr, boxW, ""));

    const leftW = Math.max(12, Math.floor(boxW * 0.35));
    const rightW = Math.max(12, boxW - leftW - 3);
    const win = 10;

    // Left pane: Pets list
    const { start: pStart, end: pEnd, hasAbove: pAbove, hasBelow: pBelow } = fixedWin(
      this.petCursor,
      this.pets.length,
      win,
    );
    const leftLines: string[] = [];
    if (pAbove) leftLines.push(dimSafe(this.theme, shorten(`…(+${pStart} above)`, leftW)));
    for (let i = pStart; i < pEnd; i++) {
      const p = this.pets[i];
      const isSel = i === this.petCursor;
      const isCurr = p.name === this.options.currentPet ? " ●" : "";
      const prefix = isSel ? fgSafe(this.theme, "accent", "▸ ") : "  ";
      const styled = isSel
        ? boldSafe(this.theme, fgSafe(this.theme, "accent", fit(`${p.name}${isCurr}`, leftW - 2)))
        : fit(`${p.name}${isCurr}`, leftW - 2);
      leftLines.push(truncateToWidth(`${prefix}${styled}`, leftW, ""));
    }
    if (pBelow) leftLines.push(dimSafe(this.theme, shorten(`…(+${this.pets.length - pEnd} below)`, leftW)));
    while (leftLines.length < win) leftLines.push(" ".repeat(leftW));

    // Right pane: Demo Art preview
    const selPet = this.pets[this.petCursor];
    const artLines = selPet?.art || ["  (no art preview)"];
    const rightLines: string[] = [];
    for (let r = 0; r < win; r++) {
      const line = artLines[r] ?? "";
      rightLines.push(truncateToWidth(dimSafe(this.theme, line), rightW, ""));
    }

    const combined: string[] = [];
    for (let r = 0; r < win; r++) {
      const l = leftLines[r] ?? " ".repeat(leftW);
      const rg = rightLines[r] ?? " ".repeat(rightW);
      const sep = dimSafe(this.theme, "│");
      combined.push(truncateToWidth(`${l} ${sep} ${rg}`, boxW, ""));
    }
    this.bodyText.setText(combined.join("\n"));

    const hints = "↑↓ select · Enter apply · Esc close";
    this.footerText.setText(truncateToWidth(dimSafe(this.theme, hints), boxW, ""));

    return super.render(safeWidth);
  }
}

export function createOmtPetSelectorComponent(
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  options: PetSelectorOptions,
): Component {
  return new OmtPetSelectorComponent(tui, theme, keybindings, done, ctx, options);
}

// =============================================================================
// 5. OMT Resume Sessions Component (Scope Toggle + Detail Pane)
// =============================================================================

export class OmtResumeComponent extends Container implements Component, Focusable {
  focused = true;
  readonly capturesViewportInput = true;

  private tui: TUI;
  private theme: Theme;
  private keybindings?: KeybindingsManager;
  private done: (value?: unknown) => void;
  private ctx: ExtensionContext;
  private options: ResumeDialogOptions;

  private scope: "current" | "all" = "current";
  private sessionCursor: number = 0;
  private query: string = "";
  private feedbackText: string = "";
  private closed: boolean = false;

  private topBorder: DynamicBorder;
  private headerText: Text;
  private midBorder: DynamicBorder;
  private bodyText: Text;
  private footerText: Text;
  private botBorder: DynamicBorder;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (value?: unknown) => void,
    ctx: ExtensionContext,
    options: ResumeDialogOptions,
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done;
    this.ctx = ctx;
    this.options = options;
    this.scope = options.scope || "current";

    const borderStyle = getBorderStyler(theme);
    this.topBorder = new DynamicBorder(borderStyle);
    this.headerText = new Text("", 0, 0);
    this.midBorder = new DynamicBorder(borderStyle);
    this.bodyText = new Text("", 0, 0);
    this.footerText = new Text("", 0, 0);
    this.botBorder = new DynamicBorder(borderStyle);

    this.addChild(this.topBorder);
    this.addChild(this.headerText);
    this.addChild(this.midBorder);
    this.addChild(this.bodyText);
    this.addChild(this.footerText);
    this.addChild(this.botBorder);
  }

  private getFilteredSessions(): ResumeSessionItem[] {
    return filterItems(this.options.sessions, this.query, (s) => [s.title, s.path, s.cwd]);
  }

  private close(result?: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.done(result);
  }

  handleInput(data: string): void {
    if (this.closed) return;

    if (matchesKey(data, Key.escape) || matchesKey(data, Key.esc) || data === "\x1b") {
      if (this.query.length > 0) {
        this.query = "";
        this.sessionCursor = 0;
        this.tui.requestRender?.();
        return;
      }
      this.close();
      return;
    }

    // Tab: toggle scope (current <-> all)
    if (matchesKey(data, Key.tab) || data === "\t") {
      this.scope = this.scope === "current" ? "all" : "current";
      this.options.onScopeChange?.(this.scope);
      this.tui.requestRender?.();
      return;
    }

    if (matchesKey(data, Key.up) || data === "\x1b[A" || data === "k") {
      const items = this.getFilteredSessions();
      if (items.length > 0) {
        this.sessionCursor = (this.sessionCursor - 1 + items.length) % items.length;
      }
      this.tui.requestRender?.();
      return;
    }

    if (matchesKey(data, Key.down) || data === "\x1b[B" || data === "j") {
      const items = this.getFilteredSessions();
      if (items.length > 0) {
        this.sessionCursor = (this.sessionCursor + 1) % items.length;
      }
      this.tui.requestRender?.();
      return;
    }

    if (matchesKey(data, Key.enter) || data === "\r" || data === "\n") {
      const items = this.getFilteredSessions();
      const sel = items[this.sessionCursor];
      if (sel) {
        this.options.onSelectSession(sel);
        this.close(sel);
      }
      return;
    }

    // Delete session on Delete / Backspace when query is empty
    if (data === "\x1b[3~" || (this.query.length === 0 && (matchesKey(data, Key.backspace) || data === "\x7f"))) {
      const items = this.getFilteredSessions();
      const sel = items[this.sessionCursor];
      if (sel && this.options.onDeleteSession) {
        this.options.onDeleteSession(sel);
        this.feedbackText = `Requested delete: ${sel.title}`;
        this.tui.requestRender?.();
      }
      return;
    }

    // Semantic copy of session path: 'c' or 'y'
    if (data === "c" || data === "y") {
      const items = this.getFilteredSessions();
      const sel = items[this.sessionCursor];
      if (sel) {
        this.feedbackText = `✓ copied ${sel.path.length} chars to clipboard`;
        copyToClipboard(sel.path).then((res) => {
          this.feedbackText = res.message;
          this.tui.requestRender?.();
        });
        this.tui.requestRender?.();
      }
      return;
    }

    if (matchesKey(data, Key.backspace) || data === "\x7f" || data === "\b") {
      if (this.query.length > 0) {
        this.query = this.query.slice(0, -1);
        this.sessionCursor = 0;
        this.tui.requestRender?.();
      }
      return;
    }

    if (data.length === 1 && data >= " " && data <= "~" && data !== "c" && data !== "y") {
      this.query += data;
      this.sessionCursor = 0;
      this.tui.requestRender?.();
      return;
    }
  }

  render(width: number): string[] {
    const safeWidth = Math.max(20, width);
    const boxW = Math.min(Math.max(safeWidth - 4, 20), 100);

    const scopeBadge = `[Scope: ${this.scope}] (Tab switches)`;
    const titleStr = boldSafe(this.theme, fgSafe(this.theme, "accent", `Resume Sessions ${scopeBadge}`));
    const filterDisplay = dimSafe(this.theme, `filter: ${this.query}▌`);
    this.headerText.setText(truncateToWidth(`${titleStr}  ${filterDisplay}`, boxW, ""));

    const leftW = Math.max(14, Math.floor(boxW * 0.45));
    const rightW = Math.max(12, boxW - leftW - 3);
    const win = 10;

    const items = this.getFilteredSessions();
    const { start, end, hasAbove, hasBelow } = fixedWin(this.sessionCursor, items.length, win);

    const leftLines: string[] = [];
    if (items.length === 0) {
      leftLines.push(dimSafe(this.theme, "  — no saved sessions —"));
      while (leftLines.length < win) leftLines.push(" ".repeat(leftW));
    } else {
      if (hasAbove) leftLines.push(dimSafe(this.theme, shorten(`…(+${start} above)`, leftW)));
      for (let i = start; i < end; i++) {
        const s = items[i];
        const isSel = i === this.sessionCursor;
        const prefix = isSel ? fgSafe(this.theme, "accent", "▸ ") : "  ";
        const isCurr = s.id === this.options.currentSessionId || s.isCurrent ? "● " : "";
        const desc = `${s.messageCount} msgs · ${formatAgo(s.modified)}`;
        const rowText = `${isCurr}${s.title} (${desc})`;
        const styled = isSel
          ? boldSafe(this.theme, fgSafe(this.theme, "accent", fit(rowText, leftW - 2)))
          : fit(rowText, leftW - 2);
        leftLines.push(truncateToWidth(`${prefix}${styled}`, leftW, ""));
      }
      if (hasBelow) leftLines.push(dimSafe(this.theme, shorten(`…(+${items.length - end} below)`, leftW)));
      while (leftLines.length < win) leftLines.push(" ".repeat(leftW));
    }

    // Right pane: Detail
    const sel = items[this.sessionCursor];
    const rightLines: string[] = [];
    if (!sel) {
      rightLines.push(dimSafe(this.theme, "  — no session selected —"));
    } else {
      rightLines.push(boldSafe(this.theme, fgSafe(this.theme, "accent", shorten(sel.title, rightW))));
      rightLines.push(dimSafe(this.theme, `${sel.messageCount} messages · ${formatAgo(sel.modified)}`));
      rightLines.push(dimSafe(this.theme, `Path: ${shorten(sel.path, rightW)}`));
      if (sel.cwd) rightLines.push(dimSafe(this.theme, `Cwd : ${shorten(sel.cwd, rightW)}`));
      if (sel.firstMessage) {
        rightLines.push(dimSafe(this.theme, "First message:"));
        rightLines.push(dimSafe(this.theme, shorten(sel.firstMessage, rightW)));
      }
    }
    while (rightLines.length < win) rightLines.push(" ".repeat(rightW));

    const combined: string[] = [];
    for (let r = 0; r < win; r++) {
      const l = leftLines[r] ?? " ".repeat(leftW);
      const rg = rightLines[r] ?? " ".repeat(rightW);
      const sep = dimSafe(this.theme, "│");
      combined.push(truncateToWidth(`${l} ${sep} ${rg}`, boxW, ""));
    }
    this.bodyText.setText(combined.join("\n"));

    const hints = "↑↓ select · Tab scope · Enter resume · Del delete · 'c' copy path · Esc close";
    this.footerText.setText(
      truncateToWidth(
        this.feedbackText
          ? boldSafe(this.theme, fgSafe(this.theme, "success", this.feedbackText))
          : dimSafe(this.theme, hints),
        boxW,
        "",
      ),
    );

    return super.render(safeWidth);
  }
}

export function createOmtResumeComponent(
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  options: ResumeDialogOptions,
): Component {
  return new OmtResumeComponent(tui, theme, keybindings, done, ctx, options);
}

// =============================================================================
// 6. OMT Tree Component (Modes, Fold, Labels, Summary Choices)
// =============================================================================

export class OmtTreeComponent extends Container implements Component, Focusable {
  focused = true;
  readonly capturesViewportInput = true;

  private tui: TUI;
  private theme: Theme;
  private keybindings?: KeybindingsManager;
  private done: (value?: unknown) => void;
  private ctx: ExtensionContext;
  private options: OmtTreeDialogOptions;

  private mode: TreeFilterMode = "default";
  private foldedIds: Set<string> = new Set();
  private showTimestamps: boolean = false;
  private treeCursor: number = 0;
  private query: string = "";
  private isLabeling: boolean = false;
  private labelInputBuffer: string = "";
  private feedbackText: string = "";
  private closed: boolean = false;

  private topBorder: DynamicBorder;
  private headerText: Text;
  private midBorder: DynamicBorder;
  private bodyText: Text;
  private footerText: Text;
  private botBorder: DynamicBorder;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (value?: unknown) => void,
    ctx: ExtensionContext,
    options: OmtTreeDialogOptions,
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done;
    this.ctx = ctx;
    this.options = options;

    const borderStyle = getBorderStyler(theme);
    this.topBorder = new DynamicBorder(borderStyle);
    this.headerText = new Text("", 0, 0);
    this.midBorder = new DynamicBorder(borderStyle);
    this.bodyText = new Text("", 0, 0);
    this.footerText = new Text("", 0, 0);
    this.botBorder = new DynamicBorder(borderStyle);

    this.addChild(this.topBorder);
    this.addChild(this.headerText);
    this.addChild(this.midBorder);
    this.addChild(this.bodyText);
    this.addChild(this.footerText);
    this.addChild(this.botBorder);
  }

  private getDisplayNodes() {
    const modeNodes = filterTreeNodesByMode(this.options.nodes, this.mode);
    const flattened = flattenOmtTree(modeNodes, this.foldedIds);
    return filterItems(flattened, this.query, (fn) => [
      fn.node.id,
      fn.node.label,
      fn.node.summary,
      fn.node.role,
    ]);
  }

  private close(result?: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.done(result);
  }

  handleInput(data: string): void {
    if (this.closed) return;

    // Sub-mode: Label editing
    if (this.isLabeling) {
      if (matchesKey(data, Key.escape) || matchesKey(data, Key.esc) || data === "\x1b") {
        this.isLabeling = false;
        this.labelInputBuffer = "";
        this.tui.requestRender?.();
        return;
      }
      if (matchesKey(data, Key.enter) || data === "\r" || data === "\n") {
        const nodes = this.getDisplayNodes();
        const sel = nodes[this.treeCursor];
        if (sel) {
          sel.node.label = this.labelInputBuffer;
          this.options.onSetLabel?.(sel.node.id, this.labelInputBuffer);
          this.feedbackText = `Label saved: ${this.labelInputBuffer}`;
        }
        this.isLabeling = false;
        this.labelInputBuffer = "";
        this.tui.requestRender?.();
        return;
      }
      if (matchesKey(data, Key.backspace) || data === "\x7f" || data === "\b") {
        if (this.labelInputBuffer.length > 0) {
          this.labelInputBuffer = this.labelInputBuffer.slice(0, -1);
          this.tui.requestRender?.();
        }
        return;
      }
      if (data.length === 1 && data >= " " && data <= "~") {
        this.labelInputBuffer += data;
        this.tui.requestRender?.();
        return;
      }
      return;
    }

    if (matchesKey(data, Key.escape) || matchesKey(data, Key.esc) || data === "\x1b") {
      if (this.query.length > 0) {
        this.query = "";
        this.treeCursor = 0;
        this.tui.requestRender?.();
        return;
      }
      this.close();
      return;
    }

    // Ctrl+D, Ctrl+T, Ctrl+U, Ctrl+L, Ctrl+A, Ctrl+O mode toggles
    if (data === "\x04") { // Ctrl+D: default
      this.mode = "default";
      this.feedbackText = "Mode: default";
      this.tui.requestRender?.();
      return;
    }
    if (data === "\x14") { // Ctrl+T: no-tools
      this.mode = this.mode === "no-tools" ? "default" : "no-tools";
      this.feedbackText = `Mode: ${this.mode}`;
      this.tui.requestRender?.();
      return;
    }
    if (data === "\x15") { // Ctrl+U: user-only
      this.mode = this.mode === "user-only" ? "default" : "user-only";
      this.feedbackText = `Mode: ${this.mode}`;
      this.tui.requestRender?.();
      return;
    }
    if (data === "\x0c") { // Ctrl+L: labeled-only
      this.mode = this.mode === "labeled-only" ? "default" : "labeled-only";
      this.feedbackText = `Mode: ${this.mode}`;
      this.tui.requestRender?.();
      return;
    }
    if (data === "\x01") { // Ctrl+A: all
      this.mode = this.mode === "all" ? "default" : "all";
      this.feedbackText = `Mode: ${this.mode}`;
      this.tui.requestRender?.();
      return;
    }
    if (data === "\x0f") { // Ctrl+O: cycle mode
      const modes: TreeFilterMode[] = ["default", "no-tools", "user-only", "labeled-only", "all"];
      const nextIdx = (modes.indexOf(this.mode) + 1) % modes.length;
      this.mode = modes[nextIdx];
      this.feedbackText = `Mode: ${this.mode}`;
      this.tui.requestRender?.();
      return;
    }

    // 'L' (Shift+L) opens label input
    if (data === "L") {
      const nodes = this.getDisplayNodes();
      const sel = nodes[this.treeCursor];
      if (sel) {
        this.isLabeling = true;
        this.labelInputBuffer = sel.node.label || "";
        this.tui.requestRender?.();
      }
      return;
    }

    // 'T' (Shift+T) toggles timestamps
    if (data === "T") {
      this.showTimestamps = !this.showTimestamps;
      this.feedbackText = `Timestamps: ${this.showTimestamps ? "on" : "off"}`;
      this.tui.requestRender?.();
      return;
    }

    // 'f': toggle fold or fork
    if (data === "f") {
      const nodes = this.getDisplayNodes();
      const sel = nodes[this.treeCursor];
      if (sel) {
        if (this.foldedIds.has(sel.node.id)) {
          this.foldedIds.delete(sel.node.id);
          this.feedbackText = `Unfolded: ${sel.node.id}`;
        } else {
          this.foldedIds.add(sel.node.id);
          this.feedbackText = `Folded: ${sel.node.id}`;
        }
        this.tui.requestRender?.();
      }
      return;
    }

    // 's': branch summary choices
    if (data === "s") {
      if (this.options.onBranchSummary) {
        this.options.onBranchSummary("summarize");
        this.feedbackText = "Triggered branch summary";
        this.tui.requestRender?.();
      }
      return;
    }

    if (matchesKey(data, Key.up) || data === "\x1b[A" || data === "k") {
      const nodes = this.getDisplayNodes();
      if (nodes.length > 0) {
        this.treeCursor = (this.treeCursor - 1 + nodes.length) % nodes.length;
      }
      this.tui.requestRender?.();
      return;
    }

    if (matchesKey(data, Key.down) || data === "\x1b[B" || data === "j") {
      const nodes = this.getDisplayNodes();
      if (nodes.length > 0) {
        this.treeCursor = (this.treeCursor + 1) % nodes.length;
      }
      this.tui.requestRender?.();
      return;
    }

    if (matchesKey(data, Key.enter) || data === "\r" || data === "\n") {
      const nodes = this.getDisplayNodes();
      const sel = nodes[this.treeCursor];
      if (sel) {
        this.options.onJumpToNode(sel.node.id);
        this.close(sel.node);
      }
      return;
    }

    // Copy node info: 'c' or 'y' or Ctrl+X
    if (data === "c" || data === "y" || data === "\x18") {
      const nodes = this.getDisplayNodes();
      const sel = nodes[this.treeCursor];
      if (sel) {
        const text = `${sel.node.id} [${sel.node.role || "turn"}] ${sel.node.label || sel.node.summary || ""}`;
        copyToClipboard(text).then((res) => {
          this.feedbackText = res.message;
          this.tui.requestRender?.();
        });
      }
      return;
    }

    if (matchesKey(data, Key.backspace) || data === "\x7f" || data === "\b") {
      if (this.query.length > 0) {
        this.query = this.query.slice(0, -1);
        this.treeCursor = 0;
        this.tui.requestRender?.();
      }
      return;
    }

    if (data.length === 1 && data >= " " && data <= "~" && data !== "f" && data !== "s" && data !== "c" && data !== "y") {
      this.query += data;
      this.treeCursor = 0;
      this.tui.requestRender?.();
      return;
    }
  }

  render(width: number): string[] {
    const safeWidth = Math.max(20, width);
    const boxW = Math.min(Math.max(safeWidth - 4, 20), 100);

    const titleStr = boldSafe(this.theme, fgSafe(this.theme, "accent", `Session Tree [Mode: ${this.mode}]`));
    const filterDisplay = this.isLabeling
      ? boldSafe(this.theme, fgSafe(this.theme, "warning", `Label: ${this.labelInputBuffer}▌`))
      : dimSafe(this.theme, `filter: ${this.query}▌`);
    this.headerText.setText(truncateToWidth(`${titleStr}  ${filterDisplay}`, boxW, ""));

    const win = 12;
    const nodes = this.getDisplayNodes();
    const { start, end, hasAbove, hasBelow } = fixedWin(this.treeCursor, nodes.length, win);

    const lines: string[] = [];
    if (nodes.length === 0) {
      lines.push(dimSafe(this.theme, "  — no tree nodes match filter/mode —"));
      while (lines.length < win) lines.push(" ".repeat(boxW));
    } else {
      if (hasAbove) lines.push(dimSafe(this.theme, shorten(`…(+${start} above)`, boxW)));
      for (let i = start; i < end; i++) {
        const fn = nodes[i];
        const isSel = i === this.treeCursor;
        const prefix = isSel ? fgSafe(this.theme, "accent", "▸ ") : "  ";
        const isFolded = this.foldedIds.has(fn.node.id) ? " [+] " : " ";
        const isCurrent = fn.node.isCurrent || fn.node.id === this.options.currentNodeId ? " * " : " ";
        const labelPart = fn.node.label ? `[${fn.node.label}] ` : "";
        const timePart = this.showTimestamps && fn.node.timestamp ? ` (${fn.node.timestamp})` : "";
        const summary = fn.node.summary || fn.node.role || "entry";

        const text = `${fn.connector}${isFolded}${isCurrent}${labelPart}${summary}${timePart}`;
        const styled = isSel
          ? boldSafe(this.theme, fgSafe(this.theme, "accent", fit(text, boxW - 2)))
          : fit(text, boxW - 2);
        lines.push(truncateToWidth(`${prefix}${styled}`, boxW, ""));
      }
      if (hasBelow) lines.push(dimSafe(this.theme, shorten(`…(+${nodes.length - end} below)`, boxW)));
      while (lines.length < win) lines.push(" ".repeat(boxW));
    }
    this.bodyText.setText(lines.join("\n"));

    const hints = this.isLabeling
      ? "Enter: save label · Esc: cancel"
      : "↑↓ move · Enter jump · 'f' fold · 'L' label · 'T' time · Ctrl+O mode · 'c' copy · Esc close";
    this.footerText.setText(
      truncateToWidth(
        this.feedbackText
          ? boldSafe(this.theme, fgSafe(this.theme, "success", this.feedbackText))
          : dimSafe(this.theme, hints),
        boxW,
        "",
      ),
    );

    return super.render(safeWidth);
  }
}

export function createOmtTreeComponent(
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  options: OmtTreeDialogOptions,
): Component {
  return new OmtTreeComponent(tui, theme, keybindings, done, ctx, options);
}

// =============================================================================
// 7. OMT Trajectory / Trace Steps & Live Snapshot Component
// =============================================================================

export class OmtTrajectoryComponent extends Container implements Component, Focusable {
  focused = true;
  readonly capturesViewportInput = true;

  private tui: TUI;
  private theme: Theme;
  private keybindings?: KeybindingsManager;
  private done: (value?: unknown) => void;
  private ctx: ExtensionContext;
  private options: TrajectoryDialogOptions;

  private steps: TraceStep[];
  private stepCursor: number = 0;
  private detailScrollOffset: number = 0;
  private query: string = "";
  private feedbackText: string = "";
  private closed: boolean = false;

  private topBorder: DynamicBorder;
  private headerText: Text;
  private midBorder: DynamicBorder;
  private bodyText: Text;
  private footerText: Text;
  private botBorder: DynamicBorder;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (value?: unknown) => void,
    ctx: ExtensionContext,
    options: TrajectoryDialogOptions,
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done;
    this.ctx = ctx;
    this.options = options;
    this.steps = options.steps || [];

    const borderStyle = getBorderStyler(theme);
    this.topBorder = new DynamicBorder(borderStyle);
    this.headerText = new Text("", 0, 0);
    this.midBorder = new DynamicBorder(borderStyle);
    this.bodyText = new Text("", 0, 0);
    this.footerText = new Text("", 0, 0);
    this.botBorder = new DynamicBorder(borderStyle);

    this.addChild(this.topBorder);
    this.addChild(this.headerText);
    this.addChild(this.midBorder);
    this.addChild(this.bodyText);
    this.addChild(this.footerText);
    this.addChild(this.botBorder);
  }

  /**
   * Update steps snapshot live while preserving stable selection identity!
   */
  updateSteps(newSteps: TraceStep[]): void {
    const curSelId = this.getSelectedStep()?.id;
    this.steps = newSteps;
    const { cursor } = resolveStableCursor(curSelId, this.steps, this.query);
    this.stepCursor = cursor;
    this.tui.requestRender?.();
  }

  private getFilteredSteps(): TraceStep[] {
    return filterItems(this.steps, this.query, (s) => [s.title, s.detail, s.kind, s.toolName]);
  }

  getSelectedStep(): TraceStep | undefined {
    const filtered = this.getFilteredSteps();
    return filtered[this.stepCursor];
  }

  private close(result?: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.done(result);
  }

  handleInput(data: string): void {
    if (this.closed) return;

    if (matchesKey(data, Key.escape) || matchesKey(data, Key.esc) || data === "\x1b") {
      if (this.query.length > 0) {
        this.query = "";
        this.stepCursor = 0;
        this.tui.requestRender?.();
        return;
      }
      this.close();
      return;
    }

    if (matchesKey(data, Key.up) || data === "\x1b[A" || data === "k") {
      const items = this.getFilteredSteps();
      if (items.length > 0) {
        this.stepCursor = (this.stepCursor - 1 + items.length) % items.length;
        this.detailScrollOffset = 0; // reset scroll on step change
      }
      this.tui.requestRender?.();
      return;
    }

    if (matchesKey(data, Key.down) || data === "\x1b[B" || data === "j") {
      const items = this.getFilteredSteps();
      if (items.length > 0) {
        this.stepCursor = (this.stepCursor + 1) % items.length;
        this.detailScrollOffset = 0;
      }
      this.tui.requestRender?.();
      return;
    }

    // Detail scroll: PageUp / PageDown / '[' / ']'
    if (matchesKey(data, Key.pageUp) || data === "\x1b[5~" || data === "[") {
      this.detailScrollOffset = Math.max(0, this.detailScrollOffset - 5);
      this.tui.requestRender?.();
      return;
    }

    if (matchesKey(data, Key.pageDown) || data === "\x1b[6~" || data === "]") {
      this.detailScrollOffset += 5;
      this.tui.requestRender?.();
      return;
    }

    // Semantic copy of step detail: Ctrl+Y, Ctrl+C, 'c', 'y'
    if (data === "\x19" || data === "\x03" || data === "c" || data === "y") {
      const sel = this.getSelectedStep();
      if (sel) {
        this.options.onCopyStep?.(sel);
        this.feedbackText = `✓ copied ${sel.detail.length} chars to clipboard`;
        copyToClipboard(sel.detail).then((res) => {
          this.feedbackText = res.message;
          this.tui.requestRender?.();
        });
        this.tui.requestRender?.();
      }
      return;
    }

    if (matchesKey(data, Key.enter) || data === "\r" || data === "\n") {
      const sel = this.getSelectedStep();
      if (sel) {
        this.options.onSelectStep?.(sel);
      }
      return;
    }

    if (matchesKey(data, Key.backspace) || data === "\x7f" || data === "\b") {
      if (this.query.length > 0) {
        this.query = this.query.slice(0, -1);
        this.stepCursor = 0;
        this.tui.requestRender?.();
      }
      return;
    }

    if (data.length === 1 && data >= " " && data <= "~" && data !== "c" && data !== "y" && data !== "[" && data !== "]") {
      this.query += data;
      this.stepCursor = 0;
      this.tui.requestRender?.();
      return;
    }
  }

  render(width: number): string[] {
    const safeWidth = Math.max(20, width);
    const boxW = Math.min(Math.max(safeWidth - 4, 20), 120);

    const titleStr = boldSafe(this.theme, fgSafe(this.theme, "accent", "Execution Trajectory"));
    const filterDisplay = dimSafe(this.theme, `filter: ${this.query}▌`);
    this.headerText.setText(truncateToWidth(`${titleStr}  ${filterDisplay}`, boxW, ""));

    const leftW = Math.max(14, Math.floor(boxW * 0.35));
    const rightW = Math.max(12, boxW - leftW - 3);
    const win = 12;

    const items = this.getFilteredSteps();
    const { start, end, hasAbove, hasBelow } = fixedWin(this.stepCursor, items.length, win);

    // Left column: Steps
    const leftLines: string[] = [];
    if (items.length === 0) {
      leftLines.push(dimSafe(this.theme, "  — no steps —"));
      while (leftLines.length < win) leftLines.push(" ".repeat(leftW));
    } else {
      if (hasAbove) leftLines.push(dimSafe(this.theme, shorten(`…(+${start} above)`, leftW)));
      for (let i = start; i < end; i++) {
        const s = items[i];
        const isSel = i === this.stepCursor;
        const prefix = isSel ? fgSafe(this.theme, "accent", "▸ ") : "  ";
        const kindBadge = s.kind === "error" ? "[ERR]" : `[${s.kind}]`;
        const rowText = `${kindBadge} ${s.title}`;
        const styled = isSel
          ? boldSafe(this.theme, fgSafe(this.theme, "accent", fit(rowText, leftW - 2)))
          : fit(rowText, leftW - 2);
        leftLines.push(truncateToWidth(`${prefix}${styled}`, leftW, ""));
      }
      if (hasBelow) leftLines.push(dimSafe(this.theme, shorten(`…(+${items.length - end} below)`, leftW)));
      while (leftLines.length < win) leftLines.push(" ".repeat(leftW));
    }

    // Right column: Step Detail with Diff Coloring
    const sel = this.getSelectedStep();
    const rightLines: string[] = [];
    if (!sel) {
      rightLines.push(dimSafe(this.theme, "  — no step selected —"));
    } else {
      const allDetailLines = sel.detail.split(/\r?\n/);
      const scrolledLines = allDetailLines.slice(this.detailScrollOffset, this.detailScrollOffset + win);

      for (const line of scrolledLines) {
        const kind = classifyDiffLine(line);
        let styled = line;
        if (kind === "add") {
          styled = fgSafe(this.theme, "success", line);
        } else if (kind === "delete") {
          styled = fgSafe(this.theme, "error", line);
        } else if (kind === "hunk" || kind === "header") {
          styled = boldSafe(this.theme, fgSafe(this.theme, "accent", line));
        } else {
          styled = dimSafe(this.theme, line);
        }
        rightLines.push(truncateToWidth(styled, rightW, ""));
      }
    }
    while (rightLines.length < win) rightLines.push(" ".repeat(rightW));

    const combined: string[] = [];
    for (let r = 0; r < win; r++) {
      const l = leftLines[r] ?? " ".repeat(leftW);
      const rg = rightLines[r] ?? " ".repeat(rightW);
      const sep = dimSafe(this.theme, "│");
      combined.push(truncateToWidth(`${l} ${sep} ${rg}`, boxW, ""));
    }
    this.bodyText.setText(combined.join("\n"));

    const hints = "↑↓ select step · PgUp/PgDn scroll detail · 'c'/'y' copy detail · Esc close";
    this.footerText.setText(
      truncateToWidth(
        this.feedbackText
          ? boldSafe(this.theme, fgSafe(this.theme, "success", this.feedbackText))
          : dimSafe(this.theme, hints),
        boxW,
        "",
      ),
    );

    return super.render(safeWidth);
  }
}

export function createOmtTrajectoryComponent(
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  options: TrajectoryDialogOptions,
): Component {
  return new OmtTrajectoryComponent(tui, theme, keybindings, done, ctx, options);
}

// =============================================================================
// 8. OMT Notification History Component
// =============================================================================

export class OmtNotificationHistoryComponent extends Container implements Component, Focusable {
  focused = true;
  readonly capturesViewportInput = true;

  private tui: TUI;
  private theme: Theme;
  private keybindings?: KeybindingsManager;
  private done: (value?: unknown) => void;
  private ctx: ExtensionContext;
  private options: OmtNotificationOptions;

  private notifCursor: number = 0;
  private query: string = "";
  private feedbackText: string = "";
  private closed: boolean = false;

  private topBorder: DynamicBorder;
  private headerText: Text;
  private midBorder: DynamicBorder;
  private bodyText: Text;
  private footerText: Text;
  private botBorder: DynamicBorder;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (value?: unknown) => void,
    ctx: ExtensionContext,
    options: OmtNotificationOptions,
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done;
    this.ctx = ctx;
    this.options = options;

    const borderStyle = getBorderStyler(theme);
    this.topBorder = new DynamicBorder(borderStyle);
    this.headerText = new Text("", 0, 0);
    this.midBorder = new DynamicBorder(borderStyle);
    this.bodyText = new Text("", 0, 0);
    this.footerText = new Text("", 0, 0);
    this.botBorder = new DynamicBorder(borderStyle);

    this.addChild(this.topBorder);
    this.addChild(this.headerText);
    this.addChild(this.midBorder);
    this.addChild(this.bodyText);
    this.addChild(this.footerText);
    this.addChild(this.botBorder);
  }

  private getFilteredItems(): OmtNotificationItem[] {
    return filterItems(this.options.items, this.query, (n) => [n.text, n.level]);
  }

  private close(result?: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.done(result);
  }

  handleInput(data: string): void {
    if (this.closed) return;

    if (matchesKey(data, Key.escape) || matchesKey(data, Key.esc) || data === "\x1b") {
      if (this.query.length > 0) {
        this.query = "";
        this.notifCursor = 0;
        this.tui.requestRender?.();
        return;
      }
      this.close();
      return;
    }

    if (matchesKey(data, Key.up) || data === "\x1b[A" || data === "k") {
      const items = this.getFilteredItems();
      if (items.length > 0) {
        this.notifCursor = (this.notifCursor - 1 + items.length) % items.length;
      }
      this.tui.requestRender?.();
      return;
    }

    if (matchesKey(data, Key.down) || data === "\x1b[B" || data === "j") {
      const items = this.getFilteredItems();
      if (items.length > 0) {
        this.notifCursor = (this.notifCursor + 1) % items.length;
      }
      this.tui.requestRender?.();
      return;
    }

    // Semantic copy of notification: 'c' or 'y' or Ctrl+Y
    if (data === "c" || data === "y" || data === "\x19") {
      const items = this.getFilteredItems();
      const sel = items[this.notifCursor];
      if (sel) {
        this.options.onCopyNotification?.(sel);
        this.feedbackText = `✓ copied ${sel.text.length} chars to clipboard`;
        copyToClipboard(sel.text).then((res) => {
          this.feedbackText = res.message;
          this.tui.requestRender?.();
        });
        this.tui.requestRender?.();
      }
      return;
    }

    // Clear all: 'x' or 'X'
    if (data === "x" || data === "X") {
      this.options.onClear?.();
      this.feedbackText = "Cleared notification history";
      this.tui.requestRender?.();
      return;
    }

    if (matchesKey(data, Key.backspace) || data === "\x7f" || data === "\b") {
      if (this.query.length > 0) {
        this.query = this.query.slice(0, -1);
        this.notifCursor = 0;
        this.tui.requestRender?.();
      }
      return;
    }

    if (data.length === 1 && data >= " " && data <= "~" && data !== "c" && data !== "y" && data !== "x") {
      this.query += data;
      this.notifCursor = 0;
      this.tui.requestRender?.();
      return;
    }
  }

  render(width: number): string[] {
    const safeWidth = Math.max(20, width);
    const boxW = Math.min(Math.max(safeWidth - 4, 20), 100);

    const titleStr = boldSafe(this.theme, fgSafe(this.theme, "accent", "Notification History"));
    const filterDisplay = dimSafe(this.theme, `filter: ${this.query}▌`);
    this.headerText.setText(truncateToWidth(`${titleStr}  ${filterDisplay}`, boxW, ""));

    const win = 10;
    const items = this.getFilteredItems();
    const { start, end, hasAbove, hasBelow } = fixedWin(this.notifCursor, items.length, win);

    const lines: string[] = [];
    if (items.length === 0) {
      lines.push(dimSafe(this.theme, "  — no notifications in history —"));
      while (lines.length < win) lines.push(" ".repeat(boxW));
    } else {
      if (hasAbove) lines.push(dimSafe(this.theme, shorten(`…(+${start} above)`, boxW)));
      for (let i = start; i < end; i++) {
        const n = items[i];
        const isSel = i === this.notifCursor;
        const prefix = isSel ? fgSafe(this.theme, "accent", "▸ ") : "  ";
        const lvl = n.level === "error" ? "[ERR ]" : n.level === "warning" ? "[WARN]" : "[INFO]";
        const text = `${formatAgo(n.timestamp)} · ${lvl} ${n.text}`;
        const styled = isSel
          ? boldSafe(this.theme, fgSafe(this.theme, "accent", fit(text, boxW - 2)))
          : fit(text, boxW - 2);
        lines.push(truncateToWidth(`${prefix}${styled}`, boxW, ""));
      }
      if (hasBelow) lines.push(dimSafe(this.theme, shorten(`…(+${items.length - end} below)`, boxW)));
      while (lines.length < win) lines.push(" ".repeat(boxW));
    }
    this.bodyText.setText(lines.join("\n"));

    const hints = "↑↓ select · 'c'/'y' copy · 'x' clear · Esc close";
    this.footerText.setText(
      truncateToWidth(
        this.feedbackText
          ? boldSafe(this.theme, fgSafe(this.theme, "success", this.feedbackText))
          : dimSafe(this.theme, hints),
        boxW,
        "",
      ),
    );

    return super.render(safeWidth);
  }
}

export function createOmtNotificationHistoryComponent(
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  options: OmtNotificationOptions,
): Component {
  return new OmtNotificationHistoryComponent(tui, theme, keybindings, done, ctx, options);
}

// =============================================================================
// 9. OMT Block Actions (Semantic Copy Menu) Component
// =============================================================================

export class OmtBlockActionsComponent extends Container implements Component, Focusable {
  focused = true;
  readonly capturesViewportInput = true;

  private tui: TUI;
  private theme: Theme;
  private keybindings?: KeybindingsManager;
  private done: (value?: unknown) => void;
  private ctx: ExtensionContext;
  private options: BlockActionsDialogOptions;

  private actions: BlockActionOption[];
  private cursor: number = 0;
  private feedbackText: string = "";
  private closed: boolean = false;

  private topBorder: DynamicBorder;
  private headerText: Text;
  private midBorder: DynamicBorder;
  private bodyText: Text;
  private footerText: Text;
  private botBorder: DynamicBorder;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (value?: unknown) => void,
    ctx: ExtensionContext,
    options: BlockActionsDialogOptions,
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done;
    this.ctx = ctx;
    this.options = options;
    this.actions = buildBlockOptions(options.content);

    const borderStyle = getBorderStyler(theme);
    this.topBorder = new DynamicBorder(borderStyle);
    this.headerText = new Text("", 0, 0);
    this.midBorder = new DynamicBorder(borderStyle);
    this.bodyText = new Text("", 0, 0);
    this.footerText = new Text("", 0, 0);
    this.botBorder = new DynamicBorder(borderStyle);

    this.addChild(this.topBorder);
    this.addChild(this.headerText);
    this.addChild(this.midBorder);
    this.addChild(this.bodyText);
    this.addChild(this.footerText);
    this.addChild(this.botBorder);
  }

  private close(result?: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.done(result);
  }

  handleInput(data: string): void {
    if (this.closed) return;

    if (matchesKey(data, Key.escape) || matchesKey(data, Key.esc) || data === "\x1b") {
      this.close();
      return;
    }

    if (matchesKey(data, Key.up) || data === "\x1b[A" || data === "k") {
      if (this.actions.length > 0) {
        this.cursor = (this.cursor - 1 + this.actions.length) % this.actions.length;
      }
      this.tui.requestRender?.();
      return;
    }

    if (matchesKey(data, Key.down) || data === "\x1b[B" || data === "j") {
      if (this.actions.length > 0) {
        this.cursor = (this.cursor + 1) % this.actions.length;
      }
      this.tui.requestRender?.();
      return;
    }

    if (matchesKey(data, Key.enter) || data === "\r" || data === "\n") {
      const act = this.actions[this.cursor];
      if (act) {
        this.options.onExecuteAction(act.kind, act.content);
        copyToClipboard(act.content).then((res) => {
          this.close({ action: act.kind, result: res });
        });
        this.close({ action: act.kind });
      }
      return;
    }
  }

  render(width: number): string[] {
    const safeWidth = Math.max(20, width);
    const boxW = Math.min(Math.max(safeWidth - 4, 20), 60);

    const titleStr = boldSafe(this.theme, fgSafe(this.theme, "accent", "Message Copy Actions"));
    this.headerText.setText(truncateToWidth(titleStr, boxW, ""));

    const lines: string[] = [];
    if (this.actions.length === 0) {
      lines.push(dimSafe(this.theme, "  — nothing copyable in message —"));
    } else {
      for (let i = 0; i < this.actions.length; i++) {
        const act = this.actions[i];
        const isSel = i === this.cursor;
        const prefix = isSel ? fgSafe(this.theme, "accent", "▸ ") : "  ";
        const styled = isSel
          ? boldSafe(this.theme, fgSafe(this.theme, "accent", fit(act.label, boxW - 2)))
          : fit(act.label, boxW - 2);
        lines.push(truncateToWidth(`${prefix}${styled}`, boxW, ""));
      }
    }
    this.bodyText.setText(lines.join("\n"));

    const hints = "↑↓ select · Enter copy · Esc close";
    this.footerText.setText(truncateToWidth(dimSafe(this.theme, hints), boxW, ""));

    return super.render(safeWidth);
  }
}

export function createOmtBlockActionsComponent(
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  options: BlockActionsDialogOptions,
): Component {
  return new OmtBlockActionsComponent(tui, theme, keybindings, done, ctx, options);
}









