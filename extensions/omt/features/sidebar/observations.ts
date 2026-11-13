// Read-only adapters for public Pi metadata and observed result snapshots.
// Todo normalization follows standard task list formats.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { adaptSidebarMetadata } from "../omt-adapters/index.ts";
import type { SidebarExtractionMetadata } from "./model.ts";

/** No tools, subprocesses, filesystem reads or owner mutation; absent snapshots stay unknown. */
export function readSidebarMetadata(pi: ExtensionAPI | undefined, ctx: ExtensionContext): SidebarExtractionMetadata {
  return adaptSidebarMetadata(pi, ctx);
}
