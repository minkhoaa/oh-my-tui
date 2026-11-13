// Native footer observations, subscriptions and ownership; formatting lives in presets/.
import { type ExtensionAPI, type ExtensionContext, type ReadonlyFooterDataProvider, type Theme } from "@earendil-works/pi-coding-agent";
import { type Component, type TUI, stripTerminalSequences, truncateToWidth } from "@earendil-works/pi-tui";
import { formatDisplayPath } from "../../presets/shared/tool-helpers.ts";
import { getActiveTheme } from "../../core/theme.ts";
import { hasNativeFooterRenderer } from "../../core/native-ui.ts";
import { setActiveTui } from "../../core/motion.ts";
import { readDisplayUsage, type DisplayUsage } from "../../core/usage.ts";

export const OMT_FOOTER_OWNER = Symbol.for("oh-my-tui.footer-owner");

export interface FooterControl {
  on(ctx: ExtensionContext): string;
  off(ctx: ExtensionContext): string;
  isEnabled(): boolean;
  applyTheme(ctx: ExtensionContext): void;
  cleanup?(ctx?: ExtensionContext): void;
  getUsage?(ctx?: ExtensionContext): DisplayUsage | undefined;
}

export interface ActivityState {
  type: "tool" | "running";
  name?: string;
  args?: unknown;
}

import { formatFooterLine, sanitizeStatusText, type FooterRenderData } from "../../presets/shared/footer.ts";
import { getActiveLayoutMode, shouldDisplayFooterActivity, shouldDisplayFooterBranch } from "../adaptive-layout/index.ts";
export { formatFooterLine, sanitizeStatusText, formatTokens, type FooterRenderData } from "../../presets/shared/footer.ts";
/** Format concise activity detail (command preview or shortened path). */
export function formatActivityDetail(toolName: string, rawArgs: unknown, cwd: string): string | undefined {
  if (!rawArgs || typeof rawArgs !== "object") return undefined;
  const args = rawArgs as Record<string, unknown>;
  if (toolName === "bash" || toolName === "powershell") {
    const cmd = typeof args.command === "string" ? args.command.trim() : "";
    if (!cmd) return undefined;
    const firstLine = cmd.split("\n")[0] ?? "";
    return stripTerminalSequences(truncateToWidth(firstLine, 25, "..."));
  }
  const filePath = args.path ?? args.file_path;
  if (typeof filePath === "string" && filePath) {
    const formatted = formatDisplayPath(filePath, cwd);
    return stripTerminalSequences(truncateToWidth(formatted, 25, "..."));
  }
  if (typeof args.pattern === "string" && args.pattern) {
    return stripTerminalSequences(truncateToWidth(`/${args.pattern}/`, 25, "..."));
  }
  if (typeof args.query === "string" && args.query) {
    return stripTerminalSequences(truncateToWidth(args.query.trim(), 25, "..."));
  }
  if (typeof args.task === "string" && args.task) {
    return stripTerminalSequences(truncateToWidth(args.task.trim(), 25, "..."));
  }
  return undefined;
}

class EmptyFooterComponent implements Component {
  readonly [OMT_FOOTER_OWNER] = true;
  render(): string[] {
    return [];
  }
  invalidate(): void {}
}

/** Codex-inspired clean single-line footer component. */
export class CleanFooterComponent implements Component {
  readonly [OMT_FOOTER_OWNER] = true;
  private readonly tui: TUI;
  private readonly theme: () => Theme;
  private readonly footerData: ReadonlyFooterDataProvider;
  private readonly getCtx: () => ExtensionContext | undefined;
  private readonly getActivity: () => ActivityState | undefined;
  private branchUnsub?: () => void;
  private readonly getOutputPad: () => number;
  private readonly getUsage?: () => DisplayUsage | undefined;

  constructor(
    tui: TUI,
    theme: Theme | (() => Theme),
    footerData: ReadonlyFooterDataProvider,
    getCtx: () => ExtensionContext | undefined,
    getActivity: () => ActivityState | undefined,
    getOutputPad: () => number = () => 1,
    getUsage?: () => DisplayUsage | undefined,
  ) {
    this.tui = tui;
    this.theme = typeof theme === "function" ? theme : () => theme;
    this.footerData = footerData;
    this.getCtx = getCtx;
    this.getActivity = getActivity;
    this.getOutputPad = getOutputPad;
    this.getUsage = getUsage;
    this.branchUnsub = footerData.onBranchChange?.(() => {
      try {
        this.tui.requestRender();
      } catch {}
    });
  }

  dispose(): void {
    if (this.branchUnsub) {
      this.branchUnsub();
      this.branchUnsub = undefined;
    }
  }

  invalidate(): void {
    // Event-driven rendering
  }

