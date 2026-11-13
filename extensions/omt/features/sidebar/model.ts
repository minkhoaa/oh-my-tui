import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { homedir } from "node:os";
import { readDisplayUsage } from "../../core/usage.ts";
import type {
  PetDefinition,
  PetStatus,
  SidebarState,
  SidebarOptions,
  SidebarPetState,
  SidebarConfig,
  SidebarStatsState,
  SidebarToolItem,
  SidebarWorkspaceState,
  SidebarFolds,
} from "./types.ts";
export * from "./pet.ts";
import { DEFAULT_PET, getPet, petFrameFor, isBusyStatus, fmtDur, petLabel, petNameRow, width, classicFace, SIDE_W, SIDE_INNER_W, ART_ROWS, ANIM_CYCLE, ANIM_CYCLE_BUSY, ANIM_BLINK_FROM } from "./pet.ts";



/** Formats token numbers cleanly: 1.2M, 12.5k, 420 */
export function fmtNum(n: number): string {
  if (n >= 1_000_000) {
    return (n / 1_000_000).toFixed(1) + "M";
  }
  if (n >= 1_000) {
    return (n / 1_000).toFixed(1) + "k";
  }
  return `${Math.round(n)}`;
}

/** Formats numbers with comma thousands separator */
export function fmtComma(n: number): string {
  if (typeof n !== "number" || isNaN(n)) return "0";
  return Math.round(n).toLocaleString("en-US");
}

/** Truncates string to at most n display cells with '…' */
export function truncWidth(s: string, n: number): string {
  if (n <= 1) return "…";
  let cells = 0;
  let out = "";
  for (const ch of s) {
    const c = visibleWidth(ch);
    if (cells + c > n - 1) break;
    cells += c;
    out += ch;
  }
  return out + "…";
}

/** Truncates string to at most n display cells, replacing newlines with ' ⏎ ' */
export function short(s: string, n: number): string {
  const flattened = s.replace(/\r?\n/g, " ⏎ ");
  if (visibleWidth(flattened) <= n) return flattened;
  return truncWidth(flattened, n);
}

/** Shortens home directory path to ~/ */
export function shorten(p: string): string {
  try {
    const home = homedir();
    if (home) {
      if (p === home) return "~";
      if (p.startsWith(home + "/") || p.startsWith(home + "\\")) {
        return "~" + p.slice(home.length);
      }
    }
  } catch {}
  return p;
}

/**
 * Pads a two-column sidebar row.
 * Left col max 16 chars, right column starts at column 17.
 * The outer renderer pads the remainder; the right column is not right-aligned.
 */
export function twoCol(l: string, r: string, inner = SIDE_INNER_W): string {
  const lw = Math.max(1, Math.min(17, inner));
  const shortL = short(l, lw - 1);
  const shortR = short(r, Math.max(0, inner - lw - 1));
  const gap = Math.max(1, lw - visibleWidth(shortL));
  return truncateToWidth(shortL + " ".repeat(gap) + shortR, Math.max(0, inner), "");
}

/** Renders a fixed-width context usage bar using █ and ░ */
export function ctxBar(pct: number, w: number): string {
  if (w < 1) w = 1;
  const clampedPct = Math.max(0, Math.min(100, pct));
  const f = Math.max(0, Math.min(w, Math.round((clampedPct / 100) * w)));
  return "█".repeat(f) + "░".repeat(w - f);
}

/** Horizontal separator divider */
export function sep(inner = SIDE_INNER_W): string {
  return "─".repeat(inner);
}

// -------------------------------------------------------------
// Styling Utilities (safe fallback when Theme is missing or in mock tests)
// -------------------------------------------------------------

function boldSafe(theme: Theme | undefined, text: string): string {
  if (theme && typeof theme.bold === "function") {
    try {
      return theme.bold(text);
    } catch {}
  }
  return text;
}

function fgSafe(theme: Theme | undefined, color: string, text: string): string {
  if (theme && typeof theme.fg === "function") {
    try {
      return theme.fg(color as any, text);
    } catch {}
  }
  return text;
}

function dimSafe(theme: Theme | undefined, text: string): string {
  return fgSafe(theme, "dim", text);
}

