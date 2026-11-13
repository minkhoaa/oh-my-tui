import type { ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { Component, OverlayHandle, OverlayOptions, TUI } from "@earendil-works/pi-tui";
import type { NativeNotification } from "../../core/native-ui.ts";
import { motionCoordinator } from "../../core/motion.ts";
import { notificationStore } from "./store.ts";
import { ToastQueue, toastGeometry } from "./toast-model.ts";
import { renderToastStack } from "./toast-view.ts";

let nextToastOwner = 0;
/** Own only our noncapturing overlay handle. Never use TUI.hideOverlay (foreign stack). */
export function createToastControl(docked: () => boolean) {
  const queue = new ToastQueue();
  const source = `notifications:${nextToastOwner++}`;
  let ui: ExtensionUIContext | undefined;
  let tui: TUI | undefined;
  let overlay: OverlayHandle | undefined;
  let ready = false, enabled = false, blocked = false;
  let pending: NativeNotification[] = [];
  const nativeTui = (candidate: ExtensionUIContext): TUI | undefined => {
    const value = (candidate as ExtensionUIContext & { getBackgroundTui?(): TUI }).getBackgroundTui?.();
    return value?.mode === "fullscreen" && typeof value.showOverlay === "function" && value.terminal
      && typeof candidate.theme?.style === "function" ? value : undefined;
  };
  const geometry = () => toastGeometry(tui?.terminal.columns ?? 0, tui?.terminal.rows ?? 0, docked());
  const clear = () => {
    queue.clear();
    overlay?.hide(); overlay = undefined;
    motionCoordinator.unregister(source);
  };
  const component: Component = {
    invalidate() {},
    render(width) { return ui ? renderToastStack(queue.getAll(), ui.theme, width) : []; },
  };
  const show = (event: NativeNotification): boolean => {
    if (!tui || !geometry().visible) return false;
    if (!overlay) {
      const options: OverlayOptions = {
        nonCapturing: true, margin: 0,
        get row() { return geometry().row; }, get col() { return geometry().col; },
        get width() { return geometry().width; }, get maxHeight() { return geometry().maxHeight; },
        visible: () => enabled && !blocked && geometry().visible,
      };
      overlay = tui.showOverlay(component, options);
      if (!overlay || typeof overlay.hide !== "function") { overlay = undefined; return false; }
    }
    queue.push(event.message, event.type);
    notificationStore.push(event.message, event.type);
    motionCoordinator.register(source, 1000, { essential: true });
    tui.requestRender();
    return true;
  };
  return {
    receive(event: NativeNotification): boolean {
      const sourceTui = nativeTui(event.ui);
      if (!sourceTui) return false;
      // Pi wraps UI prompts with an object spread; raw and runner UI objects differ.
      // The guarded native TUI, not object identity, identifies the presentation host.
      if (!ready || sourceTui !== tui) { pending.push(event); return true; }
      if (!enabled) return false;
      return show(event);
    },
    refresh(ctx: ExtensionContext, active: boolean): void {
      if (!ctx.hasUI || ctx.mode !== "tui") return;
      const next = nativeTui(ctx.ui);
      if (tui && next !== tui) clear();
      ui = ctx.ui; tui = next; ready = true; enabled = active && !!tui;
      if (!enabled) clear();
      for (const event of pending.splice(0)) {
        if (nativeTui(event.ui) !== tui || !enabled || !show(event)) event.fallback();
      }
      tui?.requestRender();
    },
    tick(): void {
      if (!queue.getAll().length) clear();
    },
    setBlocked(value: boolean): void {
      blocked = value;
      tui?.requestRender();
    },
    cleanup(): void {
      clear();
      for (const event of pending.splice(0)) event.fallback();
      ui = undefined; tui = undefined; ready = false; enabled = false; blocked = false;
    },
  };
}
