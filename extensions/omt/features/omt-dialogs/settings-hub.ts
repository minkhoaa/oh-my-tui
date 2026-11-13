/**
 * OMT Settings Hub Component (/omt-setting)
 *
 * Features:
 * - 14 Hub sections: agent, command, shortcut, skill, prompt, extension, plugin, market, mcp, tool, tasks, side, theme, login
 * - Exact layout: Left pane (sections list, 24-30 cols), Middle/Right pane (items list), 3rd DETAILS pane for Plugins/Marketplace when wide
 * - Dynamic scroll window win in [12, 24] clamped from terminalHeight - 14 (eliminates vertical jitter)
 * - Dynamic box width in [70, 150] from viewportWidth - 10
 * - Theme section: 2 columns (palettes left, surfaces right) backed by 25 palettes & 32 background surfaces from palette catalogue
 * - Live-preview callbacks on cursor motion; explicit confirmation on Enter; cancel restores prior state
 * - Shortcut capture prompt (Ctrl+S) and suggested plugin prompt (Ctrl+F) inside hub dialog
 * - Rounded Unicode outer borders (╭─╮ ╰─╯), padding (1, 3) geometry matching theme roles
 */

import { Container, visibleWidth, truncateToWidth, matchesKey, Key, type Component, type Focusable, type KeybindingsManager, type TUI } from "@earendil-works/pi-tui";
import type {
  ExtensionContext,
  Theme,
  ThemeColor,
} from "@earendil-works/pi-coding-agent";
import { getBorderStyler } from "../../presets/shared/style.ts";
import { accessibilityStore } from "../../features/accessibility/model.ts";
import { PSEC_IDS, type PsecId, type PsecRowItem, type SettingsHubOptions } from "./types.ts";
import { filterItems, fit, fixedWin, formatDuration, SETTINGS_HUB_SECTIONS, shorten } from "./model.ts";
import { getPaletteNames, getBackgroundNames, getRawPalette, getBackgroundHex } from "../../presets/omt-signature/palette.ts";
import { dialogSwatch, selectedDialogRow } from "./presentation.ts";

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

