import type { QueuedPrompt } from "./types.ts";

export class PromptQueueStore {
  private prompts: QueuedPrompt[] = [];

  constructor(initialPrompts: QueuedPrompt[] = []) {
    this.prompts = initialPrompts.map((p) => ({ ...p }));
  }

  enqueue(text: string, deliverAs: "steer" | "followUp" = "followUp"): QueuedPrompt {
    const prompt: QueuedPrompt = {
      id: `prompt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      text: text ?? "",
      deliverAs,
      timestamp: Date.now(),
      status: "queued",
    };
    this.prompts.push(prompt);
    return prompt;
  }

  dequeue(): QueuedPrompt | null {
    if (this.prompts.length === 0) return null;
    return this.prompts.shift() ?? null;
  }

  promote(id: string): boolean {
    const index = this.prompts.findIndex((p) => p.id === id);
    if (index === -1) return false;
    const [item] = this.prompts.splice(index, 1);
    this.prompts.unshift(item);
    return true;
  }

  remove(id: string): boolean {
    const index = this.prompts.findIndex((p) => p.id === id);
    if (index === -1) return false;
    this.prompts.splice(index, 1);
    return true;
  }

  clear(): void {
    this.prompts = [];
  }

  getAll(): QueuedPrompt[] {
    return this.prompts.map((p) => ({ ...p }));
  }

  count(): number {
    return this.prompts.length;
  }

  get(id: string): QueuedPrompt | null {
    const found = this.prompts.find((p) => p.id === id);
    return found ? { ...found } : null;
  }

  peek(): QueuedPrompt | null {
    if (this.prompts.length === 0) return null;
    return { ...this.prompts[0] };
  }

  getSteerCount(): number {
    return this.prompts.filter((p) => p.deliverAs === "steer").length;
  }

  setDeliveryMode(id: string, deliverAs: "steer" | "followUp"): boolean {
    const prompt = this.prompts.find((p) => p.id === id);
    if (!prompt) return false;
    prompt.deliverAs = deliverAs;
    return true;
  }

  toggleDeliveryMode(id: string): boolean {
    const prompt = this.prompts.find((p) => p.id === id);
    if (!prompt) return false;
    prompt.deliverAs = prompt.deliverAs === "steer" ? "followUp" : "steer";
    return true;
  }
}

