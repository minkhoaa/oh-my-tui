// OMT Rail tools presentation for Pi.
import { type AgentToolResult, type Theme, type ToolRenderers, renderDiff } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth } from "@earendil-works/pi-tui";
import { type ToolRenderContext, type HeaderStateTracker, formatDisplayPath, getTextContent, highlighted, resultState } from "../shared/tool-helpers.ts";
import { RailRow, railBlock, railCollapse, railDiffRow, railFg, railSpinner, railWrap } from "./rendering.ts";
import { isAnimationActive } from "../../core/motion.ts";

/** Rail's inline calls become panel blocks only when output/diff metadata arrives. */
function railCall(name: string, raw: unknown, theme: Theme, context: ToolRenderContext): RailRow {
  const args = (raw ?? {}) as Record<string, unknown>;
  const tracker = context.state as HeaderStateTracker;
  const row = context.lastComponent instanceof RailRow ? context.lastComponent : new RailRow();
  let state = context.isPartial ? "running" : tracker?.executionState ?? "success";
  if (tracker) tracker.updateHeader = (next) => { state = next; };
  const started = performance.now();
  const shell = name === "bash" || name === "powershell";
  const path = formatDisplayPath(args.path ?? args.file_path, context.cwd);
  let detail = shell ? (typeof args.command === "string" ? args.command : "") : path;
  if (name === "grep") {
    detail = `/${args.pattern ?? ""}/` + (path !== "(unknown path)" ? ` in ${path}` : "");
  } else if (name === "find") {
    detail = `"${args.pattern ?? "*"}"` + (path !== "(unknown path)" ? ` in ${path}` : "");
  } else if (name === "ls") {
    detail = path;
  }
  const label = name === "read" ? "Read"
    : name === "write" ? "Write"
    : name === "edit" ? "Edit"
    : name === "grep" ? "Grep"
    : name === "find" ? "Find"
    : name === "ls" ? "LS"
    : name;
  const pending = shell ? "Writing command…"
    : name === "read" ? "Reading file…"
    : name === "write" ? "Preparing write…"
    : name === "edit" ? "Preparing edit…"
    : name === "grep" ? "Searching pattern…"
    : name === "find" ? "Finding files…"
    : name === "ls" ? "Listing files…"
    : `Running ${name}…`;
  const range = name === "read" ? [typeof args.offset === "number" ? `offset: ${args.offset}` : "", typeof args.limit === "number" ? `limit: ${args.limit}` : ""].filter(Boolean).join(", ") : "";
  row.layout = (width) => {
    if (tracker?.railBlock) return [];
    const color = state === "failure" ? "error" : state === "interrupted" ? "warning" : state === "success" ? "muted" : "text";
    const complete = shell ? !!detail : path !== "(unknown path)";
    const icon = !complete ? "~" : (name === "read" || name === "grep" || name === "find") && state === "running" && context.executionStarted
      ? railSpinner(performance.now() - started, isAnimationActive())
      : shell ? "$" : (name === "write" || name === "edit") ? "←" : "→";
    const text = !complete ? pending : `${shell ? "" : label + " "}${detail}${range ? ` (${range})` : ""}`;
    const pad = width >= 10 ? Math.min(Math.max(5, context.outputPad ?? 1), Math.floor(width / 3)) : 0;
    // InlineToolRow has a fixed two-cell icon sibling, not a wrapping prefix.
    // Its pending fallback is additionally inset by three cells.
    const inset = pad + (!complete ? 3 : 0);
    return railWrap(railFg(theme, color, text), Math.max(2, width - inset - 4))
      .map((line, i) => truncateToWidth(" ".repeat(inset) + (i === 0 ? railFg(theme, color, `${icon} `) : "  ") + line, width, ""));
  };
  return row;
}

