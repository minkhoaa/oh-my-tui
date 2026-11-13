import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import type { AssistantHost } from "../shared/types.ts";
import { signatureFg } from "./rendering.ts";
import { formatSettledFoot, hasTurnCompletionMetadata, resolveTurnMetadata, type SettledTurnMetadata } from "./message-model.ts";

export interface SignatureAssistantBlock {
  start: number;
  end: number;
  kind: "text" | "thinking" | "native";
  padding: number;
  hasGutter?: boolean;
  boxed?: boolean;
}

/** Insert the gutter at the semantic content origin, after the presentation inset. */
function blockGutter(raw: string, icon: string, padding: number): string {
  const zones = raw.match(/^(?:\x1b\]133;[ABC]\x07)*/)?.[0] ?? "";
  const rest = raw.slice(zones.length);
  const margin = " ".repeat(Math.max(0, padding));
  return rest.startsWith(margin)
    ? `${zones}${margin}${icon} ${rest.slice(margin.length)}`
    : `${icon} ${raw}`;
}

function presentBlocks(lines: string[], blocks: readonly SignatureAssistantBlock[], theme: Theme): string[] {
  const result = [...lines];
  for (const block of blocks) {
    if (block.kind === "native") continue;
    let first = true;
    for (let i = block.start; i < block.end; i++) {
      const raw = lines[i]!;
      if (!stripTerminalSequences(raw).trim()) continue;
      if (first) {
        first = false;
        if (!block.hasGutter) result[i] = blockGutter(raw, signatureFg(theme, "muted", block.kind === "thinking" ? "○" : "●"), block.padding);
      } else if (block.boxed) {
        result[i] = `  ${raw}`;
      }
    }
  }
  return result;
}

export interface MarkdownTransformContext {
  messageType?: string;
  isStreaming?: boolean;
  availableWidth?: number;
  messageId?: string;
  timestamp?: string;
}

/**
 * Reports whether source text opens with a markdown table, fenced code block,
 * or box-drawing border that requires column alignment.
 */
export function startsPreformatted(text: string): boolean {
  const trimmed = text.trimStart();
  return (
    trimmed.startsWith("|") ||
    trimmed.startsWith("```") ||
    trimmed.startsWith("~~~") ||
    trimmed.startsWith("┌") ||
    trimmed.startsWith("╭") ||
    trimmed.startsWith("├") ||
    trimmed.startsWith("│") ||
    trimmed.startsWith("+")
  );
}

/**
 * Transforms Markdown content to give OMT Signature rich, cohesive presentation.
 * Preserves backwards compatibility for any existing transformer callers.
 */
export function signatureMarkdownTransformer(
  markdown: string,
  context?: MarkdownTransformContext,
): string {
  if (!markdown) return markdown;
  const parts = markdown.split(/(```[\s\S]*?```)/g);

  return parts
    .map((part, index) => {
      if (index % 2 === 1) return part;

      let text = part;
      text = text.replace(/^(\s*)[-*]\s+(?!\[[ xX]\])/gm, "$1• ");
      text = text.replace(/^(\s*)[-*]\s+\[ \]\s+/gm, "$1◻ ");
      text = text.replace(/^(\s*)[-*]\s+\[[xX]\]\s+/gm, "$1✔ ");
      text = text.replace(/^>\s+\[!(NOTE|INFO)\]/gim, "> ℹ **$1**");
      text = text.replace(/^>\s+\[!(WARNING|CAUTION)\]/gim, "> ⚠ **$1**");
      text = text.replace(/^>\s+\[!(TIP|SUCCESS)\]/gim, "> 💡 **$1**");
      text = text.replace(/^>\s+\[!(ERROR|DANGER)\]/gim, "> ✖ **$1**");

      return text;
    })
    .join("");
}

/**
 * Formats OMT Signature per native content block, retaining Markdown and terminal zones.
 * Preserves native Markdown caches and streaming tokens by avoiding in-place mutation of input lines.
 */
