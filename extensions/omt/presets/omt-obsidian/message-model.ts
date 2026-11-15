import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { signatureFg } from "./rendering.ts";
import { resolveRailGlyph } from "../../core/theme-tokens.ts";

/**
 * OMT Signature transcript and message data model.
 *
 * Presentation-only: does not mutate stored messages or fabricate runtime telemetry.
 */

/** Genuine settled-turn metadata observed from runtime events or turn completion. */
export interface SettledTurnMetadata {
  /** Model display name or identifier. */
  model?: string;
  /** Model thinking level / effort (e.g. "xhigh", "high", "medium", "low"). */
  thinkingLevel?: string;
  /** Elapsed turn duration in milliseconds, only when genuine timing is observed. */
  durationMs?: number;
  /** Settled timestamp (Date or epoch ms), only when genuine observation exists. */
  settledAt?: Date | number;
  /** Optional pre-assembled footer string if supplied directly by an observer. */
  foot?: string;
}

/**
 * Formats a turn duration:
 * - Sub-second durations display milliseconds: "400ms"
 * - Above one second, formats as whole seconds/minutes/hours: "5s", "2m37s", "1h12m".
 */
export function formatTurnDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0s";
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  if (h > 0) return `${h}h${m}m`;
  if (m > 0) return `${m}m${s}s`;
  return `${s}s`;
}

/**
 * Formats settled wall-clock time:
 * "done HH:MM:SS" in local 24-hour time.
 */