  render(width: number): string[] {
    const theme = this.theme();
    const ctx = this.getCtx();
    const activity = this.getActivity();

    const branch = this.footerData.getGitBranch?.() ?? null;

    const statusesMap = this.footerData.getExtensionStatuses?.();
    const extensionStatuses = statusesMap && statusesMap.size > 0
      ? Array.from(statusesMap.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([, text]) => sanitizeStatusText(text))
          .filter(Boolean)
      : [];

    const rawUsage = ctx?.getContextUsage?.();
    const contextUsage = rawUsage
      ? {
          percent: typeof rawUsage.percent === "number" ? rawUsage.percent : null,
          contextWindow: typeof rawUsage.contextWindow === "number" ? rawUsage.contextWindow : (ctx?.model?.contextWindow ?? 0),
        }
      : ctx?.model?.contextWindow
        ? { percent: null, contextWindow: ctx.model.contextWindow }
        : undefined;

    const routed = (ctx as { routedModel?: { model: { id: string }; thinkingLevel?: string } })?.routedModel;
    const layoutMode = getActiveLayoutMode();
    const showBranch = shouldDisplayFooterBranch(width, layoutMode);
    const showActivity = activity ? shouldDisplayFooterActivity(width, layoutMode) : false;

    const entries = this.getUsage ? undefined : ctx?.sessionManager?.getEntries?.();
    const usage = this.getUsage ? this.getUsage() : entries ? readDisplayUsage(entries) : undefined;
    const agentName = (ctx as { agent?: { name?: string } })?.agent?.name
      ?? (ctx as { currentAgent?: string })?.currentAgent;
    const renderData: FooterRenderData = {
      totalTokens: usage?.totalTokens,
      cost: usage?.cost,
      input: usage?.input,
      output: usage?.output,
      cacheRead: usage?.cacheRead,
      cacheWrite: usage?.cacheWrite,
      agent: agentName,
      outputPad: this.getOutputPad(),
      cwd: ctx?.cwd,
      branch: showBranch ? branch : null,
      extensionStatuses,
      activity: showActivity && activity
        ? {
            type: activity.type,
            name: activity.name,
            detail: activity.name && activity.args
              ? formatActivityDetail(activity.name, activity.args, ctx?.cwd ?? process.cwd())
              : undefined,
          }
        : undefined,
      contextUsage,
      modelId: ctx?.model?.id || "no-model",
      provider: ctx?.model?.provider,
      hasMultipleProviders: Boolean(this.footerData.getAvailableProviderCount?.() > 1),
      reasoning: ctx?.model?.reasoning === true,
      thinkingLevel: ctx?.thinkingLevel || "off",
      routedModelId: routed?.model?.id,
      routedThinkingLevel: routed?.thinkingLevel,
    };

    return [formatFooterLine(width, theme, renderData)];
  }
}

type FooterFactory = (tui: TUI, theme: Theme, footerData: ReadonlyFooterDataProvider) => Component & {
  dispose?(): void;
  invalidate?(): void;
};

/**
 * Controller for session-local clean footer.
 * Yields cleanly if another extension owns the footer.
 */
