import type { Theme, ExtensionContext, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { visibleWidth, truncateToWidth, stripTerminalSequences, matchesKey, Key, type Component, type TUI, type TuiMouseEvent, type TuiMouseEventResult, type KeybindingsManager } from "@earendil-works/pi-tui";
import { homedir } from "node:os";

import type {
  SidebarState,
  SidebarOptions,
  SidebarSessionState,
  SidebarModelState,
  SidebarContextState,
  SidebarStatsState,
  SidebarToolItem,
  SidebarWorkspaceState,
  SidebarPetState,
  SidebarRecentModel,
  SidebarCommandsState,
  SidebarCostItem,
  SidebarSectionItem,
  SidebarSectionsVisibility,
  SidebarFolds,
  SidebarControl,
  PetStatus,
} from "./types.ts";

import { ART_ROWS, SIDE_W, SIDE_INNER_W, DEFAULT_PET, PET_NAMES, PET_ROTATE_EVERY, getPet, petFrameFor, isBusyStatus, petLabel, petNameRow, width as petWidth, classicFace, rotatePet, createPetPureState, stepPetState, type PetPureState } from "./pet.ts";

export {
  ART_ROWS,
  SIDE_W,
  SIDE_INNER_W,
  DEFAULT_PET,
  PET_NAMES,
  PET_ROTATE_EVERY,
  getPet,
  petFrameFor,
  isBusyStatus,
  petLabel,
  petNameRow,
  classicFace,
  rotatePet,
  createPetPureState,
  stepPetState,
  type PetPureState,
};

import { motionCoordinator, isAnimationActive, scaleElapsed } from "../../core/motion.ts";

// ---------------------------------------------------------------------------
// 15 Sidebar section keys & order
// ---------------------------------------------------------------------------

export const SidePet = "pet" as const;
export const SideSession = "session" as const;
export const SideModel = "model" as const;
export const SideStats = "stats" as const;
export const SideCost = "cost" as const;
export const SideRecent = "recent" as const;
export const SideCommands = "commands" as const;
export const SidePlugins = "plugins" as const;
export const SideMCP = "mcp" as const;
export const SideTodos = "todos" as const;
export const SideLSP = "lsp" as const;
export const SideTools = "tools" as const;
export const SideSkills = "skills" as const;
export const SideSubagents = "subagents" as const;
export const SideWorkspace = "workspace" as const;

export type SideSectionKey =
  | typeof SidePet
  | typeof SideSession
  | typeof SideModel
  | typeof SideStats
  | typeof SideCost
  | typeof SideRecent
  | typeof SideCommands
  | typeof SidePlugins
  | typeof SideMCP
  | typeof SideTodos
  | typeof SideLSP
  | typeof SideTools
  | typeof SideSkills
  | typeof SideSubagents
  | typeof SideWorkspace;

/**
 * Exact 15 sidebar sections order matching OMT sideOrder:
 * Pet, Session, Model, Stats, Cost, Recent, Commands, Plugins, MCP, LSP, Todos, Tools, Skills, Subagents, Workspace.
 */
export const sideOrder: readonly SideSectionKey[] = [
  SidePet,
  SideSession,
  SideModel,
  SideStats,
  SideCost,
  SideRecent,
  SideCommands,
  SidePlugins,
  SideMCP,
  SideLSP,
  SideTodos,
  SideTools,
  SideSkills,
  SideSubagents,
  SideWorkspace,
] as const;

export const SIDE_ORDER = sideOrder;

/** Display label for settings hub per section key */
export function sideLabel(key: string): string {
  switch (key) {
    case SidePet:
      return "Pet";
    case SideSession:
      return "Session";
    case SideModel:
      return "Model & context";
    case SideStats:
      return "Stats";
    case SideCost:
      return "Cost";
    case SideRecent:
      return "Recent models";
    case SideCommands:
      return "Commands";
    case SidePlugins:
      return "Plugins";
    case SideMCP:
      return "MCP servers";
    case SideTodos:
      return "Todos";
    case SideLSP:
      return "LSP diagnostics";
    case SideTools:
      return "Tools";
    case SideSkills:
      return "Skills";
    case SideSubagents:
      return "Subagents";
    case SideWorkspace:
      return "Workspace";
    default:
      return key;
  }
}

// ---------------------------------------------------------------------------
// Visibility rules
// DefaultSideVisible: MCP, Plugins, Commands, Subagents hidden by default.
// ---------------------------------------------------------------------------

export function DefaultSideVisible(key: string): boolean {
  switch (key) {
    case SidePlugins:
    case SideMCP:
    case SideCommands:
    case SideSubagents:
      return false;
    default:
      return true;
  }
}

export const defaultSideVisible = DefaultSideVisible;

/**
 * Evaluates whether a section is visible.
 * Subagents has auto-visibility: hidden when zero, shown while any row exists.
 */
export function isSideVisible(
  key: string,
  visibilityMap?: SidebarSectionsVisibility,
  subagentCount = 0,
): boolean {
  if (visibilityMap) {
    const explicit = (visibilityMap as Record<string, boolean | undefined>)[key];
    if (typeof explicit === "boolean") {
      return explicit;
    }
  }
  if (key === SideSubagents) {
    return subagentCount > 0;
  }
  return DefaultSideVisible(key);
}

// ---------------------------------------------------------------------------
// Collapsible folds
// Collapsible sections: plugins, mcp, todos, lsp, workspace.
// Marks: ▸ (folded / closed) vs ▾ (unfolded / open).
// ---------------------------------------------------------------------------

export type FoldableSectionKey = "plugins" | "mcp" | "todos" | "lsp" | "workspace";

export const FOLDABLE_SECTIONS: readonly FoldableSectionKey[] = [
  "plugins",
  "mcp",
  "todos",
  "lsp",
  "workspace",
] as const;

export interface SidePanelFolds {
  plugins?: boolean;
  mcp?: boolean;
  todos?: boolean;
  lsp?: boolean;
  workspace?: boolean;
}

/** OMT defaults: MCP and WORKSPACE folded by default, plugins folded, todos & lsp open */
export const DEFAULT_FOLDS: SidePanelFolds = {
  plugins: true,
  mcp: true,
  todos: false,
  lsp: false,
  workspace: false,
};

export function foldMark(folded: boolean): string {
  return folded ? "▸" : "▾";
}

export const foldHeaderPrefixes: ReadonlyArray<{ key: FoldableSectionKey; prefix: string }> = [
  { key: "plugins", prefix: "PLUGINS" },
  { key: "mcp", prefix: "MCP Servers" },
  { key: "todos", prefix: "Todos" },
  { key: "lsp", prefix: "LSP" },
  { key: "workspace", prefix: "WORKSPACE" },
];

// Display thresholds matching OMT constants
export const todosShowMax = 10;
export const subagentsShowMax = 5;
export const skillsShowMax = 8;
export const lspRowsMax = 10;

// ---------------------------------------------------------------------------
// Formatting Helpers
// ---------------------------------------------------------------------------

export function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return `${Math.round(n)}`;
}

export function fmtComma(n: number): string {
  if (typeof n !== "number" || isNaN(n)) return "0";
  return Math.round(n).toLocaleString("en-US");
}

