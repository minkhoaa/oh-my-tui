/**
 * OMT Model Picker Component (3-column: Provider / Model / Spec Detail).
 */

import { Container, Text, matchesKey, Key, visibleWidth, truncateToWidth, type KeybindingsManager, type TUI, type Component, type Focusable } from "@earendil-works/pi-tui";
import type { Theme, ThemeColor, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getBorderStyler } from "../../presets/shared/style.ts";
import { accessibilityStore } from "../../features/accessibility/model.ts";
import type { ModelPickerOptions, ModelSpec } from "./types.ts";
import { fixedWin, formatNumber, shorten, fit } from "./model.ts";
import { selectedDialogRow } from "./presentation.ts";

// -----------------------------------------------------------------------------
// Theme & Styling Helpers
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// Model Detail & Provider Formatting Helpers
// -----------------------------------------------------------------------------

/**
 * normProv labels an empty provider for the left pane.
 */
export function normProv(prov?: string): string {
  if (!prov || prov.trim() === "") return "other";
  return prov.trim();
}

/**
 * modelHost strips a base URL down to its host ("https://api.x.com/v1" -> "api.x.com").
 */
export function modelHost(baseURL?: string): string {
  if (!baseURL) return "—";
  let s = baseURL.trim();
  s = s.replace(/^https?:\/\//i, "");
  const slashIdx = s.indexOf("/");
  if (slashIdx >= 0) s = s.slice(0, slashIdx);
  const atIdx = s.indexOf("@");
  if (atIdx >= 0) s = s.slice(atIdx + 1);
  return s || "—";
}

/**
 * modelCostPair formats "$in / $out per 1M", "—" when both are zero or undefined.
 */
export function modelCostPair(inp?: number, out?: number): string {
  if ((inp === undefined || inp === 0) && (out === undefined || out === 0)) {
    return "—";
  }
  const inStr = inp !== undefined ? `$${inp}` : "$0";
  const outStr = out !== undefined ? `$${out}` : "$0";
  return `${inStr} / ${outStr} per 1M`;
}

/**
 * modelThinking lists usable thinking levels or "supported" / "on", "—" when none.
 */
export function modelThinking(thinking?: boolean | { maxTokens?: number }): string {
  if (!thinking) return "—";
  if (typeof thinking === "object" && thinking.maxTokens) {
    return `up to ${formatNumber(thinking.maxTokens)}`;
  }
  return "on";
}

/**
 * isProviderConnected reports whether a provider has ready credentials.
 */
export function isProviderConnected(prov: string, models: ModelSpec[]): boolean {
  const norm = normProv(prov).toLowerCase();
  for (const m of models) {
    if (normProv(m.provider).toLowerCase() === norm) {
      if (m.keyStatus === "ready" || m.keyStatus === "unneeded") {
        return true;
      }
    }
  }
  return false;
}

/**
 * buildProviderList collects unique providers: "All" first, then connected providers,
 * then unconnected providers, sorted alphabetically within each group.
 */
export function buildProviderList(models: ModelSpec[]): string[] {
  const set = new Set<string>();
  for (const m of models) {
    set.add(normProv(m.provider));
  }
  const rest = Array.from(set);
  rest.sort((a, b) => {
    const aConn = isProviderConnected(a, models) ? 1 : 0;
    const bConn = isProviderConnected(b, models) ? 1 : 0;
    if (aConn !== bConn) return bConn - aConn;
    return a.localeCompare(b);
  });
  return ["All", ...rest];
}

/**
 * sortProviders floats connected providers above the rest (after "All"),
 * keeping alphabetical order inside each group.
 */
export function sortProviders(
  provs: string[],
  conn: Map<string, boolean> | Record<string, boolean>,
): string[] {
  if (provs.length <= 2) return [...provs];
  const all = provs[0]!;
  const rest = provs.slice(1);
  const isConn = (p: string) => {
    if (conn instanceof Map) return Boolean(conn.get(p));
    return Boolean((conn as Record<string, boolean>)[p]);
  };
  rest.sort((a, b) => {
    const aC = isConn(a) ? 1 : 0;
    const bC = isConn(b) ? 1 : 0;
    if (aC !== bC) return bC - aC;
    return a.localeCompare(b);
  });
  return [all, ...rest];
}

/**
 * matchModelText reports whether a model matches the filter query across ID,
 * name, provider, API, and input modalities.
 */
function matchModelText(m: ModelSpec, query: string): boolean {
  if (!query || query.trim() === "") return true;
  const q = query.toLowerCase().trim();
  if (m.id.toLowerCase().includes(q)) return true;
  if (m.name && m.name.toLowerCase().includes(q)) return true;
  if (m.provider && m.provider.toLowerCase().includes(q)) return true;
  if (m.providerLabel && m.providerLabel.toLowerCase().includes(q)) return true;
  if (m.api && m.api.toLowerCase().includes(q)) return true;
  if (m.baseUrl && modelHost(m.baseUrl).toLowerCase().includes(q)) return true;
  if (m.inputModalities && m.inputModalities.some((k) => k.toLowerCase().includes(q))) return true;
  return false;
}

/**
 * Count models matching filter for a specific provider.
 */
function provCount(prov: string, models: ModelSpec[], query: string): number {
  let count = 0;
  for (const m of models) {
    if (prov !== "All" && normProv(m.provider) !== prov) continue;
    if (matchModelText(m, query)) count++;
  }
  return count;
}

export interface ExtendedModelPickerOptions extends ModelPickerOptions {
  viewportWidth?: number;
  viewportHeight?: number;
}

// -----------------------------------------------------------------------------
// Model Picker Component
// -----------------------------------------------------------------------------

export class OmtModelPickerComponent extends Container implements Component, Focusable {
  focused = true;
  readonly capturesViewportInput = true;

  private tui: TUI;
  private theme: Theme;
  private keybindings?: KeybindingsManager;
  private done: (value?: unknown) => void;
  private ctx: ExtensionContext;
  private options: ExtendedModelPickerOptions;

  // Navigation State
  private providers: string[] = [];
  private providerCursor: number = 0;
  private isModelListFocused: boolean = false; // false = provider column, true = models column
  private modelCursor: number = 0;
  private query: string = "";
  private favorites: Set<string> = new Set();
  private closed: boolean = false;
  private feedbackText: string = "";

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager | undefined | null,
    done: (value?: unknown) => void,
    ctx: ExtensionContext,
    options: ExtendedModelPickerOptions,
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings ?? undefined;
    this.done = done;
    this.ctx = ctx;
    this.options = options;

    if (options.favoriteModelIds) {
      this.favorites = new Set(options.favoriteModelIds);
    } else {
      for (const m of options.models) {
        if (m.isFavorite) this.favorites.add(m.favoriteKey ?? m.id);
      }
    }

    this.providers = buildProviderList(options.models);

    if (options.currentModelId) {
      const idx = options.models.findIndex((m) => m.id === options.currentModelId && (!options.currentModelProvider || m.provider === options.currentModelProvider));
      if (idx >= 0) {
        const p = normProv(options.models[idx]!.provider);
        const pIdx = this.providers.indexOf(p);
        if (pIdx >= 0) this.providerCursor = pIdx;
        const current = options.models[idx]!;
        this.modelCursor = Math.max(0, this.getFilteredModels().findIndex(m => m.id === current.id && m.provider === current.provider));
      }
    }
  }

  private reindexProviders(): void {
    this.providers = buildProviderList(this.options.models);
  }

  getCurrentProvider(): string {
    return this.providers[this.providerCursor] ?? "All";
  }

  getProviders(): string[] {
    return [...this.providers];
  }

  getProviderCursor(): number {
    return this.providerCursor;
  }

  getModelCursor(): number {
    return this.modelCursor;
  }

  isProviderColumnFocused(): boolean {
    return !this.isModelListFocused;
  }

  getQuery(): string {
    return this.query;
  }

  getFilteredModels(): ModelSpec[] {
    const curProv = this.getCurrentProvider();
    const models = this.options.models.filter((m) => {
      if (curProv !== "All" && normProv(m.provider) !== curProv) return false;
      return matchModelText(m, this.query);
    });

    if (this.favorites.size > 0) {
      const favs: ModelSpec[] = [];
      const nonFavs: ModelSpec[] = [];
      for (const m of models) {
        if (this.favorites.has(m.favoriteKey ?? m.id)) {
          favs.push(m);
        } else {
          nonFavs.push(m);
        }
      }
      return [...favs, ...nonFavs];
    }

    return models;
  }

  getSelectedModel(): ModelSpec | undefined {
    const models = this.getFilteredModels();
    return models[this.modelCursor];
  }

  isFavorite(m: ModelSpec | string): boolean {
    const id = typeof m === "string" ? m : m.favoriteKey ?? m.id;
    return this.favorites.has(id);
  }

  toggleFavorite(modelOrId?: ModelSpec | string): void {
    let target: ModelSpec | undefined;
    if (typeof modelOrId === "object" && modelOrId !== null) {
      target = modelOrId;
    } else if (typeof modelOrId === "string") {
      target = this.options.models.find((m) => m.id === modelOrId);
    } else {
      target = this.getSelectedModel();
    }
    const id = target ? target.id : typeof modelOrId === "string" ? modelOrId : undefined;
    if (!id) return;
    const key = target?.favoriteKey ?? id;
    const nextState = !this.favorites.has(key);
    if (nextState) {
      this.favorites.add(key);
    } else {
      this.favorites.delete(key);
    }
    this.options.onToggleFavorite?.(key, nextState);
    this.feedbackText = nextState ? `Starred ${id}` : `Unstarred ${id}`;

    // Cursor follows the toggled model
    const updatedModels = this.getFilteredModels();
    const newIdx = updatedModels.findIndex((m) => (m.favoriteKey ?? m.id) === key);
    if (newIdx >= 0) {
      this.modelCursor = newIdx;
    }

    this.tui.requestRender?.();
  }

  setFeedback(msg: string): void {
    this.feedbackText = msg;
    this.tui.requestRender?.();
  }

  dispose(): void {
    this.close();
  }

  private close(result?: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.done(result);
  }

  handleInput(data: string): void {
    if (this.closed) return;

    // Esc: clear filter first; if already empty, dismiss dialog
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

    // Up / Down navigation
    if (this.keybindings?.matches?.(data, "tui.select.up") || matchesKey(data, Key.up) || data === "\x1b[A") {
      if (!this.isModelListFocused) {
        if (this.providers.length > 0) {
          this.providerCursor =
            (this.providerCursor - 1 + this.providers.length) % this.providers.length;
          this.modelCursor = 0;
        }
      } else {
        const models = this.getFilteredModels();
        if (models.length > 0) {
          this.modelCursor = (this.modelCursor - 1 + models.length) % models.length;
        }
      }
      this.tui.requestRender?.();
      return;
    }

    if (this.keybindings?.matches?.(data, "tui.select.down") || matchesKey(data, Key.down) || data === "\x1b[B") {
      if (!this.isModelListFocused) {
        if (this.providers.length > 0) {
          this.providerCursor = (this.providerCursor + 1) % this.providers.length;
          this.modelCursor = 0;
        }
      } else {
        const models = this.getFilteredModels();
        if (models.length > 0) {
          this.modelCursor = (this.modelCursor + 1) % models.length;
        }
      }
      this.tui.requestRender?.();
      return;
    }

    // Left arrow: switch to providers column
    if (matchesKey(data, Key.left) || data === "\x1b[D") {
      if (this.isModelListFocused) {
        this.isModelListFocused = false;
        this.tui.requestRender?.();
      }
      return;
    }

    // Right arrow: switch to models column (retains model selection)
    if (matchesKey(data, Key.right) || data === "\x1b[C") {
      if (!this.isModelListFocused) {
        this.isModelListFocused = true;
        const models = this.getFilteredModels();
        if (this.modelCursor >= models.length) {
          this.modelCursor = Math.max(0, models.length - 1);
        }
        this.tui.requestRender?.();
      }
      return;
    }

    // Tab: toggle column focus (retains model selection)
    if (matchesKey(data, Key.tab) || data === "\t") {
      this.isModelListFocused = !this.isModelListFocused;
      if (this.isModelListFocused) {
        const models = this.getFilteredModels();
        if (this.modelCursor >= models.length) {
          this.modelCursor = Math.max(0, models.length - 1);
        }
      }
      this.tui.requestRender?.();
      return;
    }

    // Star favorite: Ctrl+F only
    if (data === "\x06") {
      const sel = this.getSelectedModel();
      if (sel) {
        this.toggleFavorite(sel);
      }
      return;
    }

    // Enter: on provider column -> focus models; on models column -> select model
    if (matchesKey(data, Key.enter) || data === "\r" || data === "\n") {
      if (!this.isModelListFocused) {
        this.isModelListFocused = true;
        this.modelCursor = 0;
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

    // Backspace: remove last character from filter
    if (matchesKey(data, Key.backspace) || data === "\x7f" || data === "\b") {
      if (this.query.length > 0) {
        this.query = this.query.slice(0, -1);
        this.modelCursor = 0;
        this.tui.requestRender?.();
      }
      return;
    }

    // Printable / pasted text: append to filter query (including numbers 1-9; no numeric badge hijack)
    if (!data.startsWith("\x1b") && data.length > 0 && !/[\x00-\x1f\x7f]/.test(data)) {
      this.query += data;
      this.modelCursor = 0;
      this.tui.requestRender?.();
      return;
    }
  }

  /**
   * Renders the 3-column Model Picker inside rounded Unicode borders.
   */
  render(width: number): string[] {
    const rawWidth = Math.max(20, Math.floor(width));

    // Responsive boxW matching OMT: winW - 10 clamped to [70, 150]
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

    // Padding parameters: (1, 3)
    let padX = 3;
    let padY = 1;
    if (boxW < 70) {
      padX = boxW < 40 ? 0 : 1;
      padY = 0;
    }

    const innerW = Math.max(16, boxW - padX * 2);

    const curProv = this.getCurrentProvider();
    const models = this.getFilteredModels();
    const selModel = this.getSelectedModel();

    // -------------------------------------------------------------------------
    // 1. Column Width Calculations
    // -------------------------------------------------------------------------
    let leftW = 42;
    if (boxW < 120) leftW = 36;
    if (boxW < 100) leftW = 28;
    if (innerW < 45) leftW = Math.max(6, Math.floor(innerW * 0.38));

    const detW = 40;
    const detailCol = models.length > 0 && boxW >= 110;

    let rightW = boxW - 8 - leftW - 3;
    if (detailCol) {
      rightW -= detW + 3;
      if (rightW < 16) rightW = 16;
    } else if (rightW < 30) {
      rightW = Math.max(10, innerW - leftW - 3);
    }

    // Reference leaves two spare cells after its columns; do not stretch the
    // model column to absorb them (that shifts DETAILS by two cells).
    if (boxW < 70) rightW = Math.max(1, innerW - leftW - 3);

    // -------------------------------------------------------------------------
    // 2. Providers Column Rows (Left)
    // -------------------------------------------------------------------------
    const {
      start: pStart,
      end: pEnd,
      hasAbove: pAbove,
      hasBelow: pBelow,
    } = fixedWin(this.providerCursor, this.providers.length, win);

    const provLines: string[] = [];
    if (pAbove) {
      provLines.push("  " + dimSafe(this.theme, fit(`…(+${pStart} above)`, leftW - 2)));
    }
    for (let i = pStart; i < pEnd; i++) {
      const p = this.providers[i]!;
      const count = provCount(p, this.options.models, this.query);
      const isCur = i === this.providerCursor;
      const isFocused = isCur && !this.isModelListFocused;

      const mark = isCur ? boldSafe(this.theme, fgSafe(this.theme, "accent", "▸ ")) : "  ";
      let dot = "  ";
      if (p !== "All") {
        const conn = isProviderConnected(p, this.options.models);
        dot = conn ? fgSafe(this.theme, "success", "● ") : dimSafe(this.theme, "○ ");
      }

      const cntStr = `${count}`;
      const availNameW = Math.max(2, leftW - 2 - 2 - cntStr.length - 1);
      const nm = shorten(p, availNameW);
      const padLen = Math.max(1, leftW - 2 - 2 - visibleWidth(nm) - cntStr.length);
      const content = `${dot}${nm}${" ".repeat(padLen)}${cntStr}`;

      let styledContent = content;
      if (count === 0) {
        styledContent = dimSafe(this.theme, content);
      } else if (isFocused) {
        styledContent = boldSafe(this.theme, fgSafe(this.theme, "accent", content));
      } else if (isCur) {
        styledContent = fgSafe(this.theme, "text" as ThemeColor, content);
      } else {
        styledContent = dimSafe(this.theme, content);
      }

      provLines.push(`${mark}${isCur ? selectedDialogRow(this.theme, content, leftW - 2, isFocused) : fit(styledContent, leftW - 2)}`);
    }
    if (pBelow) {
      provLines.push("  " + dimSafe(this.theme, fit(`…(+${this.providers.length - pEnd} below)`, leftW - 2)));
    }
    while (provLines.length < win) {
      provLines.push(" ".repeat(leftW));
    }

    // -------------------------------------------------------------------------
    // 3. Models Column Rows (Middle - NO numeric badges)
    // -------------------------------------------------------------------------
    const {
      start: mStart,
      end: mEnd,
      hasAbove: mAbove,
      hasBelow: mBelow,
    } = fixedWin(this.modelCursor, models.length, win);

    const modelLines: string[] = [];
    if (models.length === 0) {
      const notConn =
        curProv !== "All" && !isProviderConnected(curProv, this.options.models);
      const emptyMsg = notConn ? "not connected · ^L login" : "— no match —";
      modelLines.push("  " + dimSafe(this.theme, fit(emptyMsg, rightW - 2)));
      while (modelLines.length < win) modelLines.push(" ".repeat(rightW));
    } else {
      if (mAbove) {
        modelLines.push("  " + dimSafe(this.theme, fit(`…(+${mStart} above)`, rightW - 2)));
      }
      for (let i = mStart; i < mEnd; i++) {
        const m = models[i]!;
        const isCur = i === this.modelCursor;
        const isFocused = isCur && this.isModelListFocused;

        const mark = isCur ? "▸ " : "  ";
        const isFav = this.isFavorite(m);
        const star = isFav
          ? fgSafe(this.theme, "warning", "★")
          : dimSafe(this.theme, "☆");

        const optW = Math.max(10, Math.min(28, rightW - 10));
        let row = shorten(m.id, optW);
        if (!detailCol && m.name && m.name !== m.id) {
          row += "  — " + shorten(m.name, Math.max(4, rightW - 4 - optW - 3));
        }
        const availRowW = Math.max(4, rightW - 4);
        const rowPadded = fit(row, availRowW);

        const styled = isFocused
          ? selectedDialogRow(this.theme, rowPadded, availRowW)
          : isCur
          ? fgSafe(this.theme, "text" as ThemeColor, rowPadded)
          : dimSafe(this.theme, rowPadded);

        modelLines.push(`${mark}${styled} ${star}`);
      }
      if (mBelow) {
        modelLines.push("  " + dimSafe(this.theme, fit(`…(+${models.length - mEnd} below)`, rightW - 2)));
      }
      while (modelLines.length < win) {
        modelLines.push(" ".repeat(rightW));
      }
    }

    // -------------------------------------------------------------------------
    // 4. Spec Detail Column Rows (Right - no colon)
    // -------------------------------------------------------------------------
    const specLines: string[] = [];
    if (detailCol && detW > 0) {
      if (!selModel) {
        specLines.push("  " + dimSafe(this.theme, fit("— no specs —", detW - 2)));
      } else {
        const m = selModel;
        const provVal = m.providerLabel ? `${m.providerLabel} (${m.provider})` : m.provider;
        const compactTokens = (n: number | undefined) => n && n > 0 ? n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}` : "—";
        const ctxVal = compactTokens(m.contextWindow);
        const maxVal = compactTokens(m.maxTokens);
        const inVal =
          m.inputModalities && m.inputModalities.length > 0
            ? m.inputModalities.join(", ")
            : (m as any).input && (m as any).input.length > 0
            ? (m as any).input.join(", ")
            : "—";
        const costVal = modelCostPair(m.costInput, m.costOutput);
        const cacheVal = modelCostPair(m.costCacheRead, m.costCacheWrite);
        const thinkVal = modelThinking(m.thinking);

        specLines.push("  " + boldSafe(this.theme, fgSafe(this.theme, "text" as ThemeColor, fit(m.id, detW - 2))));

        const rows: [string, string][] = [
          ["Name", m.name ? m.name : "—"],
          ["Provider", provVal ? provVal : "—"],
          ["API", m.api ? m.api : "—"],
          ["Host", modelHost(m.baseUrl)],
          ["Context", ctxVal],
          ["Max output", maxVal],
          ["In / Out", costVal],
          ["Cache r/w", cacheVal],
          ["Thinking", thinkVal],
          ["Input", inVal],
        ];

        const lw = 11;
        const valW = Math.max(10, detW - 2 - lw - 1);
        for (const [label, val] of rows) {
          const lab = dimSafe(this.theme, fit(label, lw));
          let styleVal = fgSafe(this.theme, "text" as ThemeColor, fit(shorten(val, valW), valW));
          if (val === "—") {
            styleVal = dimSafe(this.theme, fit(val, valW));
          } else if (label === "Thinking") {
            styleVal = fgSafe(this.theme, "warning", fit(shorten(val, valW), valW));
          }
          specLines.push(`  ${lab} ${styleVal}`);
        }

        const keyLab = dimSafe(this.theme, fit("Key", lw));
        const isConn = isProviderConnected(m.provider, this.options.models);
        const keyVal = isConn ? "ready" : "missing";
        const keyStyle = isConn
          ? fgSafe(this.theme, "success", fit(keyVal, valW))
          : fgSafe(this.theme, "warning", fit(keyVal, valW));
        specLines.push(`  ${keyLab} ${keyStyle}`);
      }
      while (specLines.length < win) {
        specLines.push(" ".repeat(detW));
      }
    }

    // -------------------------------------------------------------------------
    // 5. Header Bar & Title Rows
    // -------------------------------------------------------------------------
    const titleText = boldSafe(this.theme, fgSafe(this.theme, "text" as ThemeColor, "Select model"));
    const filterText = dimSafe(this.theme, `filter: ${this.query}▌`);

    const sep = fgSafe(this.theme, "border", "│");
    let headerRow = "";

    const selLabel = curProv && (this.query === "" || !this.isModelListFocused) ? curProv : "All";
    if (detailCol) {
      const pHead = boldSafe(this.theme, fgSafe(this.theme, "text", fit("PROVIDERS", leftW - 2)));
      const mHead = boldSafe(this.theme, fgSafe(this.theme, "text", fit(`${selLabel} · ${models.length}`, rightW - 2)));
      const sHead = boldSafe(this.theme, fgSafe(this.theme, "text", fit("DETAILS", detW - 2)));
      headerRow = `  ${pHead} ${sep}   ${mHead} ${sep}   ${sHead}`;
    } else {
      const pHead = boldSafe(this.theme, fgSafe(this.theme, "text", fit("PROVIDERS", leftW - 2)));
      const mHead = boldSafe(this.theme, fgSafe(this.theme, "text", fit(`${selLabel} · ${models.length}`, rightW - 2)));
      headerRow = `  ${pHead} ${sep}   ${mHead}`;
    }

    // -------------------------------------------------------------------------
    // 6. Body Rows Assembly
    // -------------------------------------------------------------------------
    const combinedBodyLines: string[] = [];
    for (let r = 0; r < win; r++) {
      const p = provLines[r] ?? " ".repeat(leftW);
      const m = modelLines[r] ?? " ".repeat(rightW);

      if (detailCol && detW > 0) {
        const s = specLines[r] ?? " ".repeat(detW);
        combinedBodyLines.push(`${fit(p, leftW)} ${sep} ${fit(m, rightW)} ${sep} ${fit(s, detW)}`);
      } else {
        combinedBodyLines.push(`${fit(p, leftW)} ${sep} ${fit(m, rightW)}`);
      }
    }

    // -------------------------------------------------------------------------
    // 7. Footer / Hints Row
    // -------------------------------------------------------------------------
    let footerLine = "";
    if (this.feedbackText) {
      footerLine = boldSafe(this.theme, fgSafe(this.theme, "success", this.feedbackText));
    } else if (!this.isModelListFocused) {
      footerLine =
        "↑↓ providers · → models · type to search all · Enter open · ^F star · ^L login · Esc close";
    } else {
      footerLine =
        "↑↓ models · ← providers · Tab switch · type filters here · Enter select · ^F star · ^L login · Esc close";
    }
    const footStyled = dimSafe(this.theme, footerLine);

    // -------------------------------------------------------------------------
    // 8. Box Assembly with Rounded Unicode Framing & Padding
    // -------------------------------------------------------------------------
    const frameLine = (content: string): string => {
      const leftPad = " ".repeat(padX);
      const rightPad = " ".repeat(padX);
      const truncated = truncateToWidth(content, innerW, "");
      const diff = Math.max(0, innerW - visibleWidth(truncated));
      return `${borderStyler(v)}${leftPad}${truncated}${" ".repeat(diff)}${rightPad}${borderStyler(v)}`;
    };

    const lines: string[] = [];
    lines.push(borderStyler(tl + h.repeat(Math.max(0, boxW)) + tr));
    if (padY > 0) lines.push(borderStyler(v) + " ".repeat(Math.max(0, boxW)) + borderStyler(v));
    lines.push(frameLine(titleText));
    lines.push(frameLine(filterText));
    lines.push(frameLine(""));
    lines.push(frameLine(headerRow));
    for (const bodyLn of combinedBodyLines) {
      lines.push(frameLine(bodyLn));
    }
    lines.push(frameLine(""));
    lines.push(frameLine(footStyled));
    if (padY > 0) lines.push(borderStyler(v) + " ".repeat(Math.max(0, boxW)) + borderStyler(v));
    lines.push(borderStyler(bl + h.repeat(Math.max(0, boxW)) + br));

    return lines;
  }
}

export function createOmtModelPickerComponent(
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager | undefined | null,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  options: ExtendedModelPickerOptions,
): OmtModelPickerComponent {
  return new OmtModelPickerComponent(tui, theme, keybindings, done, ctx, options);
}

export {
  OmtModelPickerComponent as ModelPickerComponent,
  createOmtModelPickerComponent as createModelPickerComponent,
};
