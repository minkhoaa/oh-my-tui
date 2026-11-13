// Native lifecycle/ownership only. Preset motion and attribution live in presets/.
import { keyText, type ExtensionAPI, type ExtensionContext, type WorkingIndicatorOptions } from "@earendil-works/pi-coding-agent";
import { getActiveTheme } from "../../core/theme.ts";
import { hasAnimatedWorking, usesWorkingPhases, workingIndicator, workingLine } from "../../presets/shared/working.ts";
import { observeWorkingRender, type WorkingPresentation } from "../../core/native-ui.ts";

export interface ThinkingControl {
  on(ctx: ExtensionContext): string;
  off(ctx: ExtensionContext): string;
  isEnabled(): boolean;
  applyTheme(ctx: ExtensionContext): void;
  cleanup(ctx: ExtensionContext): void;
}

/** Session-local, display-only control. Pi owns content, visibility and run outcomes. */
export function createThinkingControl(pi: ExtensionAPI): ThinkingControl {
  let enabled = false;
  let phase = "Working";
  const running = new Set<string>();
  let started = performance.now();
  let currentContext: ExtensionContext | undefined;
  const restoreRender = observeWorkingRender((options, width) => {
    if (!enabled || !owned || options !== owned.indicator || !hasAnimatedWorking() || !currentContext) return;
    const current = presentation(currentContext);
    if (!current || !isOwner(current)) return;
    const elapsed = performance.now() - started;
    return workingLine(currentContext.ui.theme, elapsed, phase, keyText("app.interrupt").replace(/\bescape\b/g, "esc"), width);
  });
  function indicator(): WorkingIndicatorOptions {
    return workingIndicator(!!restoreRender);
  }
  let owned: { message: string; indicator: WorkingIndicatorOptions; previous: WorkingPresentation; label: string } | undefined;

  function presentation(ctx: ExtensionContext): WorkingPresentation | undefined {
    const ui = ctx.ui as typeof ctx.ui & { getWorkingPresentation?(): WorkingPresentation | undefined };
    if (ctx.mode !== "tui" || typeof ui.setWorkingIndicator !== "function"
      || typeof ui.setWorkingMessage !== "function" || typeof ui.setHiddenThinkingLabel !== "function"
      || typeof ui.getWorkingPresentation !== "function") return;
    const current = ui.getWorkingPresentation();
    return current && typeof current.hiddenThinkingLabel === "string"
      && typeof current.defaultHiddenThinkingLabel === "string" && typeof current.visible === "boolean"
      && (current.message === undefined || typeof current.message === "string") ? current : undefined;
  }

  function isOwner(current: WorkingPresentation): boolean {
    return !!owned && current.message === owned.message && current.indicator === owned.indicator
      && current.hiddenThinkingLabel === owned.label && current.visible === owned.previous.visible;
  }

  function update(ctx: ExtensionContext) {
    if (!usesWorkingPhases()) return; // Presets choose whether to display observed phases.
    if (!enabled || !owned || owned.message === phase) return;
    const current = presentation(ctx);
    if (!current || !isOwner(current)) return;
    ctx.ui.setWorkingMessage(phase);
    owned.message = phase;
  }

  // Observe normalized lifecycle events only; never transform messages or execution.
  pi.on("agent_start", (_event, ctx) => {
    running.clear();
    started = performance.now();
    phase = "Working";
    update(ctx);
  });
  pi.on("message_update", (event, ctx) => {
    if (event.message.role !== "assistant") return;
    const type = event.assistantMessageEvent.type;
    if (type === "thinking_start" || type === "thinking_delta") phase = "Thinking";
    else if (type === "text_start" || type === "text_delta") phase = "Streaming";
    else if (type === "toolcall_start" || type === "toolcall_delta") phase = "Preparing tools";
    else if (type === "thinking_end" || type === "text_end" || type === "toolcall_end") {
      phase = running.size ? "Running tools" : "Working";
    } else return;
    update(ctx);
  });
  pi.on("message_end", (event, ctx) => {
    if (event.message.role !== "assistant") return;
    phase = event.message.stopReason === "aborted" ? "Interrupted"
      : event.message.stopReason === "error" ? "Error" : "Working";
    update(ctx);
  });
  pi.on("tool_execution_start", (event, ctx) => {
    running.add(event.toolCallId);
    phase = "Running tools";
    update(ctx);
  });
  pi.on("tool_execution_end", (event, ctx) => {
    running.delete(event.toolCallId);
    phase = running.size ? "Running tools" : "Working";
    update(ctx);
  });
  pi.on("agent_settled", (_event, ctx) => {
    running.clear();
    phase = "Working";
    // Native Pi removes the working row. No synthetic completion row or timing.
    update(ctx);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    off(ctx);
    running.clear();
    currentContext = undefined;
  });

  function off(ctx: ExtensionContext): string {
    enabled = false;
    const current = presentation(ctx);
    if (current && owned) {
      // Restore only our fields, leaving later extension replacements untouched.
      if (current.message === owned.message) ctx.ui.setWorkingMessage(owned.previous.message);
      if (current.indicator === owned.indicator) ctx.ui.setWorkingIndicator(owned.previous.indicator);
      if (current.hiddenThinkingLabel === owned.label) ctx.ui.setHiddenThinkingLabel(owned.previous.hiddenThinkingLabel);
    }
    owned = undefined;
    return "OMT thinking off (native presentation restored where owned).";
  }

  function on(ctx: ExtensionContext): string {
    currentContext = ctx;
    const current = presentation(ctx);
    if (!current) return "OMT thinking unavailable: native working presentation API required in TUI mode.";
    const active = getActiveTheme();
    if (active.id === "native") {
      enabled = true;
      if (owned) {
        if (current.message === owned.message) ctx.ui.setWorkingMessage(owned.previous.message);
        if (current.indicator === owned.indicator) ctx.ui.setWorkingIndicator(owned.previous.indicator);
        if (current.hiddenThinkingLabel === owned.label) ctx.ui.setHiddenThinkingLabel(owned.previous.hiddenThinkingLabel);
        owned = undefined;
      }
      return "OMT thinking on (native presentation).";
    }
    if (owned && isOwner(current)) {
      enabled = true;
      update(ctx);
      return "OMT thinking on.";
    }
    if (current.message !== undefined || current.indicator !== undefined || !current.visible
      || current.hiddenThinkingLabel !== current.defaultHiddenThinkingLabel) {
      return "OMT thinking inactive: another extension owns the working presentation.";
    }
    const label = active.thinking.label;
    const frames = indicator();
    enabled = true;
    owned = { message: usesWorkingPhases() ? phase : "Working", indicator: frames, previous: current, label };
    ctx.ui.setWorkingMessage(owned.message);
    ctx.ui.setWorkingIndicator(owned.indicator);
    ctx.ui.setHiddenThinkingLabel(label);
    return "OMT thinking on.";
  }

  return {
    on,
    off,
    isEnabled(): boolean {
      return enabled;
    },
    applyTheme(ctx: ExtensionContext): void {
      const active = getActiveTheme();
      if (active.id === "native") {
        if (owned) {
          const current = presentation(ctx);
          if (current) {
            if (current.message === owned.message) ctx.ui.setWorkingMessage(owned.previous.message);
            if (current.indicator === owned.indicator) ctx.ui.setWorkingIndicator(owned.previous.indicator);
            if (current.hiddenThinkingLabel === owned.label) ctx.ui.setHiddenThinkingLabel(owned.previous.hiddenThinkingLabel);
          }
          owned = undefined;
        }
        return;
      }
      if (enabled) {
        const label = active.thinking.label;
        const frames = indicator();
        const current = presentation(ctx);
        if (current && owned && isOwner(current)) {
          owned.indicator = frames;
          owned.label = label;
          currentContext = ctx;
          const message = usesWorkingPhases() ? phase : "Working";
          owned.message = message;
          ctx.ui.setWorkingMessage(message);
          ctx.ui.setWorkingIndicator(frames);
          ctx.ui.setHiddenThinkingLabel(label);
          update(ctx);
        } else {
          on(ctx);
        }
      }
    },
    cleanup(ctx: ExtensionContext) {
      off(ctx);
      running.clear();
      restoreRender?.();
      currentContext = undefined;
    },
  };
}
