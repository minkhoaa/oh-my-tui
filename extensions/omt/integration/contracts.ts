import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { createEditorControl } from "../features/editor/index.ts";
import type { createUserMessageControl } from "../features/user-message/index.ts";
import type { createToolsControl } from "../features/tools/index.ts";
import type { createFooterControl } from "../features/footer/index.ts";
import type { createThinkingControl } from "../features/thinking/index.ts";
import type { BackgroundControl } from "../features/backgrounds/integration.ts";
import type { ComposerStash } from "../features/advanced-composer/store.ts";
import type { PromptQueueStore } from "../features/prompt-queue/store.ts";
import type { SidebarControl } from "../features/sidebar/index.ts";
import type { HeaderControl } from "../features/header/index.ts";

/** Runtime-owned controls. Dialogs/actions receive references, never parallel state. */
export interface RuntimeServices {
  pi?: ExtensionAPI;
  editor: ReturnType<typeof createEditorControl>;
  messages: ReturnType<typeof createUserMessageControl>;
  tools: ReturnType<typeof createToolsControl>;
  footer: ReturnType<typeof createFooterControl>;
  thinking: ReturnType<typeof createThinkingControl>;
  background: BackgroundControl;
  sidebar: SidebarControl;
  header?: HeaderControl;
  composerStash: ComposerStash;
  promptQueueStore: PromptQueueStore;
  applyTheme(name: string, ctx: ExtensionContext, options?: { sessionOnly?: boolean }): string;
  activateComponents(ctx: ExtensionContext): string[];
  refreshLayout?(ctx: ExtensionContext): Promise<boolean>;
  refreshHostTheme?(ctx: ExtensionContext): string | undefined;
}
