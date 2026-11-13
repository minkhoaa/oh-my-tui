import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { configStore, type SignaturePreferences } from "../core/config.ts";

/** UI callbacks only: native Pi owns model/thinking operations and their outcomes. */
export function createSidebarActions(pi: ExtensionAPI | undefined, ctx: ExtensionContext, active: () => boolean) {
  function preference<K extends "pet" | "petStyle" | "folds" | "visible">(key: K, value: SignaturePreferences[K]): void {
    if (!active()) return;
    configStore.setSignatureOverride(key, value);
    if (configStore.setSignatureDefault(key, value)) configStore.setSignatureOverride(key, undefined);
    else ctx.ui.notify("Appearance updated for this session; saving failed.", "warning");
  }
  return {
    onSelectPet(value: string): void {
      preference(value === "ascii" || value === "classic" ? "petStyle" : "pet", value);
    },
    onToggleFold(key: string, folded: boolean): void { preference("folds", { ...configStore.getSignature().folds, [key]: folded }); },
    onToggleSection(key: string, visible: boolean): void { preference("visible", { ...configStore.getSignature().visible, [key]: visible }); },
    async onSelectModel(id: string): Promise<void> {
      if (!active()) return;
      const all = ctx.modelRegistry?.getAll?.() ?? [];
      const qualified = all.filter(model => `${model.provider}/${model.id}` === id);
      const matches = qualified.length ? qualified : all.filter(model => model.id === id);
      if (!pi?.setModel || matches.length !== 1) {
        ctx.ui.notify("Model unchanged: native model is unavailable or ambiguous.", "warning");
        return;
      }
      try {
        if (!await pi.setModel(matches[0]!)) ctx.ui.notify("Model unchanged: authentication unavailable.", "warning");
      } catch (error) { ctx.ui.notify(`Model unchanged: ${String(error)}`, "error"); }
    },
    onSelectThinkingLevel(level: string): void {
      if (!active()) return;
      const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
      if (!pi?.setThinkingLevel || !levels.includes(level as typeof levels[number])) {
        ctx.ui.notify("Thinking level unchanged: native operation unavailable.", "warning");
        return;
      }
      pi.setThinkingLevel(level as typeof levels[number]);
    },
  };
}
