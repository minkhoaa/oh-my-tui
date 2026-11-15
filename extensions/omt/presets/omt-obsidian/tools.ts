import { getLanguageFromPath, highlightCode, type Theme, type ToolRenderers } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth, visibleWidth, sliceByColumn } from "@earendil-works/pi-tui";
import { formatDisplayPath, formatDuration, getTextContent, resultState, summarizeDiff, type HeaderStateTracker, type ToolExecutionState, type ToolRenderContext } from "../shared/tool-helpers.ts";
import { signatureFg, omtDiffAdd, omtDiffDel, type SignatureColorRole } from "./rendering.ts";
import { LayoutRow } from "../shared/rendering.ts";

function isAsciiPrintable(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 32 || code > 126) return false;
  }
  return true;
}

function fastAsciiRows(line: string, width: number): string[] {
  const rows: string[] = [];
  for (let i = 0; i < line.length; i += width) {
    rows.push(line.slice(i, i + width));
  }
  return rows;
}
import { configStore } from "../../core/config.ts";
import { resolveRailGlyph, resolveRailColor, formatSolidChip, BadgeStyles } from "../../core/theme-tokens.ts";
import { accessibilityStore } from "../../features/accessibility/model.ts";

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

function toolRailSpine(theme: Theme, state: ToolExecutionState, isAscii?: boolean): string {
  const spineChar = resolveRailGlyph("block", isAscii);
  const railColor = resolveRailColor(state);
  const spineRole: SignatureColorRole =
    railColor.role === "active" ? "cyan" :
    railColor.role === "error" ? "red" :
    railColor.role === "warning" ? "yellow" : "muted";
  return signatureFg(theme, spineRole, spineChar);
}

function statusBullet(theme: Theme, state: ToolExecutionState): string {
  return toolRailSpine(theme, state);
}