function wrapWords(text: string, maxWidth: number): string[] {
  if (maxWidth <= 0) return [];
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur) {
      cur = w;
    } else if (visibleWidth(cur) + 1 + visibleWidth(w) <= maxWidth) {
      cur += " " + w;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// -----------------------------------------------------------------------------
// Curated OMT Plugins & Palette/Surface Catalogues
// -----------------------------------------------------------------------------

interface PluginSuggestion {
  name: string;
  why: string;
}

const CURATED_PLUGINS: PluginSuggestion[] = [
  { name: "pi-subagents", why: "delegate work to background teams" },
  { name: "pi-ask-user", why: "handshake before risky decisions" },
  { name: "@dietrichgebert/ponytail", why: "lazy-senior mode: less code, fewer deps" },
];

const PSEC_PROVS: Record<PsecId, string> = {
  agent: "Agent",
  command: "Commands",
  shortcut: "Shortcuts",
  skill: "Skills",
  prompt: "Prompts",
  extension: "Extensions",
  plugin: "Plugins",
  market: "Marketplace",
  mcp: "MCP",
  tool: "Tools",
  tasks: "Tasks",
  side: "Sidebar",
  theme: "Theme",
  login: "Login",
};

export interface ExtendedSettingsHubOptions extends SettingsHubOptions {
  viewportWidth?: number;
  viewportHeight?: number;
  onPreviewTheme?: (themeName: string) => boolean | void | Promise<boolean | void>;
  onSelectTheme?: (themeName: string) => boolean | void | Promise<boolean | void>;
  onPreviewBackground?: (bgName: string) => boolean | void | Promise<boolean | void>;
  onSelectBackground?: (bgName: string) => boolean | void | Promise<boolean | void>;
  onCancelTheme?: (initialTheme?: string, initialBackground?: string) => void;
  onInstallPackage?: (spec: string) => Promise<boolean | void> | boolean | void;
  onUninstallPackage?: (spec: string) => Promise<boolean | void> | boolean | void;
  onCycleTasksTab?: () => void;
  onToggleSidebarSection?: (section: string) => void;
}

// -----------------------------------------------------------------------------
// Settings Hub Component
// -----------------------------------------------------------------------------

export class OmtSettingsHubComponent extends Container implements Component, Focusable {
  focused = true;
  readonly capturesViewportInput = true;

  private tui: TUI;
  private theme: Theme;
  private keybindings?: KeybindingsManager;
  private done: (value?: unknown) => void;
  private ctx: ExtensionContext;
  private options: ExtendedSettingsHubOptions;

  private sections: PsecId[] = [...PSEC_IDS];
  private sectionCursor: number = 0;
  private itemCursor: number = 0;
  private themeCursor: number = 0;
  private bgCursor: number = 0;
  private isRightPaneFocused: boolean = false;
  private isBgColumnFocused: boolean = false; // in Theme section: palettes vs backgrounds
  private query: string = "";
  private feedbackText: string = "";
  private closed: boolean = false;

  // Theme preview tracking & rollback state
  private initialTheme: string;
  private initialBg: string;
  private currentTheme: string;
  private currentBg: string;
  private feedbackGeneration: number = 0;

  // Inline modal prompts (shortcut assignment & plugin suggestion)
  private isShortcutPromptOpen: boolean = false;
  private shortcutTargetCommand: string = "";
  private isSuggestPromptOpen: boolean = false;
  private suggestQuery: string = "";
  private customSuggestedPlugins: string[] = [];

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (value?: unknown) => void,
    ctx: ExtensionContext,
    options: ExtendedSettingsHubOptions = {},
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done;
    this.ctx = ctx;
    this.options = options;

    this.initialTheme = options.currentTheme || "omt-signature";
    this.initialBg = options.currentBackground || "transparent";
    this.currentTheme = this.initialTheme;
    this.currentBg = this.initialBg;

    if (options.initialSection) {
      const idx = this.sections.indexOf(options.initialSection);
      if (idx >= 0) {
        this.sectionCursor = idx;
        if (
          options.initialSection === "shortcut" ||
          options.initialSection === "tasks" ||
          options.initialSection === "theme"
        ) {
          this.isRightPaneFocused = true;
        }
      }
    }
    this.focusCurrentTheme();
  }

  private focusCurrentTheme(): void {
    const { palItems, bgItems } = this.getThemeCols();
    const palIdx = palItems.findIndex(
      (p) => p.payload === `theme:${this.currentTheme}` || p.label === this.currentTheme,
    );
    if (palIdx >= 0) {
      this.themeCursor = palIdx;
    }
    const bgIdx = bgItems.findIndex(
      (b) => b.payload === `bg:${this.currentBg}` || b.label === this.currentBg,
    );
    if (bgIdx >= 0) {
      this.bgCursor = bgIdx;
    }
  }

  getCurrentSection(): PsecId {
    return this.sections[this.sectionCursor] ?? "agent";
  }

  getQuery(): string {
    return this.query;
  }

  getCurrentTheme(): string {
    return this.currentTheme;
  }

  getCurrentBackground(): string {
    return this.currentBg;
  }

  getThemeCursor(): number {
    return this.themeCursor;
  }

  getBgCursor(): number {
    return this.bgCursor;
  }

  setSection(sec: PsecId): void {
    const idx = this.sections.indexOf(sec);
    if (idx >= 0) {
      this.sectionCursor = idx;
      this.itemCursor = 0;
      this.isRightPaneFocused = false;
      this.isBgColumnFocused = false;
      this.query = "";
      if (sec === "theme") {
        this.focusCurrentTheme();
      }
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

  // ---------------------------------------------------------------------------
  // Left-Pane Section Badge Counts
  // ---------------------------------------------------------------------------

  private getSectionCount(sec: PsecId): number {
    if (this.options.unavailableSections?.[sec]) return -2;
    switch (sec) {
      case "command":
        return this.options.commands?.length ?? 0;
      case "shortcut":
        return this.options.shortcuts?.length ?? 0;
      case "skill":
        return this.options.skills?.length ?? 0;
      case "prompt":
        return this.options.prompts?.length ?? 0;
      case "extension":
        return this.options.extensions?.length ?? 0;
      case "plugin":
        return this.options.plugins?.length ?? 0;
      case "market":
        if (this.options.marketLoading) return -1;
        return this.options.marketplace?.length ?? 0;
      case "mcp":
        return this.options.mcpServers?.length ?? 0;
      case "tool":
        return this.options.toolStats?.length ?? 0;
      default:
        return -1;
    }
  }

  // ---------------------------------------------------------------------------
  // Right-Pane Items Builder
  // ---------------------------------------------------------------------------

  private getSectionItems(sec: PsecId): PsecRowItem[] {
    const unavailable = this.options.unavailableSections?.[sec];
    if (unavailable) return [{ label: "— unavailable —", desc: unavailable, disabled: true }];
    if (this.options.sections?.[sec]) {
      return this.options.sections[sec]!;
    }

    switch (sec) {
      case "agent":
        return [
          {
            label: "Open agent settings →",
            desc: "model · thinking · steering · images · skills · … (pi parity)",
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
        if (cmds.length === 0) {
          return [{ label: "— no commands —", desc: "the command registry is empty", disabled: true }];
        }
        return cmds.map((c) => ({
          label: `/${c.name}`,
          desc: `${shorten(c.description, 42)} [${c.tag || "cmd"}]`,
          payload: c.name,
        }));
      }

      case "shortcut": {
        const shortcuts = this.options.shortcuts || [
          { key: "Ctrl+P", description: "Open command palette", category: "navigation", command: "omt palette" },
          { key: "Ctrl+B", description: "Toggle sidebar visibility", category: "view", command: "omt sidebar" },
          { key: "Ctrl+N", description: "Create new session turn", category: "session", command: "new" },
          { key: "Ctrl+K", description: "Open interactive model picker", category: "model", command: "model" },
          { key: "Alt+1..9", description: "Switch multi-view tab", category: "tabs", command: "tab" },
          { key: "Esc", description: "Close dialog or dismiss palette", category: "global", command: "escape" },
        ];
        if (shortcuts.length === 0) {
          return [{ label: "— no shortcuts —", desc: "the shortcut table is empty", disabled: true }];
        }
        return shortcuts.map((s) => ({
          label: s.key,
          desc: `${shorten(s.description, 40)} [${s.category || "key"}]`,
          payload: s.command || s.key,
        }));
      }

      case "skill": {
        const skills = this.options.skills || [];
        if (skills.length === 0) {
          return [{ label: "— no skills —", desc: "/reload refreshes the catalog", disabled: true }];
        }
        return skills.map((s) => ({
          label: `/${s.name}`,
          desc: shorten(s.description, 48),
          payload: s.name,
        }));
      }

      case "prompt": {
        const prompts = this.options.prompts || [];
        if (prompts.length === 0) {
          return [{ label: "— no prompts —", desc: "/reload refreshes the catalog", disabled: true }];
        }
        return prompts.map((p) => ({
          label: `/${p.name}`,
          desc: shorten(p.description, 48),
          payload: p.name,
        }));
      }

      case "extension": {
        const exts = this.options.extensions || [
          { name: "oh-my-tui", description: "Modular presentation enhancements for Pi", tag: "omt" },
        ];
        if (exts.length === 0) {
          return [{ label: "— no extensions —", desc: "/reload refreshes the catalog", disabled: true }];
        }
        return exts.map((e) => ({
          label: `/${e.name}`,
          desc: `${shorten(e.description, 40)} [${e.tag || "ext"}]`,
          payload: e.name,
        }));
      }

      case "plugin": {
        const installed = this.options.plugins || [
          { name: "pi-lens", spec: "npm:pi-lens", description: "Visual workspace inspection", suggested: true },
        ];
        const installedNames = new Set(installed.map((p) => p.name));

        const rows: PsecRowItem[] = [];

        // 1. Installed plugins
        for (const p of installed) {
          const isSug = p.suggested || CURATED_PLUGINS.some((c) => c.name === p.name);
          rows.push({
            label: `${isSug ? "★ " : ""}${p.name}`,
            desc: `${p.busy ? "working · " : ""}${isSug ? "suggested · " : ""}${shorten(p.description || p.spec, 40)}`,
            payload: `plugin:${p.spec}`,
            installed: true,
            suggested: isSug,
          });
        }

        // 2. Curated suggestions (not installed)
        for (const s of CURATED_PLUGINS) {
          if (!installedNames.has(s.name)) {
            rows.push({
              label: `★ ${s.name}`,
              desc: `suggested · ${s.why} · Enter installs`,
              payload: `market:${s.name}`,
              suggested: true,
              installed: false,
            });
          }
        }

        // 3. User custom suggestions
        for (const c of this.customSuggestedPlugins) {
          if (!installedNames.has(c) && !CURATED_PLUGINS.some((s) => s.name === c)) {
            rows.push({
              label: `★ ${c}`,
              desc: "your pick · Enter installs",
              payload: `market:${c}`,
              suggested: true,
              installed: false,
            });
          }
        }

        return rows;
      }

      case "market": {
        if (this.options.marketLoading) {
          return [{ label: "— loading plugins… —", desc: "npm is searching; rows appear as soon as it lands", disabled: true }];
        }
        if (this.options.marketError) {
          return [{ label: "— market unavailable —", desc: shorten(this.options.marketError, 60), disabled: true }];
        }
        const market = this.options.marketplace || [
          { name: "oh-my-tui", version: "0.1.0", desc: "Modular terminal UI presentation layer", stars: 120, installed: true },
          { name: "pi-lens", version: "1.2.0", desc: "Interactive workspace file tree and diff viewer", stars: 45, installed: false },
        ];
        if (market.length === 0) {
          return [{ label: "— empty market —", desc: "no pi packages match — Esc clears the search", disabled: true }];
        }
        return market.map((m) => {
          const stars = m.stars ? `★${m.stars} ` : "";
          const ver = m.version ? (m.version.startsWith("v") ? m.version : `v${m.version} `) : "";
          return {
            label: m.name,
            desc: m.installed
              ? `✓ installed · ${stars}${shorten(`${ver}${m.desc}`, 44)}`
              : `${stars}${shorten(`${ver}— ${m.desc}`, 48)}`,
            payload: `market:${m.name}`,
            installed: m.installed,
            stars: m.stars,
          };
        });
      }

      case "mcp": {
        const mcp = this.options.mcpServers || [
          { name: "notion", status: "connected" as const, direct: 2, total: 5, tokens: 1200 },
        ];
        if (mcp.length === 0) {
          return [{ label: "— no servers —", desc: "add one to ~/.pi/agent/mcp.json", disabled: true }];
        }
        return mcp.map((s) => ({
          label: s.name,
          desc: s.status === "connected"
            ? `● ${s.direct ?? 1}/${s.total ?? 1} direct · ~${s.tokens ?? 0} tok`
            : s.status === "disabled"
            ? "disabled in mcp.json · /mcp can enable it"
            : "○ not connected · /mcp shows why",
          payload: "mcp",
          badge: s.status === "connected" ? "●" : "○",
        }));
      }

      case "tool": {
        const tools = this.options.toolStats || [];
        if (tools.length === 0) {
          return [{ label: "— no tool calls yet —", desc: "tools appear here as the agent works", disabled: true }];
        }
        return tools.map((t) => ({
          label: t.name,
          desc: `${t.count}x · ${formatDuration(t.durationMs)}${t.errors ? ` · ${t.errors} error` : ""}`,
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
          desc: `${t.value} · Enter: next`,
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
        const palettes = this.options.palettes || getPaletteNames();
        const curTheme = this.currentTheme;
        const curLight = getRawPalette(curTheme).light ?? false;

        const paletteItems: PsecRowItem[] = palettes.map((p) => {
          const raw = getRawPalette(p);
          const accent = raw.accent || "#888888";
          return {
            label: p,
            desc: p === curTheme ? `✓ current · ${accent}` : accent,
            payload: `theme:${p}`,
            isCurrent: p === curTheme,
          };
        });

        const bgs = this.options.backgrounds || getBackgroundNames();
        const curBg = this.currentBg;
        const bgItems: PsecRowItem[] = bgs.map((b) => {
          const hex = getBackgroundHex(b, curLight);
          const desc = hex ? hex : "terminal background";
          return {
            label: b,
            desc: b === curBg ? `✓ current · ${desc}` : desc,
            payload: `bg:${b}`,
            isCurrent: b === curBg,
          };
        });

        return [...paletteItems, ...bgItems];
      }

      case "login":
        return [
          {
            label: "Open login →",
            desc: "providers · keys · OAuth",
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

  // ---------------------------------------------------------------------------
  // Input Handling
  // ---------------------------------------------------------------------------

  handleInput(data: string): void {
    if (this.closed) return;

    // Handle active inline modal prompts first
    if (this.isShortcutPromptOpen) {
      if (matchesKey(data, Key.escape) || matchesKey(data, Key.esc) || data === "\x1b") {
        this.isShortcutPromptOpen = false;
        this.tui.requestRender?.();
        return;
      }
      if (data.startsWith("\x1b") && data.length > 1) {
        const k = data.slice(1);
        this.setFeedback(`Assigned Alt+${k} to /${this.shortcutTargetCommand}`);
        this.isShortcutPromptOpen = false;
        this.tui.requestRender?.();
        return;
      }
      if (matchesKey(data, Key.enter) || data === "\r" || data === "\n") {
        this.isShortcutPromptOpen = false;
        this.tui.requestRender?.();
        return;
      }
      return;
    }

    if (this.isSuggestPromptOpen) {
      if (matchesKey(data, Key.escape) || matchesKey(data, Key.esc) || data === "\x1b") {
        this.isSuggestPromptOpen = false;
        this.tui.requestRender?.();
        return;
      }
      if (matchesKey(data, Key.enter) || data === "\r" || data === "\n") {
        const trimmed = this.suggestQuery.trim();
        if (trimmed) {
          this.customSuggestedPlugins.push(trimmed);
          this.setFeedback(`Added suggested package: ${trimmed}`);
        }
        this.isSuggestPromptOpen = false;
        this.tui.requestRender?.();
        return;
      }
      if (matchesKey(data, Key.backspace) || data === "\x7f" || data === "\b") {
        if (this.suggestQuery.length > 0) {
          this.suggestQuery = this.suggestQuery.slice(0, -1);
          this.tui.requestRender?.();
        }
        return;
      }
      if (data.length === 1 && data >= " " && data <= "~") {
        this.suggestQuery += data;
        this.tui.requestRender?.();
        return;
      }
      return;
    }

    // Esc: clear search first; second Esc closes and triggers cancel rollback if in theme preview
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.esc) || data === "\x1b") {
      if (this.query.length > 0) {
        this.query = "";
        this.itemCursor = 0;
        this.tui.requestRender?.();
        return;
      }
      if (this.getCurrentSection() === "theme") {
        this.options.onCancelTheme?.(this.initialTheme, this.initialBg);
      }
      this.close();
      return;
    }

    // Up / Down navigation
    if (this.keybindings?.matches?.(data, "tui.select.up") || matchesKey(data, Key.up) || data === "\x1b[A") {
      if (!this.isRightPaneFocused) {
        this.sectionCursor = (this.sectionCursor - 1 + this.sections.length) % this.sections.length;
        this.itemCursor = 0;
        this.query = "";
        if (this.getCurrentSection() === "theme") {
          this.focusCurrentTheme();
        }
      } else if (this.getCurrentSection() === "theme") {
        const { palItems, bgItems } = this.getThemeCols();
        if (this.isBgColumnFocused) {
          if (bgItems.length > 0) {
            this.bgCursor = (this.bgCursor - 1 + bgItems.length) % bgItems.length;
            const b = bgItems[this.bgCursor]?.payload?.replace("bg:", "");
            if (b) {
              try {
                const res = this.options.onPreviewBackground
                  ? this.options.onPreviewBackground(b)
                  : this.options.onSelectBackground
                  ? this.options.onSelectBackground(b)
                  : undefined;
                if (res instanceof Promise) {
                  const gen = ++this.feedbackGeneration;
                  res.then((val) => {
                    if (this.closed || this.feedbackGeneration !== gen) return;
                    if (val !== false) {
                      this.currentBg = b;
                      this.tui.requestRender?.();
                    }
                  }).catch(() => {});
                } else if (res !== false) {
                  this.currentBg = b;
                }
              } catch {}
            }
          }
        } else {
          if (palItems.length > 0) {
            this.themeCursor = (this.themeCursor - 1 + palItems.length) % palItems.length;
            const p = palItems[this.themeCursor]?.payload?.replace("theme:", "");
            if (p) {
              try {
                const res = this.options.onPreviewTheme
                  ? this.options.onPreviewTheme(p)
                  : this.options.onSelectTheme
                  ? this.options.onSelectTheme(p)
                  : undefined;
                if (res instanceof Promise) {
                  const gen = ++this.feedbackGeneration;
                  res.then((val) => {
                    if (this.closed || this.feedbackGeneration !== gen) return;
                    if (val !== false) {
                      this.currentTheme = p;
                      this.tui.requestRender?.();
                    }
                  }).catch(() => {});
                } else if (res !== false) {
                  this.currentTheme = p;
                }
              } catch {}
            }
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

    if (this.keybindings?.matches?.(data, "tui.select.down") || matchesKey(data, Key.down) || data === "\x1b[B") {
      if (!this.isRightPaneFocused) {
        this.sectionCursor = (this.sectionCursor + 1) % this.sections.length;
        this.itemCursor = 0;
        this.query = "";
        if (this.getCurrentSection() === "theme") {
          this.focusCurrentTheme();
        }
      } else if (this.getCurrentSection() === "theme") {
        const { palItems, bgItems } = this.getThemeCols();
        if (this.isBgColumnFocused) {
          if (bgItems.length > 0) {
            this.bgCursor = (this.bgCursor + 1) % bgItems.length;
            const b = bgItems[this.bgCursor]?.payload?.replace("bg:", "");
            if (b) {
              try {
                const res = this.options.onPreviewBackground
                  ? this.options.onPreviewBackground(b)
                  : this.options.onSelectBackground
                  ? this.options.onSelectBackground(b)
                  : undefined;
                if (res instanceof Promise) {
                  const gen = ++this.feedbackGeneration;
                  res.then((val) => {
                    if (this.closed || this.feedbackGeneration !== gen) return;
                    if (val !== false) {
                      this.currentBg = b;
                      this.tui.requestRender?.();
                    }
                  }).catch(() => {});
                } else if (res !== false) {
                  this.currentBg = b;
                }
              } catch {}
            }
          }
        } else {
          if (palItems.length > 0) {
            this.themeCursor = (this.themeCursor + 1) % palItems.length;
            const p = palItems[this.themeCursor]?.payload?.replace("theme:", "");
            if (p) {
              try {
                const res = this.options.onPreviewTheme
                  ? this.options.onPreviewTheme(p)
                  : this.options.onSelectTheme
                  ? this.options.onSelectTheme(p)
                  : undefined;
                if (res instanceof Promise) {
                  const gen = ++this.feedbackGeneration;
                  res.then((val) => {
                    if (this.closed || this.feedbackGeneration !== gen) return;
                    if (val !== false) {
                      this.currentTheme = p;
                      this.tui.requestRender?.();
                    }
                  }).catch(() => {});
                } else if (res !== false) {
                  this.currentTheme = p;
                }
              } catch {}
            }
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

    // Left / Right / Tab pane and column switching
    if (matchesKey(data, Key.right) || data === "\x1b[C") {
      if (!this.isRightPaneFocused) {
        this.isRightPaneFocused = true;
        this.isBgColumnFocused = false;
      } else if (this.getCurrentSection() === "theme") {
        this.isBgColumnFocused = true;
      }
      this.tui.requestRender?.();
      return;
    }

    if (matchesKey(data, Key.left) || data === "\x1b[D") {
      if (this.isRightPaneFocused) {
        if (this.getCurrentSection() === "theme" && this.isBgColumnFocused) {
          this.isBgColumnFocused = false;
        } else {
          this.isRightPaneFocused = false;
        }
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

    // Backspace: trim query rune
    if (matchesKey(data, Key.backspace) || data === "\x7f" || data === "\b") {
      if (this.query.length > 0) {
        this.query = this.query.slice(0, -1);
        this.itemCursor = 0;
        if (this.getCurrentSection() === "market" && this.options.onSearchMarketplace) {
          this.options.onSearchMarketplace(this.query);
        }
        this.tui.requestRender?.();
      }
      return;
    }

    // Ctrl+S: Shortcut assignment prompt
    if (data === "\x13") {
      const items = this.getFilteredItems();
      const item = items[this.itemCursor];
      if (item && item.payload) {
        if (this.options.onAssignShortcut) {
          this.options.onAssignShortcut(item.payload);
        }
        this.shortcutTargetCommand = item.payload.replace(/^\//, "");
        this.isShortcutPromptOpen = true;
        this.tui.requestRender?.();
      }
      return;
    }

    // Ctrl+F: Plugin suggestion prompt (in Plugins section)
    if (data === "\x06" && this.getCurrentSection() === "plugin") {
      this.isSuggestPromptOpen = true;
      this.suggestQuery = "";
      this.tui.requestRender?.();
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
            if (!this.options.onSelectBackground) {
              // callback absent: do not report Applied
              return;
            }
            try {
              const res = this.options.onSelectBackground(name);
              if (res instanceof Promise) {
                const gen = ++this.feedbackGeneration;
                res.then((val) => {
                  if (this.closed || this.feedbackGeneration !== gen) return;
                  if (val === false) {
                    this.setFeedback(`Failed to apply surface: ${name}`);
                  } else {
                    this.currentBg = name;
                    this.setFeedback(`Applied surface: ${name}`);
                  }
                  this.tui.requestRender?.();
                }).catch((err: any) => {
                  if (this.closed || this.feedbackGeneration !== gen) return;
                  this.setFeedback(`Error applying surface: ${err?.message || name}`);
                  this.tui.requestRender?.();
                });
              } else if (res === false) {
                this.setFeedback(`Failed to apply surface: ${name}`);
              } else {
                this.currentBg = name;
                this.setFeedback(`Applied surface: ${name}`);
              }
            } catch (err: any) {
              this.setFeedback(`Error applying surface: ${err?.message || name}`);
            }
          }
        } else {
          const p = palItems[this.themeCursor];
          if (p && p.payload) {
            const name = p.payload.replace("theme:", "");
            if (!this.options.onSelectTheme) {
              // callback absent: do not report Applied
              return;
            }
            try {
              const res = this.options.onSelectTheme(name);
              if (res instanceof Promise) {
                const gen = ++this.feedbackGeneration;
                res.then((val) => {
                  if (this.closed || this.feedbackGeneration !== gen) return;
                  if (val === false) {
                    this.setFeedback(`Failed to apply palette: ${name}`);
                  } else {
                    this.currentTheme = name;
                    this.setFeedback(`Applied theme: ${name}`);
                  }
                  this.tui.requestRender?.();
                }).catch((err: any) => {
                  if (this.closed || this.feedbackGeneration !== gen) return;
                  this.setFeedback(`Error applying theme: ${err?.message || name}`);
                  this.tui.requestRender?.();
                });
              } else if (res === false) {
                this.setFeedback(`Failed to apply palette: ${name}`);
              } else {
                this.currentTheme = name;
                this.setFeedback(`Applied theme: ${name}`);
              }
            } catch (err: any) {
              this.setFeedback(`Error applying theme: ${err?.message || name}`);
            }
          }
        }
        this.tui.requestRender?.();
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
        } else if (this.options.onInstallPackage) {
          this.options.onInstallPackage(spec);
          this.setFeedback(`Installing ${spec}…`);
        } else if (typeof this.ctx.ui?.setEditorText === "function") {
          this.close();
          this.ctx.ui.setEditorText(`/package install ${spec}`);
          return;
        } else {
          this.setFeedback("— unavailable: package install requires native pi UI —");
        }
        return;
      }

      // 3. In-place mutations: tasks & sidebar toggling
      if (payload.startsWith("tasks:")) {
        const key = payload.replace("tasks:", "");
        if (this.options.onCycleTasksTab) {
          this.options.onCycleTasksTab();
        }
        if (this.options.onCycleTaskSetting) {
          this.options.onCycleTaskSetting(key, "next");
        }
        this.setFeedback(`Cycled task setting: ${key}`);
        return;
      }

      if (payload.startsWith("side:")) {
        const key = payload.replace("side:", "");
        if (this.options.onToggleSidebarSection) {
          this.options.onToggleSidebarSection(key);
        }
        if (this.options.onToggleSideSection) {
          this.options.onToggleSideSection(key);
        }
        this.setFeedback(`Toggled sidebar section: ${key}`);
        return;
      }

      // 4. Runnable slash commands
      if (payload.startsWith("/")) {
        this.close();
        if (typeof this.ctx.ui?.setEditorText === "function") {
          this.ctx.ui.setEditorText(payload);
        }
        return;
      }

      if (payload) {
        this.setFeedback(`Selected ${payload}`);
      }
      return;
    }

    // Delete / Backspace in plugins list for uninstall (Key.delete, no raw 'x' hijack)
    if (data === "\x1b[3~") {
      if (this.getCurrentSection() === "plugin" && this.isRightPaneFocused) {
        const items = this.getFilteredItems();
        const item = items[this.itemCursor];
        if (item && item.payload && item.payload.startsWith("plugin:")) {
          const spec = item.payload.replace("plugin:", "");
          if (this.options.onUninstallPlugin) {
            this.options.onUninstallPlugin(spec);
            this.setFeedback(`Uninstalled ${spec}`);
          } else if (this.options.onUninstallPackage) {
            this.options.onUninstallPackage(spec);
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

    // Printable runes / paste append to filter query
    if (!data.startsWith("\x1b") && data.length > 0 && !/[\x00-\x1f\x7f]/.test(data)) {
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

  // ---------------------------------------------------------------------------
  // Detail Lines Helpers
  // ---------------------------------------------------------------------------

  private pluginDetailLines(w: number, items: PsecRowItem[]): string[] {
    const safeW = Math.max(30, w);
    const item = items[this.itemCursor];
    if (!item) {
      return ["  " + dimSafe(this.theme, fit("— no selection —", safeW - 2))];
    }

    const lines: string[] = [];
    const nameOnly = item.label.replace(/^★\s*/, "");
    lines.push("  " + boldSafe(this.theme, fgSafe(this.theme, "text" as ThemeColor, fit(nameOnly, safeW - 2))));

    const spec = item.payload?.replace(/^plugin:/, "") || item.payload || nameOnly;
    const rows: [string, string][] = [
      ["Spec", spec || "—"],
      ["Source", spec.startsWith("npm:") ? "npm registry" : "local"],
      ["Version", "latest"],
      ["Path", `~/.pi/agent/plugins/${nameOnly}`],
    ];

    const lw = 11;
    const valW = Math.max(10, safeW - 2 - lw - 1);
    for (const [lab, val] of rows) {
      const styledLab = dimSafe(this.theme, fit(lab, lw));
      const styledVal = val === "—"
        ? dimSafe(this.theme, fit(val, valW))
        : fgSafe(this.theme, "text" as ThemeColor, fit(shorten(val, valW), valW));
      lines.push(`  ${styledLab} ${styledVal}`);
    }

    lines.push("  " + dimSafe(this.theme, fit("Description", safeW - 2)));
    const descText = item.desc || "Pi extension module";
    for (const ln of wrapWords(descText, safeW - 2)) {
      lines.push("  " + fgSafe(this.theme, "text" as ThemeColor, fit(ln, safeW - 2)));
    }

    lines.push("  " + dimSafe(this.theme, fit("Commands (1)", safeW - 2)));
    lines.push("  " + fgSafe(this.theme, "text" as ThemeColor, fit(`/${nameOnly} — trigger command`, safeW - 2)));

    return lines;
  }

  private marketDetailLines(w: number, items: PsecRowItem[]): string[] {
    const safeW = Math.max(30, w);
    const item = items[this.itemCursor];
    if (!item) {
      return ["  " + dimSafe(this.theme, fit("— no selection —", safeW - 2))];
    }

    const lines: string[] = [];
    const title = item.installed ? `${item.label} ✓` : item.label;
    lines.push("  " + boldSafe(this.theme, fgSafe(this.theme, "text" as ThemeColor, fit(title, safeW - 2))));

    const rows: [string, string][] = [
      ["Version", "1.0.0"],
      ["Spec", `npm:${item.label}`],
      ["Stars", item.stars ? `★${item.stars}` : "—"],
      ["Downloads", "450/wk"],
    ];

    const lw = 11;
    const valW = Math.max(10, safeW - 2 - lw - 1);
    for (const [lab, val] of rows) {
      const styledLab = dimSafe(this.theme, fit(lab, lw));
      const styledVal = val === "—"
        ? dimSafe(this.theme, fit(val, valW))
        : fgSafe(this.theme, "text" as ThemeColor, fit(shorten(val, valW), valW));
      lines.push(`  ${styledLab} ${styledVal}`);
    }

    const statusStr = item.installed ? "installed" : "not installed";
    const statusStyle = item.installed ? fgSafe(this.theme, "success", statusStr) : dimSafe(this.theme, statusStr);
    lines.push(`  ${dimSafe(this.theme, fit("Status", lw))} ${statusStyle}`);

    lines.push("  " + dimSafe(this.theme, fit("Repository", lw)));
    lines.push("  " + fgSafe(this.theme, "text" as ThemeColor, fit(`https://github.com/pi/${item.label}`, safeW - 2)));

    lines.push("  " + dimSafe(this.theme, fit("Description", safeW - 2)));
    const descText = item.desc || "Pi package for interactive coding";
    for (const ln of wrapWords(descText, safeW - 2)) {
      lines.push("  " + fgSafe(this.theme, "text" as ThemeColor, fit(ln, safeW - 2)));
    }

    const hint = item.installed ? "Enter: uninstall via pi remove" : "Enter: install via pi install";
    lines.push("  " + dimSafe(this.theme, fit(hint, safeW - 2)));

    return lines;
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  render(width: number): string[] {
    const rawWidth = Math.max(20, Math.floor(width));

    // Responsive boxW matching OMT hubBoxW(m): winW - 10 clamped to [70, 150]
    let boxW = rawWidth - 10;
    if (boxW < 70) boxW = 70;
    if (boxW > 150) boxW = 150;
    if (rawWidth < 74) boxW = Math.max(16, rawWidth - 2);

    // Terminal height for windowing math: win = winH - 14 clamped to [12, 24]
    const termH =
      this.options.viewportHeight ??
      (this.tui as any)?.terminal?.rows ??
      (this.tui as any)?.height ??
      49;
    let win = termH - 14;
    if (win < 12) win = 12;
    if (win > 24) win = 24;

    const isAscii = accessibilityStore?.isPlainTextAsciiBorders?.() ?? false;
    const tl = isAscii ? "+" : "╭";
    const tr = isAscii ? "+" : "╮";
    const bl = isAscii ? "+" : "╰";
    const br = isAscii ? "+" : "╯";
    const h = isAscii ? "-" : "─";
    const v = isAscii ? "|" : "│";

    const borderStyler = getBorderStyler(this.theme);

    // Padding: (1, 3)
    let padX = 3;
    let padY = 1;
    if (boxW < 70) {
      padX = boxW < 40 ? 0 : 1;
      padY = 0;
    }

    const innerW = Math.max(16, boxW - padX * 2);

    const frameLine = (content: string): string => {
      const leftPad = " ".repeat(padX);
      const rightPad = " ".repeat(padX);
      const truncated = truncateToWidth(content, innerW, "");
      const diff = Math.max(0, innerW - visibleWidth(truncated));
      return `${borderStyler(v)}${leftPad}${truncated}${" ".repeat(diff)}${rightPad}${borderStyler(v)}`;
    };

    // -------------------------------------------------------------------------
    // Inline Prompts Overlay (Shortcut assignment & Plugin suggestion)
    // -------------------------------------------------------------------------
    if (this.isShortcutPromptOpen) {
      const outputLines: string[] = [];
      outputLines.push(borderStyler(tl + h.repeat(Math.max(0, boxW)) + tr));
      if (padY > 0) outputLines.push(borderStyler(v) + " ".repeat(Math.max(0, boxW)) + borderStyler(v));
      outputLines.push(frameLine(boldSafe(this.theme, fgSafe(this.theme, "accent", `Assign Alt shortcut to /${this.shortcutTargetCommand}`))));
      outputLines.push(frameLine(dimSafe(this.theme, "Press any Alt key combination (or Esc to cancel):")));
      outputLines.push(frameLine(""));
      outputLines.push(frameLine(boldSafe(this.theme, fgSafe(this.theme, "warning", "[ press Alt+<key> ]"))));
      outputLines.push(frameLine(""));
      outputLines.push(frameLine(dimSafe(this.theme, "Press Alt key · Esc cancels")));
      if (padY > 0) outputLines.push(borderStyler(v) + " ".repeat(Math.max(0, boxW)) + borderStyler(v));
      outputLines.push(borderStyler(bl + h.repeat(Math.max(0, boxW)) + br));
      return outputLines;
    }

    if (this.isSuggestPromptOpen) {
      const outputLines: string[] = [];
      outputLines.push(borderStyler(tl + h.repeat(Math.max(0, boxW)) + tr));
      if (padY > 0) outputLines.push(borderStyler(v) + " ".repeat(Math.max(0, boxW)) + borderStyler(v));
      outputLines.push(frameLine(boldSafe(this.theme, fgSafe(this.theme, "accent", "Add suggested plugin package"))));
      outputLines.push(frameLine(dimSafe(this.theme, "npm package name (e.g. pi-subagents):")));
      outputLines.push(frameLine(""));
      outputLines.push(frameLine(boldSafe(this.theme, `> ${this.suggestQuery}▌`)));
      outputLines.push(frameLine(""));
      outputLines.push(frameLine(dimSafe(this.theme, "Enter adds to suggestions · Esc cancels")));
      if (padY > 0) outputLines.push(borderStyler(v) + " ".repeat(Math.max(0, boxW)) + borderStyler(v));
      outputLines.push(borderStyler(bl + h.repeat(Math.max(0, boxW)) + br));
      return outputLines;
    }

    // -------------------------------------------------------------------------
    // 1. Header Lines: Title, Message, and Filter
    // -------------------------------------------------------------------------
    const titleStr = boldSafe(this.theme, fgSafe(this.theme, "text", "Settings Hub"));
    const secMeta = SETTINGS_HUB_SECTIONS[this.getCurrentSection()] || SETTINGS_HUB_SECTIONS.agent;
    const msgStr = dimSafe(this.theme, secMeta.hint);

    const filterLabel = this.getCurrentSection() === "market" ? "search: " : "filter: ";
    const filterDisplay = dimSafe(this.theme, `${filterLabel}${this.query}▌`);

    // -------------------------------------------------------------------------
    // 2. Multi-Pane Width Calculations
    // -------------------------------------------------------------------------
    let leftW = 30;
    if (boxW < 100) {
      leftW = 24;
    }
    if (innerW < 45) {
      leftW = Math.max(8, Math.floor(innerW * 0.38));
    }

    let rightW = boxW - 8 - leftW - 3;
    if (rightW < 30) {
      rightW = Math.max(10, innerW - leftW - 3);
    }

    const curSec = this.getCurrentSection();
    const isPlugin = curSec === "plugin";
    const isMarket = curSec === "market";
    const isThemeSec = curSec === "theme";

    const detailCol = boxW >= 110 && (isPlugin || isMarket);
    const bgCol = boxW >= 110 && isThemeSec;

    let detW = 42;
    let bgW = 30;
    let listW = rightW;

    if (detailCol) {
      listW = rightW - detW - 3;
      if (listW < 20) {
        listW = 20;
        detW = rightW - listW - 3;
      }
    }
    if (bgCol) {
      listW = rightW - bgW - 3;
      if (listW < 20) {
        listW = 20;
        bgW = rightW - listW - 3;
      }
    }

    // Source columns intentionally leave two trailing cells inside the frame.
    // Preserve those widths on normal terminals, shrinking only narrow fallbacks.
    if (boxW < 70) rightW = listW = Math.max(1, innerW - leftW - 3);

    // -------------------------------------------------------------------------
    // 3. Left Pane: Sections Window
    // -------------------------------------------------------------------------
    const { start: secStart, end: secEnd, hasAbove: secAbove, hasBelow: secBelow } = fixedWin(
      this.sectionCursor,
      this.sections.length,
      win,
    );

    const leftLines: string[] = [];
    if (secAbove) {
      leftLines.push("  " + dimSafe(this.theme, fit(`…(+${secStart} above)`, leftW - 2)));
    }
    for (let i = secStart; i < secEnd; i++) {
      const s = this.sections[i];
      const isSel = i === this.sectionCursor;
      const provName = PSEC_PROVS[s] || s;
      const count = this.getSectionCount(s);
      const cntStr = count >= 0 ? `${count}` : count === -2 ? "—" : "";
      const cw = leftW - 2;
      const shortNm = shorten(provName, Math.max(4, cw - 5));
      const pad = Math.max(1, cw - 2 - visibleWidth(shortNm) - cntStr.length);
      const content = fit(`${shortNm}${" ".repeat(pad)}${cntStr}`, cw - 2);

      const mark = isSel ? boldSafe(this.theme, fgSafe(this.theme, "accent", "▸ ")) : "  ";
      const styled = isSel
        ? !this.isRightPaneFocused
          ? boldSafe(this.theme, fgSafe(this.theme, "accent", content))
          : fgSafe(this.theme, "text" as ThemeColor, content)
        : dimSafe(this.theme, content);

      leftLines.push(`${mark}${isSel ? selectedDialogRow(this.theme, content, leftW - 2, !this.isRightPaneFocused) : fit(styled, leftW - 2)}`);
    }
    if (secBelow) {
      leftLines.push("  " + dimSafe(this.theme, fit(`…(+${this.sections.length - secEnd} below)`, leftW - 2)));
    }
    while (leftLines.length < win) {
      leftLines.push(" ".repeat(leftW));
    }

    // -------------------------------------------------------------------------
    // 4. Right Pane: Section Items Window & 3rd Details Column
    // -------------------------------------------------------------------------
    let rightLines: string[] = [];
    let bgLines: string[] = [];
    let detLines: string[] = [];

    let headerRow = "";
    const secName = PSEC_PROVS[curSec] || curSec;
    const sep = fgSafe(this.theme, "border", "│");

    if (bgCol) {
      // Theme Section: 2 columns in right pane (Palettes & Backgrounds)
      const { palItems, bgItems } = this.getThemeCols();

      const head = (label: string, count: number, w: number, focused: boolean) => {
        const text = fit(`${label} · ${count}`, w - 2);
        return (focused ? "▸ " : "  ") + (focused ? boldSafe(this.theme, fgSafe(this.theme, "text" as ThemeColor, text)) : dimSafe(this.theme, text));
      };
      const palHead = head("THEME", palItems.length, listW, !this.isBgColumnFocused && this.isRightPaneFocused);
      const bgHead = head("BACKGROUND", bgItems.length, bgW, this.isBgColumnFocused && this.isRightPaneFocused);
      headerRow = `  ${boldSafe(this.theme, fit("SECTIONS", leftW - 2))} ${sep} ${palHead} ${sep} ${bgHead}`;

      // Palettes column
      const { start: pStart, end: pEnd, hasAbove: pAbove, hasBelow: pBelow } = fixedWin(
        this.themeCursor,
        palItems.length,
        win,
      );
      if (pAbove) rightLines.push("  " + dimSafe(this.theme, fit(`…(+${pStart} above)`, listW - 2)));
      for (let i = pStart; i < pEnd; i++) {
        const item = palItems[i];
        const isSel = i === this.themeCursor;
        const mark = isSel ? "▸ " : "  ";
        const optW = Math.max(10, Math.min(28, listW - 10));
        const rowText = fit(shorten(item.label, optW), optW) + (item.desc ? `  — ${shorten(item.desc, listW - 4 - optW - 3)}` : "");
        const styled = isSel && !this.isBgColumnFocused && this.isRightPaneFocused
          ? selectedDialogRow(this.theme, rowText, listW - 2)
          : dimSafe(this.theme, fit(rowText, listW - 2));
        rightLines.push(`${mark}${styled}`);
      }
      if (pBelow) rightLines.push("  " + dimSafe(this.theme, fit(`…(+${palItems.length - pEnd} below)`, listW - 2)));
      if (palItems.length === 0) rightLines.push("  " + dimSafe(this.theme, fit("— no match —", listW - 2)));
      while (rightLines.length < win) rightLines.push(" ".repeat(listW));

      // Backgrounds column
      const { start: bStart, end: bEnd, hasAbove: bAbove, hasBelow: bBelow } = fixedWin(
        this.bgCursor,
        bgItems.length,
        win,
      );
      if (bAbove) bgLines.push("  " + dimSafe(this.theme, fit(`…(+${bStart} above)`, bgW - 2)));
      for (let i = bStart; i < bEnd; i++) {
        const item = bgItems[i];
        const isSel = i === this.bgCursor;
        const mark = isSel && this.isBgColumnFocused ? "▸ " : "  ";
        const curLight = getRawPalette(this.currentTheme).light ?? false;
        const hex = getBackgroundHex(item.label, curLight);
        const swatch = dialogSwatch(this.theme, hex);
        // Transparent is the terminal's own background, not a painted surface.
        const isCur = item.isCurrent && item.label !== "transparent" ? " ✓" : "";
        const nameW = Math.max(4, bgW - 7 - visibleWidth(isCur));
        const rowText = `${swatch} ${fit(item.label, nameW)}${isCur}`;
        const styled = isSel && this.isBgColumnFocused && this.isRightPaneFocused
          ? selectedDialogRow(this.theme, rowText, bgW - 2)
          : dimSafe(this.theme, fit(rowText, bgW - 2));
        bgLines.push(`${mark}${styled}`);
      }
      if (bBelow) bgLines.push("  " + dimSafe(this.theme, fit(`…(+${bgItems.length - bEnd} below)`, bgW - 2)));
      if (bgItems.length === 0) bgLines.push("  " + dimSafe(this.theme, fit("— no match —", bgW - 2)));
      while (bgLines.length < win) bgLines.push(" ".repeat(bgW));
    } else if (detailCol) {
      // 3-Column Layout: Sections | List | DETAILS
      const items = this.getFilteredItems();
      const secHead = fit(
        boldSafe(this.theme, fgSafe(this.theme, "text", `${secName.toUpperCase()} · ${items.length}`)),
        listW - 2,
      );
      const detHead = fit(
        boldSafe(this.theme, fgSafe(this.theme, "text", "DETAILS")),
        detW - 2,
      );
      headerRow = `  ${boldSafe(this.theme, fgSafe(this.theme, "text", fit("SECTIONS", leftW - 2)))} ${sep}   ${secHead} ${sep}   ${detHead}`;

      const { start: itStart, end: itEnd, hasAbove: itAbove, hasBelow: itBelow } = fixedWin(
        this.itemCursor,
        items.length,
        win,
      );

      const optW = Math.max(10, listW - 4);
      if (itAbove) rightLines.push("  " + dimSafe(this.theme, fit(`…(+${itStart} above)`, listW - 2)));
      for (let i = itStart; i < itEnd; i++) {
        const item = items[i];
        const isSel = i === this.itemCursor;
        const mark = isSel ? "▸ " : "  ";
        let rowContent = item.label;
        if (isMarket && item.stars) {
          const chip = `★${item.stars}`;
          const availW = Math.max(4, optW - visibleWidth(chip) - 1);
          rowContent = `${fit(shorten(item.label, availW), availW)} ${chip}`;
        } else {
          rowContent = fit(shorten(item.label, optW), optW);
        }

        const styled = isSel
          ? this.isRightPaneFocused
            ? selectedDialogRow(this.theme, rowContent, listW - 2)
            : fgSafe(this.theme, "text" as ThemeColor, rowContent)
          : dimSafe(this.theme, rowContent);
        rightLines.push(`${mark}${styled}`);
      }
      if (itBelow) rightLines.push("  " + dimSafe(this.theme, fit(`…(+${items.length - itEnd} below)`, listW - 2)));
      if (items.length === 0) rightLines.push("  " + dimSafe(this.theme, fit("— no match —", listW - 2)));
      while (rightLines.length < win) rightLines.push(" ".repeat(listW));

      // Build DETAILS lines
      if (isMarket) {
        detLines = this.marketDetailLines(detW, items);
      } else {
        detLines = this.pluginDetailLines(detW, items);
      }
      while (detLines.length < win) detLines.push(" ".repeat(detW));
    } else {
      // Classic 2-Pane Layout: Sections | List
      const items = this.getFilteredItems();
      const secHead = fit(
        boldSafe(this.theme, fgSafe(this.theme, "text", `${secName.toUpperCase()} · ${items.length}`)),
        rightW - 2,
      );
      headerRow = `  ${boldSafe(this.theme, fgSafe(this.theme, "text", fit("SECTIONS", leftW - 2)))} ${sep}   ${secHead}`;

      const { start: itStart, end: itEnd, hasAbove: itAbove, hasBelow: itBelow } = fixedWin(
        this.itemCursor,
        items.length,
        win,
      );

      const optW = Math.max(10, Math.min(28, rightW - 10));
      if (itAbove) rightLines.push("  " + dimSafe(this.theme, fit(`…(+${itStart} above)`, rightW - 2)));
      for (let i = itStart; i < itEnd; i++) {
        const item = items[i];
        const isSel = i === this.itemCursor;
        const mark = isSel ? "▸ " : "  ";
        const namePart = fit(shorten(item.label, optW), optW);
        const descPart = item.desc ? `  — ${shorten(item.desc, rightW - 4 - optW - 3)}` : "";
        const rowText = fit(`${namePart}${descPart}`, rightW - 4);

        const styled = isSel
          ? this.isRightPaneFocused
            ? selectedDialogRow(this.theme, rowText, rightW - 2)
            : fgSafe(this.theme, "text" as ThemeColor, rowText)
          : dimSafe(this.theme, rowText);
        rightLines.push(`${mark}${styled}`);
      }
      if (itBelow) rightLines.push("  " + dimSafe(this.theme, fit(`…(+${items.length - itEnd} below)`, rightW - 2)));
      if (items.length === 0) rightLines.push("  " + dimSafe(this.theme, fit("— no match —", rightW - 2)));
      while (rightLines.length < win) rightLines.push(" ".repeat(rightW));
    }

    // -------------------------------------------------------------------------
    // 5. Combined Body Lines Assembly
    // -------------------------------------------------------------------------
    const combinedBodyLines: string[] = [];
    for (let r = 0; r < win; r++) {
      const l = leftLines[r] ?? " ".repeat(leftW);
      const rg = rightLines[r] ?? " ".repeat(listW);

      if (bgCol) {
        const bg = bgLines[r] ?? " ".repeat(bgW);
        combinedBodyLines.push(`${fit(l, leftW)} ${sep} ${fit(rg, listW)} ${sep} ${fit(bg, bgW)}`);
      } else if (detailCol) {
        const dt = detLines[r] ?? " ".repeat(detW);
        combinedBodyLines.push(`${fit(l, leftW)} ${sep} ${fit(rg, listW)} ${sep} ${fit(dt, detW)}`);
      } else {
        combinedBodyLines.push(`${fit(l, leftW)} ${sep} ${fit(rg, rightW)}`);
      }
    }

    // -------------------------------------------------------------------------
    // 6. Footer Line
    // -------------------------------------------------------------------------
    let defaultFooter = "↑↓ sections · → contents · Enter open · Esc close";
    if (this.isRightPaneFocused) {
      if (curSec === "market") {
        defaultFooter = "↑↓ select · ← sections · Tab switch · type to search npm · Enter install · Esc clears";
      } else if (bgCol) {
        defaultFooter = "↑↓ previews · ←/→ switch column · Enter applies · type filters · Esc close";
      } else if (curSec === "plugin") {
        defaultFooter = "↑↓ select · ← sections · Enter install · Delete uninstall · Ctrl+F suggest · Esc close";
      } else {
        defaultFooter = "↑↓ select · ← sections · Tab switch · type filters · Enter run · Esc close";
      }
    }
    const footMsg = this.feedbackText || defaultFooter;
    const footStyled = this.feedbackText
      ? boldSafe(this.theme, fgSafe(this.theme, "success", footMsg))
      : dimSafe(this.theme, footMsg);

    // -------------------------------------------------------------------------
    // 7. Assemble Full Dialog Box with Unicode Rounded Borders & Padding
    // -------------------------------------------------------------------------
    const outputLines: string[] = [];
    outputLines.push(borderStyler(tl + h.repeat(Math.max(0, boxW)) + tr));
    if (padY > 0) outputLines.push(borderStyler(v) + " ".repeat(Math.max(0, boxW)) + borderStyler(v));
    outputLines.push(frameLine(titleStr));
    outputLines.push(frameLine(msgStr));
    outputLines.push(frameLine(filterDisplay));
    outputLines.push(frameLine(""));
    outputLines.push(frameLine(headerRow));
    for (const bodyLn of combinedBodyLines) {
      outputLines.push(frameLine(bodyLn));
    }
    outputLines.push(frameLine(""));
    outputLines.push(frameLine(footStyled));
    if (padY > 0) outputLines.push(borderStyler(v) + " ".repeat(Math.max(0, boxW)) + borderStyler(v));
    outputLines.push(borderStyler(bl + h.repeat(Math.max(0, boxW)) + br));

    return outputLines;
  }
}

export function createOmtSettingsHubComponent(
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  options: ExtendedSettingsHubOptions = {},
): Component {
  return new OmtSettingsHubComponent(tui, theme, keybindings, done, ctx, options);
}

export {
  OmtSettingsHubComponent as SettingsHubComponent,
  createOmtSettingsHubComponent as createSettingsHubComponent,
};
