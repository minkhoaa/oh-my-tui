import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SidebarExtractionMetadata } from "../sidebar/model.ts";
import { OmtAdapterStore, type AdapterObservationContext } from "./store.ts";
import type { OmtAdapterState, ReconstructionOptions } from "./types.ts";

export * from "./types.ts";
export * from "./model.ts";
export * from "./store.ts";

/**
 * Public facade to adapt genuine host and session observations into both rich
 * immutable OMT adapter state and backwards-compatible SidebarExtractionMetadata.
 */
export function adaptSidebarMetadata(
  pi: ExtensionAPI | undefined,
  ctx: ExtensionContext,
  options?: ReconstructionOptions,
): SidebarExtractionMetadata & { adapterState: OmtAdapterState } {
  const store = new OmtAdapterStore();

  const commands = typeof pi?.getCommands === "function" ? pi.getCommands() : [];
  const settings = typeof pi?.getSettings === "function" ? pi.getSettings() : undefined;
  const mcpServers = typeof pi?.getMcpServers === "function" ? pi.getMcpServers() : undefined;

  const obsContext: AdapterObservationContext = {
    cwd: ctx.cwd || process.cwd(),
    commands,
    settings,
    mcpServers,
  };

  let rawBranch: unknown[] = [];
  try {
    rawBranch = ctx.sessionManager?.getBranch?.() ?? [];
  } catch {
    rawBranch = [];
  }

  const adapterState = store.reconstructFromBranch(rawBranch, options, obsContext);
  const sectionItems = store.getSectionItems(options);

  const metadata: SidebarExtractionMetadata & { adapterState: OmtAdapterState } = {
    adapterState,
    autoCompact: settings?.compaction?.enabled ?? (ctx.ui as typeof ctx.ui & {
      getNativeCompactionEnabled?(): boolean | undefined;
    })?.getNativeCompactionEnabled?.(),
    todos: sectionItems.todos,
    lsp: sectionItems.lsp,
    skills: sectionItems.skills,
    mcp: sectionItems.mcp,
    plugins: sectionItems.plugins,
    subagents: sectionItems.subagents,
  };

  if (typeof pi?.getCommands === "function") {
    metadata.commands = {
      ext: commands.filter((c) => c.source === "extension").length,
      prompt: commands.filter((c) => c.source === "prompt").length,
      skill: commands.filter((c) => c.source === "skill").length,
    };
  }

  return metadata;
}
