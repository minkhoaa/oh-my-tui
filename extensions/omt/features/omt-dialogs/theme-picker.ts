/**
 * OMT Theme & Surface Picker Component.
 */

import { Container, visibleWidth, truncateToWidth, matchesKey, Key, type Component, type Focusable, type KeybindingsManager, type TUI, type TuiMouseEvent } from "@earendil-works/pi-tui";
import type { ExtensionContext, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";

// =============================================================================
// Theme & Background Model Interfaces
// =============================================================================

export interface ThemeItem {
  id: string;
  name: string;
  accent?: string;
  light?: boolean;
  isCurrent?: boolean;
}

export interface BackgroundItem {
  id: string;
  name: string;
  hex?: string;
  darkHex?: string;
  lightHex?: string;
  isCurrent?: boolean;
}

export interface ThemePickerOptions {
  themes?: ThemeItem[];
  backgrounds?: BackgroundItem[];
  currentTheme?: string;
  currentBackground?: string;
  onPreviewTheme?: (themeId: string) => void;
  onSelectTheme: (themeId: string) => void;
  onPreviewBackground?: (backgroundId: string) => void;
  onSelectBackground?: (backgroundId: string) => void;
  onCancelTheme?: (initialTheme: string, initialBackground: string) => void;
  onClose?: () => void;
  viewportWidth?: number;
  viewportHeight?: number;
}

// =============================================================================
// 1. Builtin 25 Palettes
// =============================================================================

export const LIGHT_PALETTES = new Set<string>([
  "catppuccin-latte",
  "solarized-light",
  "github-light",
  "rose-pine-dawn",
  "gruvbox-light",
  "one-light",
]);

export const BUILTIN_THEMES: readonly ThemeItem[] = [
  { id: "default", name: "default", accent: "15", light: false },
  { id: "one-dark", name: "one-dark", accent: "#61AFEF", light: false },
  { id: "gruvbox", name: "gruvbox", accent: "#FABD2F", light: false },
  { id: "dracula", name: "dracula", accent: "#BD93F9", light: false },
  { id: "tokyo-night", name: "tokyo-night", accent: "#7AA2F7", light: false },
  { id: "nord", name: "nord", accent: "#88C0D0", light: false },
  { id: "catppuccin-mocha", name: "catppuccin-mocha", accent: "#CBA6F7", light: false },
  { id: "catppuccin-latte", name: "catppuccin-latte", accent: "#8839EF", light: true },
  { id: "solarized-dark", name: "solarized-dark", accent: "#268BD2", light: false },
  { id: "solarized-light", name: "solarized-light", accent: "#268BD2", light: true },
  { id: "monokai", name: "monokai", accent: "#AB9DF2", light: false },
  { id: "github-dark", name: "github-dark", accent: "#4493F8", light: false },
  { id: "github-light", name: "github-light", accent: "#0969DA", light: true },
  { id: "ayu-dark", name: "ayu-dark", accent: "#FF8F40", light: false },
  { id: "palenight", name: "palenight", accent: "#C792EA", light: false },
  { id: "material-darker", name: "material-darker", accent: "#82AAFF", light: false },
  { id: "everforest", name: "everforest", accent: "#D699B6", light: false },
  { id: "kanagawa", name: "kanagawa", accent: "#7E9CD8", light: false },
  { id: "rose-pine", name: "rose-pine", accent: "#C4A7E7", light: false },
  { id: "rose-pine-dawn", name: "rose-pine-dawn", accent: "#907AA9", light: true },
  { id: "gruvbox-light", name: "gruvbox-light", accent: "#AF3A03", light: true },
  { id: "one-light", name: "one-light", accent: "#4078F2", light: true },
  { id: "zenburn", name: "zenburn", accent: "#8CD0D3", light: false },
  { id: "tomorrow-night", name: "tomorrow-night", accent: "#81A2BE", light: false },
  { id: "tokyo-storm", name: "tokyo-storm", accent: "#7AA2F7", light: false },
];

// =============================================================================
// 2. Builtin 32 Background Surfaces
// =============================================================================

export const TRANSPARENT = "transparent";

export const BUILTIN_BACKGROUNDS: readonly BackgroundItem[] = [
  { id: "transparent", name: "transparent", hex: "", darkHex: "", lightHex: "" },
  { id: "aura", name: "aura", hex: "#0f0f0f", darkHex: "#0f0f0f", lightHex: "#0f0f0f" },
  { id: "ayu", name: "ayu", hex: "#0B0E14", darkHex: "#0B0E14", lightHex: "#0B0E14" },
  { id: "carbonfox", name: "carbonfox", hex: "#161616", darkHex: "#161616", lightHex: "#ffffff" },
  { id: "catppuccin", name: "catppuccin", hex: "#1e1e2e", darkHex: "#1e1e2e", lightHex: "#eff1f5" },
  { id: "catppuccin-frappe", name: "catppuccin-frappe", hex: "#303446", darkHex: "#303446", lightHex: "#303446" },
  { id: "catppuccin-macchiato", name: "catppuccin-macchiato", hex: "#24273a", darkHex: "#24273a", lightHex: "#24273a" },
  { id: "cobalt2", name: "cobalt2", hex: "#193549", darkHex: "#193549", lightHex: "#ffffff" },
  { id: "cursor", name: "cursor", hex: "#181818", darkHex: "#181818", lightHex: "#fcfcfc" },
  { id: "dracula", name: "dracula", hex: "#282a36", darkHex: "#282a36", lightHex: "#f8f8f2" },
  { id: "everforest", name: "everforest", hex: "#2d353b", darkHex: "#2d353b", lightHex: "#fdf6e3" },
  { id: "flexoki", name: "flexoki", hex: "#100F0F", darkHex: "#100F0F", lightHex: "#FFFCF0" },
  { id: "github", name: "github", hex: "#0d1117", darkHex: "#0d1117", lightHex: "#ffffff" },
  { id: "gruvbox", name: "gruvbox", hex: "#282828", darkHex: "#282828", lightHex: "#fbf1c7" },
  { id: "kanagawa", name: "kanagawa", hex: "#1F1F28", darkHex: "#1F1F28", lightHex: "#F2E9DE" },
  { id: "material", name: "material", hex: "#263238", darkHex: "#263238", lightHex: "#fafafa" },
  { id: "matrix", name: "matrix", hex: "#0a0e0a", darkHex: "#0a0e0a", lightHex: "#eef3ea" },
  { id: "mercury", name: "mercury", hex: "#171721", darkHex: "#171721", lightHex: "#ffffff" },
  { id: "monokai", name: "monokai", hex: "#272822", darkHex: "#272822", lightHex: "#fafafa" },
  { id: "nightowl", name: "nightowl", hex: "#011627", darkHex: "#011627", lightHex: "#011627" },
  { id: "nord", name: "nord", hex: "#2E3440", darkHex: "#2E3440", lightHex: "#ECEFF4" },
  { id: "one-dark", name: "one-dark", hex: "#282c34", darkHex: "#282c34", lightHex: "#fafafa" },
  { id: "opencode", name: "opencode", hex: "#0a0a0a", darkHex: "#0a0a0a", lightHex: "#ffffff" },
  { id: "osaka-jade", name: "osaka-jade", hex: "#111c18", darkHex: "#111c18", lightHex: "#F6F5DD" },
  { id: "palenight", name: "palenight", hex: "#292d3e", darkHex: "#292d3e", lightHex: "#fafafa" },
  { id: "rosepine", name: "rosepine", hex: "#191724", darkHex: "#191724", lightHex: "#faf4ed" },
  { id: "solarized", name: "solarized", hex: "#002b36", darkHex: "#002b36", lightHex: "#fdf6e3" },
  { id: "synthwave84", name: "synthwave84", hex: "#262335", darkHex: "#262335", lightHex: "#fafafa" },
  { id: "tokyonight", name: "tokyonight", hex: "#1a1b26", darkHex: "#1a1b26", lightHex: "#e1e2e7" },
  { id: "vercel", name: "vercel", hex: "#000000", darkHex: "#000000", lightHex: "#FFFFFF" },
  { id: "vesper", name: "vesper", hex: "#101010", darkHex: "#101010", lightHex: "#FFFFFF" },
  { id: "zenburn", name: "zenburn", hex: "#3f3f3f", darkHex: "#3f3f3f", lightHex: "#ffffef" },
];

// =============================================================================
// Helper Functions: Styling, Formatting & Windowing
// =============================================================================

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

/**
 * 2-cell swatch in surface color, or unpainted spaces for transparent (terminal's own bg).
 */
function renderSwatch(hex?: string): string {
  if (!hex || hex === "" || hex === "transparent") {
    return "  ";
  }
  const clean = hex.replace(/^#/, "");
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
      return `\x1b[48;2;${r};${g};${b}m  \x1b[49m`;
    }
  }
  return "  ";
}

