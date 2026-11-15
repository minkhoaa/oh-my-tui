import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { getActiveTheme } from "../../core/theme.ts";
import { isCleanTheme, isRailTheme, isEmberTheme, isSignatureTheme, isObsidianTheme, omtStyle } from "./style.ts";
export interface FooterRenderData {
  outputPad?: number;
  cwd?: string;
  branch: string | null;
  extensionStatuses: string[];
  activity?: {
    type: "tool" | "running";
    name?: string;
    detail?: string;
  };
  contextUsage?: {
    percent: number | null;
    contextWindow: number;
  };
  modelId: string;
  /** Persisted session-wide accounting; never used as current context usage. */
  totalTokens?: number;
  cost?: number;
  provider?: string;
  hasMultipleProviders?: boolean;
  reasoning?: boolean;
  thinkingLevel?: string;
  routedModelId?: string;
  routedThinkingLevel?: string;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  agent?: string;
  hints?: string;
}

export { sanitizeStatusText, formatTokens } from "./footer-format.ts";
export { signatureFooter } from "../omt-signature/footer.ts";
export { obsidianFooter } from "../omt-obsidian/footer.ts";

import { cleanFooter } from "../omt-clean/footer.ts";
import { railFooter } from "../omt-rail/footer.ts";
import { emberFooter } from "../omt-ember/footer.ts";
import { signatureFooter } from "../omt-signature/footer.ts";
import { obsidianFooter } from "../omt-obsidian/footer.ts";
import { minimalFooter } from "../minimal/footer.ts";
export function formatFooterLine(width: number, theme: Theme, data: FooterRenderData): string {
  if (width <= 0) return "";
  if (width < omtStyle.minWidth) return truncateToWidth(data.routedModelId ?? data.modelId, width, "");
  const active = getActiveTheme();
  if (isObsidianTheme(active)) return obsidianFooter(width, theme, data);
  if (isSignatureTheme(active)) return signatureFooter(width, theme, data);
  if (isRailTheme(active)) return railFooter(width, theme, data);
  if (isCleanTheme(active)) return cleanFooter(width, theme, data);
  if (isEmberTheme(active)) return emberFooter(width, theme, data);
  return minimalFooter(width, theme, data);
}
