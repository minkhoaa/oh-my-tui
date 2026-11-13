import { highlightCode, type Theme, type ToolRenderers } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth, visibleWidth, sliceByColumn } from "@earendil-works/pi-tui";
import { formatDisplayPath, getTextContent, resultState, summarizeDiff, type HeaderStateTracker, type ToolExecutionState, type ToolRenderContext } from "../shared/tool-helpers.ts";
import { signatureFg, omtDiffAdd, omtDiffDel, type SignatureColorRole } from "./rendering.ts";
import { LayoutRow } from "../shared/rendering.ts";
import { configStore } from "../../core/config.ts";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

class SignatureToolRow extends LayoutRow {
  private palette?: string;
  override render(width: number): string[] {
    const palette = configStore.getSignaturePalette();
    if (palette !== this.palette) { this.palette = palette; this.invalidate(); }
    return super.render(width);
  }
  protected override format(rows: string[], width: number): string[] {
    return rows.map((line) => truncateToWidth(line, width, ""));
  }
}

function toolRow(context: ToolRenderContext): SignatureToolRow {
  return context.lastComponent instanceof SignatureToolRow
    ? context.lastComponent
    : new SignatureToolRow();
}

function statusBullet(theme: Theme, state: ToolExecutionState): string {
  switch (state) {
    case "success": return signatureFg(theme, "green", "●");
    case "failure": return signatureFg(theme, "red", "●");
    case "interrupted": return signatureFg(theme, "yellow", "●");
    default: return signatureFg(theme, "muted", "●");
  }
}

function shortString(s: string, maxCells: number): string {
  const oneLine = s.replace(/\n+/g, " ⏎ ");
  if (visibleWidth(oneLine) <= maxCells) return oneLine;
  return truncateToWidth(oneLine, maxCells, "…");
}

function countLines(s: string): number {
  const clean = s.replace(/\r/g, "").trim();
  if (!clean) return 0;
  return clean.split("\n").length;
}

function compactArgs(args: Record<string, unknown>): string {
  const keys = Object.keys(args);
  if (keys.length === 0) return "";
  try {
    const raw = JSON.stringify(args);
    const oneLine = raw.replace(/\s+/g, " ");
    return oneLine.length > 120 ? oneLine.slice(0, 120) + "…" : oneLine;
  } catch {
    return "";
  }
}

function formatToolName(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : "Tool";
}

function formatToolArgs(name: string, args: Record<string, unknown>, cwd = process.cwd()): string {
  const flat = (value: unknown) => typeof value === "string" ? stripTerminalSequences(value).trim().replace(/\s+/g, " ") : "";
  const path = flat(args.file_path ?? args.path);
  const shownPath = path ? formatDisplayPath(path, cwd) : "";
  const limit = typeof args.limit === "number" && args.limit >= 1 ? args.limit : undefined;
  if (name === "bash" || name === "powershell") {
    const timeout = typeof args.timeout === "number" && args.timeout > 0 ? ` (timeout ${args.timeout}s)` : "";
    return (flat(args.command) || "...") + timeout;
  }
  if (name === "read") {
    const start = typeof args.offset === "number" && args.offset >= 1 ? Math.floor(args.offset) : 1;
    const range = limit ? `:${start}-${start + Math.floor(limit) - 1}` : typeof args.offset === "number" ? `:${start}` : "";
    return (shownPath || "...") + range;
  }
  if (name === "write") {
    let writeSuffix = "";
    if (typeof args.content === "string") {
      const n = countLines(args.content);
      if (n > 0) writeSuffix = ` +${n}`;
    }
    return (shownPath || "...") + writeSuffix;
  }
  if (name === "edit" || name === "multiedit") return shownPath || "...";
  if (name === "ls") return (shownPath || ".") + (limit ? ` (limit ${limit})` : "");
  if (name === "find") return `${flat(args.pattern) || "..."} in ${shownPath || "."}` + (limit ? ` (limit ${limit})` : "");
  if (name === "grep") {
    const pattern = typeof args.pattern !== "string" ? "[invalid arg]" : flat(args.pattern) ? `/${flat(args.pattern)}/` : "...";
    return `${pattern} in ${shownPath || "."}` + (flat(args.glob) ? ` (${flat(args.glob)})` : "") + (limit ? ` limit ${limit}` : "");
  }
  // Unknown tool schemas remain inspectable instead of silently discarding arguments.
  return compactArgs(args);
}

function diffMarker(line: string): "+" | "-" | null {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("+") && !trimmed.startsWith("+++")) return "+";
  if (trimmed.startsWith("-") && !trimmed.startsWith("---")) return "-";
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2 && /^\d+$/.test(parts[0]!)) {
    if (parts[1]!.startsWith("+")) return "+";
    if (parts[1]!.startsWith("-")) return "-";
  }
  return null;
}

function countDiffChanges(diffLines: string[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diffLines) {
    const marker = diffMarker(line);
    if (marker === "+") additions++;
    else if (marker === "-") deletions++;
  }
  return { additions, deletions };
}