/**
 * Clamps visible window around cursor with …(+N above) and …(+N below).
 */
function fixedWin(
  cursor: number,
  total: number,
  win: number,
): { start: number; end: number; hasAbove: boolean; hasBelow: boolean } {
  if (total <= win) {
    return { start: 0, end: total, hasAbove: false, hasBelow: false };
  }
  let start = Math.max(0, cursor - Math.floor(win / 2));
  let end = start + win;
  if (end > total) {
    end = total;
    start = Math.max(0, end - win);
  }
  return {
    start,
    end,
    hasAbove: start > 0,
    hasBelow: end < total,
  };
}

/**
 * Pads or truncates string to exact visible width respecting ANSI escape sequences.
 */
function padToVisibleWidth(str: string, targetWidth: number): string {
  const curW = visibleWidth(str);
  if (curW > targetWidth) {
    return truncateToWidth(str, targetWidth, "");
  }
  if (curW < targetWidth) {
    return str + " ".repeat(targetWidth - curW);
  }
  return str;
}

// =============================================================================
// OmtThemePickerComponent
// =============================================================================

export class OmtThemePickerComponent extends Container implements Component, Focusable {
  focused = true;
  readonly capturesViewportInput = true;

  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly keybindings?: KeybindingsManager;
  private readonly done: (value?: unknown) => void;
  private readonly ctx?: ExtensionContext;
  private readonly options: ThemePickerOptions;

