import type { ExtensionAPI, ExtensionContext, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { getActiveTheme } from "../../core/theme.ts";
import { nativeToolRenderers } from "../../core/native-ui.ts";
import { createCleanReadRenderer, createCleanWriteRenderer, createCleanEditRenderer, createCleanBashRenderer, createCleanGrepRenderer, createCleanFindRenderer, createCleanLsRenderer, createCleanCustomToolRenderer, OMT_TOOL_OWNER, type CustomToolRendererOptions } from "../../presets/shared/tools.ts";
import { ToolGroups, isGroupableTool } from "./groups.ts";
import { createGroupedToolRenderer } from "./group-renderer.ts";
export * from "../../presets/shared/tools.ts";
export interface ToolsControl {
  on(): string;
  off(): string;
  isEnabled(): boolean;
  applyTheme?(): void;
  cleanup?(): void;
  syncSession?(ctx: ExtensionContext): void;
  observeMessage?(message: unknown): void;
  registerCustomTool?(name: string, options?: CustomToolRendererOptions | ToolRenderers): void;
}

export function createToolsControl(pi: ExtensionAPI): ToolsControl {
  if (typeof pi.registerToolRenderer !== "function") {
    const unavailable = () => "OMT tools unavailable: native registerToolRenderer API required.";
    return { on: unavailable, off: unavailable, isEnabled: () => false };
  }
  let enabled = true;
  let expanded = () => false;
  let canGroup = false;
  const groups = new ToolGroups(() => expanded());
  const isNative = nativeToolRenderers();
  const customRenderers = new Map<string, ToolRenderers>();
  const renderers: Record<string, ToolRenderers> = {
    read: createCleanReadRenderer(),
    write: createCleanWriteRenderer(),
    edit: createCleanEditRenderer(),
    bash: createCleanBashRenderer("bash"),
    powershell: createCleanBashRenderer("powershell"),
    grep: createCleanGrepRenderer(),
    find: createCleanFindRenderer(),
    ls: createCleanLsRenderer(),
  };
  for (const [name, renderer] of Object.entries(renderers)) {
    if (isGroupableTool(name)) renderers[name] = createGroupedToolRenderer(name, renderer, groups);
    (renderers[name] as Record<symbol, unknown>)[OMT_TOOL_OWNER] = true;
  }

  pi.registerToolRenderer((name, next) => {
    const downstream = next();
    const active = getActiveTheme();
    if (!enabled || active.id === "native") return downstream;
    if (renderers[name] && isNative(name, downstream)) return renderers[name];
    if (customRenderers.has(name) && (!downstream || isNative(name, downstream))) {
      return customRenderers.get(name)!;
    }
    if (!downstream || isNative(name, downstream)) {
      return createCleanCustomToolRenderer(name);
    }
    return downstream;
  });

  return {
    on() {
      enabled = true;
      const active = getActiveTheme();
      if (active.id === "native") return "OMT tools on (native presentation).";
      return "OMT tools on.";
    },
    off() { enabled = false; return "OMT tools off (native rendering)."; },
    isEnabled: () => enabled,
    applyTheme() { /* dynamic via getActiveTheme() */ },
    cleanup() {
      enabled = false;
      groups.reset(); expanded = () => false; canGroup = false;
      customRenderers.clear();
    },
    syncSession(ctx) {
      canGroup = ctx.hasUI && typeof ctx.ui.getToolsExpanded === "function";
      if (!canGroup) { groups.reset(); expanded = () => false; return; }
      try {
        const messages: unknown[] = [];
        for (const entry of ctx.sessionManager.getBranch()) {
          if (entry.type === "message") messages.push(entry.message);
          else if (entry.type === "custom_message") messages.push({ role: "custom", display: entry.display });
          else if (entry.type === "custom" || entry.type === "compaction" || entry.type === "branch_summary"
            || (entry.type === "usage" && entry.kind === "cache_ember")) messages.push({ role: "custom", display: true });
        }
        groups.seed(messages);
      } catch { groups.reset(); canGroup = false; }
      expanded = () => ctx.hasUI && typeof ctx.ui.getToolsExpanded === "function" ? ctx.ui.getToolsExpanded() : false;
    },
    observeMessage(message) { if (canGroup) groups.observe(message); },
    registerCustomTool(name: string, options?: CustomToolRendererOptions | ToolRenderers) {
      const custom = options && "renderCall" in options
        ? (options as ToolRenderers)
        : createCleanCustomToolRenderer(name, options as CustomToolRendererOptions | undefined);
      (custom as Record<symbol, unknown>)[OMT_TOOL_OWNER] = true;
      customRenderers.set(name, custom);
    },
  };
}