export function formatSettledTime(time: Date | number): string {
  const d = typeof time === "number" ? new Date(time) : time instanceof Date ? time : undefined;
  if (!d || !Number.isFinite(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `done ${hh}:${mm}:${ss}`;
}

/**
 * Reports whether settled-turn metadata contains genuine turn-completion observation.
 * A footer is only stamped when turnStart is non-zero, producing genuine duration and done timestamp.
 * A bare message model from session history without turn-completion data must never trigger a footer badge.
 */
export function hasTurnCompletionMetadata(meta?: SettledTurnMetadata): boolean {
  if (!meta) return false;
  if (typeof meta.foot === "string" && meta.foot.trim().length > 0) return true;
  if (typeof meta.durationMs === "number" && Number.isFinite(meta.durationMs) && meta.durationMs >= 0) return true;
  if (meta.settledAt !== undefined) {
    const d = typeof meta.settledAt === "number" ? new Date(meta.settledAt) : meta.settledAt instanceof Date ? meta.settledAt : undefined;
    if (d && Number.isFinite(d.getTime())) return true;
  }
  return false;
}

/**
 * Formats settled-turn metadata matching OMT's footer assembly:
 * "<model> · <thinkingLevel> · <duration> · done <time>".
 *
 * Omits any field that was not genuinely provided. Never fabricates duration or time.
 * Gated to actual turn-completion metadata; returns empty string if metadata lacks turn completion.
 */
export function formatSettledFoot(
  meta?: SettledTurnMetadata,
  availableWidth?: number,
): string {
  if (!meta || !hasTurnCompletionMetadata(meta)) return "";
  if (typeof meta.foot === "string" && meta.foot.trim().length > 0) {
    const raw = meta.foot.trim();
    return availableWidth !== undefined && availableWidth > 0
      ? truncateToWidth(raw, availableWidth, "…")
      : raw;
  }

  const parts: string[] = [];

  const model = meta.model?.trim();
  if (model && model !== "…") {
    parts.push(model);
  }

  const thinkingLevel = meta.thinkingLevel?.trim();
  if (thinkingLevel) {
    parts.push(thinkingLevel);
  }

  if (typeof meta.durationMs === "number" && Number.isFinite(meta.durationMs) && meta.durationMs >= 0) {
    parts.push(formatTurnDuration(meta.durationMs));
  }

  if (meta.settledAt !== undefined) {
    const timeStr = formatSettledTime(meta.settledAt);
    if (timeStr) parts.push(timeStr);
  }

  if (parts.length === 0) return "";
  const assembled = parts.join(" · ");
  return availableWidth !== undefined && availableWidth > 0
    ? truncateToWidth(assembled, availableWidth, "…")
    : assembled;
}

/** Callback shape for resolving metadata without mutating Pi stored messages. */
export type TurnMetadataResolver = (target: unknown) => SettledTurnMetadata | undefined;

let activeTurnMetadataResolver: TurnMetadataResolver | undefined;

/** Registers an optional local metadata resolver for parent integration. */
export function setTurnMetadataResolver(resolver: TurnMetadataResolver | undefined): void {
  activeTurnMetadataResolver = resolver;
}

/** Returns the current turn metadata resolver, if registered. */
export function getTurnMetadataResolver(): TurnMetadataResolver | undefined {
  return activeTurnMetadataResolver;
}

/**
 * Resolves settled-turn metadata from a host or message target without mutation.
 */
export function resolveTurnMetadata(target: unknown): SettledTurnMetadata | undefined {
  if (!target || typeof target !== "object") return undefined;

  const candidate = target as Record<string, unknown>;
  // Explicit turnMetadata property on host or message
  if (candidate.turnMetadata && typeof candidate.turnMetadata === "object") {
    const tm = candidate.turnMetadata as SettledTurnMetadata;
    if (hasTurnCompletionMetadata(tm)) return tm;
  }

  // Active external resolver if configured by parent/integrator
  if (activeTurnMetadataResolver) {
    const resolved = activeTurnMetadataResolver(target);
    if (resolved && hasTurnCompletionMetadata(resolved)) return resolved;
  }

  // Inspect host or message properties
  const lastMsg = candidate.lastMessage as Record<string, unknown> | undefined;

  const durationMs = typeof candidate.durationMs === "number"
    ? candidate.durationMs
    : typeof lastMsg?.durationMs === "number"
      ? lastMsg.durationMs
      : undefined;

  const settledAt = candidate.settledAt instanceof Date || typeof candidate.settledAt === "number"
    ? candidate.settledAt
    : lastMsg?.settledAt instanceof Date || typeof lastMsg?.settledAt === "number"
      ? lastMsg.settledAt
      : undefined;

  const foot = typeof candidate.foot === "string"
    ? candidate.foot
    : typeof lastMsg?.foot === "string"
      ? lastMsg.foot
      : undefined;

  // Gate historical footer to actual turn-completion metadata: a message or host with only
  // model/thinking and zero turn-completion data must never resolve as a settled turn footer.
  if (durationMs !== undefined || settledAt !== undefined || (foot && foot.trim().length > 0)) {
    const model = typeof candidate.model === "string"
      ? candidate.model
      : typeof lastMsg?.model === "string"
        ? lastMsg.model
        : undefined;

    const thinkingLevel = typeof candidate.thinkingLevel === "string"
      ? candidate.thinkingLevel
      : typeof lastMsg?.thinkingLevel === "string"
        ? lastMsg.thinkingLevel
        : typeof candidate.providerThinkingLevel === "string"
          ? candidate.providerThinkingLevel
          : typeof lastMsg?.providerThinkingLevel === "string"
            ? lastMsg.providerThinkingLevel
            : undefined;

    return { model, thinkingLevel, durationMs, settledAt, foot };
  }

  return undefined;
}

/**
 * Recognizable transcript message kinds in OMT and Pi.
 */
export type SignatureMessageKind =
  | "user"
  | "assistant"
  | "thinking"
  | "tool"
  | "bash"
  | "compaction"
  | "branch"
  | "costnotice"
  | "tree"
  | "session"
  | "notice"
  | "custom"
  | "system"
  | "tool-grouping"
  | "unknown";

/** Presentation delegation policy for transcript message kinds. */
export type DelegationPolicy =
  | "signature-custom"
  | "native-delegated"
  | "adapted"
  | "blocked";

export interface MessageKindContract {
  readonly kind: SignatureMessageKind;
  readonly policy: DelegationPolicy;
  readonly description: string;
  readonly sourceSymbol: string;
}

const MESSAGE_CONTRACTS: Record<SignatureMessageKind, MessageKindContract> = {
  user: {
    kind: "user",
    policy: "signature-custom",
    sourceSymbol: "omt:signature:user",
    description: "Rounded border frame with cBorder, padding(0, 1), and gutterBox bullet icon.",
  },
  assistant: {
    kind: "assistant",
    policy: "signature-custom",
    sourceSymbol: "omt:signature:assistant",
    description: "Gutter bullet icon on first non-empty line, gutterBox on preformatted starts, settled turn foot.",
  },
  thinking: {
    kind: "thinking",
    policy: "signature-custom",
    sourceSymbol: "omt:signature:thinking",
    description: "Subdued reasoning aside with circle bullet (○), preserving native collapsible interaction.",
  },
  tool: {
    kind: "tool",
    policy: "signature-custom",
    sourceSymbol: "omt:signature:tool",
    description: "Compact tool execution card with status bullet, formatted arguments, diff highlight, and full native expansion.",
  },
  bash: {
    kind: "bash",
    policy: "adapted",
    sourceSymbol: "omt:signature:bash",
    description: "Direct shell execution output adapted to Pi's per-tool renderers and execution model.",
  },
  compaction: {
    kind: "compaction",
    policy: "native-delegated",
    sourceSymbol: "omt:signature:compaction",
    description: "Safely delegates to native Pi's compaction-summary-message renderer without replacing global summary history.",
  },
  branch: {
    kind: "branch",
    policy: "native-delegated",
    sourceSymbol: "omt:signature:branch",
    description: "Safely delegates to native Pi's branch-summary-message renderer without replacing session tree state.",
  },
  costnotice: {
    kind: "costnotice",
    policy: "native-delegated",
    sourceSymbol: "omt:signature:costnotice",
    description: "Delegates to native Pi interactive mode notice rendering.",
  },
  tree: {
    kind: "tree",
    policy: "native-delegated",
    sourceSymbol: "omt:signature:tree",
    description: "Delegates to native Pi session tree view component.",
  },
  session: {
    kind: "session",
    policy: "native-delegated",
    sourceSymbol: "omt:signature:session",
    description: "Delegates to native Pi session management view component.",
  },
  notice: {
    kind: "notice",
    policy: "native-delegated",
    sourceSymbol: "omt:signature:notice",
    description: "Delegates to native Pi notification and alert system.",
  },
  custom: {
    kind: "custom",
    policy: "native-delegated",
    sourceSymbol: "omt:signature:custom",
    description: "Delegates to extension-registered message renderers.",
  },
  system: {
    kind: "system",
    policy: "native-delegated",
    sourceSymbol: "omt:signature:system",
    description: "Delegates system prompts and session configuration to native Pi.",
  },
  "tool-grouping": {
    kind: "tool-grouping",
    policy: "blocked",
    sourceSymbol: "omt:signature:tool-grouping",
    description: "Cross-row tool call grouping is blocked by missing public host transcript composition APIs.",
  },
  unknown: {
    kind: "unknown",
    policy: "native-delegated",
    sourceSymbol: "omt:signature:unknown",
    description: "Safely passes unknown message kinds to native Pi rendering.",
  },
};

/** Classifies a role or kind string into the canonical Signature message kind. */
export function classifyMessage(roleOrKind?: string): SignatureMessageKind {
  if (!roleOrKind || typeof roleOrKind !== "string") return "unknown";
  const norm = roleOrKind.trim().toLowerCase();
  switch (norm) {
    case "user":
      return "user";
    case "assistant":
      return "assistant";
    case "thinking":
    case "thought":
    case "reasoning":
      return "thinking";
    case "tool":
    case "toolcall":
    case "toolresult":
      return "tool";
    case "bash":
    case "bashexecution":
      return "bash";
    case "compaction":
    case "compactionsummary":
      return "compaction";
    case "branch":
    case "branchsummary":
      return "branch";
    case "costnotice":
      return "costnotice";
    case "tree":
      return "tree";
    case "session":
      return "session";
    case "notice":
      return "notice";
    case "custom":
      return "custom";
    case "system":
      return "system";
    case "tool-grouping":
    case "toolgroup":
      return "tool-grouping";
    default:
      return "unknown";
  }
}

/** Reports whether a message kind safely delegates to native Pi rendering. */
export function isDelegatedToNative(kind: string): boolean {
  const classified = classifyMessage(kind);
  const contract = MESSAGE_CONTRACTS[classified];
  return contract.policy === "native-delegated";
}

/** Retrieves the explicit contract specification for a message kind. */
export function getMessageContract(kind: string): MessageKindContract {
  const classified = classifyMessage(kind);
  return MESSAGE_CONTRACTS[classified];
}

/** Returns all message kind contracts for auditing and documentation. */
export function getAllMessageContracts(): MessageKindContract[] {
  return Object.values(MESSAGE_CONTRACTS);
}

/**
 * Reports whether source text begins with preformatted content:
 * Markdown tables (`|`), fenced code blocks (` ``` `), or box-drawing characters (`┌`, `╭`, etc.).
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
 * Pure gutter formatting:
 * - First non-empty line gets `${icon} ${line}`.
 * - If `boxed`: continuation lines get `"  " + line` (2-cell gutter alignment).
 * - If not `boxed`: continuation lines remain flush-left (`line`).
 * - Empty separator lines remain empty `""`.
 */
export function applyGutter(lines: string[], icon: string, boxed: boolean): string[] {
  if (lines.length === 0) return lines;
  const result: string[] = [];
  let firstFound = false;

  for (const line of lines) {
    const clean = stripTerminalSequences(line);
    if (clean.trim().length === 0) {
      result.push(line);
      continue;
    }
    if (!firstFound) {
      result.push(`${icon} ${line}`);
      firstFound = true;
    } else if (boxed) {
      result.push(`  ${line}`);
    } else {
      result.push(line);
    }
  }

  return result;
}

/**
 * Returns the safe native reasoning presentation label for OMT Signature.
 *   - Collapsed thinking displays statusBarStyle "○" (cMuted) followed by
 *     thinkStyle (cBorder italic) rendering Short(t, 160) where t is capped
 *     at 300 chars and newlines are flattened to " ⏎ ".
 *   - When no thinking text is available (e.g. at initial prompt streaming),
 *     falls back to "Reasoning…" or "Thought".
 */
export function signatureThinkingLabel(
  theme: Theme,
  isStreaming: boolean,
  thinkingText?: string,
): string {
  const spine = signatureFg(theme, isStreaming ? "cyan" : "muted", resolveRailGlyph("block"));
  const raw = thinkingText;
  let previewText: string;

  if (raw && raw.trim().length > 0) {
    let t = raw;
    if (t.length > 300) {
      t = t.slice(0, 300) + "…";
    }
    const flattened = t.replace(/\r\n?/g, "\n").replace(/\n/g, " ⏎ ");
    previewText = visibleWidth(flattened) <= 160
      ? flattened
      : truncateToWidth(flattened, 160, "…");
  } else {
    previewText = isStreaming ? "Reasoning…" : "Thought";
  }

  const styled = typeof theme.italic === "function" ? theme.italic(previewText) : previewText;
  const styledLabel = signatureFg(theme, "border", styled);
  return `${spine} ${styledLabel}`;
}