function getToolChipLabel(name: string, args: Record<string, unknown>): string {
  if (name === "bash" || name === "powershell") return "SH";
  if (name === "read") return "READ";
  if (name === "write") return "WRITE";
  if (name === "edit" || name === "multiedit") return "EDIT";
  if (name === "manage_task" || name === "task") return "TASK";
  if (name === "subagent" || name === "agent") return "SUBAGENT";
  if (name === "swarm") return "SWARM";
  return name.toUpperCase();
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

function formatLanguageName(lang?: string): string {
  if (!lang) return "Plain text";
  const map: Record<string, string> = {
    ts: "TypeScript",
    typescript: "TypeScript",
    js: "JavaScript",
    javascript: "JavaScript",
    jsx: "JSX",
    tsx: "TSX",
    json: "JSON",
    md: "Markdown",
    markdown: "Markdown",
    py: "Python",
    python: "Python",
    rs: "Rust",
    rust: "Rust",
    go: "Go",
    sh: "Bash",
    bash: "Bash",
    zsh: "Zsh",
    toml: "TOML",
    yaml: "YAML",
    yml: "YAML",
    html: "HTML",
    css: "CSS",
    sql: "SQL",
    c: "C",
    cpp: "C++",
  };
  return map[lang.toLowerCase()] ?? (lang.charAt(0).toUpperCase() + lang.slice(1));
}

function isSubagentToolName(name: string): boolean {
  const n = name.toLowerCase().trim();
  return (
    n === "subagent" ||
    n === "subagents" ||
    n === "task" ||
    n === "swarm" ||
    n === "manage_task" ||
    n === "agent" ||
    n === "run_agent" ||
    n === "run_workflow"
  );
}

interface SubagentMetadata {
  roleOrName: string;
  taskSummary: string;
  model?: string;
  action?: string;
}

function extractSubagentMetadata(name: string, args: Record<string, unknown>): SubagentMetadata {
  const sanitize = (val: unknown): string =>
    typeof val === "string" ? stripTerminalSequences(val).trim().replace(/\s+/g, " ") : "";

  const nameVal = sanitize(args.agent ?? args.role ?? args.name ?? args.profile ?? args.TaskId ?? args.taskId);
  let taskVal = "";
  for (const k of ["task", "prompt", "message", "instruction", "brief", "summary", "Input", "input"]) {
    const v = sanitize(args[k]);
    if (v) {
      taskVal = v;
      break;
    }
  }
  const modelVal = sanitize(args.model);
  const actionVal = sanitize(args.action ?? args.Action);

  const defaultRole = name === "swarm" ? "Swarm" : name.includes("task") ? "Task" : "Subagent";
  const roleOrName = nameVal || (actionVal ? `${actionVal}` : defaultRole);

  return {
    roleOrName,
    taskSummary: taskVal || (actionVal ? `action ${actionVal}` : "delegated task"),
    model: modelVal || undefined,
    action: actionVal || undefined,
  };
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
  if (isSubagentToolName(name)) {
    const meta = extractSubagentMetadata(name, args);
    const modelPart = meta.model ? ` [${meta.model}]` : "";
    const prefix = meta.roleOrName && meta.roleOrName.toLowerCase() !== name.toLowerCase() ? `${meta.roleOrName}${modelPart}: ` : "";
    return `${prefix}${meta.taskSummary}`;
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
  // Fast-Path ASCII: For ASCII-only strings (/^[\x20-\x7e]*$/), bypass heavy grapheme segmentation.
  if (isAsciiPrintable(line)) {
    if (line.length <= width) return [line];
    return fastAsciiRows(line, width);
  }
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

// ============================================================================
// Side-by-Side 2-Column Diff Rendering (when innerW >= 80)
// ============================================================================

interface DiffRowItem {
  type: "context" | "del" | "add";
  text: string;
  lineNum?: number;
}

interface SideBySideRow {
  left: DiffRowItem | null;
  right: DiffRowItem | null;
}

function extractScopeFromDiff(diffText: string): string | null {
  if (!diffText) return null;
  const match = diffText.match(/^@@\s*-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s*@@\s*(.+)$/m);
  if (match && match[1]) {
    const scope = match[1].trim();
    if (scope.length > 0 && !scope.startsWith("@")) {
      return scope;
    }
  }
  return null;
}

function parseDiffHunksForSideBySide(diffText: string, fallbackLines: string[]): SideBySideRow[] {
  const text = diffText || fallbackLines.join("\n");
  const rawLines = text.split(/\r?\n/);
  const rows: SideBySideRow[] = [];

  let curOld = 1;
  let curNew = 1;
  let delQueue: DiffRowItem[] = [];
  let addQueue: DiffRowItem[] = [];

  const flushQueues = () => {
    const count = Math.max(delQueue.length, addQueue.length);
    for (let i = 0; i < count; i++) {
      rows.push({
        left: delQueue[i] ?? null,
        right: addQueue[i] ?? null,
      });
    }
    delQueue = [];
    addQueue = [];
  };

  for (const rawLine of rawLines) {
    if (!rawLine.trim()) continue;
    if (
      rawLine.startsWith("---") ||
      rawLine.startsWith("+++") ||
      rawLine.startsWith("diff ") ||
      rawLine.startsWith("index ")
    ) {
      continue;
    }

    const hunkMatch = rawLine.match(/^@@\s*-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s*@@/);
    if (hunkMatch) {
      flushQueues();
      curOld = parseInt(hunkMatch[1]!, 10);
      curNew = parseInt(hunkMatch[2]!, 10);
      continue;
    }

    // Pi-formatted numbered diffs: " 10  const a = 1;" or "-11  const b = 2;" or "+11  const b = 20;"
    const trimmed = rawLine.trimStart();
    const numMatch = trimmed.match(/^(\d+)\s+([+-]?)(.*)$/);
    if (numMatch) {
      const lineNum = parseInt(numMatch[1]!, 10);
      const sign = numMatch[2]!;
      const code = numMatch[3]!;
      if (sign === "-") {
        delQueue.push({ type: "del", text: code, lineNum });
      } else if (sign === "+") {
        addQueue.push({ type: "add", text: code, lineNum });
      } else {
        flushQueues();
        rows.push({
          left: { type: "context", text: code, lineNum },
          right: { type: "context", text: code, lineNum },
        });
      }
      continue;
    }

    // Standard unified diff lines
    if (rawLine.startsWith("-")) {
      delQueue.push({ type: "del", text: rawLine.slice(1), lineNum: curOld++ });
      continue;
    }
    if (rawLine.startsWith("+")) {
      addQueue.push({ type: "add", text: rawLine.slice(1), lineNum: curNew++ });
      continue;
    }

    // Context line
    flushQueues();
    const contextText = rawLine.startsWith(" ") ? rawLine.slice(1) : rawLine;
    rows.push({
      left: { type: "context", text: contextText, lineNum: curOld++ },
      right: { type: "context", text: contextText, lineNum: curNew++ },
    });
  }

  flushQueues();
  return rows;
}

function highlightWordDiff(
  delText: string,
  addText: string,
  theme: Theme,
): { leftStyled: string; rightStyled: string } {
  // Tokenize into words, whitespace, symbols
  const delTokens = delText.match(/\s+|[a-zA-Z0-9_]+|[^\s\w]/g) || (delText ? [delText] : []);
  const addTokens = addText.match(/\s+|[a-zA-Z0-9_]+|[^\s\w]/g) || (addText ? [addText] : []);

  let prefix = 0;
  while (
    prefix < delTokens.length &&
    prefix < addTokens.length &&
    delTokens[prefix] === addTokens[prefix]
  ) {
    prefix++;
  }

  let suffix = 0;
  while (
    suffix < delTokens.length - prefix &&
    suffix < addTokens.length - prefix &&
    delTokens[delTokens.length - 1 - suffix] === addTokens[addTokens.length - 1 - suffix]
  ) {
    suffix++;
  }

  // Format Left (Deletion) with word-level emphasis
  const delPre = delTokens.slice(0, prefix).join("");
  const delMid = delTokens.slice(prefix, delTokens.length - suffix).join("");
  const delSuf = delTokens.slice(delTokens.length - suffix).join("");

  const leftStyled =
    omtDiffDel(theme, delPre) +
    (delMid ? theme.bold(signatureFg(theme, "red", delMid)) : "") +
    omtDiffDel(theme, delSuf);

  // Format Right (Addition) with word-level emphasis
  const addPre = addTokens.slice(0, prefix).join("");
  const addMid = addTokens.slice(prefix, addTokens.length - suffix).join("");
  const addSuf = addTokens.slice(addTokens.length - suffix).join("");

  const rightStyled =
    omtDiffAdd(theme, addPre) +
    (addMid ? theme.bold(signatureFg(theme, "green", addMid)) : "") +
    omtDiffAdd(theme, addSuf);

  return { leftStyled, rightStyled };
}

function renderSideBySideDiff(
  rawDiffText: string,
  fallbackLines: string[],
  displayPath: string,
  counts: { additions: number; deletions: number },
  theme: Theme,
  innerW: number,
  hook: string,
  cont: string,
): string[] {
  const rows: string[] = [];

  // 1. Title with scope badge if present
  const scope = extractScopeFromDiff(rawDiffText);
  const scopeBadge = scope ? ` [scope: ${scope}]` : "";
  const title = `Updated ${displayPath} (+${counts.additions} -${counts.deletions})${scopeBadge}`;
  const titleRows = expandedRows(title, innerW);
  for (let idx = 0; idx < titleRows.length; idx++) {
    rows.push(`${idx === 0 ? hook : cont}${signatureFg(theme, "text", titleRows[idx]!)}`);
  }

  // Geometry: Available width is innerW
  // Divider " │ " occupies 3 characters
  const divider = " │ ";
  const colW = Math.floor((innerW - 3) / 2);
  const leftW = colW;
  const rightW = innerW - 3 - leftW;
  const numW = 5; // e.g. "  12 "
  const codeLeftW = Math.max(1, leftW - numW);
  const codeRightW = Math.max(1, rightW - numW);

  // 2. Column Headers: BEFORE │ AFTER
  const divStyled = signatureFg(theme, "muted", divider);
  const bPad = Math.max(0, Math.floor((leftW - 6) / 2));
  const bText = " ".repeat(bPad) + "BEFORE" + " ".repeat(Math.max(0, leftW - 6 - bPad));
  const aPad = Math.max(0, Math.floor((rightW - 5) / 2));
  const aText = " ".repeat(aPad) + "AFTER" + " ".repeat(Math.max(0, rightW - 5 - aPad));
  const headerLine = `${signatureFg(theme, "muted", bText)}${divStyled}${signatureFg(theme, "muted", aText)}`;
  rows.push(`${cont}${headerLine}`);

  // 3. Subheader separator: ───────────┼───────────
  const sepLine = `${signatureFg(theme, "muted", "─".repeat(leftW))}${signatureFg(theme, "muted", "─┼─")}${signatureFg(theme, "muted", "─".repeat(rightW))}`;
  rows.push(`${cont}${sepLine}`);

  // 4. Content rows
  const parsedRows = parseDiffHunksForSideBySide(rawDiffText, fallbackLines);
  const maxDiffRows = 24;
  const clamped = parsedRows.length > maxDiffRows;
  const rowsToRender = clamped ? parsedRows.slice(0, maxDiffRows) : parsedRows;

  for (const pr of rowsToRender) {
    let colLeft = "";
    let colRight = "";

    // Left Column (BEFORE)
    if (pr.left) {
      const lineNumStr = pr.left.lineNum !== undefined ? String(pr.left.lineNum).padStart(4, " ") + " " : "     ";
      const numStyled = signatureFg(theme, "muted", lineNumStr);

      let codeStyled: string;
      if (pr.right && pr.left.type === "del" && pr.right.type === "add") {
        const { leftStyled } = highlightWordDiff(pr.left.text, pr.right.text, theme);
        codeStyled = leftStyled;
      } else if (pr.left.type === "del") {
        codeStyled = omtDiffDel(theme, pr.left.text);
      } else {
        codeStyled = signatureFg(theme, "code", pr.left.text);
      }

      const truncated = truncateToWidth(codeStyled, codeLeftW, "");
      const padded = truncated + " ".repeat(Math.max(0, codeLeftW - visibleWidth(truncated)));
      colLeft = `${numStyled}${padded}`;
    } else {
      colLeft = " ".repeat(leftW);
    }

    // Right Column (AFTER)
    if (pr.right) {
      const lineNumStr = pr.right.lineNum !== undefined ? String(pr.right.lineNum).padStart(4, " ") + " " : "     ";
      const numStyled = signatureFg(theme, "muted", lineNumStr);

      let codeStyled: string;
      if (pr.left && pr.left.type === "del" && pr.right.type === "add") {
        const { rightStyled } = highlightWordDiff(pr.left.text, pr.right.text, theme);
        codeStyled = rightStyled;
      } else if (pr.right.type === "add") {
        codeStyled = omtDiffAdd(theme, pr.right.text);
      } else {
        codeStyled = signatureFg(theme, "code", pr.right.text);
      }

      const truncated = truncateToWidth(codeStyled, codeRightW, "");
      const padded = truncated + " ".repeat(Math.max(0, codeRightW - visibleWidth(truncated)));
      colRight = `${numStyled}${padded}`;
    } else {
      colRight = " ".repeat(rightW);
    }

    const rowContent = `${colLeft}${divStyled}${colRight}`;
    rows.push(`${cont}${rowContent}`);
  }

  if (clamped) {
    const hiddenCount = parsedRows.length - maxDiffRows;
    rows.push(`${cont}${signatureFg(theme, "muted", `... ${hiddenCount} lines hidden ...`)}`);
  }

  return rows;
}

function extractSmartSummary(rawOutput: string): string | null {
  const text = stripTerminalSequences(rawOutput);

  // 1. node:test output
  const nodePass = text.match(/ℹ\s+pass\s+(\d+)/i);
  const nodeFail = text.match(/ℹ\s+fail\s+(\d+)/i);
  const nodeSuites = text.match(/ℹ\s+suites\s+(\d+)/i);
  const nodeTests = text.match(/ℹ\s+tests\s+(\d+)/i);
  if (nodePass || nodeFail || (nodeTests && (text.includes("ℹ pass") || text.includes("ℹ fail")))) {
    const pass = nodePass ? parseInt(nodePass[1]!, 10) : 0;
    const fail = nodeFail ? parseInt(nodeFail[1]!, 10) : 0;
    const suites = nodeSuites ? parseInt(nodeSuites[1]!, 10) : undefined;
    const parts: string[] = [`${pass} passed`];
    if (fail > 0) parts.push(`${fail} failed`);
    if (suites !== undefined) parts.push(`${suites} suites`);
    return `[summary: ${parts.join(", ")}]`;
  }

  // 2. Jest / Vitest output:
  const jestTests = text.match(/Tests:\s*([^,\n\r]+(?:,[^,\n\r]+)*)/i);
  const jestSuites = text.match(/Test Suites:\s*([^,\n\r]+(?:,[^,\n\r]+)*)/i);
  if (jestTests || jestSuites) {
    const passM = text.match(/(\d+)\s+passed/i);
    const failM = text.match(/(\d+)\s+failed/i);
    const suiteM = (jestSuites ? jestSuites[1]?.match(/(\d+)\s+total/i) : null) || text.match(/(\d+)\s+suites?/i);
    const parts: string[] = [];
    if (passM) parts.push(`${passM[1]} passed`);
    if (failM) parts.push(`${failM[1]} failed`);
    if (suiteM) parts.push(`${suiteM[1]} suites`);
    if (parts.length > 0) return `[summary: ${parts.join(", ")}]`;
  }

  // 3. Pytest output:
  const pytestMatch = text.match(/={3,}\s*(.+?(?:passed|failed|error|skipped).*?)\s*={3,}/i);
  if (pytestMatch && pytestMatch[1]) {
    const rawSum = pytestMatch[1].trim();
    const cleanSum = rawSum.replace(/\s+in\s+[\d.]+s.*$/i, "").trim();
    return `[summary: ${cleanSum}]`;
  }

  // 4. Cargo test output:
  const cargoMatch = text.match(/test result:\s*(?:ok|FAILED)\.\s*(\d+)\s*passed;\s*(\d+)\s*failed/i);
  if (cargoMatch) {
    return `[summary: ${cargoMatch[1]} passed, ${cargoMatch[2]} failed]`;
  }

  // 5. TypeScript compiler (tsc):
  const tscMatch = text.match(/Found\s+(\d+)\s+errors?(?:\s+in\s+(\d+)\s+files?)?/i);
  if (tscMatch) {
    const errCount = tscMatch[1]!;
    const fileCount = tscMatch[2];
    return fileCount
      ? `[summary: Found ${errCount} errors in ${fileCount} files]`
      : `[summary: Found ${errCount} errors]`;
  }

  // 6. ESLint output:
  const eslintMatch = text.match(/(\d+)\s+problems?\s*\(([^)]+)\)/i);
  if (eslintMatch) {
    return `[summary: ${eslintMatch[1]} problems (${eslintMatch[2]})]`;
  }
  const eslintZero = text.match(/0\s+problems/i);
  if (eslintZero) {
    return `[summary: 0 problems]`;
  }

  return null;
}

function extractRootCause(rawOutput: string, diagnosticError = ""): string[] {
  const combined = diagnosticError && !rawOutput.includes(diagnosticError)
    ? `${diagnosticError}\n${rawOutput}`
    : (diagnosticError || rawOutput);
  const lines = stripTerminalSequences(combined)
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);

  if (lines.length === 0) return [];

  const errPatterns = [
    /^AssertionError(?: \[[^\]]+\])?:/i,
    /^(?:[A-Z][a-zA-Z]*Error|Error):/i,
    /^(?:FAIL|FAILED)\b/i,
    /^(?:error\s*TS\d+|error\[E\d+\])/i,
    /^npm ERR!/i,
    /^panic:/i,
    /^(?:fatal|error):/i,
  ];

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]!.trimStart();
    if (errPatterns.some((pat) => pat.test(line))) {
      return lines.slice(idx, idx + 3);
    }
  }

  return lines.slice(-Math.min(3, lines.length));
}

