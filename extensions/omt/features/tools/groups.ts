export type GroupToolState = "running" | "success" | "failure";
export interface GroupMember { id: string; name: string; state: GroupToolState }
export interface ToolGroup { head: string; members: readonly GroupMember[]; open: boolean }
type Token = { kind: "tool"; id: string; name: string } | { kind: "barrier" };
type Owned = GroupMember & { invalidate(): void };
const verbs: Record<string, { done: string; running: string; single: string; plural: string }> = {
  read: { done: "read", running: "reading", single: "file", plural: "files" },
  bash: { done: "ran", running: "running", single: "shell command", plural: "shell commands" },
  grep: { done: "searched for", running: "searching for", single: "pattern", plural: "patterns" },
  glob: { done: "searched for", running: "searching for", single: "pattern", plural: "patterns" },
  find: { done: "searched for", running: "searching for", single: "pattern", plural: "patterns" },
  ls: { done: "listed", running: "listing", single: "directory", plural: "directories" },
};
export const isGroupableTool = (name: string) => Object.hasOwn(verbs, name);

/** Counts only genuinely owned, observed tool calls. */
export function toolGroupSummary(group: ToolGroup): { text: string; running: boolean; failed: boolean } {
  const running = group.members.some(member => member.state === "running");
  const failed = group.members.some(member => member.state === "failure");
  const tallies = new Map<string, { verb: typeof verbs[string]; count: number }>();
  for (const member of group.members) {
    const verb = verbs[member.name]!;
    const key = `${verb.done}|${verb.single}`;
    const tally = tallies.get(key);
    if (tally) tally.count++;
    else tallies.set(key, { verb, count: 1 });
  }
  const raw = [...tallies.values()].map(({ verb, count }) => `${running ? verb.running : verb.done} ${count} ${count === 1 ? verb.single : verb.plural}`).join(", ");
  return { text: raw.charAt(0).toUpperCase() + raw.slice(1) + (running ? "…" : ""), running, failed };
}

/** Presentation-only index of public messages and public renderer ownership. */
export class ToolGroups {
  private messages = new Map<unknown, Token[]>();
  private anonymous = new WeakMap<object, number>();
  private serial = 0;
  private owned = new Map<string, Owned>();
  private facts = new Map<string, { state: GroupToolState; images: boolean }>();
  private groups = new Map<string, { head: string; members: GroupMember[] }>();
  private opened = new Set<string>();
  private dirty = true;
  private queued = false;
  private generation = 0;
  private globallyExpanded: () => boolean;
  constructor(globallyExpanded: () => boolean = () => false) { this.globallyExpanded = globallyExpanded; }

  seed(messages: readonly unknown[]): void {
    this.reset();
    for (const message of messages) this.observe(message);
  }
  reset(): void {
    this.generation++; this.queued = false;
    this.messages.clear(); this.owned.clear(); this.facts.clear(); this.groups.clear(); this.opened.clear();
    this.anonymous = new WeakMap(); this.serial = 0; this.dirty = true;
  }
  private changed(): void {
    this.dirty = true;
    if (this.queued) return;
    this.queued = true;
    const generation = this.generation;
    // Never invalidate a native component reentrantly from its renderCall constructor.
    queueMicrotask(() => {
      if (generation !== this.generation) return;
      this.queued = false;
      for (const item of this.owned.values()) {
        try { item.invalidate(); } catch { /* Stale/disposed host cannot revive a session. */ }
      }
    });
  }
  observe(raw: unknown): void {
    if (!raw || typeof raw !== "object") return;
    const message = raw as Record<string, unknown>;
    if (message.role === "toolResult") {
      if (typeof message.toolCallId === "string") this.result(message.toolCallId, message.isError === true ? "failure" : "success", Array.isArray(message.content) && message.content.some(item => item?.type === "image"));
      return;
    }
    let tokens: Token[];
    if (message.role === "assistant") {
      tokens = [];
      if (!Array.isArray(message.content)) return;
      for (const item of message.content) {
        if (item?.type === "toolCall") {
          tokens.push(typeof item.id === "string" && item.id && typeof item.name === "string" && isGroupableTool(item.name)
            ? { kind: "tool", id: item.id, name: item.name } : { kind: "barrier" });
        } else if (item?.type === "text" || item?.type === "thinking") {
          const body = item.type === "text" ? item.text : item.thinking;
          if (typeof body === "string" && body.trim()) tokens.push({ kind: "barrier" });
        } else tokens.push({ kind: "barrier" });
      }
      if (message.stopReason === "length" || ((message.stopReason === "error" || message.stopReason === "aborted")
        && !message.content.some(item => item?.type === "toolCall"))) tokens.push({ kind: "barrier" });
    } else {
      if (message.display === false) return;
      tokens = [{ kind: "barrier" }];
    }
    let key: unknown = typeof message.timestamp === "number"
      ? JSON.stringify([message.role, message.timestamp, message.provider, message.model, message.customType]) : this.anonymous.get(raw);
    if (key === undefined) { key = ++this.serial; this.anonymous.set(raw, key as number); }
    const previous = this.messages.get(key);
    if (previous && JSON.stringify(previous) === JSON.stringify(tokens)) return;
    this.messages.set(key, tokens); this.changed();
  }
  register(id: string, name: string, state: GroupToolState, invalidate: () => void): void {
    if (!id || !isGroupableTool(name)) return;
    const previous = this.owned.get(id);
    const observedState = this.facts.get(id)?.state ?? state;
    this.owned.set(id, { id, name, state: observedState, invalidate });
    if (!previous || previous.name !== name || previous.state !== observedState) this.changed();
  }
  result(id: string, state: GroupToolState, images: boolean): void {
    if (!id) return;
    const previous = this.facts.get(id);
    if (previous?.state === state && previous.images === images) return;
    this.facts.set(id, { state, images });
    const owned = this.owned.get(id); if (owned) owned.state = state;
    this.changed();
  }
  private rebuild(): void {
    if (!this.dirty) return;
    this.dirty = false; this.groups.clear();
    const tokens = [...this.messages.values()].flat();
    const counts = new Map<string, number>();
    for (const token of tokens) if (token.kind === "tool") counts.set(token.id, (counts.get(token.id) ?? 0) + 1);
    let run: GroupMember[] = [];
    const flush = () => {
      if (run.length >= 2) {
        const group = { head: run[0]!.id, members: run };
        for (const member of run) this.groups.set(member.id, group);
      }
      run = [];
    };
    for (const token of tokens) {
      const item = token.kind === "tool" ? this.owned.get(token.id) : undefined;
      if (token.kind === "tool" && item && item.name === token.name && counts.get(token.id) === 1 && !this.facts.get(token.id)?.images) run.push(item);
      else flush(); // Visible prose/thinking, foreign calls and images break runs.
    }
    flush();
  }
  view(id: string): ToolGroup | undefined {
    this.rebuild();
    const group = this.groups.get(id); if (!group) return;
    let global = false; try { global = this.globallyExpanded(); } catch { /* Unsupported/stale UI. */ }
    return { ...group, open: global || this.opened.has(group.head) };
  }
  toggle(head: string): void {
    if (this.opened.has(head)) this.opened.delete(head); else this.opened.add(head);
    this.changed();
  }
}
