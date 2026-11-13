import type { ComposerDraft, ComposerMetrics } from "./types.ts";

export function calculateComposerMetrics(
  text: string,
  currentLine?: number,
  hasStashOrOptions?: boolean | { hasStash?: boolean; stashCount?: number },
): ComposerMetrics {
  const normalized = text ?? "";
  const linesList = normalized.length === 0 ? [""] : normalized.split(/\r\n|\r|\n/);
  const lines = linesList.length;
  const chars = normalized.length;
  const estimatedTokens = chars === 0 ? 0 : Math.ceil(chars / 4);
  const isMultiLine = lines > 1;
  const clampedLine = Math.max(1, Math.min(lines, currentLine ?? 1));

  let hasStash = false;
  if (typeof hasStashOrOptions === "boolean") {
    hasStash = hasStashOrOptions;
  } else if (hasStashOrOptions && typeof hasStashOrOptions === "object") {
    hasStash = Boolean(
      hasStashOrOptions.hasStash || (hasStashOrOptions.stashCount ?? 0) > 0,
    );
  }

  return {
    lines,
    currentLine: clampedLine,
    chars,
    estimatedTokens,
    isMultiLine,
    hasStash,
  };
}

/**
 * In-memory Stash / Scratchpad manager for composer drafts.
 * Supports LIFO (stack) and FIFO operations, peek, clear, and retrieval.
 */
export class ComposerStash {
  private drafts: ComposerDraft[] = [];

  constructor(initialDrafts: ComposerDraft[] = []) {
    this.drafts = initialDrafts.map((d) => ({ ...d }));
  }

  stash(text: string, title?: string): ComposerDraft {
    const trimmed = text ?? "";
    const cleanTitle = title?.trim() || this.generateDefaultTitle(trimmed);
    const draft: ComposerDraft = {
      id: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      text: trimmed,
      timestamp: Date.now(),
      title: cleanTitle,
    };
    this.drafts.push(draft);
    return draft;
  }

  pop(mode: "lifo" | "fifo" = "lifo"): ComposerDraft | null {
    if (this.drafts.length === 0) return null;
    return mode === "fifo" ? (this.drafts.shift() ?? null) : (this.drafts.pop() ?? null);
  }

  peek(mode: "lifo" | "fifo" = "lifo"): ComposerDraft | null {
    if (this.drafts.length === 0) return null;
    return mode === "fifo"
      ? (this.drafts[0] ?? null)
      : (this.drafts[this.drafts.length - 1] ?? null);
  }

  clear(): void {
    this.drafts = [];
  }

  getAll(): ComposerDraft[] {
    return this.drafts.map((d) => ({ ...d }));
  }

  count(): number {
    return this.drafts.length;
  }

  remove(id: string): boolean {
    const idx = this.drafts.findIndex((d) => d.id === id);
    if (idx === -1) return false;
    this.drafts.splice(idx, 1);
    return true;
  }

  get(id: string): ComposerDraft | null {
    const found = this.drafts.find((d) => d.id === id);
    return found ? { ...found } : null;
  }

  restore(id?: string): ComposerDraft | null {
    if (id !== undefined) {
      const idx = this.drafts.findIndex((d) => d.id === id);
      if (idx === -1) return null;
      const [item] = this.drafts.splice(idx, 1);
      return item ?? null;
    }
    return this.pop();
  }

  private generateDefaultTitle(text: string): string {
    const firstLine = text.split(/\r\n|\r|\n/)[0]?.trim();
    if (firstLine && firstLine.length > 0) {
      return firstLine.length > 30 ? `${firstLine.slice(0, 30).trimEnd()}…` : firstLine;
    }
    return "Scratchpad Draft";
  }
}