function renderRootCauseBox(
  causeLines: string[],
  theme: Theme,
  innerW: number,
  cont: string,
): string[] {
  if (causeLines.length === 0) return [];
  const boxW = Math.max(10, Math.min(innerW, 80));
  const innerContentW = Math.max(1, boxW - 4);
  const title = boxW >= 24 ? " Root Cause " : " Error ";
  const topDashes = Math.max(1, boxW - 2 - visibleWidth(title) - 1);
  const topBorder = `┌─${title}${"─".repeat(topDashes)}┐`;
  const bottomBorder = `└${"─".repeat(Math.max(1, boxW - 2))}┘`;

  const rows: string[] = [];
  rows.push(`${cont}${signatureFg(theme, "red", topBorder)}`);

  for (const line of causeLines) {
    const truncated = truncateToWidth(line.trim(), innerContentW, "");
    const padded = truncated + " ".repeat(Math.max(0, innerContentW - visibleWidth(truncated)));
    rows.push(
      `${cont}${signatureFg(theme, "red", "│ ")}${signatureFg(theme, "error", padded)}${signatureFg(theme, "red", " │")}`,
    );
  }

  rows.push(`${cont}${signatureFg(theme, "red", bottomBorder)}`);
  return rows;
}

function renderSubagentCard(
  toolName: string,
  args: Record<string, unknown>,
  state: ToolExecutionState,
  rawOutput: string,
  theme: Theme,
  innerW: number,
  hook: string,
  cont: string,
  durationMs?: number,
  diagnosticError = "",
): string[] {
  const meta = extractSubagentMetadata(toolName, args);
  const cardW = Math.max(10, Math.min(innerW, 80));
  const innerCardW = Math.max(1, cardW - 4);

  const statusBadge =
    state === "running"
      ? signatureFg(theme, "yellow", "[running]")
      : state === "failure" || state === "interrupted"
      ? signatureFg(theme, "red", "[failed]")
      : signatureFg(theme, "green", "[done]");

  const durationStr =
    durationMs !== undefined && durationMs > 0
      ? signatureFg(theme, "muted", ` · ${formatDuration(durationMs)}`)
      : "";

  const rawTitle = ` Subagent: ${meta.roleOrName} `;
  const titleText = truncateToWidth(rawTitle, Math.max(6, cardW - 6), "… ");
  const topDashes = Math.max(1, cardW - 2 - visibleWidth(titleText) - 1);
  const topBorder = `┌─${titleText}${"─".repeat(topDashes)}┐`;
  const bottomBorder = `└${"─".repeat(Math.max(1, cardW - 2))}┘`;

  const rows: string[] = [];
  rows.push(`${hook}${signatureFg(theme, "border", topBorder)}`);

  const addCardRow = (label: string, value: string) => {
    const full = `${label}: ${value}`;
    const wrapped = expandedRows(full, innerCardW);
    for (let i = 0; i < wrapped.length; i++) {
      const cell = wrapped[i]!;
      const padded = cell + " ".repeat(Math.max(0, innerCardW - visibleWidth(cell)));
      rows.push(
        `${cont}${signatureFg(theme, "border", "│ ")}${signatureFg(theme, "text", padded)}${signatureFg(theme, "border", " │")}`,
      );
    }
  };

  addCardRow("Task", meta.taskSummary);
  if (meta.model) {
    addCardRow("Model", meta.model);
  }

  const statusPlain = "Status: ";
  const statusLineStyled = `${signatureFg(theme, "text", statusPlain)}${statusBadge}${durationStr}`;
  const statusPadW = Math.max(
    0,
    innerCardW - visibleWidth(stripTerminalSequences(statusLineStyled)),
  );
  rows.push(
    `${cont}${signatureFg(theme, "border", "│ ")}${statusLineStyled}${" ".repeat(statusPadW)}${signatureFg(theme, "border", " │")}`,
  );

  const sourceOutput = diagnosticError && !rawOutput.includes(diagnosticError)
    ? `${diagnosticError}\n${rawOutput}`
    : (rawOutput || diagnosticError);
  const cleanOutput = stripTerminalSequences(sourceOutput).trim();
  if (cleanOutput) {
    let resultPreview = cleanOutput;
    if (
      (cleanOutput.startsWith("{") && cleanOutput.endsWith("}")) ||
      (cleanOutput.startsWith("[") && cleanOutput.endsWith("]"))
    ) {
      try {
        const parsed = JSON.parse(cleanOutput);
        if (parsed && typeof parsed === "object") {
          const extracted =
            parsed.error ??
            parsed.summary ??
            parsed.result ??
            parsed.message ??
            parsed.text ??
            parsed.status;
          if (typeof extracted === "string" && extracted.trim()) {
            resultPreview = extracted.trim();
          }
        }
      } catch {
        // keep cleanOutput
      }
    }

    const midTitle = " Result ";
    const midDashes = Math.max(1, cardW - 2 - visibleWidth(midTitle) - 1);
    const midDivider = `├─${midTitle}${"─".repeat(midDashes)}┤`;
    rows.push(`${cont}${signatureFg(theme, "border", midDivider)}`);

    const outLines = resultPreview.split(/\r?\n/).slice(0, 8);
    for (const outLine of outLines) {
      for (const cell of expandedRows(outLine, innerCardW)) {
        const padded = cell + " ".repeat(Math.max(0, innerCardW - visibleWidth(cell)));
        rows.push(
          `${cont}${signatureFg(theme, "border", "│ ")}${signatureFg(theme, "code", padded)}${signatureFg(theme, "border", " │")}`,
        );
      }
    }
  }

  rows.push(`${cont}${signatureFg(theme, "border", bottomBorder)}`);
  return rows;
}

