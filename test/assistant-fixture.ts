import type { AssistantMessageComponent } from "@earendil-works/pi-coding-agent";

export type AssistantFixture = NonNullable<ConstructorParameters<typeof AssistantMessageComponent>[0]>;

/** Complete, offline message shape accepted by the actual installed component. */
export function assistantFixture(): AssistantFixture {
  return {
    role: "assistant", content: [], api: "openai-responses", provider: "openai", model: "fixture-model",
    timestamp: 0, stopReason: "stop",
    usage: {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}
