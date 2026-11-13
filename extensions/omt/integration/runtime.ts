import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createEditorControl } from "../features/editor/index.ts";
import { createUserMessageControl } from "../features/user-message/index.ts";
import { createToolsControl } from "../features/tools/index.ts";
import { createFooterControl } from "../features/footer/index.ts";
import { createThinkingControl } from "../features/thinking/index.ts";
import { createBackgroundControl } from "../features/backgrounds/integration.ts";
import { createHeaderControl, OMT_HEADER_OWNER } from "../features/header/index.ts";
import { createSidebarControl } from "../features/sidebar/index.ts";
import { FleetStore } from "../features/agent-fleet/store.ts";

import { observeNativeUIOwnership, installNativeStartupPresentation, installNativeHeaderPresentation } from "../core/native-ui.ts";
import { THEME_NAMES, THEME_PRESETS, resolveThemeName } from "../presets/index.ts";
import { getActiveTheme, resetActiveTheme, setActiveTheme } from "../core/theme.ts";
import { configStore } from "../core/config.ts";
import { getActiveTui, setActiveTui, motionCoordinator } from "../core/motion.ts";

import { ComposerStash } from "../features/advanced-composer/store.ts";
import { PromptQueueStore } from "../features/prompt-queue/store.ts";

import { notificationStore } from "../features/smart-notifications/store.ts";
import { createToastControl } from "../features/smart-notifications/toasts.ts";
import { accessibilityStore } from "../features/accessibility/model.ts";

import { resetLayoutMode } from "../features/adaptive-layout/index.ts";

import { createDialogs } from "./dialogs.ts";
import { createHostThemeControl } from "./host-theme.ts";
import { registerCommands } from "./commands.ts";
import { withFallback } from "./status.ts";
import { createSidebarActions } from "./sidebar-actions.ts";
import { signatureCommandPresentation } from "./command-presentation.ts";
import { createSignatureLayoutControl, type SidebarDockFactory } from "./layout.ts";
import { setTurnMetadataResolver, type SettledTurnMetadata } from "../presets/omt-signature/message-model.ts";