function sourceLines(value: string): string[] {
  const normalized = value.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  while (lines.length && lines.at(-1) === "") lines.pop();
  return lines;
}

/** Use a conservative tool-output lexer: highlight only explicit code, JSON, or diff. */
function outputLanguage(value: string): string | undefined {
  const fence = value.match(/```([^\s⏎`]*)/);
  if (fence) return fence[1] ?? "";
  const trimmed = value.trim();
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) return "json";
  if (value.includes("diff --git") || (value.includes("+++") && value.includes("---"))) return "diff";
  return undefined;
}

/** Hard-wrap without trimming code indentation or whitespace at a wrap boundary. */
function expandedRows(line: string, width: number): string[] {
  // Native column slicing retains ANSI state across rows. Plain output takes the
  // linear grapheme path so a single long source line does not repeatedly scan itself.
  if (line.includes("\x1b")) {
    const rows: string[] = [];
    const total = visibleWidth(line);
    for (let offset = 0; offset < total;) {
      const part = sliceByColumn(line, offset, width, true);
      const size = visibleWidth(part);
      if (!size) {
        const glyph = sliceByColumn(line, offset, 2);
        const escaped = [...stripTerminalSequences(glyph)].map(c => `\\u{${c.codePointAt(0)!.toString(16)}}`).join("");
        rows.push(...expandedRows(escaped, width));
        offset += Math.max(1, visibleWidth(glyph));
      } else {
        rows.push(part);
        offset += size;
      }
    }
    return rows.length ? rows : [line];
  }
  const rows: string[] = [];
  let row = "", cells = 0;
  for (const { segment } of graphemes.segment(line)) {
    const size = visibleWidth(segment);
    if (cells + size > width && row) { rows.push(row); row = ""; cells = 0; }
    if (size > width) {
      // A two-cell grapheme physically cannot fit a one-cell viewport. Show its
      // Unicode escape instead of silently dropping it at the final width guard.
      const escaped = [...segment].map(c => `\\u{${c.codePointAt(0)!.toString(16)}}`).join("");
      rows.push(...expandedRows(escaped, width));
      continue;
    }
    row += segment;
    cells += size;
  }
  if (row || !rows.length) rows.push(row);
  return rows;
}

function editFallback(args: Record<string, unknown>): string[] {
  const edits = Array.isArray(args.edits) ? args.edits : [args];
  const lines: string[] = [];
  for (const item of edits) {
    if (!item || typeof item !== "object") continue;
    const edit = item as Record<string, unknown>;
    if (typeof edit.oldText === "string") {
      for (const line of sourceLines(edit.oldText)) if (line.trim()) lines.push(`- ${line}`);
    }
    if (typeof edit.newText === "string") {
      for (const line of sourceLines(edit.newText)) if (line.trim()) lines.push(`+ ${line}`);
    }
  }
  return lines;
}