  private themes: ThemeItem[];
  private backgrounds: BackgroundItem[];

  private filteredThemes: ThemeItem[] = [];
  private filteredBackgrounds: BackgroundItem[] = [];

  private themeCursor = 0;
  private bgCursor = 0;
  private isBgFocused = false;
  private filter = "";
  private feedbackText = "";
  private isClosed = false;
  private feedbackGeneration = 0;

  private currentThemeId: string;
  private currentBackgroundId: string;
  private initialThemeId: string;
  private initialBackgroundId: string;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings?: KeybindingsManager,
    done?: (value?: unknown) => void,
    ctxOrOptions?: ExtensionContext | ThemePickerOptions,
    maybeOptions?: ThemePickerOptions,
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done ?? (() => {});

    let options: ThemePickerOptions;
    if (maybeOptions !== undefined) {
      this.ctx = ctxOrOptions as ExtensionContext;
      options = maybeOptions;
    } else if (
      ctxOrOptions &&
      ("onSelectTheme" in ctxOrOptions ||
        "themes" in ctxOrOptions ||
        "backgrounds" in ctxOrOptions ||
        "currentTheme" in ctxOrOptions)
    ) {
      options = ctxOrOptions as ThemePickerOptions;
    } else {
      this.ctx = ctxOrOptions as ExtensionContext;
      options = {} as ThemePickerOptions;
    }
    this.options = options;

    // Load themes: options or complete 25 built-in palettes
    this.themes =
      options.themes && options.themes.length > 0
        ? options.themes.map((t) => ({
            ...t,
            light: t.light ?? LIGHT_PALETTES.has(t.id),
          }))
        : BUILTIN_THEMES.map((t) => ({ ...t }));

    // Load backgrounds: options or complete 32 built-in surfaces
    this.backgrounds =
      options.backgrounds && options.backgrounds.length > 0
        ? options.backgrounds.map((b) => ({ ...b }))
        : BUILTIN_BACKGROUNDS.map((b) => ({ ...b }));

    this.currentThemeId = options.currentTheme ?? this.themes[0]?.id ?? "default";
    this.currentBackgroundId = options.currentBackground ?? "transparent";
    this.initialThemeId = this.currentThemeId;
    this.initialBackgroundId = this.currentBackgroundId;

    this.reindex();

    // Focus current theme row
    const initThemeIdx = this.filteredThemes.findIndex((t) => t.id === this.currentThemeId);
    if (initThemeIdx >= 0) {
      this.themeCursor = initThemeIdx;
    }

