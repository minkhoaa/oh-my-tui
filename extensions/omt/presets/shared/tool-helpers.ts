import { type AgentToolResult, type Theme, type ToolRenderers, getLanguageFromPath, highlightCode } from "@earendil-works/pi-coding-agent";
import { Text, indexedColor } from "@earendil-works/pi-tui";
import { contentPadding, isCleanTheme, isRailTheme, isEmberTheme, quiet } from "./style.ts";
import { getActiveTheme } from "../../core/theme.ts";
import { homedir } from "node:os";
import { isAbsolute, relative } from "node:path";
import { emberFg } from "../omt-ember/rendering.ts";
import { cleanDim } from "../omt-clean/rendering.ts";

export type ToolRenderContext = Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];
export const OMT_TOOL_OWNER = Symbol.for("oh-my-tui.tool-owner");
export type ToolExecutionState = "running" | "success" | "failure" | "interrupted";

export interface CustomToolRendererOptions {
  /** Tool display name (defaults to tool name). */
  name?: string;
  /** Custom formatter for the call header detail preview. */
  formatCallDetail?: (args: Record<string, unknown>, cwd: string) => string;
  /** Custom formatter for collapsed result summary. */
  formatResultSummary?: (result: AgentToolResult, theme: Theme) => string;
  /** Custom formatter for expanded result content. */
  formatExpandedContent?: (result: AgentToolResult, theme: Theme, context: ToolRenderContext) => string;
  /** Custom running state indicator text (defaults to "executing..."). */
  runningText?: string;
}

export interface DiffSummary { additions: number; deletions: number; chunks: number }

export interface HeaderStateTracker {
  executionState?: ToolExecutionState;
  railBlock?: boolean;
  updateHeader?: (state: ToolExecutionState) => void;
}

export function determineToolState(
  isPartial: boolean,
  isError: boolean,
  result?: AgentToolResult,
  output = "",
): ToolExecutionState {
  if (isPartial) return "running";

  const details = result?.details as Record<string, unknown> | undefined;
  const rail = isRailTheme();
  const strict = isEmberTheme();
  const clean = isCleanTheme(getActiveTheme()) || rail || strict;
  const isInterrupted = details?.interrupted === true
    || details?.aborted === true
    || details?.cancelled === true
    || details?.exitCode === 130
    || (!clean && details?.exitCode === 137)
    || details?.signal === "SIGINT"
    || details?.signal === "SIGTERM"
    || (clean
      ? !!(isError || result?.isError) && (/^(?:command|operation) aborted(?:[.!:\s]|$)/i.test(output.trim())
        || (rail || strict) && /(?:^|\n\n)Command aborted\s*$/.test(output))
      : /command aborted|operation aborted|interrupted|sigint|cancelled/i.test(output));

  if (isInterrupted) return "interrupted";
  if (isError || result?.isError || (clean && typeof details?.exitCode === "number" && details.exitCode !== 0)) return "failure";
  return "success";
}

export function renderStatusIcon(state: ToolExecutionState, theme: Theme): string {
  const active = getActiveTheme();
  const color = state === "running" ? active.color.secondary
    : state === "failure" ? active.color.error
    : state === "interrupted" ? active.color.warning : active.color.success;
  if (isEmberTheme(active)) return emberFg(theme, state === "success" ? "success" : state === "failure" ? "error" : state === "interrupted" ? "accent" : "muted", "●");
  return isCleanTheme(active)
    ? (state === "running" ? cleanDim("•") : theme.style("•", { fg: indexedColor(state === "success" ? 2 : 1), bold: true }))
    : theme.fg(color, active.glyph[state]);
}