/** Compact tool row; native Pi still owns expansion and execution. */
export function createSignatureToolRenderer(name: string): ToolRenderers {
  const toolName = formatToolName(name);
  const diffTool = name === "edit" || name === "write" || name === "multiedit";

  return {
    renderShell: "self",

    renderCall(raw, theme, context) {
      const args = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      const tracker = context.state as HeaderStateTracker;
      const component = toolRow(context);
      component.cache = false;
      let state: ToolExecutionState = context.isPartial
        ? "running"
        : tracker?.executionState ?? (context.isError ? "failure" : "success");
      if (tracker) {
        tracker.updateHeader = (next) => {
          state = next;
          tracker.executionState = next;
          component.invalidate();
        };
      }

      const argsStr = formatToolArgs(name, args, context.cwd);
      // Signature shares a one-cell inset with assistant blocks and grouped tools,
      // independently of native outputPad. Contract it only on tiny viewports.
      const requestedPad = 1;

      component.layout = (width) => {
        const pad = Math.min(requestedPad, Math.max(0, Math.floor((width - 4) / 2)));
        const outer = " ".repeat(pad);
        const innerW = Math.max(1, width - pad * 2);
        const dot = statusBullet(theme, state);
        const nameStyled = theme.bold(signatureFg(theme, "text", toolName));

        // When collapsed: single-line compact header:
        // dot + " " + nameSt.Render(name) + toolStyle.Render("("+Short(args, avail)+")")
        // Never framed.
        if (!context.expanded) {
          const nameWidth = visibleWidth(toolName);
          const avail = Math.max(8, innerW - nameWidth - 6);
          const shortArgs = shortString(argsStr, avail);
          const headerLine = `${dot} ${nameStyled}${signatureFg(theme, "muted", `(${shortArgs})`)}`;
          return [`${outer}${truncateToWidth(headerLine, innerW, "")}`];
        }

        // When opened / expanded: wrap name(args) with indented continuation rows:
        // Line 0: dot + " " + nameSt.Render(name) + toolStyle.Render(prefix)
        // Line k: "  " + toolStyle.Render(ln)
        const fullCallText = `${toolName}(${argsStr})`;
        const wrapW = Math.max(8, innerW - 2);
        const wrapped = expandedRows(fullCallText, wrapW);

        const rows: string[] = [];
        for (let k = 0; k < wrapped.length; k++) {
          const ln = wrapped[k]!;
          if (k === 0) {
            const rest = ln.startsWith(toolName) ? ln.slice(toolName.length) : ln;
            const firstRow = `${dot} ${nameStyled}${signatureFg(theme, "muted", rest)}`;
            rows.push(`${outer}${truncateToWidth(firstRow, innerW, "")}`);
          } else {
            const contRow = `  ${signatureFg(theme, "muted", ln)}`;
            rows.push(`${outer}${truncateToWidth(contRow, innerW, "")}`);
          }
        }
        return rows.length > 0 ? rows : [`${outer}${dot} ${nameStyled}`];
      };
      return component;
    },

    renderResult(result, options, theme, context) {
      const state = resultState(result, options.isPartial, context);
      const component = toolRow(context);
      component.cache = !options.isPartial;
      const args = (context.args ?? {}) as Record<string, unknown>;
      const details = result.details as { diff?: string; error?: string; message?: string } | undefined;
      const output = getTextContent(result).replace(/\r\n?/g, "\n");
      const failure = state === "failure" || state === "interrupted";
      const displayPath = formatDisplayPath(args.file_path ?? args.path, context.cwd);
      const rawDiff = typeof details?.diff === "string" ? details.diff : "";
      const lines = name === "edit" || name === "multiedit"
        ? sourceLines(rawDiff || editFallback(args).join("\n")).filter((line) => !line.startsWith("---") && !line.startsWith("+++") && !line.startsWith("@@"))
        : [];
      const counts = countDiffChanges(lines);
      const content = typeof args.content === "string" ? args.content : "";
      const writeLines = sourceLines(content);
      const isDiffTool = diffTool && state === "success" && (name !== "write" || content.trim().length > 0)
        && (name === "write" ? writeLines.length > 0 : lines.length > 0);

      component.layout = (width) => {
        // Match the call header's one-cell inset, contracting on tiny terminals.
        const pad = Math.min(1, Math.max(0, Math.floor((width - 6) / 2)));
        const gutter = Math.min(4, Math.max(0, width - pad * 2 - 2));
        const innerW = Math.max(1, width - pad * 2 - gutter);
        const outer = " ".repeat(pad);
        const hook = `${outer}${signatureFg(theme, "muted", gutter === 4 ? "  ⎿ " : gutter >= 2 ? "⎿ " + " ".repeat(gutter - 2) : " ".repeat(gutter))}`;
        const cont = `${outer}${signatureFg(theme, "muted", " ".repeat(gutter))}`;
        // Collapsed calls expose execution state in the header only.
        // Full errors/interruption text remain available through native expansion.
        if (!options.expanded) return [];

        if (options.isPartial || state === "running") return [`${hook}${signatureFg(theme, "muted", "Running…")}`];
        if (isDiffTool) {
          const title = name === "write"
            ? `Wrote ${writeLines.length} lines to ${displayPath}`
            : `Updated ${displayPath} (+${counts.additions} -${counts.deletions})`;
          const rows = expandedRows(title, innerW).map((line, index) => `${index === 0 ? hook : cont}${signatureFg(theme, "text", line)}`);
          const rawLines = name === "write"
            ? writeLines.map((line, index) => `${String(index + 1).padStart(4, " ")} +${line}`)
            : lines;
          for (const rawLine of rawLines) {
            const clean = stripTerminalSequences(rawLine).replace(/\t/g, "    ");
            const marker = diffMarker(clean);
            for (const cell of expandedRows(clean, innerW)) {
              const padded = cell + " ".repeat(Math.max(0, innerW - visibleWidth(cell)));
              const styled = marker === "+" ? omtDiffAdd(theme, padded)
                : marker === "-" ? omtDiffDel(theme, padded)
                : signatureFg(theme, "code", padded);
              rows.push(`${cont}${styled}`);
            }
          }
          return rows;
        }

        const diagnostic = failure ? details?.error || details?.message || "" : "";
        const rawOutput = diagnostic && !output.includes(diagnostic) ? diagnostic + (output ? "\n" + output : "") : output;
        const outputLines = rawOutput.trim() ? sourceLines(rawOutput.replace(/\t/g, "    ")) : [];
        if (!outputLines.length) return [`${hook}${signatureFg(theme, "muted", "(No output)")}`];
        const textRole = failure ? "error" : "muted";
        const lang = !failure && (name === "bash" || name === "powershell") && outputLines.length > 1
          ? outputLanguage(rawOutput) : undefined;
        let displayLines = outputLines;
        if (lang) {
          try { displayLines = highlightCode(rawOutput, lang); } catch { /* Keep native output if no lexer is available. */ }
        }
        const rows: string[] = [];
        for (const line of displayLines) {
          for (const cell of expandedRows(line, innerW)) {
            const body = lang ? cell : signatureFg(theme, textRole, cell);
            rows.push(`${rows.length === 0 ? hook : cont}${body}`);
          }
        }
        return rows;
      };
      return component;
    },
  };
}