    // Remember current background row
    const initBgIdx = this.filteredBackgrounds.findIndex((b) => b.id === this.currentBackgroundId);
    if (initBgIdx >= 0) {
      this.bgCursor = initBgIdx;
    }
  }

  private reindex(): void {
    const q = this.filter.trim().toLowerCase();

    if (!q) {
      this.filteredThemes = [...this.themes];
      this.filteredBackgrounds = [...this.backgrounds];
    } else {
      this.filteredThemes = this.themes.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.id.toLowerCase().includes(q) ||
          (t.accent && t.accent.toLowerCase().includes(q)),
      );
      this.filteredBackgrounds = this.backgrounds.filter(
        (b) =>
          b.name.toLowerCase().includes(q) ||
          b.id.toLowerCase().includes(q) ||
          (b.hex && b.hex.toLowerCase().includes(q)),
      );
    }

    if (this.themeCursor >= this.filteredThemes.length) {
      this.themeCursor = Math.max(0, this.filteredThemes.length - 1);
    }
    if (this.bgCursor >= this.filteredBackgrounds.length) {
      this.bgCursor = Math.max(0, this.filteredBackgrounds.length - 1);
    }
  }

  private isCurrentThemeLight(): boolean {
    const curTheme = this.themes.find((t) => t.id === this.currentThemeId);
    if (curTheme) {
      return curTheme.light ?? LIGHT_PALETTES.has(curTheme.id);
    }
    return false;
  }

  private getBackgroundHex(b: BackgroundItem): string {
    const isLight = this.isCurrentThemeLight();
    if (isLight && b.lightHex !== undefined) {
      return b.lightHex;
    }
    if (!isLight && b.darkHex !== undefined) {
      return b.darkHex;
    }
    return b.hex ?? "";
  }

  private previewTheme(themeId: string): void {
    try {
      const res: any = this.options.onPreviewTheme
        ? this.options.onPreviewTheme(themeId)
        : this.options.onSelectTheme
        ? this.options.onSelectTheme(themeId)
        : undefined;
      if (res instanceof Promise) {
        const gen = ++this.feedbackGeneration;
        res.then((val: any) => {
          if (this.isClosed || this.feedbackGeneration !== gen) return;
          if (val !== false) {
            this.currentThemeId = themeId;
            this.tui.requestRender?.();
          }
        }).catch(() => {});
      } else if (res !== false) {
        this.currentThemeId = themeId;
      }
    } catch {}
  }

  private close(selected?: unknown): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.options.onClose?.();
    this.done(selected);
  }

  handleInput(data: string): void {
    if (this.isClosed) return;

    // Esc / Ctrl+C -> cancel or clear search filter first
    if (
      this.keybindings?.matches?.(data, "tui.select.cancel") ||
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.esc) ||
      data === "\x1b" ||
      data === "\x03"
    ) {
      if (this.filter.length > 0) {
        this.filter = "";
        this.reindex();
        this.tui.requestRender?.();
        return;
      }
      this.options?.onCancelTheme?.(this.initialThemeId, this.initialBackgroundId);
      this.close(undefined);
      return;
    }

    // Enter / Return -> confirm and apply
    if (
      this.keybindings?.matches?.(data, "tui.select.confirm") ||
      matchesKey(data, Key.enter) ||
      data === "\r" ||
      data === "\n"
    ) {
      if (!this.isBgFocused) {
        const sel = this.filteredThemes[this.themeCursor];
        if (sel) {
          if (!this.options.onSelectTheme) return;
          try {
            const res = (this.options.onSelectTheme as any)(sel.id);
            if (res instanceof Promise) {
              const gen = ++this.feedbackGeneration;
              res.then((val) => {
                if (this.isClosed || this.feedbackGeneration !== gen) return;
                if (val === false) {
                  this.feedbackText = `Failed to apply theme: ${sel.name}`;
                  this.tui.requestRender?.();
                } else {
                  this.currentThemeId = sel.id;
                  this.feedbackText = `theme → ${sel.name}`;
                  this.close(sel.id);
                }
              }).catch((err: any) => {
                if (this.isClosed || this.feedbackGeneration !== gen) return;
                this.feedbackText = `Error: ${err?.message || sel.name}`;
                this.tui.requestRender?.();
              });
              return;
            } else if (res === false) {
              this.feedbackText = `Failed to apply theme: ${sel.name}`;
              this.tui.requestRender?.();
              return;
            }
            this.currentThemeId = sel.id;
            this.feedbackText = `theme → ${sel.name}`;
            this.close(sel.id);
          } catch (err: any) {
            this.feedbackText = `Error: ${err?.message || sel.name}`;
            this.tui.requestRender?.();
          }
        }
      } else {
        const sel = this.filteredBackgrounds[this.bgCursor];
        if (sel) {
          if (!this.options.onSelectBackground) return;
          try {
            const res = (this.options.onSelectBackground as any)(sel.id);
            if (res instanceof Promise) {
              const gen = ++this.feedbackGeneration;
              res.then((val) => {
                if (this.isClosed || this.feedbackGeneration !== gen) return;
                if (val === false) {
                  this.feedbackText = `Failed to apply background: ${sel.name}`;
                  this.tui.requestRender?.();
                } else {
                  this.currentBackgroundId = sel.id;
                  this.feedbackText = `background → ${sel.name}`;
                  this.close(sel.id);
                }
              }).catch((err: any) => {
                if (this.isClosed || this.feedbackGeneration !== gen) return;
                this.feedbackText = `Error: ${err?.message || sel.name}`;
                this.tui.requestRender?.();
              });
              return;
            } else if (res === false) {
              this.feedbackText = `Failed to apply background: ${sel.name}`;
              this.tui.requestRender?.();
              return;
            }
            this.currentBackgroundId = sel.id;
            this.feedbackText = `background → ${sel.name}`;
            this.close(sel.id);
          } catch (err: any) {
            this.feedbackText = `Error: ${err?.message || sel.name}`;
            this.tui.requestRender?.();
          }
        }
      }
      return;
    }

    // Up Arrow -> navigate up + live preview immediately on cursor move
    if (
      this.keybindings?.matches?.(data, "tui.select.up") ||
      matchesKey(data, Key.up) ||
      data === "\x1b[A"
    ) {
      if (!this.isBgFocused) {
        const n = this.filteredThemes.length;
        if (n > 0) {
          this.themeCursor = (this.themeCursor - 1 + n) % n;
          const sel = this.filteredThemes[this.themeCursor];
          if (sel) {
            this.previewTheme(sel.id);
          }
        }
      } else {
        const n = this.filteredBackgrounds.length;
        if (n > 0) {
          this.bgCursor = (this.bgCursor - 1 + n) % n;
          const sel = this.filteredBackgrounds[this.bgCursor];
          if (sel) {
            try {
              const res: any = this.options.onPreviewBackground
                ? this.options.onPreviewBackground(sel.id)
                : this.options.onSelectBackground
                ? this.options.onSelectBackground(sel.id)
                : undefined;
              if (res instanceof Promise) {
                const gen = ++this.feedbackGeneration;
                res.then((val: any) => {
                  if (this.isClosed || this.feedbackGeneration !== gen) return;
                  if (val !== false) {
                    this.currentBackgroundId = sel.id;
                    this.tui.requestRender?.();
                  }
                }).catch(() => {});
              } else if (res !== false) {
                this.currentBackgroundId = sel.id;
              }
            } catch {}
          }
        }
      }
      this.tui.requestRender?.();
      return;
    }

    // Down Arrow -> navigate down + live preview immediately on cursor move
    if (
      this.keybindings?.matches?.(data, "tui.select.down") ||
      matchesKey(data, Key.down) ||
      data === "\x1b[B"
    ) {
      if (!this.isBgFocused) {
        const n = this.filteredThemes.length;
        if (n > 0) {
          this.themeCursor = (this.themeCursor + 1) % n;
          const sel = this.filteredThemes[this.themeCursor];
          if (sel) {
            this.previewTheme(sel.id);
          }
        }
      } else {
        const n = this.filteredBackgrounds.length;
        if (n > 0) {
          this.bgCursor = (this.bgCursor + 1) % n;
          const sel = this.filteredBackgrounds[this.bgCursor];
          if (sel) {
            try {
              const res: any = this.options.onPreviewBackground
                ? this.options.onPreviewBackground(sel.id)
                : this.options.onSelectBackground
                ? this.options.onSelectBackground(sel.id)
                : undefined;
              if (res instanceof Promise) {
                const gen = ++this.feedbackGeneration;
                res.then((val: any) => {
                  if (this.isClosed || this.feedbackGeneration !== gen) return;
                  if (val !== false) {
                    this.currentBackgroundId = sel.id;
                    this.tui.requestRender?.();
                  }
                }).catch(() => {});
              } else if (res !== false) {
                this.currentBackgroundId = sel.id;
              }
            } catch {}
          }
        }
      }
      this.tui.requestRender?.();
      return;
    }

    // PageUp -> jump up 5 rows + live preview
    if (this.keybindings?.matches?.(data, "tui.select.pageUp") || matchesKey(data, Key.pageUp)) {
      if (!this.isBgFocused) {
        const n = this.filteredThemes.length;
        if (n > 0) {
          this.themeCursor = Math.max(0, this.themeCursor - 5);
          const sel = this.filteredThemes[this.themeCursor];
          if (sel) this.previewTheme(sel.id);
        }
      } else {
        const n = this.filteredBackgrounds.length;
        if (n > 0) {
          this.bgCursor = Math.max(0, this.bgCursor - 5);
        }
      }
      this.tui.requestRender?.();
      return;
    }

    // PageDown -> jump down 5 rows + live preview
    if (this.keybindings?.matches?.(data, "tui.select.pageDown") || matchesKey(data, Key.pageDown)) {
      if (!this.isBgFocused) {
        const n = this.filteredThemes.length;
        if (n > 0) {
          this.themeCursor = Math.min(n - 1, this.themeCursor + 5);
          const sel = this.filteredThemes[this.themeCursor];
          if (sel) this.previewTheme(sel.id);
        }
      } else {
        const n = this.filteredBackgrounds.length;
        if (n > 0) {
          this.bgCursor = Math.min(n - 1, this.bgCursor + 5);
        }
      }
      this.tui.requestRender?.();
      return;
    }

    // Left Arrow -> switch to Palettes column
    if (matchesKey(data, Key.left) || data === "\x1b[D") {
      if (this.isBgFocused) {
        this.isBgFocused = false;
        this.tui.requestRender?.();
      }
      return;
    }

    // Right Arrow -> switch to Background surfaces column
    if (matchesKey(data, Key.right) || data === "\x1b[C") {
      if (!this.isBgFocused) {
        this.isBgFocused = true;
        this.tui.requestRender?.();
      }
      return;
    }

    // Tab -> cycle between Palettes and Background surfaces
    if (matchesKey(data, Key.tab) || data === "\t") {
      this.isBgFocused = !this.isBgFocused;
      this.tui.requestRender?.();
      return;
    }

    // Backspace -> delete filter character
    if (matchesKey(data, Key.backspace) || data === "\x7f" || data === "\b") {
      if (this.filter.length > 0) {
        this.filter = this.filter.slice(0, -1);
        this.reindex();
        this.tui.requestRender?.();
      }
      return;
    }

    // Printable runes / paste append to filter query
    if (!data.startsWith("\x1b") && data.length > 0 && !/[\x00-\x1f\x7f]/.test(data)) {
      this.filter += data;
      this.reindex();
      this.tui.requestRender?.();
      return;
    }
  }

  override handleMouse(event: any): any {
    if (this.isClosed) return undefined;
    if (event?.type === "wheel") {
      const delta = event.wheelDelta ?? 0;
      if (delta > 0) {
        this.handleInput("\x1b[B"); // down
        return { target: this, handled: true, render: true };
      }
      if (delta < 0) {
        this.handleInput("\x1b[A"); // up
        return { target: this, handled: true, render: true };
      }
    }
    return super.handleMouse?.(event);
  }

  override render(width: number): string[] {
    if (this.isClosed || width <= 0) return [];

    const safeW = Math.max(20, Math.floor(width));
    let boxW = safeW - 10;
    if (boxW < 70) boxW = 70;
    if (boxW > 150) boxW = 150;
    if (safeW < 74) boxW = Math.max(16, safeW - 2);

    const theme = this.theme;
    const fg = (col: ThemeColor, s: string) => fgSafe(theme, col, s);
    const bold = (s: string) => boldSafe(theme, s);
    const dim = (s: string) => dimSafe(theme, s);

    // Dialog interior dimensions (matching OMT dlgStyle with padding + borders)
    let padX = 3;
    let padY = 1;
    if (boxW < 70) {
      padX = boxW < 40 ? 0 : 1;
      padY = 0;
    }
    const innerW = Math.max(16, boxW - padX * 2);

    // Calculate 2-column widths: Palettes (left) and Background Surfaces (right)
    const sepStr = innerW >= 34 ? " │ " : "│";
    const sepW = visibleWidth(sepStr);
    const availColW = innerW - sepW;
    let bgW = 30;
    let leftW = innerW - sepW - bgW;
    if (leftW < 20 || boxW < 110) {
      leftW = Math.max(7, Math.floor(availColW / 2));
      bgW = Math.max(7, availColW - leftW);
    }
    const rightW = bgW;

    const termH =
      this.options?.viewportHeight ??
      (this.tui as any)?.terminal?.rows ??
      (this.tui as any)?.height ??
      49;
    let win = termH - 14;
    if (win < 12) win = 12;
    if (win > 24) win = 24;

    // -------------------------------------------------------------------------
    // 1. Left Column: Palettes (with ✓ current, accent hex, (light) indicator)
    // -------------------------------------------------------------------------
    const totalPalettes = this.filteredThemes.length;
    const {
      start: pStart,
      end: pEnd,
      hasAbove: pAbove,
      hasBelow: pBelow,
    } = fixedWin(this.themeCursor, totalPalettes, win);

    const leftLines: string[] = [];
    if (pAbove) {
      leftLines.push(padToVisibleWidth(dim(`…(+${pStart} above)`), leftW));
    }

    for (let i = pStart; i < pEnd; i++) {
      const t = this.filteredThemes[i]!;
      const isCursor = i === this.themeCursor;
      const isCurrent = t.id === this.currentThemeId || t.isCurrent;
      const isLight = t.light ?? LIGHT_PALETTES.has(t.id);
      const accent = t.accent ?? "";

      const prefix = isCursor
        ? !this.isBgFocused
          ? fg("accent", "▸ ")
          : dim("▸ ")
        : "  ";

      // Build descriptive details: (light), hex, and ✓ current
      const details: string[] = [];
      if (isCurrent) details.push("✓ current");
      if (isLight) details.push("(light)");
      if (accent) details.push(accent);

      let rowText = "";
      if (leftW >= 32) {
        const nameColW = Math.min(18, Math.max(10, Math.floor(leftW * 0.45)));
        const paddedName = padToVisibleWidth(t.name, nameColW);
        const descText = details.length > 0 ? `— ${details.join(" · ")}` : "";
        rowText = padToVisibleWidth(`${paddedName} ${descText}`, leftW - 2);
      } else if (leftW >= 20) {
        const descText = details.length > 0 ? ` ${details.join(" · ")}` : "";
        rowText = padToVisibleWidth(`${t.name}${descText}`, leftW - 2);
      } else if (leftW >= 12) {
        const curMark = isCurrent ? " ✓" : isLight ? " (l)" : "";
        rowText = padToVisibleWidth(`${t.name}${curMark}`, leftW - 2);
      } else {
        const curMark = isCurrent ? "✓" : "";
        rowText = padToVisibleWidth(`${t.name} ${curMark}`.trim(), leftW - 2);
      }

      let styledRow = rowText;
      if (isCursor && !this.isBgFocused) {
        styledRow = bold(fg("accent", rowText));
      } else if (isCurrent) {
        styledRow = fg("text", rowText);
      } else {
        styledRow = dim(rowText);
      }

      leftLines.push(padToVisibleWidth(`${prefix}${styledRow}`, leftW));
    }

    if (pBelow) {
      leftLines.push(padToVisibleWidth(dim(`…(+${totalPalettes - pEnd} below)`), leftW));
    }
    if (totalPalettes === 0) {
      leftLines.push(padToVisibleWidth(dim("— no match —"), leftW));
    }
    while (leftLines.length < win) {
      leftLines.push(" ".repeat(leftW));
    }

    // -------------------------------------------------------------------------
    // 2. Right Column: Background Surfaces (swatch, name, ✓ current, hex)
    // -------------------------------------------------------------------------
    const totalBgs = this.filteredBackgrounds.length;
    const {
      start: bStart,
      end: bEnd,
      hasAbove: bAbove,
      hasBelow: bBelow,
    } = fixedWin(this.bgCursor, totalBgs, win);

    const rightLines: string[] = [];
    if (bAbove) {
      rightLines.push(padToVisibleWidth(dim(`…(+${bStart} above)`), rightW));
    }

    for (let i = bStart; i < bEnd; i++) {
      const b = this.filteredBackgrounds[i]!;
      const isCursor = i === this.bgCursor;
      const isCurrent = b.id === this.currentBackgroundId || b.isCurrent;
      const hex = this.getBackgroundHex(b);
      const swatch = renderSwatch(hex);

      const prefix = isCursor
        ? this.isBgFocused
          ? fg("accent", "▸ ")
          : dim("▸ ")
        : "  ";

      const curMark = isCurrent ? " ✓" : "";
      const hexDesc = hex ? hex : "terminal bg";

      let rowText = "";
      if (rightW >= 28) {
        const nameW = Math.min(16, Math.max(10, Math.floor(rightW * 0.42)));
        const paddedName = padToVisibleWidth(b.name, nameW);
        const descText = isCurrent ? `✓ current · ${hexDesc}` : hexDesc;
        rowText = padToVisibleWidth(`${swatch} ${paddedName} — ${descText}`, rightW - 2);
      } else if (rightW >= 18) {
        rowText = padToVisibleWidth(`${swatch} ${b.name}${curMark} ${hex}`, rightW - 2);
      } else if (rightW >= 12) {
        rowText = padToVisibleWidth(`${swatch} ${b.name}${curMark}`, rightW - 2);
      } else {
        rowText = padToVisibleWidth(`${swatch}${b.name}${curMark}`, rightW - 2);
      }

      let styledRow = rowText;
      if (isCursor && this.isBgFocused) {
        styledRow = bold(fg("accent", rowText));
      } else if (isCurrent) {
        styledRow = fg("text", rowText);
      } else {
        styledRow = dim(rowText);
      }

      rightLines.push(padToVisibleWidth(`${prefix}${styledRow}`, rightW));
    }

    if (bBelow) {
      rightLines.push(padToVisibleWidth(dim(`…(+${totalBgs - bEnd} below)`), rightW));
    }
    if (totalBgs === 0) {
      rightLines.push(padToVisibleWidth(dim("— no match —"), rightW));
    }
    while (rightLines.length < win) {
      rightLines.push(" ".repeat(rightW));
    }

    // -------------------------------------------------------------------------
    // 3. Assemble Inner Rows: Title, Message, Filter, Headers, Columns, Footer
    // -------------------------------------------------------------------------
    const innerLines: string[] = [];

    // Title line
    const titleText =
      innerW >= 42
        ? "THEME & SURFACE SETTINGS"
        : innerW >= 24
          ? "THEME & SURFACES"
          : "THEMES";
    innerLines.push(bold(fg("accent", titleText)));

    // Message hint line
    if (innerW >= 60) {
      innerLines.push(
        dim("↑↓ previews live · → background column · Enter applies · Esc closes"),
      );
    } else if (innerW >= 36) {
      innerLines.push(dim("↑↓ preview live · Tab column · Enter apply · Esc close"));
    } else {
      innerLines.push(dim("↑↓ preview · ↵ apply"));
    }

    // Filter line
    innerLines.push(dim("filter: ") + fg("text", `${this.filter}▌`));

    // Column Headers line
    const palHeadText = innerW >= 44 ? `PALETTES · ${totalPalettes}` : `PAL (${totalPalettes})`;
    const bgHeadText = innerW >= 44 ? `BACKGROUND · ${totalBgs}` : `SURFACE (${totalBgs})`;

    const styledPalHead = !this.isBgFocused ? bold(fg("accent", palHeadText)) : dim(palHeadText);
    const styledBgHead = this.isBgFocused ? bold(fg("accent", bgHeadText)) : dim(bgHeadText);

    const headLine = `${padToVisibleWidth(styledPalHead, leftW)}${fg("border", sepStr)}${padToVisibleWidth(styledBgHead, rightW)}`;
    innerLines.push(headLine);

    // Ruled column divider
    const sepMidGlyph = sepStr === " │ " ? "─┼─" : "┼";
    const dividerLine = fg("border", "─".repeat(leftW) + sepMidGlyph + "─".repeat(rightW));
    innerLines.push(dividerLine);

    // Merged 2-column list lines
    for (let r = 0; r < win; r++) {
      const l = leftLines[r] ?? " ".repeat(leftW);
      const rg = rightLines[r] ?? " ".repeat(rightW);
      innerLines.push(`${padToVisibleWidth(l, leftW)}${fg("border", sepStr)}${padToVisibleWidth(rg, rightW)}`);
    }

    // Bottom column divider
    const sepBotGlyph = sepStr === " │ " ? "─┴─" : "┴";
    innerLines.push(fg("border", "─".repeat(leftW) + sepBotGlyph + "─".repeat(rightW)));

    // Footer info line: active selection status
    const curThemeObj = this.themes.find((t) => t.id === this.currentThemeId);
    const curThemeLabel = curThemeObj?.name ?? this.currentThemeId;
    const curBgObj = this.backgrounds.find((b) => b.id === this.currentBackgroundId);
    const curBgLabel = curBgObj?.name ?? this.currentBackgroundId;

    if (this.feedbackText) {
      innerLines.push(fg("success", this.feedbackText));
    } else if (innerW >= 46) {
      innerLines.push(
        dim("active: ") +
          bold(fg("accent", curThemeLabel)) +
          dim(" · surface: ") +
          bold(fg("accent", curBgLabel)),
      );
    } else {
      innerLines.push(bold(fg("accent", `${curThemeLabel} / ${curBgLabel}`)));
    }

    // -------------------------------------------------------------------------
    // 4. Wrap Everything in Rounded Unicode Border Box (╭─╮, │, ╰─╯)
    // -------------------------------------------------------------------------
    const finalBoxLines: string[] = [];
    const topBar = `╭${"─".repeat(Math.max(0, boxW))}╮`;
    const botBar = `╰${"─".repeat(Math.max(0, boxW))}╯`;

    finalBoxLines.push(fg("border", topBar));
    if (padY > 0) {
      finalBoxLines.push(`${fg("border", "│")}${" ".repeat(Math.max(0, boxW))}${fg("border", "│")}`);
    }

    const hPad = " ".repeat(padX);
    for (const rawLine of innerLines) {
      const clamped = truncateToWidth(rawLine, innerW, "");
      const paddedContent = padToVisibleWidth(clamped, innerW);
      finalBoxLines.push(
        `${fg("border", "│")}${hPad}${paddedContent}${hPad}${fg("border", "│")}`,
      );
    }

    if (padY > 0) {
      finalBoxLines.push(`${fg("border", "│")}${" ".repeat(Math.max(0, boxW))}${fg("border", "│")}`);
    }
    finalBoxLines.push(fg("border", botBar));

    // Ensure all lines adhere strictly to safeW without horizontal overflow
    return finalBoxLines.map((line) => {
      const w = visibleWidth(line);
      if (w > safeW) {
        return truncateToWidth(line, safeW, "");
      }
      return line;
    });
  }

  dispose(): void {
    if (this.isClosed) return;
    this.isClosed = true;
  }
}

// =============================================================================
// Aliases & Factory Functions
// =============================================================================

export class ThemePickerComponent extends OmtThemePickerComponent {}

export function createOmtThemePickerComponent(
  tui: TUI,
  theme: Theme,
  keybindings?: KeybindingsManager,
  done?: (value?: unknown) => void,
  ctxOrOptions?: ExtensionContext | ThemePickerOptions,
  maybeOptions?: ThemePickerOptions,
): OmtThemePickerComponent {
  return new OmtThemePickerComponent(tui, theme, keybindings, done, ctxOrOptions, maybeOptions);
}

export function createThemePickerComponent(
  tui: TUI,
  theme: Theme,
  keybindings?: KeybindingsManager,
  done?: (value?: unknown) => void,
  ctxOrOptions?: ExtensionContext | ThemePickerOptions,
  maybeOptions?: ThemePickerOptions,
): OmtThemePickerComponent {
  return new OmtThemePickerComponent(tui, theme, keybindings, done, ctxOrOptions, maybeOptions);
}