export function signatureAssistant(
  lines: string[],
  host: AssistantHost,
  theme: Theme,
  width: number,
  options?: { metadata?: SettledTurnMetadata; proseOffset?: number; blocks?: readonly SignatureAssistantBlock[] },
): string[] {
  if (lines.length === 0 || width < 10) return [...lines];

  const firstIdx = lines.findIndex((ln) => stripTerminalSequences(ln).trim().length > 0);
  if (firstIdx < 0) return [...lines];

  const icon = signatureFg(theme, "muted", "●");
  const thinkIcon = signatureFg(theme, "muted", "○");
  const result: string[] = options?.blocks ? presentBlocks(lines, options.blocks, theme) : [];

  if (!options?.blocks) {
  // Legacy pure-line callers retain their explicit single thinking/prose split.
  // Native components use per-child blocks: thinking/text may alternate repeatedly.
  // Determine prose split offset
  let proseStart = typeof options?.proseOffset === "number" && options.proseOffset >= 0
    ? options.proseOffset
    : -1;

  if (proseStart < 0) {
    // If not explicitly provided, detect if the first line is thinking
    const firstClean = stripTerminalSequences(lines[firstIdx]!).trim();
    if (firstClean.startsWith("○") || firstClean.includes("○")) {
      // Find the blank separator line after thinking
      const sepIdx = lines.findIndex((ln, idx) => idx > firstIdx && stripTerminalSequences(ln).trim().length === 0);
      proseStart = sepIdx >= 0 ? sepIdx + 1 : lines.length;
    } else {
      proseStart = 0;
    }
  }

  // Preserve leading blank lines prior to first content
  for (let i = 0; i < firstIdx; i++) {
    result.push(lines[i]!);
  }

  // Process thinking section if present (firstIdx .. proseStart - 1)
  let firstThinkingDone = false;
  const thinkingEnd = Math.min(lines.length, proseStart > 0 ? proseStart : 0);
  for (let i = firstIdx; i < thinkingEnd; i++) {
    const raw = lines[i]!;
    const clean = stripTerminalSequences(raw);
    if (clean.trim().length === 0) {
      result.push(raw);
      continue;
    }
    if (!firstThinkingDone) {
      firstThinkingDone = true;
      if (clean.includes("○")) {
        result.push(raw);
      } else {
        result.push(`${thinkIcon} ${raw}`);
      }
    } else {
      result.push(raw);
    }
  }

  // Process prose section if present (proseStart .. lines.length - 1)
  const actualProseStart = Math.max(firstIdx, proseStart);
  let firstProseIdx = -1;
  let boxed = false;

  for (let i = actualProseStart; i < lines.length; i++) {
    const raw = lines[i]!;
    const clean = stripTerminalSequences(raw);
    if (clean.trim().length === 0) {
      result.push(raw);
      continue;
    }
    if (firstProseIdx < 0) {
      firstProseIdx = i;
      boxed = startsPreformatted(clean);
      result.push(`${icon} ${raw}`);
    } else if (boxed) {
      result.push(`  ${raw}`);
    } else {
      result.push(raw);
    }
  }

  }

  // Settled-turn footer:
  // "  ▣ <model> · <thinking> · <duration> · done <time>"
  // Gated to actual turn-completion metadata; historical resumed messages have no badge.
  // Suppressed while streaming or during pending intermediate tool calls.
  if (!host.hasToolCalls && !host.isStreaming) {
    const resolved = resolveTurnMetadata(host.lastMessage ?? host);
    const fallbackModel = host.lastMessage?.model ?? (typeof (host as any).model === "string" ? (host as any).model : undefined);
    const effectiveMeta: SettledTurnMetadata = {
      ...resolved,
      ...options?.metadata,
      model: options?.metadata?.model ?? resolved?.model ?? fallbackModel,
    };
    if (hasTurnCompletionMetadata(effectiveMeta)) {
      // Reserve 4 cells for the "  ▣ " prefix so the line strictly fits within available width
      const footStr = formatSettledFoot(effectiveMeta, Math.max(0, width - 4));
      if (footStr) {
        const marker = signatureFg(theme, "accent", "  ▣");
        const footStyled = signatureFg(theme, "muted", footStr);

        // Cleanly trim any trailing empty lines before appending the blank separator row and footer
        while (
          result.length > 0 &&
          stripTerminalSequences(result[result.length - 1]!).trim().length === 0
        ) {
          result.pop();
        }

        result.push("", `${marker} ${footStyled}`);
      }
    }
  }

  return result;
}