// -------------------------------------------------------------
// Section Renderers
// -------------------------------------------------------------

/** Renders Pet section (4-row ASCII art or 1-row classic face) + divider */
export function renderPet(
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
  const sepChar = plainAscii ? "-" : "─";

  // Determine pet art color style
  const getArtStyled = (line: string): string => {
    if (status === "thinking" || status === "writing" || status === "working") {
      return fgSafe(theme, "text", line);
    }
    if (status === "success") {
      return fgSafe(theme, "success", line);
    }
    if (status === "error") {
      return fgSafe(theme, "error", line);
    }
    return dimSafe(theme, line);
  };

  if (isClassicMode) {
    const face = classicFace(status, tick);
    const faceW = visibleWidth(face);
    const labelW = Math.max(0, inner - faceW - 1);
    const statusLabel = short(petLabel(status, petState?.since), labelW);
    const row = getArtStyled(face) + " " + dimSafe(theme, statusLabel);
    return [row, fgSafe(theme, "border", sepChar.repeat(inner))];
  }

  const frame = petFrameFor(p, tick, isBusy);
  const petW = width(frame);

  const labelW = Math.max(0, inner - petW - 2);
  const nameStr = boldSafe(theme, short(p.name, labelW));
  const labelStr = dimSafe(theme, short(petLabel(status, petState?.since), labelW));

  const nameRowIdx = petNameRow(frame);
  const groundRowIdx = frame.length - 1;

  const rows: string[] = [];
  for (let i = 0; i < frame.length; i++) {
    const rawLine = frame[i] ?? "";
    const rawWidth = [...rawLine].length;
    const pad = " ".repeat(Math.max(0, petW - rawWidth));
    const paddedArt = getArtStyled(rawLine + pad);

    let row = paddedArt;
    if (i === nameRowIdx) {
      row += "  " + nameStr;
    } else if (i === groundRowIdx) {
      row += "  " + labelStr;
    }
    rows.push(row);
  }

  // Divider
  rows.push(fgSafe(theme, "border", sepChar.repeat(inner)));
  return rows;
}

/** Formats thinking levels row layout (wraps if exceeding inner width) */
export function formatThinkLevels(levels: string[], activeLevel: string, inner: number, theme?: Theme): string[] {
  if (!levels || levels.length === 0) return [];
  const lines: string[] = [];
  let current: string[] = [];
  let currentWidth = 0;

  for (const lvl of levels) {
    const w = visibleWidth(lvl);
    if (currentWidth > 0 && currentWidth + 1 + w > inner) {
      lines.push(current.join(" "));
      current = [];
      currentWidth = 0;
    }
    if (currentWidth > 0) currentWidth += 1;
    const styled = lvl === activeLevel ? boldSafe(theme, fgSafe(theme, "text", lvl)) : dimSafe(theme, lvl);
    current.push(styled);
    currentWidth += w;
  }
  if (current.length > 0) {
    lines.push(current.join(" "));
  }
  return lines;
}

/**
 * Main sidebar renderer producing the exact 34-column outer box (30 inner content)
 * with rounded borders (╭─╮ ╰─╯), padding (0, 1), and clean sections.
 */
