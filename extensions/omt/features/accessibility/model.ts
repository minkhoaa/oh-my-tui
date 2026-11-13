import type { Theme, ThemeBg, ThemeColor } from "@earendil-works/pi-coding-agent";

import type { AccessibilitySettings, ShortcutHelpEntry } from "./types.ts";

export type { AccessibilitySettings, ShortcutHelpEntry } from "./types.ts";

// ==========================================
// Accessibility Store
// ==========================================

export class AccessibilityStore {
  private settings: AccessibilitySettings = {
    highContrast: false,
    screenReaderFriendly: false,
    plainTextAsciiBorders: false,
    reducedMotion: false,
  };

  private listeners = new Set<(settings: AccessibilitySettings) => void>();

  getSettings(): AccessibilitySettings {
    return { ...this.settings };
  }

  isHighContrast(): boolean {
    return this.settings.highContrast;
  }

  isScreenReaderFriendly(): boolean {
    return this.settings.screenReaderFriendly;
  }

  isPlainTextAsciiBorders(): boolean {
    return this.settings.plainTextAsciiBorders;
  }

  isReducedMotion(): boolean {
    return this.settings.reducedMotion;
  }

  updateSettings(partial: Partial<AccessibilitySettings>): AccessibilitySettings {
    this.settings = { ...this.settings, ...partial };
    this.notify();
    return this.getSettings();
  }

  setHighContrast(val: boolean): void {
    this.updateSettings({ highContrast: val });
  }

  setScreenReaderFriendly(val: boolean): void {
    this.updateSettings({ screenReaderFriendly: val });
  }

  setPlainTextAsciiBorders(val: boolean): void {
    this.updateSettings({ plainTextAsciiBorders: val });
  }

  setReducedMotion(val: boolean): void {
    this.updateSettings({ reducedMotion: val });
  }

  toggleHighContrast(): boolean {
    const next = !this.settings.highContrast;
    this.setHighContrast(next);
    return next;
  }

  toggleScreenReaderFriendly(): boolean {
    const next = !this.settings.screenReaderFriendly;
    this.setScreenReaderFriendly(next);
    return next;
  }

  togglePlainTextAsciiBorders(): boolean {
    const next = !this.settings.plainTextAsciiBorders;
    this.setPlainTextAsciiBorders(next);
    return next;
  }

  toggleReducedMotion(): boolean {
    const next = !this.settings.reducedMotion;
    this.setReducedMotion(next);
    return next;
  }

  reset(): void {
    this.settings = {
      highContrast: false,
      screenReaderFriendly: false,
      plainTextAsciiBorders: false,
      reducedMotion: false,
    };
    this.notify();
  }

  subscribe(listener: (settings: AccessibilitySettings) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const current = this.getSettings();
    for (const listener of this.listeners) {
      try {
        listener(current);
      } catch {
        // Suppress listener failure
      }
    }
  }
}

export const accessibilityStore = new AccessibilityStore();

// ==========================================
// High Contrast Palette & Styling Helpers
// ==========================================

export interface HighContrastPalette {
  foreground: string;
  background: string;
  border: string;
  accent: string;
  warning: string;
  error: string;
  success: string;
  dim: string;
  muted: string;
}

export const HIGH_CONTRAST_PALETTE: HighContrastPalette = {
  foreground: "#ffffff",
  background: "#000000",
  border: "#ffffff",
  accent: "#ffff00",     // High visibility bright yellow
  warning: "#ffff00",    // Bright yellow
  error: "#ff5555",      // Bright red
  success: "#55ff55",    // Bright green
  dim: "#ffffff",        // Keep bright, no low-contrast text
  muted: "#dddddd",      // Readably bright muted
};

/**
 * Adapt a Pi Theme for high-contrast viewing.
 * Replaces faint/dim colors with maximal contrast colors and bold weights.
 */