export function formatDuration(ms: number): string {
  if (ms < 0 || !Number.isFinite(ms)) return "0ms";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function formatDisplayPath(filePath: unknown, cwd: string): string {
  if (typeof filePath !== "string" || !filePath) return "(unknown path)";
  if (!isAbsolute(filePath)) return filePath;
  const rel = relative(cwd, filePath);
  if (rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\") && !isAbsolute(rel)) return rel || ".";
  const home = homedir();
  return home && (filePath === home || filePath.startsWith(`${home}/`)) ? `~${filePath.slice(home.length)}` : filePath;
}

export function getTextContent(result?: AgentToolResult): string {
  return result?.content?.filter((c): c is { type: "text"; text: string } => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text).join("\n") ?? "";
}

export function summarizeDiff(diff: string): DiffSummary {
  let additions = 0, deletions = 0, chunks = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("@@")) chunks++;
    else if (line.startsWith("+") && !line.startsWith("+++")) additions++;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
  }
  return { additions, deletions, chunks: chunks || (additions + deletions > 0 ? 1 : 0) };
}

export function expandHint(context: ToolRenderContext, theme: Theme): string {
  const key = context.keyText("app.tools.expand");
  return quiet(theme, ` (${key ? context.keyHint("app.tools.expand", "to expand") : "click to expand"})`);
}

class PlainToolRow extends Text {}
const rowPadding = new WeakMap<Text, number>();

export function textRow(context: ToolRenderContext, text: string, header = false): Text {
  const component = context.lastComponent instanceof PlainToolRow
    ? context.lastComponent : new PlainToolRow("", 0, 0);
  const padding = Math.max(0, contentPadding(context.outputPad) - (header ? 2 : 0));
  if (rowPadding.get(component) !== padding) {
    component.setPaddingX(padding);
    rowPadding.set(component, padding);
  }
  component.setText(text);
  return component;
}

export function header(name: string, detail: string, suffix: string, theme: Theme, context: ToolRenderContext): Text {
  const active = getActiveTheme();
  const tracker = context.state as HeaderStateTracker | undefined;
  const state = (!context.isPartial && tracker?.executionState) ? tracker.executionState : determineToolState(context.isPartial, context.isError);
  const duration = !context.isPartial && context.durationMs !== undefined ? quiet(theme, ` (${formatDuration(context.durationMs)})`) : "";
  const nameColor = active.color.text;
  const buildText = (st: ToolExecutionState) => `${renderStatusIcon(st, theme)} ${theme.fg(nameColor, name)} ${theme.fg(active.color.secondary, detail)}${suffix}${duration}`;
  const component = textRow(context, buildText(state), true);
  if (tracker) tracker.updateHeader = (next) => { tracker.executionState = next; component.setText(buildText(next)); };
  return component;
}

export function highlighted(content: string, path: unknown, theme: Theme): string {
  const lang = typeof path === "string" ? getLanguageFromPath(path) : undefined;
  let lines: string[];
  try { lines = lang ? highlightCode(content, lang) : content.split("\n"); }
  catch { lines = content.split("\n"); }
  while (lines.at(-1) === "") lines.pop();
  return lines.map((line) => lang ? line : theme.fg("toolOutput", line)).join("\n");
}

export function resultState(result: AgentToolResult, partial: boolean, context: ToolRenderContext): ToolExecutionState {
  const state = determineToolState(partial, context.isError, result, getTextContent(result));
  const tracker = context.state as HeaderStateTracker | undefined;
  if (tracker) {
    tracker.executionState = state;
    tracker.updateHeader?.(state);
  }
  return state;
}

export function fileResultState(name: string, state: ToolExecutionState, result: AgentToolResult, theme: Theme): string | undefined {
  const active = getActiveTheme();
  if (state === "interrupted") return theme.fg(active.color.warning, `${active.glyph.interrupted} ${name} aborted`);
  if (state === "failure") {
    const text = getTextContent(result).trim();
    const details = result?.details as Record<string, unknown> | undefined;
    const detailError = typeof details?.error === "string" ? details.error.trim()
      : typeof details?.message === "string" ? details.message.trim()
      : undefined;
    const errorMsg = text || detailError || `Failed to ${name.toLowerCase()} file`;
    return theme.fg(active.color.error, errorMsg.startsWith("Error:") ? errorMsg : `Error: ${errorMsg}`);
  }
  if (state === "running") return quiet(theme, name === "Edit" ? "applying edits..." : name === "Write" ? "writing..." : "reading...");
  return undefined;
}
