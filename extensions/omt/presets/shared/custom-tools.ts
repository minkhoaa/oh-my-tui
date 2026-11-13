import { type ToolRenderers, formatSize } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { getActiveTheme } from "../../core/theme.ts";
import { isCleanTheme, isRailTheme, isEmberTheme, quiet } from "./style.ts";
import { formatDisplayPath, getTextContent, highlighted, resultState, textRow, header, expandHint, type CustomToolRendererOptions, OMT_TOOL_OWNER } from "./tool-helpers.ts";
import { cleanHeader, createCleanToolRenderer } from "../omt-clean/tools.ts";
import { createRailToolRenderer } from "../omt-rail/tools.ts";
import { createEmberToolRenderer } from "../omt-ember/tools.ts";

export function formatCustomCallDetail(rawArgs: unknown, cwd: string): string {
  if (!rawArgs || typeof rawArgs !== "object") return "";
  const args = rawArgs as Record<string, unknown>;

  const filePath = args.path ?? args.file_path;
  if (typeof filePath === "string" && filePath) {
    return formatDisplayPath(filePath, cwd);
  }
  if (typeof args.command === "string" && args.command) {
    return truncateToWidth(args.command.split("\n")[0] ?? "", 50, "…");
  }
  if (typeof args.query === "string" && args.query) {
    return `"${truncateToWidth(args.query.trim(), 40, "…")}"`;
  }
  if (typeof args.url === "string" && args.url) {
    return truncateToWidth(args.url.trim(), 50, "…");
  }
  if (typeof args.pattern === "string" && args.pattern) {
    return `/${args.pattern}/`;
  }
  if (typeof args.task === "string" && args.task) {
    return truncateToWidth(args.task.trim(), 45, "…");
  }
  if (typeof args.message === "string" && args.message) {
    return truncateToWidth(args.message.trim(), 45, "…");
  }
  if (typeof args.prompt === "string" && args.prompt) {
    return truncateToWidth(args.prompt.trim(), 45, "…");
  }

  const entries = Object.entries(args);
  if (entries.length === 0) return "";
  const [firstKey, firstVal] = entries[0]!;
  if (typeof firstVal === "string") {
    return `${firstKey}="${truncateToWidth(firstVal.trim(), 35, "…")}"`;
  }
  if (typeof firstVal === "number" || typeof firstVal === "boolean") {
    return `${firstKey}=${String(firstVal)}`;
  }
  return `${firstKey}=${truncateToWidth(JSON.stringify(firstVal), 30, "…")}`;
}

export function createCleanCustomToolRenderer(toolName = "custom", options: CustomToolRendererOptions = {}): ToolRenderers {
  const displayName = options.name ?? toolName;
  const clean = createCleanToolRenderer(displayName);
  const rail = createRailToolRenderer(displayName);
  const ember = createEmberToolRenderer(displayName);

  const renderer: ToolRenderers = {
    renderShell: "self",
    renderCall(raw, theme, context) {
      if (options.formatCallDetail) {
        const detail = options.formatCallDetail(raw as any, context.cwd);
        if (isCleanTheme()) return cleanHeader(displayName, detail, "", theme, context);
        return header(displayName, detail, "", theme, context);
      }
      if (isCleanTheme()) return clean.renderCall!(raw, theme, context);
      if (isRailTheme()) return rail.renderCall!(raw, theme, context);
      if (isEmberTheme()) return ember.renderCall!(raw, theme, context);

      const args = (raw ?? {}) as Record<string, unknown>;
      const detail = formatCustomCallDetail(args, context.cwd);
      return header(displayName, detail, "", theme, context);
    },
    renderResult(result, renderOpts, theme, context) {
      if (!options.formatResultSummary && !options.formatExpandedContent) {
        if (isCleanTheme()) return clean.renderResult!(result, renderOpts, theme, context);
        if (isRailTheme()) return rail.renderResult!(result, renderOpts, theme, context);
        if (isEmberTheme()) return ember.renderResult!(result, renderOpts, theme, context);
      }

      const active = getActiveTheme();
      const state = resultState(result, renderOpts.isPartial, context);
      const text = getTextContent(result).trim();

      if (state === "running") {
        if (!renderOpts.expanded) {
          return textRow(context, quiet(theme, options.runningText ?? "executing..."));
        }
        return textRow(context, text ? theme.fg(active.color.secondary, text) : quiet(theme, options.runningText ?? "executing..."));
      }

      if (state === "interrupted") {
        const body: string[] = [theme.fg(active.color.warning, `${active.glyph.interrupted} ${displayName} aborted`)];
        if (text) {
          const lines = text.split("\n");
          const limit = renderOpts.expanded ? lines.length : 3;
          body.push(...lines.slice(0, limit).map((l) => theme.fg(active.color.secondary, l)));
        }
        return textRow(context, body.join("\n"));
      }

      if (state === "failure") {
        const details = result?.details as Record<string, unknown> | undefined;
        const detailError = typeof details?.error === "string" ? details.error.trim()
          : typeof details?.message === "string" ? details.message.trim()
          : undefined;
        const errorMsg = text || detailError || `${displayName} failed`;
        const body: string[] = [theme.fg(active.color.error, errorMsg.startsWith("Error:") ? errorMsg : `Error: ${errorMsg}`)];
        return textRow(context, body.join("\n"));
      }

      // Success state
      if (options.formatResultSummary && !renderOpts.expanded) {
        return textRow(context, options.formatResultSummary(result, theme) + expandHint(context, theme));
      }

      if (renderOpts.expanded) {
        if (options.formatExpandedContent) {
          return textRow(context, options.formatExpandedContent(result, theme, context));
        }
        if (text) {
          try {
            const parsed = JSON.parse(text);
            return textRow(context, highlighted(JSON.stringify(parsed, null, 2), "data.json", theme));
          } catch {
            return textRow(context, theme.fg("toolOutput", text));
          }
        }
        if (result.details && typeof result.details === "object") {
          return textRow(context, highlighted(JSON.stringify(result.details, null, 2), "data.json", theme));
        }
        return textRow(context, quiet(theme, "(no output)"));
      }

      // Collapsed success summary
      if (text) {
        const lines = text.split("\n");
        if (lines.length === 1 && lines[0]!.length <= 60) {
          return textRow(context, theme.fg(active.color.secondary, lines[0]!) + expandHint(context, theme));
        }
        const summary = `${lines.length} ${lines.length === 1 ? "line" : "lines"} (${formatSize(Buffer.byteLength(text))})`;
        return textRow(context, theme.fg(active.color.secondary, summary) + expandHint(context, theme));
      }

      if (result.details && typeof result.details === "object") {
        if (Array.isArray(result.details)) {
          return textRow(context, theme.fg(active.color.secondary, `${result.details.length} items`) + expandHint(context, theme));
        }
        const detailObj = result.details as Record<string, unknown>;
        if (typeof detailObj.count === "number") {
          return textRow(context, theme.fg(active.color.secondary, `${detailObj.count} items`) + expandHint(context, theme));
        }
        if (typeof detailObj.total === "number") {
          return textRow(context, theme.fg(active.color.secondary, `${detailObj.total} total`) + expandHint(context, theme));
        }
        const keyCount = Object.keys(detailObj).length;
        return textRow(context, theme.fg(active.color.secondary, `${keyCount} ${keyCount === 1 ? "property" : "properties"}`) + expandHint(context, theme));
      }

      return textRow(context, theme.fg(active.color.secondary, "(completed)"));
    },
  };
  (renderer as Record<symbol, unknown>)[OMT_TOOL_OWNER] = true;
  return renderer;
}
