import { type ToolRenderers, formatReadLineRange, formatSize, renderDiff } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { omtStyle, quiet } from "../shared/style.ts";
import { formatDisplayPath, getTextContent, summarizeDiff, highlighted, resultState, fileResultState, textRow, header, expandHint } from "../shared/tool-helpers.ts";

export function createCleanReadRenderer(): ToolRenderers {
  return {
    renderShell: "self",
    renderCall(raw, theme, context) {
      const args = (raw ?? {}) as { path?: string; file_path?: string; offset?: number; limit?: number };
      return header("read", formatDisplayPath(args.path ?? args.file_path, context.cwd), quiet(theme, formatReadLineRange(args.offset, args.limit)), theme, context);
    },
    renderResult(result, options, theme, context) {
      const stateText = fileResultState("Read", resultState(result, options.isPartial, context), result, theme);
      if (stateText !== undefined) return textRow(context, stateText);
      const content = getTextContent(result);
      const trunc = (result.details as { truncation?: { truncated?: boolean; outputLines?: number; totalLines?: number } })?.truncation;
      const note = trunc?.truncated ? theme.fg(omtStyle.color.warning, ` [Truncated: showing ${trunc.outputLines} of ${trunc.totalLines} lines]`) : "";
      if (!options.expanded) {
        const count = content ? content.split("\n").length : 0;
        const summary = count ? `${count} ${count === 1 ? "line" : "lines"} (${formatSize(Buffer.byteLength(content))})` : "0 lines (empty)";
        return textRow(context, theme.fg(omtStyle.color.secondary, summary) + note + expandHint(context, theme));
      }
      const args = (context.args ?? {}) as { path?: string; file_path?: string };
      return textRow(context, highlighted(content, args.path ?? args.file_path, theme) + (note ? `\n${note}` : ""));
    },
  };
}

export function createCleanWriteRenderer(): ToolRenderers {
  return {
    renderShell: "self",
    renderCall(raw, theme, context) {
      const args = (raw ?? {}) as { path?: string; file_path?: string; content?: string };
      const count = typeof args.content === "string" ? args.content.split("\n").length : 0;
      const progress = context.isPartial && count ? quiet(theme, ` (${count} ${count === 1 ? "line" : "lines"}...)`) : "";
      return header("write", formatDisplayPath(args.path ?? args.file_path, context.cwd), progress, theme, context);
    },
    renderResult(result, options, theme, context) {
      const state = resultState(result, options.isPartial, context);
      const args = (context.args ?? {}) as { path?: string; file_path?: string; content?: string };
      const content = typeof args.content === "string" ? args.content : "";
      const count = content ? content.split("\n").length : 0;
      if (state === "running" && !options.expanded) {
        return textRow(context, count > 0 ? "" : (fileResultState("Write", state, result, theme) ?? ""));
      }
      const stateText = fileResultState("Write", state, result, theme);
      if (stateText !== undefined) return textRow(context, stateText);
      if (options.expanded) return textRow(context, highlighted(content, args.path ?? args.file_path, theme));
      return textRow(context, theme.fg(omtStyle.color.secondary, `Wrote ${count} ${count === 1 ? "line" : "lines"} (${formatSize(Buffer.byteLength(content))})`) + expandHint(context, theme));
    },
  };
}

export function createCleanEditRenderer(): ToolRenderers {
  return {
    renderShell: "self",
    renderCall(raw, theme, context) {
      const args = (raw ?? {}) as { path?: string; file_path?: string; edits?: unknown[] };
      const count = Array.isArray(args.edits) ? args.edits.length : 1;
      return header("edit", formatDisplayPath(args.path ?? args.file_path, context.cwd), quiet(theme, ` (${count} ${count === 1 ? "edit" : "edits"})`), theme, context);
    },
    renderResult(result, options, theme, context) {
      const stateText = fileResultState("Edit", resultState(result, options.isPartial, context), result, theme);
      if (stateText !== undefined) return textRow(context, stateText);
      const diff = (result.details as { diff?: string })?.diff;
      if (!diff) return textRow(context, theme.fg(omtStyle.color.secondary, "Edits applied successfully"));
      if (options.expanded) {
        let rendered: string;
        try { rendered = renderDiff(diff); } catch { rendered = diff; }
        return textRow(context, rendered);
      }
      const { additions, deletions, chunks } = summarizeDiff(diff);
      return textRow(context, `${theme.fg("toolDiffAdded", `+${additions}`)} ${theme.fg("toolDiffRemoved", `-${deletions}`)}${quiet(theme, ` lines${chunks > 1 ? ` in ${chunks} chunks` : ""}`)}${expandHint(context, theme)}`);
    },
  };
}

