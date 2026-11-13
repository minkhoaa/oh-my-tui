import { renderDiff, type Theme, type ToolRenderers } from "@earendil-works/pi-coding-agent";
import { sliceByColumn, stripTerminalSequences, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { contentPadding } from "../shared/style.ts";
import { formatDisplayPath, getTextContent, highlighted, resultState, summarizeDiff, type HeaderStateTracker, type ToolExecutionState, type ToolRenderContext } from "../shared/tool-helpers.ts";
import { claudeBg, claudeFg, claudeResultRows } from "./rendering.ts";
import { claudeSpinner } from "./motion.ts";
import { isAnimationActive } from "../../core/motion.ts";

import { LayoutRow } from "../shared/rendering.ts";

class ClaudeRow extends LayoutRow {
  protected override format(rows: string[], width: number): string[] { return rows.map((line) => truncateToWidth(line, width, "")); }
}
function row(context: ToolRenderContext): ClaudeRow {
  return context.lastComponent instanceof ClaudeRow ? context.lastComponent : new ClaudeRow();
}
function hint(context: ToolRenderContext): string {
  const key = context.keyText("app.tools.expand");
  return key ? ` (${key} to expand)` : " (click to expand)";
}
function marker(theme: Theme, state: ToolExecutionState, elapsed = 0): string {
  if (state === "running") {
    return isAnimationActive()
      ? claudeFg(theme, "accent", claudeSpinner(elapsed))
      : claudeFg(theme, "muted", "●");
  }
  return claudeFg(theme, state === "success" ? "success" : state === "failure" ? "error" : state === "interrupted" ? "accent" : "muted", "●");
}
function lineCount(text: string): number {
  if (!text) return 0;
  let count = 1;
  let pos = -1;
  while ((pos = text.indexOf("\n", pos + 1)) !== -1) {
    count++;
  }
  if (text.endsWith("\n")) count--;
  return count;
}
function lines(count: number): string { return `${count} ${count === 1 ? "line" : "lines"}`; }

/** Native unified diff/intraline content, observed Claude number-before-sign geometry. */
function diffRows(source: string, theme: Theme, inner: number): string[] {
  return source.split("\n").flatMap((line) => {
    const match = stripTerminalSequences(line).match(/^([+\- ])(\s*\d+) (.*)$/);
    if (!match) return wrapTextWithAnsi(line, inner);
    const [, sign, number] = match;
    const offset = number!.length + 2;
    const body = sliceByColumn(line, offset, Math.max(0, visibleWidth(line) - offset));
    const gutter = ` ${number!.trim().padStart(Math.max(1, number!.length))} ${sign}`;
    const colored = sign === "+" || sign === "-";
    return wrapTextWithAnsi(body, Math.max(2, inner - visibleWidth(gutter))).map((part, i) => {
      const prefix = i === 0 ? gutter : " ".repeat(Math.max(0, visibleWidth(gutter) - 1)) + sign;
      const content = (colored ? claudeFg(theme, sign === "+" ? "addedSign" : "removedSign", prefix) : prefix) + part;
      return colored ? claudeBg(theme, sign === "+" ? "added" : "removed", content + " ".repeat(Math.max(0, inner - visibleWidth(content)))) : content;
    });
  });
}

export function createClaudeToolRenderer(name: string): ToolRenderers {
  const shell = name === "bash" || name === "powershell";
  const label = shell ? (name === "powershell" ? "PowerShell" : "Bash")
    : name === "write" ? "Create"
    : name === "edit" ? "Update"
    : name === "read" ? "Read"
    : name === "grep" ? "Grep"
    : name === "find" ? "Find"
    : name === "ls" ? "LS"
    : name;
  return {
    renderShell: "self",
    renderCall(raw, theme, context) {
      const args = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      const tracker = context.state as HeaderStateTracker;
      const component = row(context);
      component.cache = false;
      let state: ToolExecutionState = context.isPartial ? "running" : tracker?.executionState ?? "success";
      if (tracker) tracker.updateHeader = (next) => { state = next; component.invalidate(); };
      const path = formatDisplayPath(args.path ?? args.file_path, context.cwd);
      let detail = shell ? (typeof args.command === "string" ? args.command : "…") : path;
      if (name === "grep") {
        detail = `/${args.pattern ?? ""}/` + (args.path ? `, ${path}` : "");
      } else if (name === "find") {
        detail = `"${args.pattern ?? "*"}"` + (args.path ? `, ${path}` : "");
      } else if (name === "ls") {
        detail = path;
      } else if (!shell && name !== "read" && name !== "write" && name !== "edit") {
        detail = typeof args.command === "string" ? args.command : path !== "(unknown path)" ? path : (typeof args.query === "string" ? `"${args.query}"` : "");
      }
      const started = performance.now();
      component.layout = (width) => {
        const margin = Math.min(Math.max(0, contentPadding(context.outputPad) - 2), Math.floor(width / 4));
        const pad = " ".repeat(margin);
        const elapsed = performance.now() - started;
        if (!context.expanded && (shell || name === "read" || name === "grep" || name === "find" || name === "ls")) {
          const text = state === "running" ? (shell ? `Running ${detail}` : name === "grep" ? `Searching ${detail}` : name === "find" ? `Finding ${detail}` : name === "ls" ? `Listing ${detail}` : `Reading ${path}`)
            : shell ? "Ran 1 shell command" : name === "grep" ? `Searched ${detail}` : name === "find" ? `Found files in ${path}` : name === "ls" ? `Listed ${path}` : "Read 1 file";
          const icon = state === "running" && isAnimationActive() ? claudeFg(theme, "accent", claudeSpinner(elapsed) + " ") : "";
          return [pad + "  " + claudeFg(theme, state === "failure" ? "error" : state === "interrupted" ? "accent" : "muted", icon + truncateToWidth(text + (state === "running" ? "" : hint(context)), Math.max(0, width - margin - 2 - visibleWidth(icon)), "…"))];
        }
        const text = theme.bold(label) + `(${detail})`;
        const wrapped = wrapTextWithAnsi(text, Math.max(2, width - margin - 2));
        return wrapped.map((line, i) => pad + (i === 0 ? marker(theme, state, elapsed) + " " : "  ") + line);
      };
      return component;
    },
    renderResult(result, options, theme, context) {
      const state = resultState(result, options.isPartial, context);
      const component = row(context);
      component.cache = !options.isPartial;
      const args = (context.args ?? {}) as { path?: string; file_path?: string; content?: string };
      const details = result.details as { diff?: string; error?: string; message?: string; exitCode?: number; fullOutputPath?: string; truncation?: { truncated?: boolean; outputLines?: number; totalLines?: number } } | undefined;
      const output = getTextContent(result).replace(/\r?\n$/, "");
      const failure = state === "failure" || state === "interrupted";
      const code = typeof args.content === "string" ? args.content : "";
      // Parse/highlight once per content update, never on working-clock redraws.
      const source = name === "edit" && details?.diff ? renderDiff(details.diff)
        : name === "write" ? highlighted(code, args.path ?? args.file_path, theme)
        : name === "read" && options.expanded ? highlighted(output, args.path ?? args.file_path, theme) : output;
      const counts = details?.diff ? summarizeDiff(details.diff) : undefined;
      component.layout = (width) => {
        const margin = Math.min(Math.max(0, contentPadding(context.outputPad) - 2), Math.floor(width / 4));
        const inner = Math.max(2, width - margin - 5);
        const body: string[] = [];
        const diagnostics: string[] = [];
        if (state === "interrupted") diagnostics.push(claudeFg(theme, "accent", "Interrupted"));
        if (state === "failure") diagnostics.push(claudeFg(theme, "error", details?.exitCode !== undefined ? `Error: Exit code ${details.exitCode}` : `Error: ${!shell && output ? output : details?.error ?? details?.message ?? "Tool failed"}`));
        if (details?.truncation?.truncated) diagnostics.push(claudeFg(theme, "muted", `[Truncated: showing ${details.truncation.outputLines} of ${details.truncation.totalLines} lines]`));
        if (details?.fullOutputPath) diagnostics.push(claudeFg(theme, "muted", `[Full output saved to: ${details.fullOutputPath}]`));
        const outputLines = output ? output.split("\n") : [];
        if (failure) {
          if (output && (shell || state === "interrupted")) body.push(...(options.expanded ? outputLines : outputLines.slice(0, 3)));
          if (!options.expanded && outputLines.length > 3) body.push(claudeFg(theme, "muted", `… +${outputLines.length - 3} lines${hint(context)}`));
          body.unshift(...diagnostics);
          return claudeResultRows(body, width, margin, theme);
        }
        if (name === "read") {
          if (options.expanded) body.push(`Read ${lines(lineCount(output))}`, ...source.split("\n"));
        } else if (name === "grep" || name === "find" || name === "ls") {
          const count = Array.isArray((result.details as any)?.matches ?? (result.details as any)?.entries)
            ? ((result.details as any).matches ?? (result.details as any).entries).length
            : output ? outputLines.filter(Boolean).length : 0;
          const labelText = name === "grep" ? `Found ${count} ${count === 1 ? "match" : "matches"}`
            : name === "find" ? `Found ${count} ${count === 1 ? "file" : "files"}`
            : `${count} ${count === 1 ? "entry" : "entries"}`;
          body.push(labelText);
          if (options.expanded && output) {
            body.push(...outputLines);
          } else if (!options.expanded && outputLines.length > 3) {
            body.push(claudeFg(theme, "muted", `… +${outputLines.length - 3} lines${hint(context)}`));
          }
        } else if (shell) {
          if (options.expanded || options.isPartial) {
            const all = source ? source.split("\n") : [];
            body.push(...(options.expanded ? all : all.slice(0, 3)));
            if (!options.expanded && all.length > 3) body.push(claudeFg(theme, "muted", `… +${all.length - 3} lines${hint(context)}`));
            if (!body.length && !options.isPartial) body.push(claudeFg(theme, "muted", "(No content)"));
          }
        } else if (name === "write" || name === "edit") {
          body.push(name === "write" ? `Added ${lines(lineCount(code))}` : counts
            ? [`Added ${lines(counts.additions)}`, `removed ${lines(counts.deletions)}`].join(", ") : output || "Edits applied");
          const raw = name === "write" ? source.split("\n").slice(0, lineCount(code)).map((line, i) => `+${i + 1} ${line}`).join("\n") : source;
          const rendered = diffRows(raw, theme, Math.max(2, inner - 7));
          const preview = options.expanded ? rendered : rendered.slice(0, 10);
          // Result prose has a tree gutter; diff rows below it start at column five.
          const prose = claudeResultRows(body, width, margin, theme);
          prose.push(...preview.map((line) => " ".repeat(margin + 5) + line));
          if (rendered.length > preview.length) prose.push(...claudeResultRows([claudeFg(theme, "muted", `… +${rendered.length - preview.length} lines${hint(context)}`)], width, margin, theme));
          prose.push(...claudeResultRows(diagnostics, width, margin, theme));
          return prose;
        } else {
          body.push(...(options.expanded ? outputLines : outputLines.slice(0, 3)));
          if (!options.expanded && outputLines.length > 3) body.push(claudeFg(theme, "muted", `… +${outputLines.length - 3} lines${hint(context)}`));
          if (!body.length && !options.isPartial) body.push(claudeFg(theme, "muted", "(Completed)"));
        }
        body.push(...diagnostics);
        return claudeResultRows(body, width, margin, theme);
      };
      return component;
    },
  };
}