export default function omt(pi: ExtensionAPI) {
  pi.registerFlag("omt-theme", {
    description: `Override saved OMT presentation (${THEME_NAMES.join(", ")}); runtime-local`,
    type: "string",
  });
  const restoreOwnership = observeNativeUIOwnership(event => toasts.receive(event));
  const editor = createEditorControl();
  editor.setSubmitPresentation?.(text => signatureCommandPresentation(pi, text));
  let currentContext: ExtensionContext | undefined;
  let restoreStartup: (() => void) | undefined;
  let restoreHeader: (() => void) | undefined;
  const messages = createUserMessageControl(() => {
    try {
      return currentContext?.ui?.theme;
    } catch {
      return undefined as any;
    }
  });
  const tools = createToolsControl(pi);
  const footer = createFooterControl(pi);
  const thinking = createThinkingControl(pi);
  const background = createBackgroundControl();
  const header = createHeaderControl(pi);
  const sidebar = createSidebarControl(pi);
  const fleet = new FleetStore();
  let fleetDock: import("../features/sidebar/view.ts").SidebarDockComponent | undefined;
  const unsubscribeFleet = [
    pi.events?.on?.("subagent:async-started", (event: unknown) => {
      if (fleet.observeAsyncStarted(event)) getActiveTui()?.requestRender?.();
    }),
    pi.events?.on?.("subagent:child-status", (event: unknown) => {
      if (fleet.observeChildStatus(event)) getActiveTui()?.requestRender?.();
    }),
    pi.events?.on?.("subagent:async-complete", (event: unknown) => {
      if (fleet.observeCompletion(event)) getActiveTui()?.requestRender?.();
    }),
    pi.events?.on?.("subagent:foreground-complete", (event: unknown) => {
      if (fleet.observeCompletion(event)) getActiveTui()?.requestRender?.();
    }),
  ].filter((unsubscribe): unsubscribe is () => void => typeof unsubscribe === "function");
  const layout = createSignatureLayoutControl(sidebar, async () => {
    const view = await import("../features/sidebar/view.ts");
    const factory = (view as unknown as { createSidebarDockComponent?: SidebarDockFactory }).createSidebarDockComponent;
    if (!factory) return undefined;
    return (tui, theme, keys, ctx, options) => {
      const dock = view.createSidebarDockComponent(tui, theme, keys, ctx, {
        ...options, getFleetChildren: () => fleet.snapshot(), ...createSidebarActions(pi, ctx, () => layout.isMounted()),
      });
      fleetDock = dock;
      return dock;
    };
  });
  const hostTheme = createHostThemeControl();
  const toasts = createToastControl(() => layout.isMounted());
  const signatureActive = () => getActiveTheme().id === "omt-signature"
    && ["editor", "messages", "tools", "footer", "thinking"].some(
      name => configStore.isComponentEnabled(name as "editor" | "messages" | "tools" | "footer" | "thinking"));
  const refreshHostTheme = (ctx: ExtensionContext, claim = false) => hostTheme.refresh(ctx, signatureActive(), claim);
  const refreshLayout = (ctx: ExtensionContext) => {
    refreshHostTheme(ctx);
    toasts.refresh(ctx, signatureActive());
    return layout.refresh(ctx);
  };
  editor.setStatuslineProvider?.(() => {
    const ctx = currentContext;
    if (!ctx) return undefined;
    const usage = footer.getUsage?.(ctx);
    const context = ctx.getContextUsage?.();
    return { model: ctx.model?.id ?? ctx.model?.name, totalTokens: usage?.totalTokens, cost: usage?.cost,
      contextUsage: context ? { percent: context.percent, contextWindow: context.contextWindow } : undefined,
      isThinking: !(ctx.isIdle?.() ?? true) };
  });
  const observedTurns = new Map<string, SettledTurnMetadata>();
  let turnStarted: number | undefined;
  let lastAssistant: any;
  let observedThinking: string | undefined;
  const messageKey = (message: any) => message?.role === "assistant" && typeof message.timestamp === "number"
    ? JSON.stringify([message.timestamp, message.provider, message.model]) : undefined;
  const resolveObserved = (message: unknown) => {
    const key = messageKey(message);
    return key ? observedTurns.get(key) : undefined;
  };
  setTurnMetadataResolver(resolveObserved);

  // Singletons for composer scratchpad and prompt queue
  const composerStash = new ComposerStash();
  const promptQueueStore = new PromptQueueStore();

  function activateComponents(ctx: ExtensionContext): string[] {
    const results: string[] = [];
    for (const [name, control] of Object.entries({ editor, messages, tools, footer, thinking })) {
      if (configStore.isComponentEnabled(name as "editor" | "messages" | "tools" | "footer" | "thinking")) {
        results.push(control.on(ctx));
      } else {
        control.off(ctx);
      }
    }
    const hostIssue = refreshHostTheme(ctx, true);
    if (hostIssue) results.push(hostIssue);
    toasts.refresh(ctx, signatureActive());
    return results.filter((result) => / unavailable:| inactive:/.test(result));
  }

  function applyTheme(name: string, ctx: ExtensionContext, options?: { sessionOnly?: boolean }): string {
    const resolved = resolveThemeName(name);
    const preset = resolved ? THEME_PRESETS[resolved] : undefined;
    if (!preset) {
      return `Unknown theme: ${name}. Available themes: ${THEME_NAMES.join(", ")}`;
    }
    setActiveTheme(resolved!);
    if (options?.sessionOnly) {
      configStore.setPresetOverride(resolved!);
    } else {
      configStore.setPreset(resolved!);
    }
    editor.applyTheme(ctx);
    header.applyTheme(ctx);
    thinking.applyTheme(ctx);
    const issues = activateComponents(ctx);
    background.applyTheme(ctx);
    if (resolved === "native") {
      sidebar.off(ctx);
      void refreshLayout(ctx);
      return "OMT theme set to native (native presentation restored).";
    }
    if (resolved === "omt-signature") {
      sidebar.on(ctx);
    }
    void refreshLayout(ctx);
    getActiveTui()?.requestRender?.();
    return withFallback(`OMT theme set to ${resolved}.`, issues);
  }

  const services = { pi, editor, messages, tools, footer, thinking, background, sidebar, header, composerStash, promptQueueStore, applyTheme, activateComponents, refreshLayout, refreshHostTheme };
  const dialogs = createDialogs(services);
  registerCommands(pi, services, dialogs);

  // ==========================================
  // Lifecycle Handlers
  // ==========================================

  pi.on("session_start", async (_event, ctx) => {
    restoreStartup?.(); restoreStartup = undefined;
    restoreHeader?.(); restoreHeader = undefined;
    layout.cleanup();
    background.cleanup(currentContext);
    hostTheme.cleanup(currentContext);
    motionCoordinator.clear();
    currentContext = ctx;
    observedTurns.clear(); turnStarted = undefined; lastAssistant = undefined;
    setTurnMetadataResolver(resolveObserved);
    fleet.reset();
    sidebar.observe?.("session_start");
    configStore.init();
    tools.syncSession?.(ctx);
    motionCoordinator.setRenderCallback(() => {
      toasts.tick();
      const tui = getActiveTui();
      if (tui && typeof tui.requestRender === "function") {
        try {
          tui.requestRender();
        } catch {}
      }
      background.requestRender();
    });

    const requested = pi.getFlag("omt-theme");
    resetActiveTheme();
    const saved = configStore.getPreset();
    const initial = requested === undefined ? saved : resolveThemeName(String(requested));
    setActiveTheme(initial ?? saved);
    if (requested !== undefined && initial) configStore.setPresetOverride(initial);
    if (!initial && ctx.hasUI) {
      ctx.ui.notify(`Unknown OMT startup theme: ${requested}. Using ${saved}.`, "warning");
    }

    const issues = activateComponents(ctx);
    header.on(ctx);
    restoreStartup = installNativeStartupPresentation(ctx.ui, () => getActiveTheme().id === "omt-signature" && header.isEnabled()
      && !!(ctx.ui as any).getHeaderComponent?.()?.[OMT_HEADER_OWNER]);
    restoreHeader = installNativeHeaderPresentation(ctx.ui, () => getActiveTheme().id === "omt-signature" && header.isEnabled()
      && !!(ctx.ui as any).getHeaderComponent?.()?.[OMT_HEADER_OWNER], { compact: true });
    if (ctx.mode === "tui" && getActiveTheme().id !== "native" && issues.length) {
      ctx.ui.notify(withFallback(`OMT theme: ${getActiveTheme().id}.`, issues), "warning");
    }

    if (configStore.isBackgroundEnabled()) background.on(ctx);
    else background.off(ctx);
    if (getActiveTheme().id === "omt-signature" && configStore.getSignature().surface !== "transparent") background.applyTheme(ctx);

    if (getActiveTheme().id === "omt-signature") {
      sidebar.on(ctx);
    }
    await refreshLayout(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    toasts.cleanup();
    restoreStartup?.(); restoreStartup = undefined;
    restoreHeader?.(); restoreHeader = undefined;
    layout.cleanup();
    fleetDock = undefined;
    motionCoordinator.dispose();
    setActiveTui(undefined);
    editor.cleanup?.(ctx);
    messages.cleanup?.();
    tools.cleanup?.();
    footer.cleanup?.(ctx);
    header.cleanup(ctx);
    thinking.cleanup(ctx);
    background.cleanup(ctx);
    sidebar.cleanup?.(ctx);
    fleet.reset();
    for (const unsubscribe of unsubscribeFleet) unsubscribe();
    hostTheme.cleanup(ctx);
    restoreOwnership?.();
    currentContext = undefined;
    observedTurns.clear(); setTurnMetadataResolver(undefined);
    resetActiveTheme();
    resetLayoutMode();
    accessibilityStore.reset();
    dialogs.reset();
    composerStash.clear();
    promptQueueStore.clear();
    notificationStore.clear();
    configStore.clearSessionOverrides();
  });

  pi.on("ui_prompt_start", () => { toasts.setBlocked(true); });
  pi.on("ui_prompt_end", () => { toasts.setBlocked(false); });

  pi.on("agent_start", (event) => {
    turnStarted = performance.now(); lastAssistant = undefined;
    observedThinking = pi.getThinkingLevel?.();
    sidebar.observe?.("agent_start", event);
  });
  pi.on("session_compact", (_event, ctx) => { tools.syncSession?.(ctx); });
  pi.on("session_tree", (event, ctx) => {
    currentContext = ctx; turnStarted = undefined; lastAssistant = undefined;
    tools.syncSession?.(ctx);
    sidebar.observe?.("session_tree", event);
  });
  pi.on("tool_execution_start", (event) => {
    if (fleet.observeToolExecution(event, true)) getActiveTui()?.requestRender?.();
    sidebar.observe?.("tool_execution_start", event);
    motionCoordinator.register(`tool:${event.toolCallId}`);
    background.notifyActivityStart();
  });
  pi.on("tool_execution_end", (event) => {
    if (fleet.observeToolExecution(event, false)) getActiveTui()?.requestRender?.();
    motionCoordinator.unregister(`tool:${event.toolCallId}`);
    background.notifyActivityEnd();
    // Non-intrusively record notification
    if (event.isError) {
      notificationStore.push(`Tool ${event.toolName} failed`, "error");
    } else {
      notificationStore.push(`Tool ${event.toolName} completed`, "success");
    }
  });
  pi.on("message_update", (event) => {
    tools.observeMessage?.(event.message);
    sidebar.observe?.("message_update", event);
    if (event.message.role !== "assistant") return;
    const type = event.assistantMessageEvent.type;
    if (
      type === "text_start" ||
      type === "text_delta" ||
      type === "thinking_start" ||
      type === "thinking_delta" ||
      type === "toolcall_start" ||
      type === "toolcall_delta"
    ) {
      if (configStore.isComponentEnabled("thinking") && getActiveTheme().id !== "native") {
        motionCoordinator.register("assistant:stream");
      }
      if (type === "text_start" || type === "thinking_start" || type === "toolcall_start") {
        background.notifyActivityStart();
      }
    } else if (type === "text_end" || type === "thinking_end" || type === "toolcall_end") {
      motionCoordinator.unregister("assistant:stream");
      background.notifyActivityEnd();
    }
  });
  pi.on("message_end", (event) => {
    tools.observeMessage?.(event.message);
    sidebar.observe?.("message_end", event);
    if (event.message.role === "assistant") lastAssistant = event.message;
    motionCoordinator.unregister("assistant:stream");
    background.notifySettled();
  });
  pi.on("agent_settled", (event) => {
    sidebar.observe?.("agent_settled", event);
    const key = messageKey(lastAssistant);
    if (key && turnStarted !== undefined) {
      observedTurns.set(key, { model: lastAssistant.model, thinkingLevel: lastAssistant.thinkingLevel ?? observedThinking,
        durationMs: performance.now() - turnStarted, ...(lastAssistant.stopReason === "stop" ? { settledAt: Date.now() } : {}) });
      while (observedTurns.size > 1000) observedTurns.delete(observedTurns.keys().next().value!);
      getActiveTui()?.requestRender?.();
    }
    turnStarted = undefined;
    motionCoordinator.clearTransient();
    background.notifySettled();
  });

}