export function renderSidebar(
  state: SidebarState = {},
  width = SIDE_W,
  theme?: Theme,
  options?: SidebarOptions,
): string[] {
  const outerWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : SIDE_W;
  if (outerWidth === 0) return [];
  if (outerWidth < 4) return ["─".repeat(outerWidth)];
  const inner = outerWidth - 4;
  const vis = options?.visibleSections ?? {};
  const isPlainAscii = options?.plainAscii ?? false;

  const showPet = vis.pet !== false;
  const showSession = vis.session !== false;
  const showModel = vis.model !== false;
  const showStats = vis.stats !== false;
  const showCost = vis.cost === true;
  const showRecent = vis.recent !== false;
  const showCommands = vis.commands !== false;
  const showTools = vis.tools !== false;
  const showWorkspace = vis.workspace !== false;
  const showTodos = vis.todos !== false;
  const showLsp = vis.lsp !== false;
  const showSkills = vis.skills !== false;
  const showMcp = vis.mcp !== false;
  const showPlugins = vis.plugins !== false;
  const showSubagents = vis.subagents !== false;

  const innerRows: string[] = [];

  const addSep = () => {
    const sepChar = isPlainAscii ? "-" : "─";
    innerRows.push(fgSafe(theme, "border", sepChar.repeat(inner)));
  };

  const isFolded = (key: keyof SidebarFolds): boolean => {
    if (options?.foldedSections && typeof options.foldedSections[key] === "boolean") {
      return options.foldedSections[key]!;
    }
    return false;
  };
  const foldMark = (key: keyof SidebarFolds): string => (isFolded(key) ? "▸" : "▾");

  // 1. PET SECTION
  if (showPet) {
    const petLines = renderPet(state.pet, inner, theme, isPlainAscii);
    innerRows.push(...petLines);
  }

  // 2. SESSION SECTION
  if (showSession) {
    innerRows.push(boldSafe(theme, fgSafe(theme, "text", "SESSION")));
    const session = state.session ?? {};
    let firstLine = "";
    if (session.firstPrompt && session.firstPrompt.trim() !== "") {
      firstLine = short(session.firstPrompt, inner);
    } else {
      const isThinking = state.pet?.status === "thinking";
      const dot = isThinking ? fgSafe(theme, "success", "●") : dimSafe(theme, "○");
      const statusText = petLabel(state.pet?.status ?? "idle");
      firstLine = `${dot} ${short(statusText, inner - 2)}`;
    }
    innerRows.push(dimSafe(theme, firstLine));

    const sessId = session.id ? shorten(session.id) : "…";
    innerRows.push(dimSafe(theme, short(sessId, inner)));

    const sessFile = session.filePath ? shorten(session.filePath) : "In-memory";
    innerRows.push(dimSafe(theme, short(sessFile, inner)));
    addSep();
  }

  // 3. MODEL SECTION
  if (showModel) {
    const model = state.model ?? { label: "—" };
    const lvl = model.thinkLevel && model.thinkLevel !== "" ? model.thinkLevel : "off";
    const modelName = short(`${model.label} - ${lvl}`, inner - 8);
    innerRows.push(dimSafe(theme, "model · ") + fgSafe(theme, "text", modelName));

    if (model.thinkLevels && model.thinkLevels.length > 0) {
      const thinkRows = formatThinkLevels(model.thinkLevels, lvl, inner, theme);
      innerRows.push(...thinkRows);
    }

    const ctx = state.context ?? {};
    const knownPct = typeof ctx.percent === "number" && Number.isFinite(ctx.percent);
    const pct = knownPct ? Math.max(0, Math.min(100, ctx.percent!)) : 0;
    const barW = Math.max(4, inner - 4 - 5);
    const pctStr = knownPct ? `${Math.round(pct).toString().padStart(3)}%` : "   ?%";
    innerRows.push(dimSafe(theme, `ctx ${knownPct ? ctxBar(pct, barW) : "░".repeat(barW)} ${pctStr}`));

    const used = ctx.tokens;
    const win = ctx.contextWindow ?? 0;
    const compact = ctx.autoCompact === undefined ? "compact ?" : ctx.autoCompact ? "compact auto" : "manual";
    let tokLine = "tok —";
    if (win > 0 && used !== undefined && used !== null) {
      tokLine = `${fmtNum(used)}/${fmtNum(win)} tkns - ${compact}`;
    } else if (used !== undefined && used !== null) {
      tokLine = `tok ${fmtNum(used)}`;
    }
    innerRows.push(dimSafe(theme, short(tokLine, inner)));
    addSep();
  }

  // 4. STATS SECTION
  if (showStats) {
    innerRows.push(boldSafe(theme, fgSafe(theme, "text", twoCol("Stats", "Tokens", inner))));
    const stats: SidebarStatsState = state.stats ?? {
      inTokens: 0,
      outTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      userMessages: 0,
      assistantMessages: 0,
      totalMessages: 0,
    };

    const elapsed = stats.elapsedMs !== undefined && stats.elapsedMs > 0 ? fmtDur(stats.elapsedMs) : "—";
    const last = stats.lastDurationMs !== undefined && stats.lastDurationMs > 0 ? fmtDur(stats.lastDurationMs) : "—";
    const speed = stats.lastSpeed !== undefined && stats.lastSpeed > 0 ? `${Math.round(stats.lastSpeed)} tok/s` : "—";
    const cache =
      stats.totalTokens > 0 && stats.cacheReadTokens > 0
        ? `${Math.round((100 * stats.cacheReadTokens) / stats.totalTokens)}%`
        : "—";
    const cost = stats.cost !== undefined && Number.isFinite(stats.cost) ? `$${stats.cost.toFixed(2)}` : "—";

    innerRows.push(dimSafe(theme, twoCol(`time ${elapsed}`, `in ${fmtNum(stats.inTokens)}`, inner)));
    innerRows.push(dimSafe(theme, twoCol(`last ${last}`, `out ${fmtNum(stats.outTokens)}`, inner)));
    innerRows.push(dimSafe(theme, twoCol(`speed ${speed}`, `total ${fmtNum(stats.totalTokens)}`, inner)));
    innerRows.push(dimSafe(theme, twoCol(`turns ${stats.userMessages}`, `cache ${cache}`, inner)));

    const left =
      typeof state.context?.percent === "number" &&
      Number.isFinite(state.context.percent) &&
      state.context.percent > 0
        ? `${Math.round(100 - Math.max(0, Math.min(100, state.context.percent)))}%`
        : "—";
    innerRows.push(dimSafe(theme, twoCol(`left ${left}`, `cost ${cost}`, inner)));

    innerRows.push(
      dimSafe(
        theme,
        short(
          `msgs ${fmtComma(stats.totalMessages)} · u ${fmtComma(stats.userMessages)} a ${fmtComma(stats.assistantMessages)}`,
          inner,
        ),
      ),
    );

    let cachedStr = "—";
    let uncachedStr = "—";
    if (stats.totalTokens > 0) {
      cachedStr = stats.cacheReadTokens != null ? fmtComma(stats.cacheReadTokens) : "—";
      uncachedStr = stats.inTokens != null ? fmtComma(stats.inTokens + (stats.cacheWriteTokens ?? 0)) : "—";
    }
    innerRows.push(dimSafe(theme, short(`cached ${cachedStr} · uncached ${uncachedStr}`, inner)));
    addSep();
  }

  // 5. COST SECTION (optional)
  if (showCost && state.costBreakdown && state.costBreakdown.length > 0) {
    innerRows.push(boldSafe(theme, fgSafe(theme, "text", "COST")));
    const rows = state.costBreakdown.slice(0, 3);
    for (const item of rows) {
      const line = `${short(item.key, inner - 8)} $${item.cost.toFixed(3)}`;
      innerRows.push(dimSafe(theme, short(line, inner)));
    }
    addSep();
  }

  // 6. RECENT MODELS SECTION
  if (showRecent) {
    innerRows.push(boldSafe(theme, fgSafe(theme, "text", "RECENT MODELS")));
    const recents = state.recentModels ?? [];
    if (recents.length === 0) {
      innerRows.push(dimSafe(theme, "—"));
    } else {
      for (let i = 0; i < recents.length; i++) {
        const r = recents[i];
        const isCur = r.isCurrent ?? false;
        const bullet = isCur ? fgSafe(theme, "success", "● ") : dimSafe(theme, "○ ");
        const label = short(r.label || r.id, inner - 5);
        const text = isCur ? fgSafe(theme, "text", `${i + 1}. ${label}`) : dimSafe(theme, `${i + 1}. ${label}`);
        innerRows.push(bullet + text);
      }
    }
    const operationsWired = typeof options?.onSelectModel === "function" && (options?.interactive ?? false);
    if (operationsWired) {
      innerRows.push(dimSafe(theme, "click to switch · ^↑↓ scroll"));
    } else if (options?.showScrollHints !== false) {
      innerRows.push(dimSafe(theme, "^↑↓ scroll"));
    }
    addSep();
  }

  // 7. COMMANDS SECTION
  if (showCommands) {
    innerRows.push(boldSafe(theme, fgSafe(theme, "text", "COMMANDS")));
    const cmds = state.commands;
    const hasCmds =
      cmds &&
      ((cmds.ext ?? 0) > 0 ||
        (cmds.prompt ?? 0) > 0 ||
        (cmds.skill ?? 0) > 0 ||
        (cmds.builtin ?? 0) > 0);
    if (!hasCmds) {
      innerRows.push(dimSafe(theme, "—"));
    } else {
      innerRows.push(
        dimSafe(
          theme,
          short(
            `${cmds.ext} ext · ${cmds.prompt} prompt · ${cmds.skill} skill · ${cmds.builtin ?? "?"} builtin`,
            inner,
          ),
        ),
      );
      if ((cmds.queueSteer ?? 0) + (cmds.queueFollow ?? 0) > 0) {
        innerRows.push(
          dimSafe(theme, `queue: ${cmds.queueSteer ?? 0} steer · ${cmds.queueFollow ?? 0} follow`),
        );
      }
    }
    addSep();
  }

  // 8. PLUGINS SECTION (collapsible)
  if (showPlugins) {
    const mark = foldMark("plugins");
    const count = state.plugins?.length ?? 0;
    const folded = isFolded("plugins");
    innerRows.push(boldSafe(theme, fgSafe(theme, "text", `PLUGINS (${count}) ${mark}`)));
    if (!folded) {
      if (!state.plugins) innerRows.push(dimSafe(theme, "unavailable"));
      else if (state.plugins.length === 0) innerRows.push(dimSafe(theme, "—"));
      else for (const p of state.plugins) innerRows.push(dimSafe(theme, short(p.detail ? ` • ${p.label} · ${p.detail}` : ` • ${p.label}`, inner)));
    }
    addSep();
  }

  // 9. MCP SERVERS SECTION (collapsible)
  if (showMcp) {
    const mark = foldMark("mcp");
    const count = state.mcp?.length ?? 0;
    const folded = isFolded("mcp");
    innerRows.push(boldSafe(theme, fgSafe(theme, "text", `MCP Servers (${count}) ${mark}`)));
    if (!folded) {
      if (!state.mcp) innerRows.push(dimSafe(theme, "unavailable"));
      else if (state.mcp.length === 0) innerRows.push(dimSafe(theme, "—"));
      else for (const s of state.mcp) innerRows.push(dimSafe(theme, short(s.detail ? `○ ${s.label} · ${s.detail}` : `○ ${s.label}`, inner)));
    }
    addSep();
  }

  // 10. TODOS SECTION (collapsible)
  if (showTodos) {
    const mark = foldMark("todos");
    const todos = state.todos;
    const total = todos?.length ?? 0;
    const done = todos ? todos.filter((t) => t.label.startsWith("✓")).length : 0;
    const folded = isFolded("todos");
    innerRows.push(boldSafe(theme, fgSafe(theme, "text", `Todos (${done}/${total}) ${mark}`)));
    if (!folded) {
      if (!todos) innerRows.push(dimSafe(theme, "unavailable"));
      else if (todos.length === 0) innerRows.push(dimSafe(theme, " (no todos)"));
      else {
        const shown = todos.slice(0, 10);
        for (const t of shown) innerRows.push(dimSafe(theme, short(t.detail ? `${t.label} (${t.detail})` : t.label, inner)));
        if (todos.length > 10) innerRows.push(dimSafe(theme, ` … +${todos.length - 10} more`));
      }
    }
    addSep();
  }

  // 11. LSP SECTION (collapsible)
  if (showLsp) {
    const mark = foldMark("lsp");
    const count = state.lsp?.length ?? 0;
    const folded = isFolded("lsp");
    const title = count > 0 ? `LSP (${count}) ${mark}` : `LSP ${mark}`;
    innerRows.push(boldSafe(theme, fgSafe(theme, "text", title)));
    if (!folded) {
      if (!state.lsp) innerRows.push(dimSafe(theme, " — run lsp_diagnostics for diagnostics"));
      else if (state.lsp.length === 0) innerRows.push(dimSafe(theme, " — no diagnostics"));
      else {
        const shown = state.lsp.slice(0, 10);
        for (const l of shown) innerRows.push(dimSafe(theme, short(l.label, inner)));
        if (state.lsp.length > 10) innerRows.push(dimSafe(theme, ` … +${state.lsp.length - 10} more`));
      }
    }
    addSep();
  }

  // 12. TOOLS SECTION (invoked tools only)
  const tools = state.tools ?? [];
  if (showTools && tools.length > 0) {
    innerRows.push(boldSafe(theme, fgSafe(theme, "text", "TOOLS")));
    for (const t of tools) {
      let mark = dimSafe(theme, "●");
      if (t.status === "done") {
        mark = fgSafe(theme, "success", "✓");
      } else if (t.status === "error") {
        mark = fgSafe(theme, "error", "×");
      }
      const toolLine = `${mark} ${dimSafe(theme, t.name)}${dimSafe(theme, " · " + t.status)}`;
      innerRows.push(short(toolLine, inner));
    }
    addSep();
  }

  // 13. SKILLS SECTION (only rendered if skills used)
  if (showSkills && state.skills && state.skills.length > 0) {
    innerRows.push(boldSafe(theme, fgSafe(theme, "text", "SKILLS")));
    for (const item of state.skills) {
      innerRows.push(dimSafe(theme, short(item.detail ? `${item.label} · ${item.detail}` : item.label, inner)));
    }
    addSep();
  }

  // 14. SUBAGENTS SECTION (only rendered if subagents exist)
  if (showSubagents && state.subagents && state.subagents.length > 0) {
    innerRows.push(boldSafe(theme, fgSafe(theme, "text", `SUBAGENTS (${state.subagents.length})`)));
    for (const item of state.subagents) {
      innerRows.push(dimSafe(theme, short(item.detail ? `● ${item.label} · ${item.detail}` : `● ${item.label}`, inner)));
    }
    addSep();
  }

  // 15. WORKSPACE SECTION (collapsible, remains last)
  if (showWorkspace) {
    const mark = foldMark("workspace");
    const ws: SidebarWorkspaceState = state.workspace ?? { cwd: process.cwd() };
    const branchPart = ws.branch ? ` · ${ws.branch}` : "";
    const folded = isFolded("workspace");
    innerRows.push(boldSafe(theme, fgSafe(theme, "text", short(`WORKSPACE${branchPart} ${mark}`, inner))));
    if (!folded) {
      if (!ws.ok) innerRows.push(dimSafe(theme, "Git status unavailable"));

      if (ws.ok && ws.files && ws.files.length > 0) {
        for (const f of ws.files) {
          const stat = `+${f.add} -${f.del}`;
          const statWidth = visibleWidth(stat);
          const nameBudget = inner - statWidth - 1;
          const fileName = short(f.path, nameBudget);
          const gap = Math.max(1, inner - visibleWidth(fileName) - statWidth);
          const fileRow = dimSafe(theme, fileName + " ".repeat(gap)) + fgSafe(theme, "success", stat);
          innerRows.push(fileRow);
        }
        if (ws.moreFiles && ws.moreFiles > 0) {
          innerRows.push(dimSafe(theme, `… ${ws.moreFiles} more files`));
        }
        if (ws.untracked && ws.untracked > 0) {
          innerRows.push(dimSafe(theme, `?${ws.untracked} untracked`));
        }
      }
    }
    innerRows.push(dimSafe(theme, short(shorten(ws.cwd), inner)));
  }

  // If quit is armed, append warning footer right-aligned inside content width
  if (options?.quitArmed) {
    const armText = "press Ctrl+C again to quit";
    const pad = Math.max(0, inner - visibleWidth(armText));
    innerRows.push(fgSafe(theme, "warning", " ".repeat(pad) + armText));
  }

  // -----------------------------------------------------------
  // Frame into the 34-column outer box (padding 0, 1)
  // -----------------------------------------------------------
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

// -------------------------------------------------------------
// State Extraction from real Pi ExtensionContext
// -------------------------------------------------------------

/**
 * Extracts genuine session state from ExtensionContext.
 * Strictly read-only; defensive against missing/unsupported fields.
 */
export interface SidebarExtractionMetadata {
  autoCompact?: boolean;
  commands?: SidebarState["commands"];
  todos?: SidebarState["todos"];
  lsp?: SidebarState["lsp"];
  skills?: SidebarState["skills"];
  mcp?: SidebarState["mcp"];
  plugins?: SidebarState["plugins"];
  subagents?: SidebarState["subagents"];
}

/** Optional host-supplied, read-only metadata for surfaces without a safe Pi owner API. */
export function extractSidebarState(ctx?: ExtensionContext, metadata?: SidebarExtractionMetadata): SidebarState {
  if (!ctx || typeof ctx !== "object") {
    return {
      session: { id: "…", filePath: "In-memory" },
      model: { label: "—", thinkLevel: "off" },
      context: { percent: 0, tokens: 0, contextWindow: 0 },
      stats: {
        inTokens: 0,
        outTokens: 0,
        totalTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        userMessages: 0,
        assistantMessages: 0,
        totalMessages: 0,
      },
      tools: [],
      workspace: { cwd: process.cwd(), ok: false },
      pet: { name: DEFAULT_PET, status: "idle", tick: 0 },
      commands: { ext: 0, prompt: 0, skill: 0, builtin: 0 },
      recentModels: [],
    };
  }

  const sm = ctx.sessionManager as any;
  const sessionId = sm?.getSessionId?.() ?? sm?.getHeader?.()?.id;
  const sessionName = sm?.getSessionName?.();
  const sessionFile = sm?.getSessionFile?.();

  let rawEntries: any[] = [];
  if (typeof sm?.getBranch === "function") {
    try {
      rawEntries = sm.getBranch() ?? [];
    } catch {}
  } else if (typeof sm?.getEntries === "function") {
    try {
      rawEntries = sm.getEntries() ?? [];
    } catch {}
  } else if (Array.isArray(sm?.entries)) {
    rawEntries = sm.entries;
  }

  // Extract first user prompt and statistics
  let firstPrompt: string | undefined;
  let userMsgs = 0;
  let asstMsgs = 0;
  let totalMsgs = 0;
  const usage = readDisplayUsage(rawEntries);
  const { input: inTokens, output: outTokens, cacheRead: cacheReadTokens, cacheWrite: cacheWriteTokens } = usage;
  const toolItems: SidebarToolItem[] = [];
  const recentModelsMap = new Map<string, { id: string; modelId?: string; label?: string }>();
  const toolsById = new Map<string, SidebarToolItem>();

  let startedAt: Date | undefined;
  const header = typeof sm?.getHeader === "function" ? sm.getHeader() : undefined;
  if (header?.timestamp) {
    try {
      startedAt = new Date(header.timestamp);
    } catch {}
  }

  for (const entry of rawEntries) {
    if (!entry) continue;

    if (entry.type === "model_change") {
      const mid = entry.modelId || entry.model;
      if (mid) {
        const id = entry.provider ? `${entry.provider}/${mid}` : mid;
        recentModelsMap.delete(id);
        recentModelsMap.set(id, { id, modelId: String(mid) });
      }
    }

    if (entry.type === "message" && entry.message) {
      totalMsgs++;
      const msg = entry.message;
      if (msg.role === "user") {
        userMsgs++;
        if (!firstPrompt) {
          if (typeof msg.content === "string") {
            firstPrompt = msg.content;
          } else if (Array.isArray(msg.content)) {
            firstPrompt = msg.content
              .filter((c: any) => c && typeof c.text === "string")
              .map((c: any) => c.text)
              .join("\n");
          }
        }
      } else if (msg.role === "assistant") {
        asstMsgs++;
        const calls = Array.isArray(msg.content)
          ? msg.content.filter((part: any) => part?.type === "toolCall")
          : Array.isArray(msg.toolCalls) ? msg.toolCalls : [];
        for (const tc of calls) {
          if (tc?.name) {
            const item: SidebarToolItem = { id: tc.id, name: tc.name, status: "running" };
            toolItems.push(item);
            if (tc.id) toolsById.set(tc.id, item);
          }
        }
      } else if (msg.role === "tool" || msg.role === "toolResult") {
        const callId = msg.toolCallId;
        const matched = callId ? toolsById.get(callId) : undefined;
        if (matched) matched.status = msg.isError ? "error" : "done";
      }
    }
  }

  const totalTokens = inTokens + outTokens + cacheReadTokens + cacheWriteTokens;

  // Active Model
  const modelObj = ctx.model as any;
  const modelLabel = modelObj?.name || modelObj?.id || "—";
  const thinkLevel = ctx.thinkingLevel || "";
  const thinkLevels = Array.isArray(modelObj?.thinkingLevels) ? modelObj.thinkingLevels
    : modelObj ? getSupportedThinkingLevels(modelObj) : undefined;

  // Context usage
  const rawCtxUsage = typeof ctx.getContextUsage === "function" ? ctx.getContextUsage() : undefined;
  const contextWindow = rawCtxUsage?.contextWindow ?? modelObj?.contextWindow ?? 0;
  const contextTokens = rawCtxUsage?.tokens;
  const contextPercent =
    rawCtxUsage?.percent === null ? null
      : typeof rawCtxUsage?.percent === "number" && Number.isFinite(rawCtxUsage.percent)
        ? rawCtxUsage.percent
        : contextWindow > 0 && typeof contextTokens === "number" && Number.isFinite(contextTokens)
          ? (contextTokens / contextWindow) * 100
          : undefined;

  // Recent Models
  if (modelObj?.id) {
    const id = modelObj.provider ? `${modelObj.provider}/${modelObj.id}` : modelObj.id;
    recentModelsMap.delete(id);
    recentModelsMap.set(id, { id, modelId: modelObj.id, label: modelObj.name });
  }
  const recentModels = Array.from(recentModelsMap.values()).reverse().map((rm) => ({
    ...rm,
    isCurrent: rm.id === (modelObj?.provider ? `${modelObj.provider}/${modelObj.id}` : modelObj?.id),
  }));

  // Pet state
  const isIdle = typeof ctx.isIdle === "function" ? ctx.isIdle() : true;
  let petStatus: PetStatus = isIdle ? "idle" : "working";
  if (!isIdle && rawEntries.length > 0) {
    const lastEntry = rawEntries[rawEntries.length - 1];
    if (lastEntry?.type === "message" && lastEntry.message?.role === "assistant") {
      const parts = Array.isArray(lastEntry.message.content) ? lastEntry.message.content : [];
      if (parts.length > 0) {
        const lastPart = parts[parts.length - 1];
        if (lastPart?.type === "thinking") {
          petStatus = "thinking";
        } else if (lastPart?.type === "text") {
          petStatus = "writing";
        } else if (lastPart?.type === "toolCall") {
          petStatus = "working";
        }
      }
    }
  }

  return {
    session: {
      id: sessionId,
      name: sessionName,
      filePath: sessionFile,
      firstPrompt,
      startedAt,
    },
    model: {
      id: modelObj?.id,
      label: modelObj?.provider ? `${modelObj.provider}/${modelLabel}` : modelLabel,
      provider: modelObj?.provider,
      thinkLevel,
      thinkLevels,
    },
    context: {
      percent: contextPercent,
      tokens: contextTokens,
      contextWindow,
      autoCompact: metadata?.autoCompact,
    },
    stats: {
      inTokens,
      outTokens,
      totalTokens,
      cacheReadTokens,
      cacheWriteTokens,
      userMessages: userMsgs,
      assistantMessages: asstMsgs,
      totalMessages: totalMsgs,
      cost: usage.cost,
      elapsedMs: startedAt ? Date.now() - startedAt.getTime() : undefined,
    },
    tools: toolItems,
    workspace: {
      cwd: ctx.cwd || process.cwd(),
      ok: false,
    },
    pet: {
      name: DEFAULT_PET,
      status: petStatus,
      tick: 0,
    },
    recentModels,
    commands: metadata?.commands,
    todos: metadata?.todos,
    lsp: metadata?.lsp,
    skills: metadata?.skills,
    mcp: metadata?.mcp,
    plugins: metadata?.plugins,
    subagents: metadata?.subagents,
  };
}
