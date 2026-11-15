import type { ToolRenderers } from "@earendil-works/pi-coding-agent";
import { isCleanTheme, isRailTheme, isEmberTheme, isSignatureTheme, isObsidianTheme } from "./style.ts";
import { createCleanToolRenderer } from "../omt-clean/tools.ts";
import { createRailToolRenderer } from "../omt-rail/tools.ts";
import { createEmberToolRenderer } from "../omt-ember/tools.ts";
import { createSignatureToolRenderer } from "../omt-signature/tools.ts";
import { createObsidianToolRenderer } from "../omt-obsidian/tools.ts";
import * as minimal from "../minimal/tools.ts";
export * from "./tool-helpers.ts";
export { createCleanCustomToolRenderer, formatCustomCallDetail } from "./custom-tools.ts";
function tool(name: string, fallback: ToolRenderers): ToolRenderers {
  const clean = createCleanToolRenderer(name),
    rail = createRailToolRenderer(name),
    ember = createEmberToolRenderer(name),
    signature = createSignatureToolRenderer(name),
    obsidian = createObsidianToolRenderer(name);
  const active = () =>
    isObsidianTheme()
      ? obsidian
      : isSignatureTheme()
        ? signature
        : isRailTheme()
          ? rail
          : isCleanTheme()
            ? clean
            : isEmberTheme()
              ? ember
              : fallback;
  return { renderShell: "self", renderCall: (args, theme, ctx) => active().renderCall!(args, theme, ctx),
    renderResult: (result, options, theme, ctx) => active().renderResult!(result, options, theme, ctx) };
}
export const createCleanReadRenderer = () => tool("read", minimal.createCleanReadRenderer());
export const createCleanWriteRenderer = () => tool("write", minimal.createCleanWriteRenderer());
export const createCleanEditRenderer = () => tool("edit", minimal.createCleanEditRenderer());
export const createCleanBashRenderer = (name = "bash") => tool(name, minimal.createCleanBashRenderer(name));
export const createCleanGrepRenderer = () => tool("grep", minimal.createCleanGrepRenderer());
export const createCleanFindRenderer = () => tool("find", minimal.createCleanFindRenderer());
export const createCleanLsRenderer = () => tool("ls", minimal.createCleanLsRenderer());