export function adaptThemeForHighContrast(baseTheme: Theme): Theme {
  const adapted = Object.create(baseTheme);
  adapted.bold = (text: string) => `\x1b[1m${text}\x1b[22m`;
  adapted.fg = (color: ThemeColor, text: string) => {
    switch (color) {
      case "error":
        return `\x1b[1;91m${text}\x1b[0m`; // Bright bold red
      case "warning":
        return `\x1b[1;93m${text}\x1b[0m`; // Bright bold yellow
      case "success":
        return `\x1b[1;92m${text}\x1b[0m`; // Bright bold green
      case "accent":
        return `\x1b[1;93m${text}\x1b[0m`; // Bright bold yellow
      case "border":
        return `\x1b[1;97m${text}\x1b[0m`; // Bright bold white
      case "dim":
      case "muted":
        return `\x1b[97m${text}\x1b[0m`;   // Bright white (not faint)
      default:
        return `\x1b[97m${text}\x1b[0m`;   // Maximum white contrast
    }
  };
  adapted.bg = (color: ThemeBg, text: string) => {
    if ((color as string) === "accent") {
      return `\x1b[43;30m${text}\x1b[0m`; // Inverted yellow background with black text
    }
    return `\x1b[40m${text}\x1b[0m`;       // Pure black background
  };
  return adapted as Theme;
}

/**
 * Helper to apply accessible styling respecting highContrast settings.
 */
export function styleAccessible(
  theme: Theme,
  color: ThemeColor,
  text: string,
  options?: { highContrast?: boolean; bold?: boolean },
): string {
  const isHc = options?.highContrast ?? accessibilityStore.isHighContrast();
  if (isHc) {
    const boldPrefix = options?.bold !== false ? "\x1b[1m" : "";
    switch (color) {
      case "error":
        return `${boldPrefix}\x1b[91m${text}\x1b[0m`;
      case "warning":
        return `${boldPrefix}\x1b[93m${text}\x1b[0m`;
      case "success":
        return `${boldPrefix}\x1b[92m${text}\x1b[0m`;
      case "accent":
        return `${boldPrefix}\x1b[93m${text}\x1b[0m`;
      case "border":
        return `${boldPrefix}\x1b[97m${text}\x1b[0m`;
      default:
        return `${boldPrefix}\x1b[97m${text}\x1b[0m`;
    }
  }

  let formatted = theme.fg ? theme.fg(color, text) : text;
  if (options?.bold && theme.bold) {
    formatted = theme.bold(formatted);
  }
  return formatted;
}

// ==========================================
// Plain Text ASCII Border Converter
// ==========================================

const ASCII_BORDER_MAP: Record<string, string> = {
  // Corners
  "╭": "+", "╮": "+", "╯": "+", "╰": "+",
  "┌": "+", "┐": "+", "┘": "+", "└": "+",
  "╔": "+", "╗": "+", "╝": "+", "╚": "+",
  "┏": "+", "┓": "+", "┛": "+", "┗": "+",
  // T-junctions & Crosses
  "┬": "+", "┴": "+", "├": "+", "┤": "+", "┼": "+",
  "╦": "+", "╩": "+", "╠": "+", "╣": "+", "╬": "+",
  "┳": "+", "┻": "+", "┣": "+", "┫": "+", "╋": "+",
  // Lines
  "─": "-", "━": "-", "═": "-",
  "│": "|", "┃": "|", "║": "|",
  // Bullets & Dots
  "•": "*", "●": "*", "○": "*", "◆": "*", "◇": "*", "■": "*", "□": "*", "▪": "*", "▫": "*",
  // Arrows & Triangles
  "▶": ">", "◀": "<", "▲": "^", "▼": "v",
  "→": "->", "←": "<-", "↑": "^", "↓": "v",
  // Blocks & Symbols
  "▏": "|", "▎": "|", "▍": "|", "▌": "|", "▋": "|", "▊": "|", "▉": "|", "█": "|",
  "…": "...",
  "✔": "[v]", "✓": "[v]",
  "✖": "[x]", "✗": "[x]",
};

const ASCII_BORDER_REGEX = /[╭╮╯╰┌┐┘└╔╗╝╚┏┓┛┗┬┴├┤┼╦╩╠╣╬┳┻┣┫╋─━═│┃║•●○◆◇■□▪▫▶◀▲▼→←↑↓▏▎▍▌▋▊▉█…✔✓✖✗]/g;

/**
 * Replace box-drawing glyphs (╭─╰│), corners, and decorative symbols with ASCII equivalents (+-|*).
 */
export function asciiBorder(str: string): string {
  if (!str) return "";
  return str.replace(ASCII_BORDER_REGEX, (ch) => ASCII_BORDER_MAP[ch] ?? ch);
}