function railResult(name: string, result: AgentToolResult, options: { expanded: boolean; isPartial: boolean }, theme: Theme, context: ToolRenderContext): RailRow {
  const state = resultState(result, options.isPartial, context);
  const tracker = context.state as HeaderStateTracker;
  const row = context.lastComponent instanceof RailRow ? context.lastComponent : new RailRow();
  row.cache = !options.isPartial;
  const args = (context.args ?? {}) as { path?: string; file_path?: string; command?: string; content?: string };
  const path = formatDisplayPath(args.path ?? args.file_path, context.cwd);
  const output = getTextContent(result);
  const details = result.details as { diff?: string; error?: string; message?: string; exitCode?: number; fullOutputPath?: string; truncation?: { truncated?: boolean; outputLines?: number; totalLines?: number } } | undefined;
  const shell = name === "bash" || name === "powershell";
  const failed = state === "failure" || state === "interrupted";
  const isCustom = name !== "bash" && name !== "powershell" && name !== "read" && name !== "write" && name !== "edit" && name !== "grep" && name !== "find" && name !== "ls";
  const block = shell || !failed && !options.isPartial && (name === "write" || name === "edit" && !!details?.diff) || (name === "read" || name === "grep" || name === "find" || name === "ls" || isCustom) && options.expanded;
  if (tracker) tracker.railBlock = block;
  const source = name === "write" ? highlighted(args.content ?? "", args.path ?? args.file_path, theme)
    : name === "edit" && details?.diff ? renderDiff(details.diff)
    : name === "read" ? highlighted(output, args.path ?? args.file_path, theme) : output;
  const started = performance.now();
  row.layout = (width) => {
    const inner = Math.max(2, width - Math.max(2, (context.outputPad ?? 1) - 3) - 5);
    const diagnostics: string[] = [];
    const nativeDiagnostic = failed && shell ? output.match(/(?:^|\n\n)(Command (?:aborted|exited with code \d+|timed out[^\n]*))\s*$/)?.[1] : undefined;
    if (failed && !nativeDiagnostic) diagnostics.push(railFg(theme, state === "interrupted" ? "warning" : "error", shell
      ? state === "interrupted" ? "Command interrupted" : details?.exitCode !== undefined ? `Exit code ${details.exitCode}` : "Command failed"
      : output || details?.error || details?.message || `${name} ${state === "interrupted" ? "interrupted" : "failed"}`));
    if (details?.truncation?.truncated) diagnostics.push(railFg(theme, "warning", `[Truncated: showing ${details.truncation.outputLines} of ${details.truncation.totalLines} lines]`));
    if (details?.fullOutputPath) diagnostics.push(railFg(theme, "warning", `[Full output saved to: ${details.fullOutputPath}]`));
    if (!block) {
      if (!failed && !options.isPartial) {
        if (name === "grep" || name === "find" || name === "ls") {
          const count = Array.isArray((details as any)?.matches ?? (details as any)?.entries)
            ? ((details as any).matches ?? (details as any).entries).length
            : output ? output.split("\n").filter(Boolean).length : 0;
          const sum = name === "grep" ? `${count} matches` : name === "find" ? `${count} files` : `${count} entries`;
          diagnostics.push(railFg(theme, "muted", sum));
        } else if (isCustom) {
          const first = output ? (output.split("\n")[0] ?? "completed") : "completed";
          diagnostics.push(railFg(theme, "muted", truncateToWidth(first, 60, "…")));
        }
      }
      return diagnostics.flatMap((line) => railWrap(line, Math.max(2, width - 8))).map((line) => truncateToWidth(" ".repeat(Math.min(8, Math.floor(width / 3))) + line, width, ""));
    }
    const body: string[] = [];
    if (shell) {
      const marker = options.isPartial ? railSpinner(performance.now() - started) : "$";
      body.push(...railWrap(railFg(theme, "text", `${marker} ${args.command ?? ""}`), inner));
      const trimmed = stripTerminalSequences(output).trim();
      const collapsed = railCollapse(trimmed, width - 4);
      let preview = options.expanded ? trimmed : collapsed.output;
      if (nativeDiagnostic && !preview.includes(nativeDiagnostic)) diagnostics.unshift(railFg(theme, state === "interrupted" ? "warning" : "error", nativeDiagnostic));
      else if (nativeDiagnostic) preview = preview.replace(nativeDiagnostic, railFg(theme, state === "interrupted" ? "warning" : "error", nativeDiagnostic));
      if (trimmed) body.push("", ...railWrap(railFg(theme, "text", preview), inner));
      if (collapsed.overflow) {
        const key = context.keyText("app.tools.expand");
        body.push("", railFg(theme, "muted", `Click${key ? ` / ${key}` : ""} to ${options.expanded ? "collapse" : "expand"}`));
      }
    } else {
      const title = name === "write" ? `# Wrote ${path}` : name === "edit" ? `← Edit ${path}` : `→ Read ${path}`;
      body.push(...railWrap(railFg(theme, "muted", title), inner), "");
      const lines = source.split("\n");
      if (name === "write") {
        const count = (args.content ?? "").split("\n").length;
        while (lines.length < count) lines.push("");
      }
      const numberWidth = Math.max(2, String(lines.length).length);
      body.push(...lines.flatMap((line, i) => {
        if (name === "write") {
          // The line_number gutter is outside the code's wrap area.
          const gutter = String(i + 1).padStart(numberWidth) + " ";
          return railWrap(line, Math.max(2, inner - gutter.length)).map((part, row) =>
            (row === 0 ? railFg(theme, "muted", gutter) : " ".repeat(gutter.length)) + part);
        }
        return railWrap(name === "edit" ? railDiffRow(theme, line, inner) : line, inner);
      }));
    }
    body.push(...diagnostics.flatMap((line) => railWrap(line, inner)));
    return railBlock(theme, body, width, context.outputPad);
  };
  return row;
}

export function createRailToolRenderer(name: string): ToolRenderers {
  return { renderShell: "self", renderCall: (raw, theme, ctx) => railCall(name, raw, theme, ctx),
    renderResult: (result, options, theme, ctx) => railResult(name, result, options, theme, ctx) };
}