function getToolTrail(
  name: string,
  args: Record<string, unknown>,
  tracker: (HeaderStateTracker & { trail?: string; exitCode?: number; durationMs?: number }) | undefined,
  state: ToolExecutionState,
  context: ToolRenderContext,
): string {
  if (tracker?.trail) return tracker.trail;

  const displayPath = formatDisplayPath(args.file_path ?? args.path, context.cwd);
  const durMs = tracker?.durationMs ?? context.durationMs;
  const durStr = typeof durMs === "number" && durMs >= 0 ? ` · ${formatDuration(durMs)}` : "";

  if (name === "edit" || name === "multiedit") {
    const fallbackLines = editFallback(args);
    const counts = countDiffChanges(fallbackLines);
    if (counts.additions > 0 || counts.deletions > 0) {
      return `Updated (+${counts.additions} -${counts.deletions} lines)`;
    }
    return state === "running" ? `Applying edits to ${displayPath}` : `Updated ${displayPath}`;
  }

  if (name === "bash" || name === "powershell") {
    if (state !== "running") {
      const exitCode = tracker?.exitCode ?? (state === "failure" ? 1 : 0);
      const isInterrupted = state === "interrupted" || exitCode === 130;
      const pill = isInterrupted ? "[interrupted]" : `[exit ${exitCode}]`;
      return `${pill}${durStr}`;
    }
    return "Executing shell command…";
  }

  if (name === "read") {
    const filePath = (args.file_path ?? args.path ?? "") as string;
    const lang = formatLanguageName(getLanguageFromPath(filePath));
    const limit = typeof args.limit === "number" && args.limit >= 1 ? args.limit : undefined;
    return limit ? `${limit} lines (${lang})` : `Reading ${displayPath} (${lang})`;
  }

  if (name === "write") {
    if (typeof args.content === "string") {
      const n = countLines(args.content);
      return `Wrote ${n} line${n === 1 ? "" : "s"} to ${displayPath}`;
    }
    return `Writing to ${displayPath}`;
  }

  if (isSubagentToolName(name)) {
    const statusStr = state === "running" ? "[running]" : state === "failure" ? "[failed]" : "[done]";
    return `${statusStr}${durStr}`;
  }

  return "";
}

