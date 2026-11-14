import type { ExtensionContext, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { HStack, type Component, type TUI } from "@earendil-works/pi-tui";
import { installNativeViewportPresentation } from "../core/native-ui.ts";
import { getActiveTheme } from "../core/theme.ts";
import { signatureTheme } from "../presets/omt-signature/rendering.ts";
import type { SidebarControl, SidebarState } from "../features/sidebar/types.ts";
import type { FleetChild } from "../features/agent-fleet/index.ts";

type DockComponent = Component & { dispose?(): void };
const mountedLayouts = new WeakMap<object, () => void>();

function viewportKey(ctx: ExtensionContext): object | undefined {
  const getter = (ctx.ui as ExtensionContext["ui"] & {
    getNativeViewportPresentation?(): { tui?: object } | undefined;
  }).getNativeViewportPresentation;
  return typeof getter === "function" ? getter.call(ctx.ui)?.tui : undefined;
}
type DockSource = Pick<SidebarControl, "getState" | "isEnabled"> & {
  setDocked?(docked: boolean, ctx?: ExtensionContext): void;
};
export type SidebarDockFactory = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager | undefined,
  ctx: ExtensionContext,
  options: { getState(): SidebarState; getFleetChildren?(): readonly FleetChild[] },
) => DockComponent;

/** Reserve real columns around Pi's unchanged viewport; never cover or rebuild it. */
export function createSignatureLayoutControl(
  sidebar: DockSource,
  loadDock: () => Promise<SidebarDockFactory | undefined>,
) {
  let binding: ReturnType<typeof installNativeViewportPresentation>;
  let component: DockComponent | undefined;
  let context: ExtensionContext | undefined;
  let layoutKey: object | undefined;
  let generation = 0;
  let issue: string | undefined;

  const requested = (ctx: ExtensionContext) => ctx.mode === "tui" && ctx.hasUI
    && getActiveTheme().id === "omt-signature" && sidebar.isEnabled();

  function release(): void {
    const previous = context;
    const oldBinding = binding;
    const oldComponent = component;
    binding = undefined;
    component = undefined;
    context = undefined;
    if (layoutKey && mountedLayouts.get(layoutKey) === release) mountedLayouts.delete(layoutKey);
    layoutKey = undefined;
    oldBinding?.dispose();
    oldComponent?.dispose?.();
    if (previous) sidebar.setDocked?.(false);
  }

  return {
    async refresh(ctx: ExtensionContext): Promise<boolean> {
      const epoch = ++generation;
      const key = viewportKey(ctx);
      if (!requested(ctx)) {
        release();
        if (key) mountedLayouts.get(key)?.();
        issue = undefined;
        return false;
      }
      if (binding?.owned() && context === ctx) return true;
      const tuiMode = ctx.mode === "tui" && ctx.hasUI;
      let factory: SidebarDockFactory | undefined;
      try {
        factory = await loadDock();
      } catch (error) {
        if (epoch === generation) issue = `Signature dock unavailable: ${error instanceof Error ? error.message : String(error)}`;
        return false;
      }
      if (epoch !== generation || !requested(ctx)) return false;
      if (!factory) {
        issue = "Signature dock unavailable: sidebar presentation factory missing.";
        return false;
      }
      if (epoch !== generation || !requested(ctx)) return false;
      // When Pi replaces a session, retain the old OMT root until the new dock is
      // ready, then swap synchronously so the native splash is never exposed.
      release();
      if (key) mountedLayouts.get(key)?.();
      let candidate: DockComponent | undefined;
      let next: ReturnType<typeof installNativeViewportPresentation>;
      try {
        next = installNativeViewportPresentation(ctx.ui, (nativeRoot, tui) => {
          candidate = factory(tui, signatureTheme(ctx.ui.theme), undefined, ctx, { getState: () => sidebar.getState(ctx) });
          return new HStack([
            { component: nativeRoot, basis: 0, grow: 1, shrink: 1, minSize: 1 },
            { component: candidate, basis: 34, grow: 0, shrink: 0, minSize: 34, maxSize: 34,
              visible: viewport => viewport.width >= 80 && tuiMode
                && getActiveTheme().id === "omt-signature" && sidebar.isEnabled() },
          ]);
        });
      } catch (error) {
        candidate?.dispose?.();
        issue = `Signature dock unavailable: ${error instanceof Error ? error.message : String(error)}`;
        return false;
      }
      if (!next) {
        candidate?.dispose?.();
        issue = "Signature dock unavailable: fullscreen native viewport is unsupported or owned elsewhere.";
        return false;
      }
      binding = next;
      component = candidate;
      context = ctx;
      layoutKey = key;
      if (key) mountedLayouts.set(key, release);
      sidebar.setDocked?.(true, ctx);
      issue = undefined;
      return true;
    },
    isMounted(): boolean { return !!binding?.owned(); },
    getIssue(): string | undefined { return issue; },
    cleanup(): void {
      generation++;
      release();
      issue = undefined;
    },
  };
}
