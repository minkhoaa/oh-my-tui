import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export interface DisplayUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost?: number;
}

/** Read-only accounting, following Pi's footer: include all persisted usage sources. */
export function readDisplayUsage(entries: readonly SessionEntry[]): DisplayUsage {
  const totals: DisplayUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
  const number = (value: unknown): number => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
  for (const entry of entries) {
    const usage = entry.type === "usage" || entry.type === "compaction" || entry.type === "branch_summary"
      ? entry.usage
      : entry.type === "message" && (entry.message.role === "assistant" || entry.message.role === "toolResult")
        ? entry.message.usage : undefined;
    if (!usage) continue;
    totals.input += number(usage.input);
    totals.output += number(usage.output);
    totals.cacheRead += number(usage.cacheRead);
    totals.cacheWrite += number(usage.cacheWrite);
    const cost = usage.cost?.total;
    if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0) totals.cost = (totals.cost ?? 0) + cost;
  }
  totals.totalTokens = totals.input + totals.output + totals.cacheRead + totals.cacheWrite;
  return totals;
}