/** Compact tool row; native Pi still owns expansion and execution. */
export function createObsidianToolRenderer(name: string): ToolRenderers {
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
        const isAscii = accessibilityStore.isPlainTextAsciiBorders();
        const spineChar = resolveRailGlyph("block", isAscii);
        const spine = toolRailSpine(theme, state, isAscii);

        const chipLabel = getToolChipLabel(name, args);
        const chipText = formatSolidChip(chipLabel, isAscii);
        const chipStyled = theme.bold(signatureFg(theme, "cyan", chipText));
        const gutterPrefix = isAscii ? `${outer}${spine} ${chipStyled} ` : `${outer}${spine}${chipStyled} `;
        const gutterW = visibleWidth(stripTerminalSequences(gutterPrefix));
        const availW = Math.max(8, innerW - gutterW);

        const trackerExt = tracker as (HeaderStateTracker & { exitCode?: number; durationMs?: number; trail?: string }) | undefined;
        let pill = "";
        if (state !== "running" && (name === "bash" || name === "powershell")) {
          const exitCode = trackerExt?.exitCode;
          const isInterrupted = state === "interrupted" || exitCode === 130;
          if (isInterrupted) {
            pill = signatureFg(theme, "yellow", "[interrupted]");
          } else if (exitCode !== undefined) {
            pill = exitCode === 0
              ? signatureFg(theme, "green", "[exit 0]")
              : signatureFg(theme, "red", `[exit ${exitCode}]`);
          } else if (state === "failure") {
            pill = signatureFg(theme, "red", "[exit 1]");
          } else if (state === "success") {
            pill = signatureFg(theme, "green", "[exit 0]");
          }
        }

        const durMs = trackerExt?.durationMs ?? context.durationMs;
        const durStr = (state !== "running" && typeof durMs === "number" && durMs > 0)
          ? formatDuration(durMs)
          : "";

        const statusPillPart = pill ? (durStr ? ` ${pill} · ${durStr}` : ` ${pill}`) : (durStr ? ` · ${durStr}` : "");

        // When collapsed: single-line compact header with ambient micro-preview trail:
        if (!context.expanded) {
          let summary = "";
          if (name === "bash" || name === "powershell") {
            const rawCmd = typeof args.command === "string" ? stripTerminalSequences(args.command).trim().replace(/\s+/g, " ") : "";
            const cmd = rawCmd || "...";
            const parts: string[] = [cmd];
            if (durStr) parts.push(signatureFg(theme, "muted", durStr));
            if (pill) parts.push(pill);
            summary = parts.join(signatureFg(theme, "muted", " · "));
          } else if (name === "read") {
            const filePath = (typeof args.file_path === "string" ? args.file_path : typeof args.path === "string" ? args.path : "") as string;
            const displayPath = filePath ? formatDisplayPath(filePath, context.cwd) : "...";
            let linesInfo = "";
            if (trackerExt?.trail) {
              const m = trackerExt.trail.match(/\d+\s+lines?/);
              if (m) linesInfo = m[0];
            }
            if (!linesInfo && typeof args.limit === "number") {
              linesInfo = `${args.limit} lines`;
            }
            const parts: string[] = [displayPath];
            if (linesInfo) parts.push(linesInfo);
            summary = parts.join(signatureFg(theme, "muted", " · "));
          } else if (name === "edit" || name === "multiedit") {
            const filePath = (typeof args.file_path === "string" ? args.file_path : typeof args.path === "string" ? args.path : "") as string;
            const displayPath = filePath ? formatDisplayPath(filePath, context.cwd) : "...";
            let diffCount = "";
            if (trackerExt?.trail) {
              const m = trackerExt.trail.match(/\(\+\d+\s+-\d+.*?\)/);
              if (m) diffCount = m[0];
            }
            if (!diffCount) {
              const fbLines = editFallback(args);
              const counts = countDiffChanges(fbLines);
              if (counts.additions > 0 || counts.deletions > 0) {
                diffCount = `(+${counts.additions} -${counts.deletions})`;
              }
            }
            const headPart = diffCount ? `${displayPath} ${diffCount}` : displayPath;
            const parts: string[] = [headPart];
            const editDur = trackerExt?.durationMs ?? (state !== "running" && typeof context.durationMs === "number" ? context.durationMs : undefined);
            if (typeof editDur === "number" && editDur > 0 && diffCount) parts.push(formatDuration(editDur));
            summary = parts.join(signatureFg(theme, "muted", " · "));
          } else if (name === "write") {
            const filePath = (typeof args.file_path === "string" ? args.file_path : typeof args.path === "string" ? args.path : "") as string;
            const displayPath = filePath ? formatDisplayPath(filePath, context.cwd) : "...";
            const writeCount = typeof args.content === "string" ? countLines(args.content) : 0;
            const headPart = writeCount > 0 ? `${displayPath} +${writeCount}` : displayPath;
            const parts: string[] = [headPart];
            if (trackerExt?.durationMs && trackerExt.durationMs > 0) {
              parts.push(formatDuration(trackerExt.durationMs));
            }
            summary = parts.join(signatureFg(theme, "muted", " · "));
          } else {
            const parts: string[] = [argsStr];
            if (durStr) parts.push(durStr);
            summary = parts.join(signatureFg(theme, "muted", " · "));
          }

          const shortSummary = shortString(summary, availW);
          const headerLine = `${gutterPrefix}${signatureFg(theme, "text", shortSummary)}`;
          const rows: string[] = [`${truncateToWidth(headerLine, innerW, "")}`];

          const trail = trackerExt?.trail || getToolTrail(name, args, trackerExt, state, context);
          if (trail) {
            const hook = signatureFg(theme, "muted", "  ⎿ ");
            const badge = signatureFg(theme, "cyan", "[trail]");
            const text = signatureFg(theme, "muted", trail);
            const trailLine = `${outer}${hook}${badge} ${text}`;
            rows.push(truncateToWidth(trailLine, innerW, ""));
          }
          return rows;
        }

        // When opened / expanded: wrap fullCallText with Left-Rail gutter:
        const fullCallText = `${argsStr}${statusPillPart}`;
        const wrapW = Math.max(8, innerW - gutterW);
        const wrapped = expandedRows(fullCallText, wrapW);

        const rows: string[] = [];
        for (let k = 0; k < wrapped.length; k++) {
          const ln = wrapped[k]!;
          if (k === 0) {
            const firstRow = `${gutterPrefix}${signatureFg(theme, "text", ln)}`;
            rows.push(`${truncateToWidth(firstRow, innerW, "")}`);
          } else {
            const contPrefix = `${outer}${signatureFg(theme, "muted", spineChar)}  `;
            const contRow = `${contPrefix}${signatureFg(theme, "muted", ln)}`;
            rows.push(`${truncateToWidth(contRow, innerW, "")}`);
          }
        }
        return rows.length > 0 ? rows : [`${gutterPrefix}`];
      };
      return component;
    },

    renderResult(result, options, theme, context) {
      const state = resultState(result, options.isPartial, context);
      const component = toolRow(context);
      component.cache = !options.isPartial;
      const args = (context.args ?? {}) as Record<string, unknown>;
      const details = result.details as {
        diff?: string;
        error?: string;
        message?: string;
        exitCode?: number;
        interrupted?: boolean;
      } | undefined;
      const output = getTextContent(result).replace(/\r\n?/g, "\n");
      const failure = state === "failure" || state === "interrupted";
      const displayPath = formatDisplayPath(args.file_path ?? args.path, context.cwd);
      const rawDiff = typeof details?.diff === "string" ? details.diff : "";
      const isEditTool = name === "edit" || name === "multiedit";
      const lines = isEditTool
        ? sourceLines(rawDiff || editFallback(args).join("\n")).filter((line) => !line.startsWith("---") && !line.startsWith("+++") && !line.startsWith("@@"))
        : [];
      const counts = countDiffChanges(lines);
      const content = typeof args.content === "string" ? args.content : "";
      const writeLines = sourceLines(content);
      const isDiffTool = diffTool && state === "success" && (name !== "write" || content.trim().length > 0)
        && (name === "write" ? writeLines.length > 0 : lines.length > 0);

      const diagnostic = failure ? details?.error || details?.message || "" : "";
      const rawOutput = diagnostic && !output.includes(diagnostic) ? diagnostic + (output ? "\n" + output : "") : output;
      const outputLines = rawOutput.trim() ? sourceLines(rawOutput.replace(/\t/g, "    ")) : [];

      const tracker = context.state as (HeaderStateTracker & { exitCode?: number; durationMs?: number; trail?: string }) | undefined;
      if (tracker) {
        tracker.executionState = state;
        if (typeof details?.exitCode === "number") {
          tracker.exitCode = details.exitCode;
        }
        if (typeof context.durationMs === "number") {
          tracker.durationMs = context.durationMs;
        }
        if (isEditTool) {
          const scope = extractScopeFromDiff(rawDiff);
          const scopePart = scope ? ` · [scope: ${scope}]` : "";
          tracker.trail = `Updated (+${counts.additions} -${counts.deletions} lines)${scopePart}`;
        } else if (name === "bash" || name === "powershell") {
          const exitCode = typeof details?.exitCode === "number" ? details.exitCode : undefined;
          const isInterrupted = details?.interrupted === true || exitCode === 130 || (state === "interrupted" && exitCode === undefined);
          const isFailure = !isInterrupted && (failure || (exitCode !== undefined && exitCode !== 0));
          const summaryBadge = extractSmartSummary(rawOutput);
          const exitCodeStr = isInterrupted ? "[interrupted]" : typeof exitCode === "number" ? `[exit ${exitCode}]` : isFailure ? "[exit 1]" : "[exit 0]";
          const durPart = typeof context.durationMs === "number" && context.durationMs >= 0 ? ` · ${formatDuration(context.durationMs)}` : "";
          const sumPart = summaryBadge ? ` · ${summaryBadge}` : "";
          tracker.trail = `${exitCodeStr}${durPart}${sumPart}`;
        } else if (name === "read") {
          const filePath = (args.file_path ?? args.path ?? "") as string;
          const detectedLang = getLanguageFromPath(filePath);
          const langLabel = formatLanguageName(detectedLang);
          const lineCountText = `${outputLines.length} line${outputLines.length === 1 ? "" : "s"}`;
          const firstSnippet = outputLines[0] ? stripTerminalSequences(outputLines[0]).trim() : "";
          const snippetPart = firstSnippet && !firstSnippet.includes("FULL_OUTPUT")
            ? ` · ${truncateToWidth(firstSnippet, 32, "…")}`
            : "";
          tracker.trail = `${lineCountText} (${langLabel})${snippetPart}`;
        } else if (name === "write") {
          tracker.trail = `Wrote ${writeLines.length} line${writeLines.length === 1 ? "" : "s"} to ${displayPath}`;
        } else if (isSubagentToolName(name)) {
          const statusBadgePlain = state === "running" ? "[running]" : state === "failure" || state === "interrupted" ? "[failed]" : "[done]";
          const subDurPart = typeof context.durationMs === "number" && context.durationMs >= 0 ? ` · ${formatDuration(context.durationMs)}` : "";
          tracker.trail = `${statusBadgePlain}${subDurPart}`;
        }
        tracker.updateHeader?.(state);
      }

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

        if (isSubagentToolName(name)) {
          const subagentError = details?.error || details?.message || "";
          return renderSubagentCard(name, args, state, output, theme, innerW, hook, cont, context.durationMs, subagentError);
        }

        if (options.isPartial || state === "running") return [`${hook}${signatureFg(theme, "muted", "Running…")}`];
        if (isDiffTool) {
          if (isEditTool && innerW >= 80) {
            return renderSideBySideDiff(rawDiff, lines, displayPath, counts, theme, innerW, hook, cont);
          }
          const title = name === "write"
            ? `Wrote ${writeLines.length} lines to ${displayPath}`
            : `Updated ${displayPath} (+${counts.additions} -${counts.deletions})`;
          const rows = expandedRows(title, innerW).map((line, index) => `${index === 0 ? hook : cont}${signatureFg(theme, "text", line)}`);
          const rawLines = name === "write"
            ? writeLines.map((line, index) => `${String(index + 1).padStart(4, " ")} +${line}`)
            : lines;
          const maxDiffLines = 24;
          const clamped = rawLines.length > maxDiffLines;
          const linesToRender = clamped ? rawLines.slice(0, maxDiffLines) : rawLines;
          for (const rawLine of linesToRender) {
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
          if (clamped) {
            const hiddenCount = rawLines.length - maxDiffLines;
            rows.push(`${cont}${signatureFg(theme, "muted", `... ${hiddenCount} lines hidden ...`)}`);
          }
          return rows;
        }

        // 2. Read tool Line Gutter & Breadcrumb
        if (name === "read" && !failure) {
          const filePath = (args.file_path ?? args.path ?? "") as string;
          const startLine = typeof args.offset === "number" && args.offset >= 1 ? Math.floor(args.offset) : 1;
          const rawLines = outputLines;
          const endLine = startLine + Math.max(0, rawLines.length - 1);
          const detectedLang = getLanguageFromPath(filePath);
          const langLabel = formatLanguageName(detectedLang);
          const lineCountText = `${rawLines.length} line${rawLines.length === 1 ? "" : "s"}`;
          const breadcrumb = rawLines.length > 0
            ? `read ${displayPath} : ${startLine}-${endLine} (${lineCountText} · ${langLabel})`
            : `read ${displayPath} (empty file · ${langLabel})`;

          const rows: string[] = [];
          for (const cell of expandedRows(breadcrumb, innerW)) {
            rows.push(`${rows.length === 0 ? hook : cont}${signatureFg(theme, "text", cell)}`);
          }

          if (rawLines.length === 0) {
            rows.push(`${cont}${signatureFg(theme, "muted", "(No content)")}`);
            return rows;
          }

          let highlightedLines = rawLines;
          if (detectedLang) {
            try {
              highlightedLines = highlightCode(rawOutput, detectedLang);
            } catch {
              // fallback
            }
          }

          const numColW = Math.max(3, String(endLine).length + 1);
          const codeW = Math.max(8, innerW - numColW - 3);

          const maxReadLines = 12;
          const clamped = rawLines.length > maxReadLines;
          const linesToRender = clamped ? rawLines.slice(0, maxReadLines) : rawLines;

          for (let i = 0; i < linesToRender.length; i++) {
            const lineNum = startLine + i;
            const numStr = String(lineNum).padStart(numColW, " ");
            const gutterPrefix = signatureFg(theme, "muted", `${numStr} │ `);
            const contGutterPrefix = signatureFg(theme, "muted", `${" ".repeat(numColW)} │ `);
            const lineContent = highlightedLines[i] ?? rawLines[i] ?? "";

            const wrappedCells = expandedRows(lineContent, codeW);
            for (let c = 0; c < wrappedCells.length; c++) {
              const cell = wrappedCells[c]!;
              const prefix = c === 0 ? gutterPrefix : contGutterPrefix;
              rows.push(`${cont}${prefix}${cell}`);
            }
          }
          if (clamped) {
            const hiddenCount = rawLines.length - maxReadLines;
            rows.push(`${cont}${signatureFg(theme, "muted", `... ${hiddenCount} lines hidden ...`)}`);
          }
          return rows;
        }

        // 3. Bash / PowerShell Smart Diagnostics
        if (name === "bash" || name === "powershell") {
          const exitCode = typeof details?.exitCode === "number" ? details.exitCode : undefined;
          const isInterrupted = details?.interrupted === true || exitCode === 130 || (state === "interrupted" && exitCode === undefined);
          const isFailure = !isInterrupted && (failure || (exitCode !== undefined && exitCode !== 0));

          const summaryBadge = extractSmartSummary(rawOutput);
          const hasDiagnostics = summaryBadge !== null || isFailure || isInterrupted || exitCode !== undefined;

          if (hasDiagnostics) {
            const statusPill = isInterrupted
              ? signatureFg(theme, "yellow", "[interrupted]")
              : exitCode === 0
              ? signatureFg(theme, "green", "[exit 0]")
              : exitCode !== undefined
              ? signatureFg(theme, "red", `[exit ${exitCode}]`)
              : isFailure
              ? signatureFg(theme, "red", "[exit 1]")
              : signatureFg(theme, "green", "[exit 0]");

            const durStr =
              typeof context.durationMs === "number" && context.durationMs >= 0
                ? signatureFg(theme, "muted", ` · ${formatDuration(context.durationMs)}`)
                : "";

            const summaryStyled = summaryBadge ? signatureFg(theme, "cyan", ` ${summaryBadge}`) : "";

            const rows: string[] = [];
            rows.push(`${hook}${statusPill}${durStr}${summaryStyled}`);

            // Pinned root-cause error box when exit code != 0 or failure state
            if (isFailure) {
              const causeLines = extractRootCause(rawOutput, diagnostic);
              if (causeLines.length > 0) {
                const causeBox = renderRootCauseBox(causeLines, theme, innerW, cont);
                rows.push(...causeBox);
              }
            }

            if (outputLines.length > 0) {
              const lang = !isFailure && outputLines.length > 1 ? outputLanguage(rawOutput) : undefined;
              let displayLines = outputLines;
              if (lang) {
                try {
                  displayLines = highlightCode(rawOutput, lang);
                } catch {
                  // Keep native output
                }
              }
              const textRole = isFailure ? "error" : "muted";
              const maxLines = 8;
              const clamped = !isInterrupted && displayLines.length > maxLines;
              const linesToRender = clamped ? displayLines.slice(0, maxLines) : displayLines;
              for (const line of linesToRender) {
                for (const cell of expandedRows(line, innerW)) {
                  const body = lang ? cell : signatureFg(theme, textRole, cell);
                  rows.push(`${cont}${body}`);
                }
              }
              if (clamped) {
                const hiddenCount = displayLines.length - maxLines;
                rows.push(`${cont}${signatureFg(theme, "muted", `... ${hiddenCount} lines hidden ...`)}`);
              }
            } else if (!isFailure) {
              rows.push(`${cont}${signatureFg(theme, "muted", "(No output)")}`);
            }
            return rows;
          }

          // Fallback for raw streams with no exitCode/diagnostics (e.g. transcript tests)
          if (!outputLines.length) return [`${hook}${signatureFg(theme, "muted", "(No output)")}`];
          const textRole = failure ? "error" : "muted";
          const lang = !failure && outputLines.length > 1 ? outputLanguage(rawOutput) : undefined;
          let displayLines = outputLines;
          if (lang) {
            try { displayLines = highlightCode(rawOutput, lang); } catch { /* Keep native output if no lexer is available. */ }
          }
          const rows: string[] = [];
          const maxLines = 8;
          const clamped = !isInterrupted && displayLines.length > maxLines;
          const linesToRender = clamped ? displayLines.slice(0, maxLines) : displayLines;
          for (const line of linesToRender) {
            for (const cell of expandedRows(line, innerW)) {
              const body = lang ? cell : signatureFg(theme, textRole, cell);
              rows.push(`${rows.length === 0 ? hook : cont}${body}`);
            }
          }
          if (clamped) {
            const hiddenCount = displayLines.length - maxLines;
            rows.push(`${cont}${signatureFg(theme, "muted", `... ${hiddenCount} lines hidden ...`)}`);
          }
          return rows;
        }

        if (!outputLines.length) return [`${hook}${signatureFg(theme, "muted", "(No output)")}`];
        const textRole = failure ? "error" : "muted";
        const lang = !failure && outputLines.length > 1 ? outputLanguage(rawOutput) : undefined;
        let displayLines = outputLines;
        if (lang) {
          try { displayLines = highlightCode(rawOutput, lang); } catch { /* Keep native output if no lexer is available. */ }
        }
        const rows: string[] = [];
        const maxLines = 8;
        const clamped = state !== "interrupted" && displayLines.length > maxLines;
        const linesToRender = clamped ? displayLines.slice(0, maxLines) : displayLines;
        for (const line of linesToRender) {
          for (const cell of expandedRows(line, innerW)) {
            const body = lang ? cell : signatureFg(theme, textRole, cell);
            rows.push(`${rows.length === 0 ? hook : cont}${body}`);
          }
        }
        if (clamped) {
          const hiddenCount = displayLines.length - maxLines;
          rows.push(`${cont}${signatureFg(theme, "muted", `... ${hiddenCount} lines hidden ...`)}`);
        }
        return rows;
      };
      return component;
    },
  };
}

export { createObsidianToolRenderer as createSignatureToolRenderer };

