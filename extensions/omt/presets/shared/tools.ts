import type { ToolRenderers } from "@earendil-works/pi-coding-agent";
import { isCodexTheme, isOpenCodeTheme, isClaudeTheme, isSignatureTheme } from "./style.ts";
import { createCodexToolRenderer } from "../codex-inspired/tools.ts";
import { createOpenCodeToolRenderer } from "../opencode-inspired/tools.ts";
import { createClaudeToolRenderer } from "../claude-code-inspired/tools.ts";
import { createSignatureToolRenderer } from "../omt-signature/tools.ts";
import * as minimal from "../minimal/tools.ts";
export * from "./tool-helpers.ts";
export { createCleanCustomToolRenderer, formatCustomCallDetail } from "./custom-tools.ts";
function tool(name: string, fallback: ToolRenderers): ToolRenderers {
  const codex = createCodexToolRenderer(name),
    opencode = createOpenCodeToolRenderer(name),
    claude = createClaudeToolRenderer(name),
    signature = createSignatureToolRenderer(name);
  const active = () =>
    isSignatureTheme()
      ? signature
      : isOpenCodeTheme()
        ? opencode
        : isCodexTheme()
          ? codex
          : isClaudeTheme()
            ? claude
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