export function fmtDur(ms: number | string): string {
  const dur = typeof ms === "number" ? ms : parseFloat(ms) || 0;
  if (dur < 1000) return `${Math.round(dur)}ms`;
  const secs = Math.round(dur / 1000);
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m${s}s`;
}

export function truncWidth(s: string | undefined | null, n: number): string {
  if (s === undefined || s === null || n <= 0) return "";
  const str = typeof s === "string" ? s : String(s);
  if (visibleWidth(str) <= n) return str;
  if (n <= 1) return "…";
  let cells = 0;
  let out = "";
  for (const ch of str) {
    const c = visibleWidth(ch);
    if (cells + c > n - 1) break;
    cells += c;
    out += ch;
  }
  return out + "…";
}

export function short(s: string | undefined | null, n: number): string {
  if (s === undefined || s === null || n <= 0) return "";
  const str = typeof s === "string" ? s : String(s);
  const flattened = str.replace(/\r?\n/g, " ⏎ ");
  if (visibleWidth(flattened) <= n) return flattened;
  return truncWidth(flattened, n);
}

export function shorten(p: string | undefined | null): string {
  if (!p) return "";
  try {
    const home = homedir();
    if (home) {
      if (p === home) return "~";
      if (p.startsWith(home + "/") || p.startsWith(home + "\\")) {
        return "~" + p.slice(home.length);
      }
    }
  } catch {}
  return String(p);
}

export function twoCol(l: string | undefined | null, r: string | undefined | null, inner = SIDE_INNER_W): string {
  const leftStr = l ?? "";
  const rightStr = r ?? "";
  // Fixed left column, not right alignment.
  const lw = Math.max(1, Math.min(17, inner));
  const shortL = short(leftStr, lw - 1);
  const shortR = short(rightStr, Math.max(0, inner - lw - 1));
  const gap = Math.max(1, lw - visibleWidth(shortL));
  return truncateToWidth(shortL + " ".repeat(gap) + shortR, Math.max(0, inner), "");
}

export function ctxBar(pct: number, w: number): string {
  if (w < 1) w = 1;
  const clampedPct = Math.max(0, Math.min(100, pct));
  const f = Math.max(0, Math.min(w, Math.round((clampedPct / 100) * w)));
  return "█".repeat(f) + "░".repeat(w - f);
}

export function sep(inner = SIDE_INNER_W, plainAscii = false, theme?: Theme): string {
  const ch = plainAscii ? "-" : "─";
  const line = ch.repeat(Math.max(1, inner));
  return fgSafe(theme, "border", line);
}

// ---------------------------------------------------------------------------
// Styling Utilities matching theme roles
// ---------------------------------------------------------------------------

function fgSafe(theme: Theme | undefined, color: string, text: string): string {
  if (!theme || typeof theme.fg !== "function") return text;
  try {
    return theme.fg(color as any, text);
  } catch {
    return text;
  }
}

function boldSafe(theme: Theme | undefined, text: string): string {
  if (!theme || typeof theme.bold !== "function") return text;
  try {
    return theme.bold(text);
  } catch {
    return text;
  }
}

function dimSafe(theme: Theme | undefined, text: string): string {
  if (!theme) return text;
  try {
    if (typeof (theme as any).dim === "function") return (theme as any).dim(text);
    if (typeof theme.fg === "function") return theme.fg("muted", text);
  } catch {}
  return text;
}

function sideTitleStyle(theme: Theme | undefined, text: string): string {
  return boldSafe(theme, fgSafe(theme, "text", text));
}

function statusBarStyle(theme: Theme | undefined, text: string): string {
  return dimSafe(theme, text);
}

function toolStyle(theme: Theme | undefined, text: string): string {
  return dimSafe(theme, text);
}

function okStyle(theme: Theme | undefined, text: string): string {
  return fgSafe(theme, "success", text);
}

function errStyle(theme: Theme | undefined, text: string): string {
  return fgSafe(theme, "error", text);
}

function warnStyle(theme: Theme | undefined, text: string): string {
  return fgSafe(theme, "warning", text);
}

// ---------------------------------------------------------------------------
// 15 Section Renderers
// ---------------------------------------------------------------------------

// 1. PET SECTION
export function renderPetSection(
  petState: SidebarPetState | undefined,
  inner = SIDE_INNER_W,
  theme?: Theme,
  plainAscii = false,
): string[] {
  const petName = petState?.name ?? DEFAULT_PET;
  const p = getPet(petName);
  const status: PetStatus = petState?.status ?? "idle";
  const isBusy = isBusyStatus(status);
  const tick = petState?.tick ?? 0;
  const isClassicMode = petState?.style === "classic";

  const getArtStyled = (line: string): string => {
    if (status === "thinking" || status === "writing" || status === "working") {
      return fgSafe(theme, "text", line);
    }
    if (status === "success") return okStyle(theme, line);
    if (status === "error") return errStyle(theme, line);
    return dimSafe(theme, line);
  };

  if (isClassicMode) {
    const face = classicFace(status, tick);
    const faceW = visibleWidth(face);
    const labelW = Math.max(0, inner - faceW - 1);
    const statusLabel = short(petLabel(status, petState?.since), labelW);
    const row = getArtStyled(face) + " " + statusBarStyle(theme, statusLabel);
    return [row, sep(inner, plainAscii, theme)];
  }

  const frame = petFrameFor(p, tick, isBusy);
  const petW = petWidth(frame);
  const labelW = Math.max(0, inner - petW - 2);
  const nameStr = sideTitleStyle(theme, short(p.name, labelW));
  const labelStr = statusBarStyle(theme, short(petLabel(status, petState?.since), labelW));
  const nameRowIdx = petNameRow(frame);
  const groundRowIdx = frame.length - 1;

  const rows: string[] = [];
  for (let i = 0; i < frame.length; i++) {
    const rawLine = frame[i] ?? "";
    const rawLen = [...rawLine].length;
    const pad = " ".repeat(Math.max(0, petW - rawLen));
    let lineArt = rawLine + pad;
    let gutter = "";
    let label = "";
    if (i === nameRowIdx) {
      gutter = "  ";
      label = nameStr;
    } else if (i === groundRowIdx) {
      gutter = "  ";
      label = labelStr;
    }
    const styledArt = getArtStyled(lineArt + gutter);
    rows.push(styledArt + label);
  }
  rows.push(sep(inner, plainAscii, theme));
  return rows;
}

// 2. SESSION SECTION
export function renderSessionSection(
  session: SidebarSessionState | undefined,
  petStatus: PetStatus | undefined,
  inner = SIDE_INNER_W,
  theme?: Theme,
  plainAscii = false,
): string[] {
  const sess = session ?? {};
  const rows: string[] = [sideTitleStyle(theme, "SESSION")];

  let firstLine = "";
  if (sess.firstPrompt && sess.firstPrompt.trim() !== "") {
    firstLine = short(sess.firstPrompt, inner);
  } else {
    const isThinking = petStatus === "thinking";
    const dot = isThinking ? okStyle(theme, "●") : statusBarStyle(theme, "○");
    const statusText = sess.status ?? (isThinking ? "thinking" : "ready");
    firstLine = `${dot} ${short(statusText, inner - 2)}`;
  }
  rows.push(statusBarStyle(theme, firstLine));

  const sessId = sess.id ? shorten(sess.id) : "…";
  rows.push(statusBarStyle(theme, short(sessId, inner)));

  const sessFile = sess.filePath ? shorten(sess.filePath) : "In-memory";
  rows.push(statusBarStyle(theme, short(sessFile, inner)));

  rows.push(sep(inner, plainAscii, theme));
  return rows;
}

export function thinkLevelRows(levels: string[], inner: number = SIDE_INNER_W): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let w = 0;
  for (const l of levels) {
    const cw = visibleWidth(l);
    if (w > 0 && w + 1 + cw > inner) {
      rows.push(cur);
      cur = [];
      w = 0;
    }
    if (w > 0) {
      w++;
    }
    cur.push(l);
    w += cw;
  }
  if (cur.length > 0) {
    rows.push(cur);
  }
  return rows;
}

export function renderThinkRows(
  levels: string[],
  activeLevel: string,
  hoverLevel: string = "",
  inner: number = SIDE_INNER_W,
  theme?: Theme,
): string[] {
  const rows = thinkLevelRows(levels, inner);
  const out: string[] = [];
  for (const row of rows) {
    const cells = row.map((l) => {
      if (l === activeLevel) {
        return theme?.bold ? theme.bold(fgSafe(theme, "text", l)) : fgSafe(theme, "text", l);
      }
      if (hoverLevel && l === hoverLevel) {
        return theme?.bold ? theme.bold(fgSafe(theme, "accent", l)) : fgSafe(theme, "accent", l);
      }
      return statusBarStyle(theme, l);
    });
    out.push(cells.join(" "));
  }
  return out;
}

// 3. MODEL SECTION
export function renderModelSection(
  model: SidebarModelState | undefined,
  context: SidebarContextState | undefined,
  inner = SIDE_INNER_W,
  theme?: Theme,
  plainAscii = false,
  hoverLevel = "",
): string[] {
  const m = model ?? { label: "—" };
  const lvl = m.thinkLevel && m.thinkLevel !== "" ? m.thinkLevel : "off";
  // Separates the model and thinking level with " - ".
  const modelName = short(`${m.id ?? m.label} - ${lvl}`, inner - 8);
  const rows: string[] = [
    statusBarStyle(theme, "model · ") + fgSafe(theme, "text", modelName),
  ];

  if (m.thinkLevels && m.thinkLevels.length > 0) {
    const activeLevel = lvl;
    const thinkLines = renderThinkRows(m.thinkLevels, activeLevel, hoverLevel, inner, theme);
    rows.push(...thinkLines);
  }

  const ctx = context ?? {};
  const knownPct = typeof ctx.percent === "number" && Number.isFinite(ctx.percent);
  const pct = knownPct ? Math.max(0, Math.min(100, ctx.percent!)) : 0;
  const barW = Math.max(4, inner - 4 - 5);
  const pctStr = knownPct ? `${Math.round(pct).toString().padStart(3)}%` : "   ?%";
  rows.push(statusBarStyle(theme, `ctx ${knownPct ? ctxBar(pct, barW) : "░".repeat(barW)} ${pctStr}`));

  const used = ctx.tokens;
  const win = ctx.contextWindow ?? 0;
  const compact = ctx.autoCompact === undefined ? "compact ?" : ctx.autoCompact ? "compact auto" : "manual";
  let tokLine = "tok —";
  if (win > 0 && used !== undefined && used !== null) {
    tokLine = `${fmtNum(used)}/${fmtNum(win)} tkns - ${compact}`;
  } else if (used !== undefined && used !== null) {
    tokLine = `tok ${fmtNum(used)}`;
  }
  rows.push(statusBarStyle(theme, short(tokLine, inner)));

  rows.push(sep(inner, plainAscii, theme));
  return rows;
}

// 4. STATS SECTION
export function renderStatsSection(
  stats: SidebarStatsState | undefined,
  contextPct: number | undefined,
  inner = SIDE_INNER_W,
  theme?: Theme,
  plainAscii = false,
): string[] {
  const s: SidebarStatsState = stats ?? {
    inTokens: 0,
    outTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    userMessages: 0,
    assistantMessages: 0,
    totalMessages: 0,
  };

  const elapsed = s.elapsedMs !== undefined && s.elapsedMs > 0 ? fmtDur(s.elapsedMs) : "—";
  const last = s.lastDurationMs !== undefined && s.lastDurationMs > 0 ? fmtDur(s.lastDurationMs) : "—";
  const speed = s.lastSpeed !== undefined && s.lastSpeed > 0 ? `${Math.round(s.lastSpeed)} tok/s` : "—";
  const cache =
    s.totalTokens > 0 && s.cacheReadTokens > 0
      ? `${Math.round((100 * s.cacheReadTokens) / s.totalTokens)}%`
      : "—";
  const cost = s.cost !== undefined && Number.isFinite(s.cost) ? `$${s.cost.toFixed(2)}` : "—";

  const rows: string[] = [
    sideTitleStyle(theme, twoCol("Stats", "Tokens", inner)),
    statusBarStyle(theme, twoCol(`time ${elapsed}`, `in ${fmtNum(s.inTokens)}`, inner)),
    statusBarStyle(theme, twoCol(`last ${last}`, `out ${fmtNum(s.outTokens)}`, inner)),
    statusBarStyle(theme, twoCol(`speed ${speed}`, `total ${fmtNum(s.totalTokens)}`, inner)),
    statusBarStyle(theme, twoCol(`turns ${s.userMessages}`, `cache ${cache}`, inner)),
  ];

  const left =
    typeof contextPct === "number" &&
    Number.isFinite(contextPct) &&
    contextPct > 0
      ? `${Math.round(100 - Math.max(0, Math.min(100, contextPct)))}%`
      : "—";
  rows.push(statusBarStyle(theme, twoCol(`left ${left}`, `cost ${cost}`, inner)));

  rows.push(
    statusBarStyle(
      theme,
      short(
        `msgs ${fmtComma(s.totalMessages)} · u ${fmtComma(s.userMessages)} a ${fmtComma(s.assistantMessages)}`,
        inner,
      ),
    ),
  );

  let cachedStr = "—";
  let uncachedStr = "—";
  if (s.totalTokens > 0) {
    cachedStr = s.cacheReadTokens != null ? fmtComma(s.cacheReadTokens) : "—";
    uncachedStr = s.inTokens != null ? fmtComma(s.inTokens + (s.cacheWriteTokens ?? 0)) : "—";
  }
  rows.push(statusBarStyle(theme, short(`cached ${cachedStr} · uncached ${uncachedStr}`, inner)));

  rows.push(sep(inner, plainAscii, theme));
  return rows;
}

// 5. COST SECTION
export function renderCostSection(
  costBreakdown: SidebarCostItem[] | undefined,
  inner = SIDE_INNER_W,
  theme?: Theme,
  plainAscii = false,
): string[] {
  if (!costBreakdown || costBreakdown.length <= 1) return [];
  const rows: string[] = [sideTitleStyle(theme, "COST")];
  const items = costBreakdown.slice(0, 3);
  for (const item of items) {
    const costText = `$${item.cost.toFixed(3)}`;
    const line = `${short(item.key, inner - 8)} ${costText}`;
    rows.push(statusBarStyle(theme, short(line, inner)));
  }
  rows.push(sep(inner, plainAscii, theme));
  return rows;
}

// 6. RECENT MODELS SECTION
export function renderRecentSection(
  recentModels: SidebarRecentModel[] | undefined,
  inner = SIDE_INNER_W,
  theme?: Theme,
  plainAscii = false,
  mouseSupported = true,
  operationsWired?: boolean,
): string[] {
  const rows: string[] = [sideTitleStyle(theme, "RECENT MODELS")];
  const recents = recentModels ?? [];
  if (recents.length === 0) {
    rows.push(toolStyle(theme, "—"));
  } else {
    for (let i = 0; i < recents.length; i++) {
      const r = recents[i];
      const isCur = r.isCurrent ?? false;
      const bullet = isCur ? okStyle(theme, "● ") : statusBarStyle(theme, "○ ");
      const label = short(r.modelId || r.label || r.id, inner - 5);
      const text = isCur
        ? fgSafe(theme, "text", `${i + 1}. ${label}`)
        : statusBarStyle(theme, `${i + 1}. ${label}`);
      rows.push(bullet + text);
    }
  }
  let hint = mouseSupported ? "click to switch · ^↑↓ scroll" : "^R list · ^↑↓ scroll";
  if (operationsWired === false) {
    hint = "^↑↓ scroll";
  }
  rows.push(toolStyle(theme, hint));
  rows.push(sep(inner, plainAscii, theme));
  return rows;
}

// 7. COMMANDS SECTION
export function renderCommandsSection(
  commands: SidebarCommandsState | undefined,
  inner = SIDE_INNER_W,
  theme?: Theme,
  plainAscii = false,
): string[] {
  const rows: string[] = [sideTitleStyle(theme, "COMMANDS")];
  const cmds = commands;
  const hasCmds =
    cmds &&
    ((cmds.ext ?? 0) > 0 ||
      (cmds.prompt ?? 0) > 0 ||
      (cmds.skill ?? 0) > 0 ||
      (cmds.builtin ?? 0) > 0);
  if (!hasCmds) {
    rows.push(toolStyle(theme, "—"));
  } else {
    rows.push(
      statusBarStyle(
        theme,
        short(
          `${cmds.ext} ext · ${cmds.prompt} prompt · ${cmds.skill} skill · ${cmds.builtin ?? "?"} builtin`,
          inner,
        ),
      ),
    );
    if ((cmds.queueSteer ?? 0) + (cmds.queueFollow ?? 0) > 0) {
      rows.push(
        statusBarStyle(theme, `queue: ${cmds.queueSteer ?? 0} steer · ${cmds.queueFollow ?? 0} follow`),
      );
    }
  }
  // COMMANDS does not emit a trailing separator
  return rows;
}

// 8. PLUGINS SECTION (collapsible)
export function renderPluginsSection(
  plugins: SidebarSectionItem[] | undefined,
  folded: boolean,
  inner = SIDE_INNER_W,
  theme?: Theme,
  plainAscii = false,
): string[] {
  const count = plugins?.length ?? 0;
  const mark = foldMark(folded);
  const rows: string[] = [
    sideTitleStyle(theme, `PLUGINS (${count}) ${mark}`),
  ];
  if (!folded) {
    if (!plugins) {
      rows.push(toolStyle(theme, "unavailable"));
    } else if (plugins.length === 0) {
      rows.push(toolStyle(theme, "—"));
    } else {
      for (const p of plugins) {
        const name = p.detail ? `${p.label} · ${p.detail}` : p.label;
        rows.push(
          statusBarStyle(theme, " • ") +
            fgSafe(theme, "text", short(name, inner - 3)),
        );
      }
    }
  }
  rows.push(sep(inner, plainAscii, theme));
  return rows;
}

// 9. MCP SERVERS SECTION (collapsible)
export function renderMcpSection(
  mcp: SidebarSectionItem[] | undefined,
  folded: boolean,
  inner = SIDE_INNER_W,
  theme?: Theme,
  plainAscii = false,
): string[] {
  const count = mcp?.length ?? 0;
  const mark = foldMark(folded);
  const rows: string[] = [
    sideTitleStyle(theme, `MCP Servers (${count}) ${mark}`),
  ];
  if (!folded) {
    if (!mcp) {
      rows.push(toolStyle(theme, "unavailable"));
    } else if (mcp.length === 0) {
      rows.push(toolStyle(theme, "—"));
    } else {
      for (const s of mcp) {
        let dot: string;
        if (s.disabled) {
          dot = statusBarStyle(theme, "⊘");
        } else if (s.connected) {
          if (typeof s.total === "number" && s.total > 0 && s.direct === s.total) {
            dot = okStyle(theme, "●");
          } else {
            dot = fgSafe(theme, "text", "◐");
          }
        } else {
          dot = statusBarStyle(theme, "○");
        }

        let countStr = "";
        if (typeof s.total === "number" && s.total > 0) {
          countStr = `${s.direct ?? 0}/${s.total}`;
        }
        let tokStr = "";
        if (typeof s.direct === "number" && s.direct > 0 && typeof s.tokens === "number" && s.tokens > 0) {
          tokStr = `  ~${fmtComma(s.tokens)}`;
        }
        const suffix = countStr || tokStr ? statusBarStyle(theme, "  " + countStr + tokStr) : (s.detail ? statusBarStyle(theme, "  " + s.detail) : "");
        const suffixLen = visibleWidth(suffix);
        const nameMax = Math.max(0, inner - 3 - suffixLen);
        const name = short(s.name || s.label, nameMax);
        rows.push(
          statusBarStyle(theme, " ") +
            dot +
            " " +
            fgSafe(theme, "text", name) +
            suffix,
        );
      }
    }
  }
  rows.push(sep(inner, plainAscii, theme));
  return rows;
}

// 10. TODOS SECTION (collapsible)
export function renderTodosSection(
  todos: SidebarSectionItem[] | undefined,
  folded: boolean,
  inner = SIDE_INNER_W,
  theme?: Theme,
  plainAscii = false,
): string[] {
  const total = todos?.length ?? 0;
  const done = todos ? todos.filter((t) => t.label.startsWith("✓")).length : 0;
  const mark = foldMark(folded);
  const rows: string[] = [
    sideTitleStyle(theme, `Todos (${done}/${total}) ${mark}`),
  ];
  if (!folded) {
    if (!todos) {
      rows.push(toolStyle(theme, "unavailable"));
    } else if (todos.length === 0) {
      rows.push(toolStyle(theme, " (no todos)"));
    } else {
      const shown = todos.slice(0, todosShowMax);
      for (const t of shown) {
        let glyph = statusBarStyle(theme, "○");
        if (t.label.startsWith("✓")) glyph = okStyle(theme, "✓");
        else if (t.label.startsWith("●") || t.label.startsWith("◐")) glyph = fgSafe(theme, "text", "◐");
        const cleanLabel = t.label.replace(/^[✓●◐○]\s*/, "");
        const text = t.detail ? `${cleanLabel} (${t.detail})` : cleanLabel;
        rows.push(` ${glyph} ` + fgSafe(theme, "text", short(text, inner - 4)));
      }
      if (todos.length > todosShowMax) {
        rows.push(toolStyle(theme, ` … +${todos.length - todosShowMax} more`));
      }
    }
  }
  rows.push(sep(inner, plainAscii, theme));
  return rows;
}

export function lspCountBadge(errs: number, warns: number, theme?: Theme): string {
  let e = "";
  let w = "";
  if (errs > 0) {
    e = errStyle(theme, `●${errs}E`);
  }
  if (warns > 0) {
    w = warnStyle(theme, `!${warns}W`);
  }
  if (e && w) return `${e} ${w}`;
  return e || w;
}

export function lspFileCounts(errs: number, warns: number): string {
  let res = "";
  if (errs > 0) res += `${errs}E`;
  if (warns > 0) res += `${warns}W`;
  return res;
}

export function lspFitTag(tag: string, avail: number): string {
  if (!tag) return "";
  const tagW = visibleWidth(tag);
  if (avail - tagW - 2 >= 10) return tag;
  if (avail >= 20) return "";
  for (const cap of [14, 10, 7]) {
    const t = short(tag, cap);
    if (avail - visibleWidth(t) - 2 >= 10) return t;
  }
  return "";
}

// 11. LSP SECTION (collapsible)
export function renderLspSection(
  lsp: SidebarSectionItem[] | undefined,
  folded: boolean,
  inner = SIDE_INNER_W,
  theme?: Theme,
  plainAscii = false,
): string[] {
  const items = lsp ?? [];
  let hasFileGroups = false;
  for (const item of items) {
    if (item.kind === "file") {
      hasFileGroups = true;
      break;
    }
  }

  let totalErrors = 0;
  let totalWarnings = 0;
  if (hasFileGroups) {
    for (const item of items) {
      if (item.kind === "file") {
        totalErrors += item.errs ?? 0;
        totalWarnings += item.warns ?? 0;
      }
    }
  } else {
    for (const item of items) {
      if (typeof item.errs === "number") totalErrors += item.errs;
      else if (item.severity === "error") totalErrors++;
      else if (item.label && (item.label.includes("error") || item.label.includes("Error"))) totalErrors++;

      if (typeof item.warns === "number") totalWarnings += item.warns;
      else if (item.severity === "warning") totalWarnings++;
      else if (item.label && (item.label.includes("warning") || item.label.includes("Warning"))) totalWarnings++;
    }
  }

  const mark = foldMark(folded);
  const title = "LSP";
  let head = sideTitleStyle(theme, short(title, inner));
  const badge = lspCountBadge(totalErrors, totalWarnings, theme);
  if (badge) {
    head += "  " + badge;
  }
  const headerLine = truncWidth(head + " " + statusBarStyle(theme, mark), inner);
  const rows: string[] = [headerLine];

  if (!folded) {
    if (!lsp) {
      rows.push(toolStyle(theme, " — run lsp_diagnostics for diagnostics"));
    } else if (lsp.length === 0) {
      rows.push(toolStyle(theme, " — no diagnostics"));
    } else {
      const shown = lsp.slice(0, lspRowsMax);
      for (const item of shown) {
        if (item.kind === "file") {
          const counts = lspFileCounts(item.errs ?? 0, item.warns ?? 0);
          const cw = visibleWidth(counts);
          const avail = Math.max(1, inner - 3 - cw - 1);
          const p = short(item.file || item.label, avail);
          const pad = Math.max(1, inner - 3 - visibleWidth(p) - cw);
          const row =
            fgSafe(theme, "text", ` ● ${p}`) +
            " ".repeat(pad) +
            (counts ? statusBarStyle(theme, counts) : "");
          rows.push(short(row, inner));
        } else if (item.kind === "diag" || (item.line !== undefined && item.severity)) {
          const sev = (item.severity ?? "error").toLowerCase();
          const dotStyle = sev === "error" ? errStyle(theme, "●") : sev === "warning" ? warnStyle(theme, "●") : fgSafe(theme, "accent", "●");
          const loc = `L${item.line ?? 0}`;
          const rawTag = item.source ? (item.code ? `${item.source}:${item.code}` : item.source) : "";
          const used = visibleWidth(loc) + 4;
          const avail = Math.max(1, inner - used);
          const tag = lspFitTag(rawTag, avail);
          let prefix = ` ${dotStyle} ${statusBarStyle(theme, loc)} `;
          if (tag) prefix += toolStyle(theme, tag) + "  ";
          const msgW = Math.max(1, avail - (tag ? visibleWidth(tag) + 2 : 0));
          const msg = short(item.message || item.detail || item.label, msgW);
          rows.push(short(prefix + fgSafe(theme, "text", msg), inner));
        } else {
          // Standard item fallback
          const text = item.detail ? `${item.label} · ${item.detail}` : item.label;
          rows.push(statusBarStyle(theme, short(text, inner)));
        }
      }
      if (lsp.length > lspRowsMax) {
        rows.push(toolStyle(theme, ` … +${lsp.length - lspRowsMax} more`));
      }
    }
  }
  rows.push(sep(inner, plainAscii, theme));
  return rows;
}

// 12. TOOLS SECTION (invoked tools only)
export function renderToolsSection(
  tools: SidebarToolItem[] | undefined,
  inner = SIDE_INNER_W,
  theme?: Theme,
  plainAscii = false,
): string[] {
  if (!tools || tools.length === 0) return [];
  const rows: string[] = [sideTitleStyle(theme, "TOOLS")];
  for (const t of tools) {
    let mark = statusBarStyle(theme, "●");
    let stateText = t.status;
    if (t.status === "done") {
      mark = okStyle(theme, "✓");
    } else if (t.status === "error") {
      mark = errStyle(theme, "×");
    } else {
      mark = statusBarStyle(theme, "●");
      stateText = "running";
    }
    const toolLine = `${mark} ${statusBarStyle(theme, t.name)}${toolStyle(theme, " · " + stateText)}`;
    rows.push(short(toolLine, inner));
  }
  rows.push(sep(inner, plainAscii, theme));
  return rows;
}

// 13. SKILLS SECTION
export function renderSkillsSection(
  skills: SidebarSectionItem[] | undefined,
  inner = SIDE_INNER_W,
  theme?: Theme,
  plainAscii = false,
): string[] {
  if (!skills || skills.length === 0) return [];
  const rows: string[] = [
    sideTitleStyle(theme, `SKILLS (${skills.length})`),
  ];
  const shown = skills.slice(0, skillsShowMax);
  for (const item of shown) {
    const text = item.detail ? `${item.label} · ${item.detail}` : item.label;
    rows.push(
      statusBarStyle(theme, " • ") +
        fgSafe(theme, "text", short(text, inner - 3)),
    );
  }
  if (skills.length > skillsShowMax) {
    rows.push(toolStyle(theme, ` … +${skills.length - skillsShowMax} more`));
  }
  rows.push(sep(inner, plainAscii, theme));
  return rows;
}

// 14. SUBAGENTS SECTION
export function renderSubagentsSection(
  subagents: SidebarSectionItem[] | undefined,
  inner = SIDE_INNER_W,
  theme?: Theme,
  mouseSupported = false,
  plainAscii = false,
): string[] {
  if (!subagents || subagents.length === 0) return [];
  let active = 0;
  for (const s of subagents) {
    const st = (s.status ?? "").toLowerCase();
    if (st === "active" || st === "running" || st === "in_progress" || st === "starting" || st === "waiting") {
      active++;
    }
  }
  const title = active > 0 ? `Subagents (${active} active)` : `Subagents (${subagents.length})`;
  const rows: string[] = [sideTitleStyle(theme, title)];

  const shown = subagents.slice(0, subagentsShowMax);
  for (const item of shown) {
    const st = (item.status ?? "").toLowerCase();
    let glyphStr = "○";
    let isAlert = false;
    let isOk = false;
    let isActive = false;
    if (st === "done" || st === "completed") {
      glyphStr = "✓";
      isOk = true;
    } else if (st === "active" || st === "running" || st === "in_progress") {
      glyphStr = "◐";
      isActive = true;
    } else if (st === "waiting") {
      glyphStr = "◌";
    } else if (st === "starting") {
      glyphStr = "○";
    } else if (st === "failed" || st === "aborted" || st === "stalled" || st === "error") {
      glyphStr = "!";
      isAlert = true;
    } else if (item.label.startsWith("✓")) {
      glyphStr = "✓";
      isOk = true;
    } else if (item.label.startsWith("●") || item.label.startsWith("◐")) {
      glyphStr = "◐";
      isActive = true;
    }

    let glyph: string;
    if (isAlert) glyph = warnStyle(theme, glyphStr);
    else if (isOk) glyph = okStyle(theme, glyphStr);
    else if (isActive) glyph = fgSafe(theme, "text", glyphStr);
    else glyph = statusBarStyle(theme, glyphStr);

    let suffix = item.elapsed ?? "";
    if (item.statusLabel && item.statusLabel.trim()) {
      suffix = suffix ? `${item.statusLabel} · ${suffix}` : item.statusLabel;
    }
    if (suffix) suffix = "  " + suffix;
    const suffixLen = visibleWidth(suffix);
    const nameMax = Math.max(0, inner - 3 - suffixLen);
    const cleanLabel = item.label ? item.label.replace(/^[✓●◐○!✖]\s*/, "") : "subagent";
    const displayName = short(item.name || cleanLabel, nameMax);
    const suffixBudget = Math.max(0, inner - visibleWidth(displayName) - 3);
    rows.push(
      statusBarStyle(theme, " ") +
        glyph +
        " " +
        fgSafe(theme, "text", displayName) +
        toolStyle(theme, short(suffix, suffixBudget)),
    );
  }
  if (subagents.length > subagentsShowMax) {
    const hint = mouseSupported ? "click for all" : "truncated";
    rows.push(toolStyle(theme, ` … +${subagents.length - subagentsShowMax} more · ${hint}`));
  }
  rows.push(sep(inner, plainAscii, theme));
  return rows;
}

// 15. WORKSPACE SECTION (collapsible)
export function renderWorkspaceSection(
  workspace: SidebarWorkspaceState | undefined,
  folded: boolean,
  inner = SIDE_INNER_W,
  theme?: Theme,
  plainAscii = false,
): string[] {
  const ws: SidebarWorkspaceState = workspace ?? { cwd: process.cwd() };
  const branchPart = ws.branch ? ` · ${ws.branch}` : "";
  const mark = foldMark(folded);
  const rows: string[] = [
    sideTitleStyle(theme, short(`WORKSPACE${branchPart} ${mark}`, inner)),
  ];

  if (!folded) {
    if (!ws.ok) {
      rows.push(statusBarStyle(theme, "Git status unavailable"));
    } else if (ws.files && ws.files.length > 0) {
      for (const f of ws.files) {
        const stat = `+${f.add} -${f.del}`;
        const statWidth = visibleWidth(stat);
        const nameBudget = inner - statWidth - 1;
        const fileName = short(f.path, nameBudget);
        const gap = Math.max(1, inner - visibleWidth(fileName) - statWidth);
        const fileRow =
          statusBarStyle(theme, fileName + " ".repeat(gap)) +
          okStyle(theme, stat);
        rows.push(fileRow);
      }
      if (ws.moreFiles && ws.moreFiles > 0) {
        rows.push(toolStyle(theme, `… ${ws.moreFiles} more files`));
      }
      if (ws.untracked && ws.untracked > 0) {
        rows.push(toolStyle(theme, `?${ws.untracked} untracked`));
      }
    }
  }

  // CWD line remains visible even when folded
  rows.push(toolStyle(theme, short(shorten(ws.cwd), inner)));
  return rows;
}

// ---------------------------------------------------------------------------
// buildSidebarContent: Combines the 15 sections in exact sideOrder
// ---------------------------------------------------------------------------

export function buildSidebarContent(
  state: SidebarState = {},
  inner = SIDE_INNER_W,
  theme?: Theme,
  options?: SidebarOptions,
): string[] {
  const vis = options?.visibleSections ?? state.visible ?? {};
  const folds = options?.foldedSections ?? state.folds ?? DEFAULT_FOLDS;
  const isPlainAscii = options?.plainAscii ?? false;
  const mouseSupported = options?.interactive ?? false;

  const innerRows: string[] = [];

  // Paint Todos before LSP in default layout.
  const paintOrder = [...sideOrder];
  const todos = paintOrder.indexOf(SideTodos), lsp = paintOrder.indexOf(SideLSP);
  [paintOrder[todos], paintOrder[lsp]] = [paintOrder[lsp]!, paintOrder[todos]!];
  for (const section of paintOrder) {
    switch (section) {
      case SidePet:
        if (isSideVisible(SidePet, vis)) {
          innerRows.push(...renderPetSection(state.pet, inner, theme, isPlainAscii));
        }
        break;

      case SideSession:
        if (isSideVisible(SideSession, vis)) {
          innerRows.push(
            ...renderSessionSection(state.session, state.pet?.status, inner, theme, isPlainAscii),
          );
        }
        break;

      case SideModel:
        if (isSideVisible(SideModel, vis)) {
          innerRows.push(
            ...renderModelSection(state.model, state.context, inner, theme, isPlainAscii),
          );
        }
        break;

      case SideStats:
        if (isSideVisible(SideStats, vis)) {
          innerRows.push(
            ...renderStatsSection(state.stats, state.context?.percent ?? undefined, inner, theme, isPlainAscii),
          );
        }
        break;

      case SideCost:
        if (isSideVisible(SideCost, vis)) {
          innerRows.push(...renderCostSection(state.costBreakdown, inner, theme, isPlainAscii));
        }
        break;

      case SideRecent:
        if (isSideVisible(SideRecent, vis)) {
          const operationsWired = typeof options?.onSelectModel === "function" && mouseSupported;
          innerRows.push(...renderRecentSection(state.recentModels, inner, theme, isPlainAscii, mouseSupported, operationsWired));
        }
        break;

      case SideCommands:
        if (isSideVisible(SideCommands, vis)) {
          innerRows.push(...renderCommandsSection(state.commands, inner, theme, isPlainAscii));
        }
        break;

      case SidePlugins:
        if (isSideVisible(SidePlugins, vis)) {
          const isFolded = folds.plugins !== undefined ? folds.plugins : DEFAULT_FOLDS.plugins ?? true;
          innerRows.push(...renderPluginsSection(state.plugins, isFolded, inner, theme, isPlainAscii));
        }
        break;

      case SideMCP:
        if (isSideVisible(SideMCP, vis)) {
          const isFolded = folds.mcp !== undefined ? folds.mcp : DEFAULT_FOLDS.mcp ?? true;
          innerRows.push(...renderMcpSection(state.mcp, isFolded, inner, theme, isPlainAscii));
        }
        break;

      case SideTodos:
        if (isSideVisible(SideTodos, vis)) {
          const isFolded = folds.todos !== undefined ? folds.todos : DEFAULT_FOLDS.todos ?? false;
          innerRows.push(...renderTodosSection(state.todos, isFolded, inner, theme, isPlainAscii));
        }
        break;

      case SideLSP:
        if (isSideVisible(SideLSP, vis)) {
          const isFolded = folds.lsp !== undefined ? folds.lsp : DEFAULT_FOLDS.lsp ?? false;
          innerRows.push(...renderLspSection(state.lsp, isFolded, inner, theme, isPlainAscii));
        }
        break;

      case SideTools:
        if (isSideVisible(SideTools, vis)) {
          innerRows.push(...renderToolsSection(state.tools, inner, theme, isPlainAscii));
        }
        break;

      case SideSkills:
        if (isSideVisible(SideSkills, vis)) {
          innerRows.push(...renderSkillsSection(state.skills, inner, theme, isPlainAscii));
        }
        break;

      case SideSubagents:
        if (isSideVisible(SideSubagents, vis, state.subagents?.length ?? 0)) {
          innerRows.push(
            ...renderSubagentsSection(state.subagents, inner, theme, mouseSupported, isPlainAscii),
          );
        }
        break;

      case SideWorkspace:
        if (isSideVisible(SideWorkspace, vis)) {
          const isFolded = folds.workspace !== undefined ? folds.workspace : DEFAULT_FOLDS.workspace ?? true;
          innerRows.push(...renderWorkspaceSection(state.workspace, isFolded, inner, theme, isPlainAscii));
        }
        break;
    }
  }

  // Quit armed warning footer right-aligned inside content width
  if (options?.quitArmed) {
    const armText = "press Ctrl+C again to quit";
    const pad = Math.max(0, inner - visibleWidth(armText));
    innerRows.push(warnStyle(theme, " ".repeat(pad) + armText));
  }

  return innerRows;
}

// ---------------------------------------------------------------------------
// renderSidepanels: Produces outer framed box (sideW 34, sideInnerW 30)
// Supports custom responsive terminal widths (120, 80, 40, 20) with 0 overflow.
// ---------------------------------------------------------------------------

export function renderSidepanels(
  state: SidebarState = {},
  width = SIDE_W,
  theme?: Theme,
  options?: SidebarOptions,
): string[] {
  const outerWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : SIDE_W;
  if (outerWidth === 0) return [];
  if (outerWidth < 4) return ["─".repeat(outerWidth)];

  const inner = outerWidth - 4; // Padding (0, 1) + 2 borders = 4
  const isPlainAscii = options?.plainAscii ?? false;

  const innerRows = buildSidebarContent(state, inner, theme, options);

  const tl = isPlainAscii ? "+" : "╭";
  const tr = isPlainAscii ? "+" : "╮";
  const bl = isPlainAscii ? "+" : "╰";
  const br = isPlainAscii ? "+" : "╯";
  const hz = isPlainAscii ? "-" : "─";
  const vt = isPlainAscii ? "|" : "│";

  const topBorder = fgSafe(theme, "border", `${tl}${hz.repeat(outerWidth - 2)}${tr}`);
  const botBorder = fgSafe(theme, "border", `${bl}${hz.repeat(outerWidth - 2)}${br}`);

  const framedLines: string[] = [topBorder];
  for (const row of innerRows) {
    const rowWidth = visibleWidth(row);
    let fitted = row;
    if (rowWidth > inner) {
      fitted = truncateToWidth(row, inner, "");
    } else if (rowWidth < inner) {
      fitted = row + " ".repeat(inner - rowWidth);
    }
    const leftEdge = fgSafe(theme, "border", `${vt} `);
    const rightEdge = fgSafe(theme, "border", ` ${vt}`);
    framedLines.push(`${leftEdge}${fitted}${rightEdge}`);
  }
  framedLines.push(botBorder);

  return framedLines;
}

/** Backward-compatible alias matching sidebar exports */
export const renderSidebar = renderSidepanels;

// ---------------------------------------------------------------------------
// Viewport clipping & bounded scrolling with scroll markers
// ---------------------------------------------------------------------------

export interface ViewportResult {
  lines: string[];
  maxScroll: number;
  totalLines: number;
  scrollOffset: number;
}

export function renderSidepanelsViewport(
  state: SidebarState = {},
  width = SIDE_W,
  height = 24,
  scrollOffset = 0,
  theme?: Theme,
  options?: SidebarOptions,
): ViewportResult {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(3, Math.floor(height));

  const framed = renderSidepanels(state, safeWidth, theme, options);
  const totalLines = framed.length;

  if (totalLines <= safeHeight) {
    return {
      lines: framed,
      maxScroll: 0,
      totalLines,
      scrollOffset: 0,
    };
  }

  const maxScroll = Math.max(0, totalLines - safeHeight);
  const clampedOffset = Math.max(0, Math.min(scrollOffset, maxScroll));

  const isPlainAscii = options?.plainAscii ?? false;
  const tl = isPlainAscii ? "+" : "╭";
  const tr = isPlainAscii ? "+" : "╮";
  const bl = isPlainAscii ? "+" : "╰";
  const br = isPlainAscii ? "+" : "╯";
  const hz = isPlainAscii ? "-" : "─";

  let topBorder = framed[0]!;
  if (clampedOffset > 0 && options?.showScrollHints !== false) {
    const hint = ` ▲ ${clampedOffset} above `;
    if (safeWidth >= visibleWidth(hint) + 4) {
      const fill = Math.max(0, safeWidth - 2 - visibleWidth(hint));
      const lFill = Math.floor(fill / 2);
      const rFill = fill - lFill;
      topBorder =
        fgSafe(theme, "border", `${tl}${hz.repeat(lFill)}`) +
        warnStyle(theme, hint) +
        fgSafe(theme, "border", `${hz.repeat(rFill)}${tr}`);
    }
  }

  let botBorder = framed[framed.length - 1]!;
  const remaining = maxScroll - clampedOffset;
  if (remaining > 0 && options?.showScrollHints !== false) {
    const hint = ` ▼ ${remaining} more `;
    if (safeWidth >= visibleWidth(hint) + 4) {
      const fill = Math.max(0, safeWidth - 2 - visibleWidth(hint));
      const lFill = Math.floor(fill / 2);
      const rFill = fill - lFill;
      botBorder =
        fgSafe(theme, "border", `${bl}${hz.repeat(lFill)}`) +
        warnStyle(theme, hint) +
        fgSafe(theme, "border", `${hz.repeat(rFill)}${br}`);
    }
  }

  const visibleInner = framed.slice(1 + clampedOffset, safeHeight - 1 + clampedOffset);
  return {
    lines: [topBorder, ...visibleInner, botBorder],
    maxScroll,
    totalLines,
    scrollOffset: clampedOffset,
  };
}

// ---------------------------------------------------------------------------
// Interactive Sidepanels Component
// ---------------------------------------------------------------------------

let nextMotionSource = 0;

export interface SidepanelsComponentOptions extends SidebarOptions {
  state?: SidebarState;
  getState?: () => SidebarState;
  onCyclePet?: (petName: string) => void;
  onSelectPet?: (petNameOrStyle: string) => void | Promise<void>;
  onSelectModel?: (modelId: string) => void | Promise<void>;
  onSelectThinkingLevel?: (level: string) => void | Promise<void>;
  onToggleFold?: (sectionKey: string, folded: boolean) => void;
  onToggleSection?: (sectionKey: string, visible: boolean) => void;
}

export class SidepanelsComponent implements Component {
  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly keybindings?: KeybindingsManager;
  private readonly done: (value?: unknown) => void;
  private readonly ctx: ExtensionContext;
  private readonly options?: SidepanelsComponentOptions;

  private state: SidebarState;
  private scrollOffset = 0;
  private isClosed = false;
  private petIndex = 0;
  private foldedSections: SidePanelFolds;
  private lastRenderedLines: string[] = [];
  private readonly motionSource = `sidepanels:${++nextMotionSource}`;
  private readonly startedAt = performance.now();
  private rotationAnchorAt = this.startedAt;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager | undefined,
    done: (value?: unknown) => void,
    ctx: ExtensionContext,
    options?: SidepanelsComponentOptions,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done;
    this.ctx = ctx;
    this.options = options;

    this.state = options?.state ?? options?.getState?.() ?? {};
    this.foldedSections = { ...(options?.foldedSections ?? this.state.folds ?? DEFAULT_FOLDS) };

    const initialPet = this.state.pet?.name ?? DEFAULT_PET;
    const foundIdx = PET_NAMES.indexOf(initialPet);
    this.petIndex = foundIdx >= 0 ? foundIdx : 0;

    if (this.options?.visibleSections?.pet !== false && this.state.visible?.pet !== false) {
      motionCoordinator.register(this.motionSource, 500);
    }
  }

  getState(): SidebarState {
    return this.state;
  }

  setState(newState: SidebarState): void {
    this.state = newState;
    this.tui.requestRender?.();
  }

  getScrollOffset(): number {
    return this.scrollOffset;
  }

  setScrollOffset(offset: number): void {
    this.scrollOffset = Math.max(0, offset);
    this.tui.requestRender?.();
  }

  getFolds(): SidePanelFolds {
    return { ...this.foldedSections };
  }

  toggleFold(sectionKey: FoldableSectionKey): boolean {
    const current = !!this.foldedSections[sectionKey];
    const next = !current;
    this.foldedSections[sectionKey] = next;
    this.options?.onToggleFold?.(sectionKey, next);
    this.tui.requestRender?.();
    return next;
  }

  cyclePet(): string {
    this.petIndex = (this.petIndex + 1) % PET_NAMES.length;
    const nextPet = PET_NAMES[this.petIndex] ?? DEFAULT_PET;
    this.rotationAnchorAt = performance.now();
    if (this.state.pet) {
      this.state = {
        ...this.state,
        pet: { ...this.state.pet, name: nextPet },
      };
    }
    this.options?.onCyclePet?.(nextPet);
    this.options?.onSelectPet?.(nextPet);
    this.tui.requestRender?.();
    return nextPet;
  }

  togglePetStyle(): string {
    const current = this.state.pet?.style ?? "ascii";
    const next = current === "ascii" ? "classic" : "ascii";
    if (this.state.pet) {
      this.state = { ...this.state, pet: { ...this.state.pet, style: next } };
    }
    this.options?.onSelectPet?.(next);
    this.tui.requestRender?.();
    return next;
  }

  selectModel(modelId: string): void {
    if (!this.options?.onSelectModel) return;
    const res = this.options.onSelectModel(modelId);
    const applyState = () => {
      if (this.state.recentModels) {
        this.state = {
          ...this.state,
          recentModels: this.state.recentModels.map((r) => ({
            ...r,
            isCurrent: r.id === modelId,
          })),
          model: this.state.model ? { ...this.state.model, label: modelId } : undefined,
        };
        this.tui.requestRender?.();
      }
    };
    if (res && typeof (res as Promise<void>).then === "function") {
      void (res as Promise<void>).then(applyState, () => {});
    } else {
      applyState();
    }
  }

  cycleRecentModel(): string | undefined {
    const recents = this.state.recentModels;
    if (!recents || recents.length === 0) return undefined;
    if (!this.options?.onSelectModel) return undefined;
    const curIdx = recents.findIndex((r) => r.isCurrent);
    const nextIdx = curIdx >= 0 ? (curIdx + 1) % recents.length : 0;
    const nextModel = recents[nextIdx]!;
    this.selectModel(nextModel.id);
    return nextModel.id;
  }

  cycleThinkingLevel(): string | undefined {
    const levels = this.state.model?.thinkLevels ?? ["off", "low", "medium", "high"];
    if (!this.options?.onSelectThinkingLevel) return undefined;
    const current = this.state.model?.thinkLevel ?? "off";
    const curIdx = levels.indexOf(current);
    const nextIdx = (curIdx + 1) % levels.length;
    const nextLevel = levels[nextIdx] ?? levels[0]!;
    const res = this.options.onSelectThinkingLevel(nextLevel);
    const applyState = () => {
      if (this.state.model) {
        this.state = {
          ...this.state,
          model: { ...this.state.model, thinkLevel: nextLevel },
        };
        this.tui.requestRender?.();
      }
    };
    if (res && typeof (res as Promise<void>).then === "function") {
      void (res as Promise<void>).then(applyState, () => {});
    } else {
      applyState();
    }
    return nextLevel;
  }

  handleInput(data: string): void {
    if (this.isClosed) return;

    // Esc / 'q' / 'Q' / Ctrl+C -> Close
    if (
      this.keybindings?.matches?.(data, "tui.select.cancel") ||
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.esc) ||
      data === "\x1b" ||
      data === "q" ||
      data === "Q" ||
      data === "\x03"
    ) {
      this.dispose();
      this.done();
      return;
    }

    // 'p' / 'P' -> Cycle next pet
    if (data === "p" || data === "P") {
      this.cyclePet();
      return;
    }

    // Shift+P -> Toggle pet style
    if (data === "\x10") {
      this.togglePetStyle();
      return;
    }

    // 'm' / 'M' -> Cycle recent model
    if (data === "m" || data === "M") {
      this.cycleRecentModel();
      return;
    }

    // 't' / 'T' -> Cycle thinking level
    if (data === "t" || data === "T") {
      this.cycleThinkingLevel();
      return;
    }

    // 'f' / 'F' -> Toggle all foldable sections
    if (data === "f" || data === "F") {
      for (const section of FOLDABLE_SECTIONS) {
        this.toggleFold(section);
      }
      return;
    }

    // '1'..'9' -> Quick select recent model
    if (data >= "1" && data <= "9") {
      const idx = parseInt(data, 10) - 1;
      const recents = this.state.recentModels;
      if (recents && idx >= 0 && idx < recents.length) {
        this.selectModel(recents[idx]!.id);
        return;
      }
    }

    // PageDown / Space / Ctrl+Down / Alt+Down
    if (
      this.keybindings?.matches?.(data, "tui.select.pageDown") ||
      matchesKey(data, Key.pageDown) ||
      data === " " ||
      data === "\x1b[6~" ||
      data === "\x1b[1;5B" ||
      data === "\x1b\x1b[B"
    ) {
      this.scrollOffset += Math.max(1, (this.options?.viewportHeight ?? 20) - 2);
      this.tui.requestRender?.();
      return;
    }

    // PageUp / Ctrl+Up / Alt+Up
    if (
      this.keybindings?.matches?.(data, "tui.select.pageUp") ||
      matchesKey(data, Key.pageUp) ||
      data === "\x1b[5~" ||
      data === "\x1b[1;5A" ||
      data === "\x1b\x1b[A"
    ) {
      this.scrollOffset = Math.max(0, this.scrollOffset - Math.max(1, (this.options?.viewportHeight ?? 20) - 2));
      this.tui.requestRender?.();
      return;
    }

    // Home / 'g' -> Top
    if (matchesKey(data, Key.home) || data === "g" || data === "\x1b[H") {
      this.scrollOffset = 0;
      this.tui.requestRender?.();
      return;
    }

    // End / 'G' -> Bottom
    if (matchesKey(data, Key.end) || data === "G" || data === "\x1b[F") {
      this.scrollOffset = 999999;
      this.tui.requestRender?.();
      return;
    }

    // Up Arrow / 'k' -> Scroll sidebar up
    if (
      this.keybindings?.matches?.(data, "tui.select.up") ||
      matchesKey(data, Key.up) ||
      data === "\x1b[A" ||
      data === "k"
    ) {
      if (this.scrollOffset > 0) {
        this.scrollOffset--;
        this.tui.requestRender?.();
      }
      return;
    }

    // Down Arrow / 'j' -> Scroll sidebar down
    if (
      this.keybindings?.matches?.(data, "tui.select.down") ||
      matchesKey(data, Key.down) ||
      data === "\x1b[B" ||
      data === "j"
    ) {
      this.scrollOffset++;
      this.tui.requestRender?.();
      return;
    }
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (this.isClosed) return undefined;

    // Wheel scrolling
    if (event.type === "wheel") {
      const delta = event.wheelDelta ?? 0;
      if (delta < 0) {
        this.scrollOffset = Math.max(0, this.scrollOffset - Math.max(1, Math.abs(delta)));
      } else if (delta > 0) {
        this.scrollOffset += Math.max(1, delta);
      }
      this.tui.requestRender?.();
      return { handled: true, render: true };
    }

    // Left click / release handling
    if (
      (event.type === "click" || event.type === "press" || event.type === "release") &&
      (event.button === "left" || event.button === "none")
    ) {
      const height = Math.max(
        1,
        Math.floor(this.options?.viewportHeight ?? Math.max(3, (this.tui.terminal?.rows ?? 30) - 10)),
      );

      // Top border click: scroll up / top
      if (event.y === 0) {
        if (this.scrollOffset > 0) {
          this.scrollOffset = Math.max(0, this.scrollOffset - 5);
          this.tui.requestRender?.();
        }
        return { handled: true, render: true };
      }

      // Bottom border click: scroll down / bottom
      if (event.y >= height - 1) {
        this.scrollOffset += 5;
        this.tui.requestRender?.();
        return { handled: true, render: true };
      }

      // Content row hit-testing with scroll offset (sideFoldAt: row = y - 1 + YOffset)
      const contentRow = event.y - 1 + this.scrollOffset;
      const targetLine = this.lastRenderedLines[1 + contentRow];
      if (targetLine) {
        const plain = stripTerminalSequences(targetLine);

        // Click header toggles fold
        if (plain.includes("PLUGINS")) {
          this.toggleFold("plugins");
          return { handled: true, render: true };
        }
        if (plain.includes("MCP Servers")) {
          this.toggleFold("mcp");
          return { handled: true, render: true };
        }
        if (plain.includes("Todos")) {
          this.toggleFold("todos");
          return { handled: true, render: true };
        }
        if (plain.includes("LSP")) {
          this.toggleFold("lsp");
          return { handled: true, render: true };
        }
        if (plain.includes("WORKSPACE")) {
          this.toggleFold("workspace");
          return { handled: true, render: true };
        }

        // Recent model click
        const modelMatch = plain.match(/(\d+)\.\s+(\S+)/);
        if (modelMatch && modelMatch[1]) {
          const idx = parseInt(modelMatch[1], 10) - 1;
          const recents = this.state.recentModels;
          if (recents && idx >= 0 && idx < recents.length) {
            this.selectModel(recents[idx]!.id);
            return { handled: true, render: true };
          }
        }

        // Pet section click: cycle pet
        const petName = this.state.pet?.name ?? DEFAULT_PET;
        if (plain.includes(petName) || contentRow < 5) {
          this.cyclePet();
          return { handled: true, render: true };
        }
      }

      return { handled: true, render: true };
    }

    return undefined;
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (this.isClosed || width <= 0) return [];
    const safeWidth = Math.max(1, Math.floor(width));
    const latest = this.options?.getState?.();
    if (latest) {
      const selected = latest.pet?.name ?? DEFAULT_PET;
      if (selected !== this.state.pet?.name) {
        const index = PET_NAMES.indexOf(selected);
        this.petIndex = index < 0 ? 0 : index;
        this.rotationAnchorAt = performance.now();
      }
      this.state = latest;
    }

    const elapsed = scaleElapsed(performance.now() - this.startedAt);
    const tick = (this.state.pet?.tick ?? 0) + (isAnimationActive() ? Math.floor(elapsed / 500) : 0);

    let shownPet = PET_NAMES[this.petIndex] ?? DEFAULT_PET;
    if (this.state.pet?.style !== "classic" && isAnimationActive()) {
      const rotationStep = Math.floor(scaleElapsed(performance.now() - this.rotationAnchorAt) / PET_ROTATE_EVERY);
      if (rotationStep > 0) {
        shownPet = rotatePet(shownPet, rotationStep);
      }
    }

    const mergedOptions: SidebarOptions = {
      ...this.options,
      foldedSections: this.foldedSections,
    };

    const state: SidebarState = {
      ...this.state,
      pet: this.state.pet ? { ...this.state.pet, name: shownPet, tick } : undefined,
    };

    const activeTheme = this.ctx.ui?.theme ?? this.theme;
    const framed = renderSidepanels(state, safeWidth, activeTheme, mergedOptions);
    this.lastRenderedLines = framed;

    const height = Math.max(
      1,
      Math.floor(this.options?.viewportHeight ?? Math.max(3, (this.tui.terminal?.rows ?? 30) - 10)),
    );
    if (height < 3) return framed.slice(0, height);

    const maxOffset = Math.max(0, framed.length - height);
    this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxOffset));

    if (framed.length <= height) return framed;

    const isPlainAscii = this.options?.plainAscii ?? false;
    const tl = isPlainAscii ? "+" : "╭";
    const tr = isPlainAscii ? "+" : "╮";
    const bl = isPlainAscii ? "+" : "╰";
    const br = isPlainAscii ? "+" : "╯";
    const hz = isPlainAscii ? "-" : "─";

    let topBorder = framed[0]!;
    if (this.scrollOffset > 0 && this.options?.showScrollHints !== false) {
      const hint = ` ▲ ${this.scrollOffset} above `;
      if (safeWidth >= visibleWidth(hint) + 4) {
        const fill = Math.max(0, safeWidth - 2 - visibleWidth(hint));
        const lFill = Math.floor(fill / 2);
        const rFill = fill - lFill;
        topBorder =
          fgSafe(activeTheme, "border", `${tl}${hz.repeat(lFill)}`) +
          warnStyle(activeTheme, hint) +
          fgSafe(activeTheme, "border", `${hz.repeat(rFill)}${tr}`);
      }
    }

    let botBorder = framed[framed.length - 1]!;
    const remaining = maxOffset - this.scrollOffset;
    if (remaining > 0 && this.options?.showScrollHints !== false) {
      const hint = ` ▼ ${remaining} more `;
      if (safeWidth >= visibleWidth(hint) + 4) {
        const fill = Math.max(0, safeWidth - 2 - visibleWidth(hint));
        const lFill = Math.floor(fill / 2);
        const rFill = fill - lFill;
        botBorder =
          fgSafe(activeTheme, "border", `${bl}${hz.repeat(lFill)}`) +
          warnStyle(activeTheme, hint) +
          fgSafe(activeTheme, "border", `${hz.repeat(rFill)}${br}`);
      }
    }

    const visibleInner = framed.slice(1 + this.scrollOffset, height - 1 + this.scrollOffset);
    return [topBorder, ...visibleInner, botBorder];
  }

  dispose(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    motionCoordinator.unregister(this.motionSource);
  }
}

/** Factory for SidepanelsComponent */
export function createSidepanelsComponent(
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager | undefined,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  options?: SidepanelsComponentOptions,
): SidepanelsComponent {
  return new SidepanelsComponent(tui, theme, keybindings, done, ctx, options);
}

/** Backward-compatible factory alias */
export const createSidebarComponent = createSidepanelsComponent;

/** One-column companion widget control */
export function createSidepanelsControl(pi?: ExtensionAPI): SidebarControl {
  let enabled = false;
  let mountedContext: ExtensionContext | undefined;
  const key = "omt-sidepanels";
  const compatible = (ctx: ExtensionContext) =>
    ctx.mode === "tui" && ctx.hasUI && typeof ctx.ui?.setWidget === "function";
  let pet = createPetPureState();
  let lastError = false;

  function unmount(): void {
    const ctx = mountedContext;
    mountedContext = undefined;
    if (ctx) ctx.ui.setWidget(key, undefined);
  }

  return {
    on(ctx) {
      if (!compatible(ctx)) return "OMT sidebar unavailable: TUI widget API required.";
      if (enabled && mountedContext === ctx) return "OMT sidebar on (compact one-column companion).";
      unmount();
      enabled = true;
      mountedContext = ctx;
      ctx.ui.setWidget(key, (_tui, theme) => ({
        invalidate() {},
        render(width) {
          if (!enabled || mountedContext !== ctx || width <= 0) return [];
          const petName = pet.name ?? DEFAULT_PET;
          return [
            truncateToWidth(theme.fg("muted", `[sidepanels] pet: ${petName} · status: ${pet.status}`), width, ""),
            truncateToWidth(theme.fg("dim", "/omt sidebar — 15 sections dashboard"), width, ""),
          ];
        },
      }));
      return "OMT sidebar on (compact one-column companion).";
    },
    off(_ctx) {
      enabled = false;
      unmount();
      return "OMT sidebar off.";
    },
    toggle(ctx) {
      return enabled ? this.off(ctx) : this.on(ctx);
    },
    isEnabled: () => enabled,
    getState(_ctx) {
      return {
        pet: { name: pet.name, status: pet.status, tick: pet.tick },
      };
    },
    observe(type, event) {
      const e = event as any;
      if (["session_start", "session_switch", "session_tree"].includes(type)) {
        pet = createPetPureState();
        lastError = false;
        return;
      }
      if (type === "agent_start") {
        pet = stepPetState(pet, { type: "turn_start" });
        lastError = false;
      }
      if (type === "tool_execution_start") pet = stepPetState(pet, { type: "tool_start" });
      if (type === "message_update") {
        const kind = e?.assistantMessageEvent?.type;
        if (kind === "thinking_delta") pet = stepPetState(pet, { type: "reasoning_chunk" });
        if (kind === "text_delta") pet = stepPetState(pet, { type: "text_chunk" });
      }
      if (type === "message_end" && e?.message?.role === "assistant") {
        lastError = e.message.stopReason === "error";
      }
      if (type === "agent_settled") pet = stepPetState(pet, { type: "turn_settled", isError: lastError });
    },
    render(state = {}, width = SIDE_W, theme, options) {
      return renderSidepanels(state, width, theme, options);
    },
    cleanup() {
      enabled = false;
      unmount();
    },
  };
}

// ---------------------------------------------------------------------------
// Hover Highlighting
// ---------------------------------------------------------------------------

export function brighten(ln: string): string {
  const on = "\x1b[22;1m";
  let res = ln.replace(/\x1b\[0m/g, "\x1b[0m" + on);
  res = res.replace(/\x1b\[m/g, "\x1b[m" + on);
  return on + res + "\x1b[0m";
}

export function hoverStyle(theme?: Theme): (s: string) => string {
  return (s: string) => {
    if (theme) {
      return boldSafe(theme, fgSafe(theme, "accent", s));
    }
    return `\x1b[1;36m${s}\x1b[0m`;
  };
}

export function applyHover(
  lines: string[],
  hoverIndex: number,
  hoverLevel?: string,
  theme?: Theme,
): string[] {
  if (hoverIndex < 0 || hoverIndex >= lines.length) return lines;
  const out = [...lines];
  const target = out[hoverIndex];
  if (!target) return lines;

  if (hoverLevel) {
    const plain = stripTerminalSequences(target);
    if (plain.includes(hoverLevel)) {
      const hStyle = hoverStyle(theme);
      out[hoverIndex] = target.replace(hoverLevel, hStyle(hoverLevel));
      return out;
    }
  }

  const plain = stripTerminalSequences(target).trimEnd();
  if (!plain.trim()) return lines;
  out[hoverIndex] = hoverStyle(theme)(plain);
  return out;
}

