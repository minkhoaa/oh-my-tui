// OMT Clean tools presentation for Pi.
import { type Theme, type ToolRenderers, formatReadLineRange, renderDiff } from "@earendil-works/pi-coding-agent";
import { Text, sliceByColumn, stripTerminalSequences, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { contentPadding, quiet } from "../shared/style.ts";
import { type ToolRenderContext, type ToolExecutionState, type HeaderStateTracker, determineToolState, renderStatusIcon, formatDisplayPath, getTextContent, summarizeDiff, highlighted, resultState, fileResultState, textRow } from "../shared/tool-helpers.ts";
import { cleanAccent, cleanActivity, cleanDim, cleanLineCount, cleanOutputPreview } from "./rendering.ts";
import { isAnimationActive } from "../../core/motion.ts";

/** exec_cell/render.rs: command header, pipe-gutter continuation, two-row continuation budget. */
class CleanCallRow extends Text {
  readLabel = "Read";
  layout?: () => { prefix: string; detail: string; margin: number; read: boolean };
  override render(width: number): string[] {
    if (!this.layout) return super.render(width);
    const { prefix, detail, margin, read } = this.layout();
    if (width < 10) return width > 0 ? [truncateToWidth(prefix + detail, width, "")] : [];
    const pad = " ".repeat(Math.min(margin, Math.max(0, width - 5)));
    const command = detail.split("\n");
    const first = wrapTextWithAnsi(command[0] ?? "", Math.max(1, width - pad.length - visibleWidth(prefix)));
    const continuation = [...first.slice(1), ...command.slice(1).flatMap((line) => wrapTextWithAnsi(line, Math.max(1, width - pad.length - 4)))];
    const rows = read ? [pad + prefix, ...wrapTextWithAnsi(detail, Math.max(1, width - pad.length - 9)).map((line, i) => pad + (i === 0 ? `  ${cleanDim("└")} ${this.readLabel} ` : "         ") + line)]
      : [pad + prefix + (first[0] ?? ""), ...continuation.slice(0, 2).map((line) => pad + cleanDim("  │ ") + line)];
    if (!read && continuation.length > 2) rows.push(pad + "    " + cleanDim(`… +${continuation.length - 2} lines`));
    return rows.map((line) => truncateToWidth(line, width, ""));
  }
}

/** Clean's output gutter belongs to screen rows, not logical lines. Pi still owns expansion. */
class CleanOutputRow extends Text {
  body = "";
  preview = false;
  hint = "";
  margin = 0;
  gutter = true;
  diagnostics: string[] = [];
  override render(width: number): string[] {
    if (width < 10) {
      if (width <= 0) return [];
      const lines = (this.body || "(no output)").split("\n");
      const rows = this.preview ? lines.slice(0, 3) : lines;
      if (this.preview && lines.length > 3) rows.push(`+${lines.length - 3} lines`);
      return [...rows, ...this.diagnostics].map((line) => truncateToWidth(line, width, ""));
    }
    const margin = Math.min(this.margin, Math.max(0, width - 5));
    const reserve = 4;
    const inner = Math.max(1, width - margin - reserve);
    const rows = this.preview ? cleanOutputPreview(this.body, inner, this.hint)
      : wrapTextWithAnsi(this.body, inner);
    rows.push(...this.diagnostics.flatMap((line) => wrapTextWithAnsi(cleanDim(line), inner)));
    return rows.map((line, i) => truncateToWidth(" ".repeat(margin) + (i === 0 && this.gutter ? cleanDim("  └ ") : "    ") + line, width, ""));
  }
}
function cleanResult(context: ToolRenderContext, body: string, preview = false, gutter = true): CleanOutputRow {
  const row = context.lastComponent instanceof CleanOutputRow ? context.lastComponent : new CleanOutputRow("", 0, 0);
  row.body = body;
  row.diagnostics = [];
  row.preview = preview;
  row.gutter = gutter;
  row.margin = Math.max(0, contentPadding(context.outputPad) - 2);
  const key = context.keyText("app.tools.expand");
  row.hint = key ? ` (${key} to expand)` : " (click to expand)";
  return row;
}

/** diff_render.rs number-before-sign gutter, retaining Pi's native intraline spans. */
function cleanDiff(diff: string, theme: Theme): string {
  const rendered = renderDiff(diff).split("\n");
  const width = Math.max(1, ...diff.split("\n").map((line) => line.match(/^[+\- ]\s*(\d+)\s/)?.[1]?.length ?? 0));
  return rendered.map((line) => {
    const plain = stripTerminalSequences(line);
    const match = plain.match(/^([+\- ])(\s*\d+) (.*)$/);
    if (!match) return line;
    const [, sign, number] = match;
    const offset = 1 + number!.length + 1;
    const body = sliceByColumn(line, offset, Math.max(0, visibleWidth(line) - offset));
    const gutter = cleanDim(number!.trim().padStart(width) + " ");
    const mark = theme.fg(sign === "+" ? "toolDiffAdded" : sign === "-" ? "toolDiffRemoved" : "toolDiffContext", sign!);
    return gutter + mark + body;
  }).join("\n");
}

export function cleanHeader(name: string, detail: string, suffix: string, theme: Theme, context: ToolRenderContext): Text {
  const tracker = context.state as HeaderStateTracker | undefined;
  const state = (!context.isPartial && tracker?.executionState)
    ? tracker.executionState
    : determineToolState(context.isPartial, context.isError);
  const cleanDetail = name === "bash" || name === "powershell"
    ? highlighted(detail, name === "powershell" ? "command.ps1" : "command.sh", theme) : detail;

  const component = context.lastComponent instanceof CleanCallRow ? context.lastComponent : new CleanCallRow("", 0, 0);
  let currentState = state;
  const started = performance.now();
  if (component instanceof CleanCallRow) {
    component.readLabel = cleanAccent(theme, "Read");
    component.layout = () => {
      const running = currentState === "running";
      const margin = Math.max(0, contentPadding(context.outputPad) - 2);
      const marker = running ? (isAnimationActive() ? cleanActivity(theme, performance.now() - started) : "•") : renderStatusIcon(currentState, theme);
      if (name === "read") return { prefix: `${running ? marker : cleanDim("•")} ${theme.bold(running ? "Exploring" : "Explored")}`, detail: detail + suffix, margin, read: true };
      const verb = name === "bash" || name === "powershell" ? (running ? "Running" : "Ran")
        : name === "write" ? (running ? "Adding" : "Added")
        : name === "edit" ? (running ? "Editing" : "Edited")
        : name === "grep" ? (running ? "Searching" : "Searched")
        : name === "find" ? (running ? "Finding" : "Found")
        : name === "ls" ? (running ? "Listing" : "Listed")
        : (running ? `Running ${name}` : `Ran ${name}`);
      const args = context.args as { content?: unknown } | undefined;
      const counts = (context.state as { cleanCounts?: string } | undefined)?.cleanCounts
        ?? (name === "write" && typeof args?.content === "string"
          ? ` (${theme.fg("toolDiffAdded", `+${cleanLineCount(args.content)}`)} ${theme.fg("toolDiffRemoved", "-0")})` : "");
      return { prefix: `${marker} ${theme.bold(verb)} `, detail: cleanDetail + counts, margin, read: false };
    };
  }
  if (tracker) {
    tracker.updateHeader = (newState: ToolExecutionState) => {
      tracker.executionState = newState;
      currentState = newState;
    };
  }
  return component;
}

export function createCleanToolRenderer(toolName: string): ToolRenderers {
  const kind = toolName === "bash" || toolName === "powershell" ? "shell" : toolName;
  return { renderShell: "self", renderCall(raw, theme, context) {
    if (kind === "read") {
      const args = (raw ?? {}) as { path?: string; file_path?: string; offset?: number; limit?: number };
      return cleanHeader("read", formatDisplayPath(args.path ?? args.file_path, context.cwd), quiet(theme, formatReadLineRange(args.offset, args.limit)), theme, context);
    }
    if (kind === "write") {
      const args = (raw ?? {}) as { path?: string; file_path?: string; content?: string };
      const count = typeof args.content === "string" ? args.content.split("\n").length : 0;
      const progress = context.isPartial && count ? quiet(theme, ` (${count} ${count === 1 ? "line" : "lines"}...)`) : "";
      return cleanHeader("write", formatDisplayPath(args.path ?? args.file_path, context.cwd), progress, theme, context);
    }
    if (kind === "edit") {
      const args = (raw ?? {}) as { path?: string; file_path?: string; edits?: unknown[] };
      const count = Array.isArray(args.edits) ? args.edits.length : 1;
      return cleanHeader("edit", formatDisplayPath(args.path ?? args.file_path, context.cwd), quiet(theme, ` (${count} ${count === 1 ? "edit" : "edits"})`), theme, context);
    }
    if (kind === "shell") {
      const args = (raw ?? {}) as { command?: string; timeout?: number };
      const command = typeof args.command === "string" ? args.command : "...";
      return cleanHeader(toolName, command, args.timeout ? quiet(theme, ` [timeout ${args.timeout}s]`) : "", theme, context);
    }
    if (kind === "grep") {
      const args = (raw ?? {}) as { pattern?: string; path?: string };
      const pattern = `/${args.pattern ?? ""}/`;
      const suffix = args.path ? quiet(theme, ` in ${formatDisplayPath(args.path, context.cwd)}`) : "";
      return cleanHeader("grep", pattern, suffix, theme, context);
    }
    if (kind === "find") {
      const args = (raw ?? {}) as { pattern?: string; path?: string };
      const pattern = args.pattern ?? "*";
      const suffix = args.path ? quiet(theme, ` in ${formatDisplayPath(args.path, context.cwd)}`) : "";
      return cleanHeader("find", pattern, suffix, theme, context);
    }
    if (kind === "ls") {
      const args = (raw ?? {}) as { path?: string };
      return cleanHeader("ls", formatDisplayPath(args.path, context.cwd), "", theme, context);
    }
    return cleanHeader(toolName, formatDisplayPath((raw as any)?.path, context.cwd) || (typeof (raw as any)?.command === "string" ? (raw as any).command : ""), "", theme, context);
  }, renderResult(result, options, theme, context) {
    if (kind === "read") {
      const stateText = fileResultState("Read", resultState(result, options.isPartial, context), result, theme);
      if (stateText && !options.isPartial) return cleanResult(context, stateText);
      if (!options.expanded) return textRow(context, "");
      const args = context.args as { path?: string; file_path?: string } | undefined;
      return cleanResult(context, highlighted(getTextContent(result), args?.path ?? args?.file_path, theme));
    }
    if (kind === "write") {
      const state = resultState(result, options.isPartial, context);
      const args = (context.args ?? {}) as { path?: string; file_path?: string; content?: string };
      const content = typeof args.content === "string" ? args.content : "";
      const error = fileResultState("Write", state, result, theme);
      if (error && state !== "running") return cleanResult(context, error);
      if (state === "running") return textRow(context, "");
      const added = content.split("\n").slice(0, cleanLineCount(content)).map((line, i) => theme.fg("toolDiffAdded", `${i + 1} +${line}`)).join("\n");
      return cleanResult(context, added, !options.expanded, false);
    }
    if (kind === "edit") {
        const diff = (result.details as { diff?: string } | undefined)?.diff;
        if (diff && context.state) {
          const counts = summarizeDiff(diff);
          (context.state as { cleanCounts?: string }).cleanCounts = ` (${theme.fg("toolDiffAdded", `+${counts.additions}`)} ${theme.fg("toolDiffRemoved", `-${counts.deletions}`)})`;
        }
        const state = resultState(result, options.isPartial, context);
        const error = fileResultState("Edit", state, result, theme);
        if (error && state !== "running") return cleanResult(context, error);
        if (state === "running") return textRow(context, "");
        return diff ? cleanResult(context, cleanDiff(diff, theme), !options.expanded, false) : textRow(context, "");
    }
    if (kind === "shell") {
      const output = getTextContent(result).replace(/\r?\n$/, "");
      const state = resultState(result, options.isPartial, context);
      const details = result.details as { exitCode?: number; fullOutputPath?: string } | undefined;
        const diagnostics = state === "interrupted" ? "Command interrupted"
          : state === "failure" ? (details?.exitCode !== undefined ? `Exit code ${details.exitCode}` : "Command failed") : "";
        const body = [output, diagnostics, details?.fullOutputPath ? `[Full output saved to: ${details.fullOutputPath}]` : ""].filter(Boolean).join("\n");
        if (!body && state === "running") return textRow(context, "");
        // Keep outcome and full-output path visible even when the output preview is clipped.
        const row = cleanResult(context, body, !options.expanded);
        if (!options.expanded && (diagnostics || details?.fullOutputPath)) {
          row.body = output;
          const diagnosticRows = [diagnostics, details?.fullOutputPath ? `[Full output saved to: ${details.fullOutputPath}]` : ""].filter(Boolean);
          // Store diagnostics on the component, not by wrapping its renderer on every update.
          row.diagnostics = diagnosticRows;
        }
        return row;
    }
    if (kind === "grep") {
      const state = resultState(result, options.isPartial, context);
      const text = getTextContent(result).replace(/\r?\n$/, "");
      const count = Array.isArray((result.details as any)?.matches)
        ? (result.details as any).matches.length
        : text ? text.split("\n").filter(Boolean).length : 0;
      const summary = count > 0 ? `Found ${count} ${count === 1 ? "match" : "matches"}` : "No matches found";
      const error = fileResultState("Grep", state, result, theme);
      if (error && state !== "running") return cleanResult(context, error);
      if (state === "running") return textRow(context, "");
      return cleanResult(context, options.expanded ? text : summary, !options.expanded);
    }
    if (kind === "find") {
      const state = resultState(result, options.isPartial, context);
      const text = getTextContent(result).replace(/\r?\n$/, "");
      const count = Array.isArray((result.details as any)?.matches)
        ? (result.details as any).matches.length
        : text ? text.split("\n").filter(Boolean).length : 0;
      const summary = count > 0 ? `Found ${count} ${count === 1 ? "file" : "files"}` : "No files found";
      const error = fileResultState("Find", state, result, theme);
      if (error && state !== "running") return cleanResult(context, error);
      if (state === "running") return textRow(context, "");
      return cleanResult(context, options.expanded ? text : summary, !options.expanded);
    }
    if (kind === "ls") {
      const state = resultState(result, options.isPartial, context);
      const text = getTextContent(result).replace(/\r?\n$/, "");
      const count = Array.isArray((result.details as any)?.entries)
        ? (result.details as any).entries.length
        : text ? text.split("\n").filter(Boolean).length : 0;
      const summary = `${count} ${count === 1 ? "entry" : "entries"}`;
      const error = fileResultState("LS", state, result, theme);
      if (error && state !== "running") return cleanResult(context, error);
      if (state === "running") return textRow(context, "");
      return cleanResult(context, options.expanded ? text : summary, !options.expanded);
    }
    const text = getTextContent(result).replace(/\r?\n$/, "");
    const state = resultState(result, options.isPartial, context);
    if (state === "running") return textRow(context, "");
    return cleanResult(context, text || (state === "failure" ? `${toolName} failed` : "(completed)"), !options.expanded);
  } };
}