export function createCleanBashRenderer(toolName = "bash"): ToolRenderers {
  return {
    renderShell: "self",
    renderCall(raw, theme, context) {
      const args = (raw ?? {}) as { command?: string; timeout?: number };
      const command = typeof args.command === "string" ? args.command : "...";
      const preview = truncateToWidth(command.split("\n")[0] ?? "", 60, "…") + (command.includes("\n") ? " …" : "");
      return header(toolName, preview, args.timeout ? quiet(theme, ` [timeout ${args.timeout}s]`) : "", theme, context);
    },
    renderResult(result, options, theme, context) {
      const rawOutput = getTextContent(result);
      const output = rawOutput.trimEnd();
      const lines = output ? output.split("\n") : [];
      const state = resultState(result, options.isPartial, context);
      const details = result.details as { exitCode?: number; fullOutputPath?: string } | undefined;
      const body: string[] = [];
      if (state === "failure") body.push(theme.fg(omtStyle.color.error, details?.exitCode !== undefined ? `Exit code ${details.exitCode}` : "Command failed"));
      const limit = options.expanded ? lines.length : state === "running" || state === "interrupted" ? 3 : 5;
      if (lines.length > limit) body.push(quiet(theme, `... (${lines.length - limit} earlier lines)`) + expandHint(context, theme));
      const displayLines = options.expanded ? lines : lines.slice(-limit);
      body.push(...displayLines.map((line) => theme.fg(state === "running" ? omtStyle.color.secondary : "toolOutput", line)));
      if (state === "interrupted") body.push(theme.fg(omtStyle.color.warning, `${omtStyle.glyph.interrupted} Command interrupted`));
      if (!body.length) body.push(quiet(theme, state === "running" ? "running..." : "(no output)"));
      if (details?.fullOutputPath) body.push(theme.fg(omtStyle.color.warning, `[Full output saved to: ${details.fullOutputPath}]`));
      return textRow(context, body.join("\n"));
    },
  };
}

export function createCleanGrepRenderer(): ToolRenderers {
  return {
    renderShell: "self",
    renderCall(raw, theme, context) {
      const args = (raw ?? {}) as { pattern?: string; path?: string };
      const detail = `/${args.pattern ?? ""}/`;
      const suffix = args.path ? ` in ${formatDisplayPath(args.path, context.cwd)}` : "";
      return header("grep", detail, quiet(theme, suffix), theme, context);
    },
    renderResult(result, options, theme, context) {
      const stateText = fileResultState("Grep", resultState(result, options.isPartial, context), result, theme);
      if (stateText !== undefined) return textRow(context, stateText);
      const content = getTextContent(result).trim();
      const count = Array.isArray((result.details as any)?.matches)
        ? (result.details as any).matches.length
        : content ? content.split("\n").length : 0;
      if (!options.expanded) {
        const summary = count > 0 ? `${count} ${count === 1 ? "match" : "matches"}` : "No matches found";
        return textRow(context, theme.fg(omtStyle.color.secondary, summary) + expandHint(context, theme));
      }
      return textRow(context, content ? theme.fg("toolOutput", content) : quiet(theme, "(no output)"));
    },
  };
}

export function createCleanFindRenderer(): ToolRenderers {
  return {
    renderShell: "self",
    renderCall(raw, theme, context) {
      const args = (raw ?? {}) as { pattern?: string; path?: string };
      const detail = args.pattern ?? "*";
      const suffix = args.path ? ` in ${formatDisplayPath(args.path, context.cwd)}` : "";
      return header("find", detail, quiet(theme, suffix), theme, context);
    },
    renderResult(result, options, theme, context) {
      const stateText = fileResultState("Find", resultState(result, options.isPartial, context), result, theme);
      if (stateText !== undefined) return textRow(context, stateText);
      const content = getTextContent(result).trim();
      const count = Array.isArray((result.details as any)?.matches)
        ? (result.details as any).matches.length
        : content ? content.split("\n").length : 0;
      if (!options.expanded) {
        const summary = count > 0 ? `${count} ${count === 1 ? "file" : "files"}` : "No files found";
        return textRow(context, theme.fg(omtStyle.color.secondary, summary) + expandHint(context, theme));
      }
      return textRow(context, content ? theme.fg("toolOutput", content) : quiet(theme, "(no output)"));
    },
  };
}

export function createCleanLsRenderer(): ToolRenderers {
  return {
    renderShell: "self",
    renderCall(raw, theme, context) {
      const args = (raw ?? {}) as { path?: string };
      const detail = formatDisplayPath(args.path, context.cwd);
      return header("ls", detail, "", theme, context);
    },
    renderResult(result, options, theme, context) {
      const stateText = fileResultState("LS", resultState(result, options.isPartial, context), result, theme);
      if (stateText !== undefined) return textRow(context, stateText);
      const content = getTextContent(result).trim();
      const count = Array.isArray((result.details as any)?.entries)
        ? (result.details as any).entries.length
        : content ? content.split("\n").length : 0;
      if (!options.expanded) {
        const summary = count > 0 ? `${count} ${count === 1 ? "entry" : "entries"}` : "0 entries";
        return textRow(context, theme.fg(omtStyle.color.secondary, summary) + expandHint(context, theme));
      }
      return textRow(context, content ? theme.fg("toolOutput", content) : quiet(theme, "(empty directory)"));
    },
  };
}