export function createFooterControl(pi: ExtensionAPI): FooterControl {
  let enabled = true;
  let currentContext: ExtensionContext | undefined;
  let activity: ActivityState | undefined;
  let currentTui: TUI | undefined;
  const runningTools = new Map<string, { name: string; args: unknown }>();
  let usageDirty = true;
  let usageSnapshot: DisplayUsage | undefined;
  let usageLeaf: string | null | undefined;
  function getUsage(ctx?: ExtensionContext) {
    if (ctx && currentContext !== ctx) { currentContext = ctx; usageDirty = true; }
    const leaf = currentContext?.sessionManager?.getLeafId?.();
    if (usageDirty || leaf !== usageLeaf) {
      usageLeaf = leaf;
      const entries = currentContext?.sessionManager?.getEntries?.();
      usageSnapshot = entries ? readDisplayUsage(entries) : undefined;
      usageDirty = false;
    }
    return usageSnapshot;
  }

  function notifyUpdate() {
    usageDirty = true;
    if (enabled && currentTui) {
      try {
        currentTui.requestRender();
      } catch {}
    }
  }

  // Track activity via lifecycle events without polling or timers
  pi.on("turn_start", () => {
    runningTools.clear();
    activity = { type: "running" };
    notifyUpdate();
  });

  pi.on("turn_end", () => {
    runningTools.clear();
    activity = undefined;
    notifyUpdate();
  });

  pi.on("tool_execution_start", (event: { toolCallId?: string; toolName?: string; args?: unknown } = {}) => {
    const id = event.toolCallId || event.toolName || "tool";
    runningTools.set(id, { name: event.toolName ?? "tool", args: event.args });
    activity = {
      type: "tool",
      name: event.toolName,
      args: event.args,
    };
    notifyUpdate();
  });

  pi.on("tool_execution_end", (event?: { toolCallId?: string; toolName?: string }) => {
    if (event?.toolCallId) {
      runningTools.delete(event.toolCallId);
    } else if (event?.toolName) {
      runningTools.delete(event.toolName);
    } else {
      const lastKey = Array.from(runningTools.keys()).at(-1);
      if (lastKey) runningTools.delete(lastKey);
    }
    if (runningTools.size > 0) {
      const remaining = Array.from(runningTools.values()).at(-1)!;
      activity = {
        type: "tool",
        name: remaining.name,
        args: remaining.args,
      };
    } else {
      activity = { type: "running" };
    }
    notifyUpdate();
  });

  pi.on("agent_end", () => {
    runningTools.clear();
    activity = undefined;
    notifyUpdate();
  });

  pi.on("agent_settled", () => {
    runningTools.clear();
    activity = undefined;
    notifyUpdate();
  });

  pi.on("model_select", () => {
    notifyUpdate();
  });

  pi.on("thinking_level_select", () => {
    notifyUpdate();
  });
  pi.on("message_end", notifyUpdate);
  function doCleanup(ctx?: ExtensionContext): void {
    enabled = false;
    if (ctx && compatible(ctx)) {
      const getFooter = (ctx.ui as { getFooterComponent?: () => unknown }).getFooterComponent;
      const current = typeof getFooter === "function" ? getFooter() : undefined;
      if (!current || (current as Record<symbol, unknown>)[OMT_FOOTER_OWNER] || current === factory) {
        ctx.ui.setFooter(undefined);
      }
    }
    runningTools.clear();
    currentTui = undefined;
    currentContext = undefined;
    activity = undefined;
  }

  pi.on("session_compact", notifyUpdate);
  pi.on("session_tree", notifyUpdate);
  pi.on("session_shutdown", (_event, ctx) => {
    doCleanup(ctx);
  });

  function isAnotherOwner(ctx: ExtensionContext): boolean {
    if (!hasNativeFooterRenderer()) return true;
    const getFooter = (ctx.ui as { getFooterComponent?: () => unknown }).getFooterComponent;
    if (typeof getFooter === "function") {
      const current = getFooter();
      if (current && !(current as Record<symbol, unknown>)[OMT_FOOTER_OWNER]) {
        return true;
      }
    }
    return false;
  }

  function compatible(ctx: ExtensionContext): boolean {
    return ctx.mode === "tui" && typeof ctx.ui?.setFooter === "function"
      && typeof (ctx.ui as { getFooterComponent?: unknown }).getFooterComponent === "function";
  }

  const factory: FooterFactory = (tui, theme, footerData) => {
    currentTui = tui;
    setActiveTui(tui);
    return new CleanFooterComponent(tui, () => currentContext?.ui.theme ?? theme, footerData, () => currentContext, () => activity,
      () => pi.getSettings?.().outputPad ?? 1, getUsage);
  };
  (factory as unknown as Record<symbol, unknown>)[OMT_FOOTER_OWNER] = true;

  const emptyFactory: FooterFactory = () => {
    return new EmptyFooterComponent();
  };
  (emptyFactory as unknown as Record<symbol, unknown>)[OMT_FOOTER_OWNER] = true;

  return {
    getUsage,
    on(ctx: ExtensionContext): string {
      if (!compatible(ctx)) return "OMT footer unavailable: native footer ownership API required in TUI mode.";
      usageDirty = true;
      currentContext = ctx;
      if (isAnotherOwner(ctx)) {
        return "OMT footer inactive: another extension owns the footer.";
      }
      enabled = true;
      const active = getActiveTheme();
      if (active.id === "native") {
        ctx.ui.setFooter(undefined);
        return "OMT footer on (native presentation).";
      }
      if (active.id === "omt-signature") {
        ctx.ui.setFooter(emptyFactory);
        return "OMT footer on.";
      }
      ctx.ui.setFooter(factory);
      return "OMT footer on.";
    },
    off(ctx: ExtensionContext): string {
      if (!compatible(ctx)) return "OMT footer unavailable: native footer ownership API required in TUI mode.";
      currentContext = ctx;
      enabled = false;
      if (isAnotherOwner(ctx)) {
        return "OMT footer off; other footer left unchanged.";
      }
      const getFooter = (ctx.ui as { getFooterComponent?: () => unknown }).getFooterComponent;
      const current = typeof getFooter === "function" ? getFooter() : undefined;
      if (!current || (current as Record<symbol, unknown>)[OMT_FOOTER_OWNER] || current === factory || current === emptyFactory) {
        ctx.ui.setFooter(undefined);
        return "OMT footer off (native footer restored).";
      }
      return "OMT footer off; other footer left unchanged.";
    },
    isEnabled(): boolean {
      return enabled;
    },
    applyTheme(ctx: ExtensionContext): void {
      if (!compatible(ctx)) return;
      currentContext = ctx;
      if (isAnotherOwner(ctx)) return;
      const active = getActiveTheme();
      if (active.id === "native") {
        ctx.ui.setFooter(undefined);
        return;
      }
      if (enabled) {
        if (active.id === "omt-signature") {
          ctx.ui.setFooter(emptyFactory);
        } else {
          ctx.ui.setFooter(factory);
          notifyUpdate();
        }
      }
    },
    cleanup(ctx?: ExtensionContext): void {
      doCleanup(ctx);
    },
  };
}
