// Capability-checked, reversible native Pi boundaries. Visual rules live in presets/.
import * as Pi from "@earendil-works/pi-coding-agent";
import type { ToolRenderers, WorkingIndicatorOptions, Theme, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { Container, ScrollView, Spacer, VStack, isViewportTUI, sliceByColumn, stripTerminalSequences, type Component, type TerminalColors, type TUI, type TuiMouseEvent } from "@earendil-works/pi-tui";

import { createAssistantPresentation } from "../presets/shared/assistant.ts";

/** Distinguish native renderers from arbitrary extension renderers, without private registries. */
export function nativeToolRenderers() {
  const native: Record<string, { renderShell?: ToolRenderers["renderShell"]; renderCall?: { toString(): string }; renderResult?: { toString(): string } }> = Object.create(null);
  const factories = {
    read: Pi.createReadToolDefinition, write: Pi.createWriteToolDefinition,
    edit: Pi.createEditToolDefinition, bash: Pi.createBashToolDefinition,
    powershell: Pi.createPowerShellToolDefinition, grep: Pi.createGrepToolDefinition,
    find: Pi.createFindToolDefinition, ls: Pi.createLsToolDefinition,
  };
  for (const [name, factory] of Object.entries(factories)) {
    // A missing/changed tool factory must not disable unrelated tools or UI.
    if (typeof factory !== "function") continue;
    try { native[name] = factory("."); } catch { /* Keep that renderer native. */ }
  }
  return (name: string, candidate: ToolRenderers | undefined): boolean => {
    if (!candidate) return true;
    const expected = native[name];
    if (!expected || candidate.renderShell !== expected.renderShell) return false;
    // Shell renderers are created per tool (closures over the shell prompt).
    const same = (slot: "renderCall" | "renderResult") => !candidate[slot]
      || candidate[slot] === expected[slot]
      || candidate[slot]?.toString() === expected[slot]?.toString();
    return same("renderCall") && same("renderResult");
  };
}

/** Method-shape checks also reject ordinary wrappers named `render`. */
export function hasNativeFooterRenderer(): boolean {
  const render = Pi.FooterComponent?.prototype?.render;
  return typeof render === "function" && render.name === "render"
    && render.toString().includes(".getSessionStats(") && render.toString().includes(".getGitBranch(");
}

/** Read-only snapshot: all writes still go through Pi's public UI APIs. */
export interface WorkingPresentation {
  message: string | undefined;
  indicator: WorkingIndicatorOptions | undefined;
  hiddenThinkingLabel: string;
  defaultHiddenThinkingLabel: string;
  visible: boolean;
}

type NativeUIHost = {
  renderer?: TUI;
  themeController?: { waitForTerminalColors?: unknown; terminalColors?: TerminalColors };
  customFooter?: unknown;
  customHeader?: unknown;
  workingMessage?: string;
  workingIndicatorOptions?: WorkingIndicatorOptions;
  hiddenThinkingLabel?: string;
  defaultHiddenThinkingLabel?: string;
  workingVisible?: boolean;
  fullscreenLayoutRoot?: Component;
  transcriptScrollView?: Component;
  documentContainer?: Container;
  headerContainer?: Container;
  loadedResourcesContainer?: Container;
  chatContainer?: Container;
  settingsManager?: Pi.SettingsManager;
};

/** Read-only host observation; layout writes use the exported ViewportTUI API. */
export interface NativeViewportPresentation {
  tui: TUI & { setLayoutRoot(component: Component | undefined): void };
  root: Component;
  currentRoot(): Component | undefined;
}

const viewportOwners = new WeakMap<TUI, Component>();
type NativeLayoutBox = {
  component: Component;
  children: NativeLayoutBox[];
  scrollView?: Component;
  scrollContentLines?: readonly string[];
  clip: { x: number; y: number; width: number; height: number };
  rect: { x: number; y: number; width: number; height: number };
};
type NativeLayoutFrame = { width: number; height: number; root: NativeLayoutBox; lines: string[] };

/** Read the already-rendered native viewport, never render/reparent its document.
 * currentLayout is intentionally guarded: Pi publishes it after overlay composition,
 * so a resize/root transition fails closed until the next native frame.
 */
function nativeTranscriptRows(host: NativeUIHost, width: number, height: number): string[] | undefined {
  const snapshot = nativeViewport(host);
  if (!snapshot) return;
  const root = snapshot.currentRoot();
  if (root !== snapshot.root && root !== viewportOwners.get(snapshot.tui)) return;
  const renderer = snapshot.tui as typeof snapshot.tui & { currentLayout?: NativeLayoutFrame };
  const frame = renderer.currentLayout;
  if (!frame || frame.width !== width || frame.height !== height || frame.root?.component !== root
    || !Array.isArray(frame.lines) || frame.lines.length !== height) return;
  const visited = new Set<NativeLayoutBox>();
  const find = (box: NativeLayoutBox): NativeLayoutBox | undefined => {
    if (!box || visited.has(box) || !Array.isArray(box.children)) return;
    visited.add(box);
    return box.component === host.transcriptScrollView ? box : box.children.map(find).find(Boolean);
  };
  const box = find(frame.root);
  if (!box || box.scrollView !== host.transcriptScrollView || !Array.isArray(box.scrollContentLines)
    || !box.clip || !box.rect) return;
  const { x, y, width: w, height: h } = box.clip;
  if (![x, y, w, h].every(Number.isInteger) || x < 0 || y < 0 || w < 1 || h < 0 || x + w > width || y + h > height) return;
  // The native scroll document also contains the startup header/resources.
  // Bound the tail to its chat child using the native Container's recorded row
  // geometry, not header strings or a second document render.
  const document = host.documentContainer;
  const chat = host.chatContainer;
  const layout = (document as unknown as { mouseLayout?: { width: number; children: Array<{ component: Component; height: number }> } } | undefined)?.mouseLayout;
  if (!(document instanceof Container) || !(chat instanceof Container) || !layout || !Array.isArray(layout.children)
    || layout.children.length !== document.children.length
    || layout.children.some((entry, i) => !entry || entry.component !== document.children[i] || !Number.isInteger(entry.height) || entry.height < 0)
    || layout.children.reduce((sum, entry) => sum + entry.height, 0) !== box.scrollContentLines.length
    || layout.width !== (host.transcriptScrollView as ScrollView).getContentWidth(box.rect.width)) return;
  const chatIndex = layout.children.findIndex(entry => entry.component === chat);
  if (chatIndex < 0) return;
  const chatHeight = layout.children[chatIndex]!.height;
  const precedingRows = layout.children.slice(0, chatIndex).reduce((sum, entry) => sum + entry.height, 0);
  // An empty native chat presents its welcome/startup content, not a compact
  // session header. Keep that native empty-state presentation in the tail.
  const chatStart = chatHeight === 0 ? 0 : precedingRows;
  const chatEnd = precedingRows + chatHeight;
  const scroll = host.transcriptScrollView as ScrollView;
  if (!Number.isInteger(box.rect.y) || !Number.isInteger(scroll.scrollTop)) return;
  const firstRow = Math.max(y, box.rect.y + chatStart - scroll.scrollTop);
  const lastRow = Math.min(y + h, box.rect.y + chatEnd - scroll.scrollTop);
  const rows = frame.lines.slice(firstRow, Math.max(firstRow, lastRow));
  // Reject before slicing: image placements/cursors cannot be replayed elsewhere.
  if (rows.some(line => typeof line !== "string" || /\x1b_G|\x1bP|\x1b\]1337;File=|\x1b\[\?1000h|\x1b_pi:c\x07/.test(line))) return;
  return rows.map(line => " ".repeat(x) + sliceByColumn(line, x, w, true));
}

function nativeViewport(host: NativeUIHost): NativeViewportPresentation | undefined {
  const tui = host.renderer;
  const root = host.fullscreenLayoutRoot;
  if (!tui || tui.mode !== "fullscreen" || !isViewportTUI(tui)
    || !(root instanceof VStack) || !(host.transcriptScrollView instanceof ScrollView)
    || root.children[0] !== host.transcriptScrollView) return;
  const renderer = tui as typeof tui & { layoutRoot?: Component };
  // Do not mistake an unknown storage shape for an unowned root.
  const setter = tui.setLayoutRoot;
  if (!("layoutRoot" in renderer) || typeof setter !== "function"
    || setter.name !== "setLayoutRoot" || !setter.toString().includes("this.layoutRoot")) return;
  return { tui, root, currentRoot: () => renderer.layoutRoot };
}

function terminalRgbSnapshot(colors: TerminalColors | undefined): TerminalColors | undefined {
  const valid = (rgb: unknown): rgb is { r: number; g: number; b: number } => !!rgb && typeof rgb === "object"
    && ["r", "g", "b"].every((key) => {
      const value = (rgb as Record<string, unknown>)[key];
      return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255;
    });
  if (!colors || !valid(colors.foreground) || !valid(colors.background)) return;
  return { foreground: { ...colors.foreground }, background: { ...colors.background } };
}

export interface NativeNotification {
  ui: ExtensionUIContext;
  message: string;
  type: "info" | "warning" | "error";
  fallback(): void;
}

/** Add guarded views only where the native context/host shape is recognized. */
export function observeNativeUIOwnership(onNotification?: (event: NativeNotification) => boolean): (() => void) | undefined {
  const target = Pi.InteractiveMode?.prototype as unknown as {
    createExtensionUIContext?: (this: NativeUIHost) => Record<string, unknown>;
  };
  const original = target?.createExtensionUIContext;
  if (typeof original !== "function" || original.name !== "createExtensionUIContext"
    || !original.toString().includes(".setExtensionFooter(")) return undefined;
  let active = true;
  const notifications = new Map<Record<string, unknown>, { ui: Record<string, unknown>; original: Function; wrapper: Function }>();
  function omtCreateUI(this: NativeUIHost) {
    const ui = original!.call(this);
    if (!("getFooterComponent" in ui) && "customFooter" in this) ui.getFooterComponent = () => this.customFooter;
    if (!("getHeaderComponent" in ui) && "customHeader" in this) ui.getHeaderComponent = () => this.customHeader;
    if (!("getBackgroundTui" in ui)) ui.getBackgroundTui = () => this.renderer;
    if (!("getNativeViewportPresentation" in ui)) ui.getNativeViewportPresentation = () => nativeViewport(this);
    if (!("getNativeTranscriptRows" in ui)) ui.getNativeTranscriptRows = (width: number, height: number) =>
      active && target.createExtensionUIContext === omtCreateUI ? nativeTranscriptRows(this, width, height) : undefined;
    if (!("getNativeStartupResources" in ui)) ui.getNativeStartupResources = () => {
      const method = (Pi.InteractiveMode.prototype as any).showLoadedResources;
      const container = this.loadedResourcesContainer;
      if (!(container instanceof Container) || Object.getPrototypeOf(container) !== Container.prototype
        || !(this.documentContainer instanceof Container) || !(this.headerContainer instanceof Container)
        || this.documentContainer.children[0] !== this.headerContainer || this.documentContainer.children[1] !== container
        || method?.name !== "showLoadedResources" || !method.toString().includes("this.loadedResourcesContainer.clear()")) return;
      return container;
    };
    if (!("getNativeSessionHost" in ui)) ui.getNativeSessionHost = () => this;
    if (!("getNativeChatContainer" in ui)) ui.getNativeChatContainer = () => {
      const container = this.chatContainer;
      if (!(container instanceof Container) || Object.getPrototypeOf(container) !== Container.prototype
        || !(this.documentContainer instanceof Container) || this.documentContainer.children[2] !== container) return;
      return container;
    };
    if (!("getNativeHeaderContainer" in ui)) ui.getNativeHeaderContainer = () => {
      const container = this.headerContainer;
      const resources = this.loadedResourcesContainer;
      if (!(container instanceof Container) || Object.getPrototypeOf(container) !== Container.prototype
        || !(this.documentContainer instanceof Container) || !(resources instanceof Container)
        || this.documentContainer.children[0] !== container || this.documentContainer.children[1] !== resources
        || this.documentContainer.children.length < 3) return;
      return container;
    };
    if (!("getNativeCompactionEnabled" in ui)) ui.getNativeCompactionEnabled = (): boolean | undefined => {
      const manager = this.settingsManager;
      const native = Pi.SettingsManager?.prototype?.getCompactionEnabled;
      if (!active || target.createExtensionUIContext !== omtCreateUI || !Pi.SettingsManager
        || !(manager instanceof Pi.SettingsManager) || manager.getCompactionEnabled !== native
        || native?.name !== "getCompactionEnabled" || !native.toString().includes("this.settings.compaction")) return;
      return manager.getCompactionEnabled();
    };
    if (!("getTerminalColors" in ui)) ui.getTerminalColors = (): TerminalColors | undefined => {
      // init() already awaited this controller's query before session_start.
      // Read only confirmed RGB replies; never infer terminal colors from theme tokens.
      const controller = this.themeController;
      if (typeof controller?.waitForTerminalColors !== "function") return;
      return terminalRgbSnapshot(controller.terminalColors);
    };
    if (!("getWorkingPresentation" in ui)) ui.getWorkingPresentation = (): WorkingPresentation | undefined => {
      if (typeof this.hiddenThinkingLabel !== "string" || typeof this.defaultHiddenThinkingLabel !== "string"
        || typeof this.workingVisible !== "boolean") return undefined;
      return {
        message: this.workingMessage,
        indicator: this.workingIndicatorOptions,
        hiddenThinkingLabel: this.hiddenThinkingLabel,
        defaultHiddenThinkingLabel: this.defaultHiddenThinkingLabel,
        visible: this.workingVisible,
      };
    };
    const notify = ui.notify;
    // Wrap before session_start handlers: built-in MCP can notify before OMT's handler.
    // Never capture a foreign notify function, nor edit/remove native transcript rows.
    if (onNotification && typeof notify === "function" && notify.toString().includes(".showExtensionNotify(")) {
      let receiver = ui;
      function omtNotify(this: Record<string, unknown> | undefined, message: string, type?: "info" | "warning" | "error") {
        if (this && typeof this.notify === "function") {
          receiver = this;
          if (this.notify === omtNotify && !notifications.has(this)) notifications.set(this, { ui: this, original: notify as Function, wrapper: omtNotify });
        }
        const fallback = () => (notify as Function).call(ui, message, type);
        if (active && ui.notify === omtNotify && receiver.notify === omtNotify && target.createExtensionUIContext === omtCreateUI) {
          try {
            if (onNotification!({ ui: receiver as unknown as ExtensionUIContext, message, type: type ?? "info", fallback })) return;
          } catch { /* Native notification remains the fail-safe. */ }
        }
        fallback();
      }
      ui.notify = omtNotify;
      notifications.set(ui, { ui, original: notify, wrapper: omtNotify });
    }
    return ui;
  }
  target.createExtensionUIContext = omtCreateUI;
  return () => {
    active = false;
    if (target.createExtensionUIContext === omtCreateUI) target.createExtensionUIContext = original;
    for (const entry of notifications.values()) if (entry.ui.notify === entry.wrapper) entry.ui.notify = entry.original;
    notifications.clear();
  };
}

/** Compose the unchanged native viewport via public layout APIs, yielding to later owners. */
export function installNativeViewportPresentation(
  ui: ExtensionUIContext,
  compose: (root: Component, tui: TUI) => Component,
): { owned(): boolean; dispose(): void } | undefined {
  const getter = (ui as ExtensionUIContext & {
    getNativeViewportPresentation?(): NativeViewportPresentation | undefined;
  }).getNativeViewportPresentation;
  if (typeof getter !== "function") return;
  const snapshot = getter.call(ui);
  if (!snapshot || snapshot.currentRoot() !== snapshot.root) return;
  const setter = snapshot.tui.setLayoutRoot;
  const wrapper = compose(snapshot.root, snapshot.tui);
  if (wrapper === snapshot.root || snapshot.currentRoot() !== snapshot.root
    || snapshot.tui.setLayoutRoot !== setter) return;
  let active = true;
  const owned = () => active && snapshot.currentRoot() === wrapper;
  try {
    snapshot.tui.setLayoutRoot(wrapper);
    viewportOwners.set(snapshot.tui, wrapper);
  } catch (error) {
    if (snapshot.currentRoot() === wrapper) snapshot.tui.setLayoutRoot(snapshot.root);
    throw error;
  }
  return {
    owned,
    dispose() {
      if (!active) return;
      const restore = owned();
      active = false;
      if (viewportOwners.get(snapshot.tui) === wrapper) viewportOwners.delete(snapshot.tui);
      if (restore) snapshot.tui.setLayoutRoot(snapshot.root);
    },
  };
}

/** Hide only native startup listings already summarized by Signature's welcome.
 * Native diagnostics, foreign rows, underlying children and mouse geometry remain intact.
 */
const startupPresentationOwners = new WeakMap<Container, { dispose: () => void; owned: () => boolean }>();

export function installNativeStartupPresentation(ui: ExtensionUIContext, enabled: () => boolean): (() => void) | undefined {
  const getter = (ui as ExtensionUIContext & { getNativeStartupResources?(): Container }).getNativeStartupResources;
  const candidate = getter?.call(ui);
  if (!candidate) return;
  const existing = startupPresentationOwners.get(candidate);
  if (existing?.owned()) return existing.dispose;
  if (existing) startupPresentationOwners.delete(candidate);
  if (candidate.render !== Container.prototype.render || candidate.handleMouse !== Container.prototype.handleMouse) return;
  const container: Container = candidate;
  const render = container.render;
  const mouse = container.handleMouse;
  const hadRender = Object.hasOwn(container, "render"), hadMouse = Object.hasOwn(container, "handleMouse");
  let active = true;
  let mapping: number[] | undefined;
  let sourceHeight = 0;
  let renderedWidth = 0;
  const owned = () => active && container.render === presentation && container.handleMouse === handleMouse;
  function presentation(width: number): string[] {
    const lines = render.call(container, width);
    mapping = undefined;
    if (!owned() || !enabled()) return lines;
    const layout = (container as any).mouseLayout as { width?: number; children?: Array<{ component: Component; height: number }> } | undefined;
    if (layout?.width !== width || !Array.isArray(layout.children) || layout.children.length !== container.children.length
      || layout.children.some((entry, i) => entry.component !== container.children[i] || !Number.isInteger(entry.height) || entry.height < 0)
      || layout.children.reduce((sum, entry) => sum + entry.height, 0) !== lines.length) return lines;
    const result: string[] = [], indices: number[] = [];
    let offset = 0, hiddenListing = false;
    for (const entry of layout.children) {
      const child = entry.component as Component & { setExpanded?: Function };
      const heading = stripTerminalSequences(lines[offset] ?? "").trim();
      const nativeListing = Object.getPrototypeOf(child)?.constructor?.name === "ExpandableText"
        && child.setExpanded?.name === "setExpanded" && child.setExpanded.toString().includes("this.state.expanded")
        && /^\[(Context|Skills|Prompts|Extensions)\]$/.test(heading);
      const spacer = hiddenListing && Object.getPrototypeOf(child)?.constructor?.name === "Spacer" && lines.slice(offset, offset + entry.height).every(line => !stripTerminalSequences(line).trim());
      if (!nativeListing && !spacer) for (let row = 0; row < entry.height; row++) { result.push(lines[offset + row]!); indices.push(offset + row); }
      hiddenListing = nativeListing;
      offset += entry.height;
    }
    mapping = indices; sourceHeight = lines.length; renderedWidth = width;
    return result;
  }
  function handleMouse(event: TuiMouseEvent) {
    if (!owned() || !enabled()) return mouse.call(container, event);
    if (!mapping || renderedWidth !== event.width) presentation(event.width);
    if (!mapping) return mouse.call(container, event);
    const y = mapping[event.y];
    return y === undefined ? undefined : mouse.call(container, { ...event, y, height: sourceHeight });
  }
  container.render = presentation;
  container.handleMouse = handleMouse;
  const dispose = () => {
    active = false; mapping = undefined;
    if (startupPresentationOwners.get(container)?.dispose === dispose) startupPresentationOwners.delete(container);
    if (container.render === presentation) { if (hadRender) container.render = render; else delete (container as Partial<Container>).render; }
    if (container.handleMouse === handleMouse) { if (hadMouse) container.handleMouse = mouse; else delete (container as Partial<Container>).handleMouse; }
  };
  startupPresentationOwners.set(container, { dispose, owned });
  return dispose;
}

/**
 * Remove the leading native Spacer1 above Signature's owned header. Compact
 * one-row session headers may also omit the exact trailing native Spacer1.
 * Diagnostics, multi-row welcome, children and native mouse geometry remain intact.
 */
const headerPresentationOwners = new WeakMap<Container, { dispose: () => void; owned: () => boolean }>();

export function installNativeHeaderPresentation(ui: ExtensionUIContext, enabled: () => boolean, options: { compact?: boolean } = {}): (() => void) | undefined {
  const getter = (ui as ExtensionUIContext & { getNativeHeaderContainer?(): Container }).getNativeHeaderContainer;
  if (typeof getter !== "function") return;
  const candidate = getter.call(ui);
  if (!(candidate instanceof Container)) return;
  const existing = headerPresentationOwners.get(candidate);
  if (existing?.owned()) return existing.dispose;
  if (existing) headerPresentationOwners.delete(candidate);
  if (Object.getPrototypeOf(candidate) !== Container.prototype
    || candidate.render !== Container.prototype.render || candidate.handleMouse !== Container.prototype.handleMouse) return;
  const container: Container = candidate;
  const render = container.render;
  const mouse = container.handleMouse;
  const hadRender = Object.hasOwn(container, "render"), hadMouse = Object.hasOwn(container, "handleMouse");
  let active = true;
  let sourceHeight = 0;
  let renderedWidth = 0;
  let cropped = false;
  let trailingCrop = 0;
  const owned = () => active && container.render === presentation && container.handleMouse === handleMouse;
  function presentation(width: number): string[] {
    const lines = render.call(container, width);
    cropped = false;
    trailingCrop = 0;
    if (!owned() || !enabled()) return lines;
    const layout = (container as any).mouseLayout as { width?: number; children?: Array<{ component: Component; height: number }> } | undefined;
    if (layout?.width !== width || !Array.isArray(layout.children) || layout.children.length !== container.children.length
      || layout.children.some((entry, i) => entry.component !== container.children[i] || !Number.isInteger(entry.height) || entry.height < 0)
      || layout.children.reduce((sum, entry) => sum + entry.height, 0) !== lines.length) return lines;
    const firstEntry = layout.children[0];
    const firstChild = firstEntry?.component;
    const isSpacer1 = firstEntry?.height === 1
      && firstChild instanceof Spacer && Object.getPrototypeOf(firstChild) === Spacer.prototype
      && firstChild.render === Spacer.prototype.render && !("handleMouse" in firstChild) && (firstChild as any).lines === 1
      && lines[0] !== undefined
      && !stripTerminalSequences(lines[0]).trim();
    if (!isSpacer1) return lines;
    cropped = true;
    sourceHeight = lines.length;
    renderedWidth = width;
    const tail = layout.children[2];
    const last = tail?.component;
    if (options.compact && layout.children.length === 3 && layout.children[1]?.height === 1
      && stripTerminalSequences(lines[1] ?? "").trim().length > 0
      && tail?.height === 1 && last instanceof Spacer && Object.getPrototypeOf(last) === Spacer.prototype
      && last.render === Spacer.prototype.render && !("handleMouse" in last) && (last as any).lines === 1
      && !stripTerminalSequences(lines.at(-1) ?? "").trim()) trailingCrop = 1;
    return lines.slice(1, lines.length - trailingCrop);
  }
  function handleMouse(event: TuiMouseEvent) {
    // Always call the captured native handler: calling container.handleMouse here
    // recurses while disabled, or through a foreign decorator retaining this wrapper.
    if (!owned() || !enabled()) return mouse.call(container, event);
    if (!cropped || renderedWidth !== event.width) presentation(event.width);
    if (!cropped) return mouse.call(container, event);
    if (event.y < 0 || event.y >= sourceHeight - 1 - trailingCrop) return undefined;
    return mouse.call(container, { ...event, y: event.y + 1, height: sourceHeight });
  }
  container.render = presentation;
  container.handleMouse = handleMouse;
  const dispose = () => {
    active = false; cropped = false;
    if (headerPresentationOwners.get(container)?.dispose === dispose) headerPresentationOwners.delete(container);
    if (container.render === presentation) { if (hadRender) container.render = render; else delete (container as Partial<Container>).render; }
    if (container.handleMouse === handleMouse) { if (hadMouse) container.handleMouse = mouse; else delete (container as Partial<Container>).handleMouse; }
  };
  headerPresentationOwners.set(container, { dispose, owned });
  return dispose;
}

/** Batch only painting during /new; Pi still tears down/rebinds every native component.
 * The runtime call is always delegated unchanged, including cancellation and failures.
 * No snapshots, stale contexts, sleeps, input interception or session mutations.
 */
type SessionPaintOwner = { ownsTheme(): boolean; refreshTheme(): void };
type SessionPaintBinding = { hold(): void; dispose(): void };
const sessionPaintOwners = new WeakMap<object, {
  bind(owner: SessionPaintOwner): SessionPaintBinding;
  owned(): boolean;
}>();

export function installNativeSessionPresentation(ui: ExtensionUIContext, owner: SessionPaintOwner): SessionPaintBinding | undefined {
  const getter = (ui as ExtensionUIContext & { getNativeSessionHost?(): unknown }).getNativeSessionHost;
  const host = getter?.call(ui) as {
    runtimeHost?: { newSession: (...args: any[]) => Promise<any> };
    renderer?: TUI & { doRender(): void };
    themeController?: { applyFromSettings(): void };
  } | undefined;
  const runtime = host?.runtimeHost, tui = host?.renderer, controller = host?.themeController;
  if (!runtime || !tui || !controller) return;
  const existing = sessionPaintOwners.get(runtime);
  if (existing?.owned()) return existing.bind(owner);
  const create = runtime.newSession, paint = tui.doRender, apply = controller.applyFromSettings;
  if (typeof create !== "function" || create.name !== "newSession"
    || !create.toString().includes("this.teardownCurrent(\"new\"") || !create.toString().includes("this.finishSessionReplacement(")
    || typeof paint !== "function" || paint.name !== "doRender" || !paint.toString().includes("this.terminal.")
    || typeof apply !== "function" || apply.name !== "applyFromSettings" || !apply.toString().includes("this.applyThemeName(")) return;
  const hadCreate = Object.hasOwn(runtime, "newSession"), hadPaint = Object.hasOwn(tui, "doRender"), hadApply = Object.hasOwn(controller, "applyFromSettings");
  let current: SessionPaintOwner | undefined;
  let running = 0, held = false, active = true;
  const owned = () => active && runtime.newSession === newSession && tui.doRender === doRender && controller.applyFromSettings === applyFromSettings;
  function restore() {
    active = false;
    if (sessionPaintOwners.get(runtime!) === entry) sessionPaintOwners.delete(runtime!);
    if (runtime!.newSession === newSession) { if (hadCreate) runtime!.newSession = create; else delete (runtime as any).newSession; }
    if (tui!.doRender === doRender) { if (hadPaint) tui!.doRender = paint; else delete (tui as any).doRender; }
    if (controller!.applyFromSettings === applyFromSettings) { if (hadApply) controller!.applyFromSettings = apply; else delete (controller as any).applyFromSettings; }
  }
  async function newSession(this: typeof runtime, ...args: any[]) {
    // A retained wrapper must be inert after cleanup or a foreign takeover.
    if (!owned() || this !== runtime) return create.apply(this, args);
    running++;
    try { return await create.apply(this, args); }
    finally {
      running--; held = false;
      if (!current && !running) restore();
      try { tui!.requestRender(); } catch { /* Painting must not replace Pi's result/error. */ }
    }
  }
  function doRender(this: typeof tui) {
    // Blocking/foreign overlays are never hidden behind the transition gate.
    if (owned() && this === tui && held && !tui!.hasOverlay()) return;
    return paint.call(this);
  }
  function applyFromSettings(this: typeof controller) {
    let refresh: SessionPaintOwner | undefined;
    try { if (owned() && this === controller && held && current?.ownsTheme()) refresh = current; }
    catch { /* An invalidated/foreign owner must not affect native theme application. */ }
    const result = apply.call(this);
    // Pi reapplies its saved theme AFTER session_start. Only reapply if OMT
    // still owned the palette immediately before that native reset.
    try { refresh?.refreshTheme(); } catch { /* Leave Pi's applied theme as the safe fallback. */ }
    // This is the host's final rebind step. Resume before extension-provided
    // withSession callbacks (which may wait for user input or run a model turn).
    if (owned() && this === controller && held) {
      held = false;
      try { tui!.requestRender(); } catch { /* Native session replacement still completes. */ }
    }
    return result;
  }
  const entry = {
    owned,
    bind(next: SessionPaintOwner): SessionPaintBinding {
      current = next;
      return {
        hold() { if (owned() && current === next && running) held = true; },
        dispose() {
          if (current !== next) return;
          current = undefined;
          if (!running) restore();
        },
      };
    },
  };
  runtime.newSession = newSession;
  tui.doRender = doRender;
  controller.applyFromSettings = applyFromSettings;
  sessionPaintOwners.set(runtime, entry);
  return entry.bind(owner);
}

/** Restyle only Pi's exact /new status; never rewrite history, text or geometry. */
export function installNativeSessionStatusPresentation(ui: ExtensionUIContext, enabled: () => boolean, style: (text: string) => string): (() => void) | undefined {
  const getter = (ui as ExtensionUIContext & { getNativeChatContainer?(): Container }).getNativeChatContainer;
  const container = getter?.call(ui);
  if (!(container instanceof Container) || container.render !== Container.prototype.render) return;
  const render = container.render, hadRender = Object.hasOwn(container, "render");
  let active = true;
  function presentation(width: number): string[] {
    const lines = render.call(container, width);
    if (!active || container!.render !== presentation || !enabled()) return lines;
    const layout = (container as any).mouseLayout as { children?: Array<{ component: Component; height: number }> } | undefined;
    if (!Array.isArray(layout?.children) || layout.children.length !== container!.children.length
      || layout.children.some((entry, i) => entry.component !== container!.children[i] || !Number.isInteger(entry.height) || entry.height < 0)
      || layout.children.reduce((sum, entry) => sum + entry.height, 0) !== lines.length) return lines;
    const result = [...lines];
    let offset = 0;
    for (const { component, height } of layout.children) {
      const child = component as Component & { build?: () => string };
      const prototype = Object.getPrototypeOf(child);
      if (prototype?.constructor?.name === "ThemedText" && child.render === prototype.render
        && prototype.render?.toString().includes("this.setText(this.build())")
        && typeof child.build === "function" && /\.fg\(["']accent["'],\s*["'](?:✓|\\u2713) New session started["']\)/.test(child.build.toString())) {
        for (let i = offset; i < offset + height; i++) result[i] = style(stripTerminalSequences(lines[i]!));
      }
      offset += height;
    }
    return result;
  }
  container.render = presentation;
  return () => {
    active = false;
    if (container.render === presentation) { if (hadRender) container.render = render; else delete (container as Partial<Container>).render; }
  };
}

/** Optional read-only boundary; absent/unsupported hosts use the public TUI query. */
export function readNativeTerminalColors(ui: ExtensionUIContext): TerminalColors | undefined {
  const getter = (ui as ExtensionUIContext & { getTerminalColors?(): TerminalColors | undefined }).getTerminalColors;
  return typeof getter === "function" ? terminalRgbSnapshot(getter.call(ui)) : undefined;
}

/** Install a reversible presentation boundary; native Pi still renders all content. */
export function observeAssistantMessages(enabled: () => boolean, palette: () => Theme): (() => void) | undefined {
  const target = Pi.AssistantMessageComponent?.prototype;
  const original = target?.render;
  const originalMouse = target?.handleMouse;
  if (typeof original !== "function" || original.name !== "render" || !original.toString().includes("super.render(")
    || originalMouse !== Container.prototype.handleMouse) return;
  const hadMouse = Object.hasOwn(target, "handleMouse");
  let active = true;
  const presentation = createAssistantPresentation(() => active && enabled()
    && target.render === render && target.handleMouse === handleMouse, palette, original);
  function render(this: InstanceType<typeof Pi.AssistantMessageComponent>, width: number) {
    if (!active || target.render !== render || this.render !== render || this.handleMouse !== handleMouse) return original.call(this, width);
    return presentation.render.call(this, width);
  }
  function handleMouse(this: InstanceType<typeof Pi.AssistantMessageComponent>, event: TuiMouseEvent) {
    if (!active || target.render !== render || target.handleMouse !== handleMouse
      || this.render !== render || this.handleMouse !== handleMouse) return originalMouse.call(this, event);
    if (presentation.toggleThinking(this, event)) return {
      handled: true as const, render: true,
      target: { component: this, originX: (event.screenX ?? event.x) - event.x, originY: (event.screenY ?? event.y) - event.y,
        width: event.width ?? 0, height: event.height ?? 0 },
    };
    const mapped = presentation.mapMouse(this, event);
    return mapped ? originalMouse.call(this, mapped) : undefined;
  }
  target.render = render;
  target.handleMouse = handleMouse;
  return () => {
    active = false;
    presentation.invalidate();
    if (target.render === render) target.render = original;
    if (target.handleMouse === handleMouse) {
      if (hadMouse) target.handleMouse = originalMouse;
      else delete (target as { handleMouse?: unknown }).handleMouse;
    }
  };
}

/**
 * Native Loader owns the only animation clock. Decorate only the owned normal working row.
 * No retry/compaction hooks; unsupported layouts keep the public indicator fallback.
 */
export function observeWorkingRender(
  render: (options: WorkingIndicatorOptions | undefined, width: number) => string | undefined,
): (() => void) | undefined {
  type Indicator = { kind?: string; render(width: number): string[]; renderInBorder(width: number): string };
  type Host = { workingIndicatorOptions?: WorkingIndicatorOptions; activeStatusIndicator?: Indicator };
  const target = Pi.InteractiveMode?.prototype as unknown as { showWorkingStatusIndicator(this: Host): void };
  const original = target?.showWorkingStatusIndicator;
  if (typeof original !== "function" || original.name !== "showWorkingStatusIndicator"
    || !original.toString().includes("new WorkingStatusIndicator(")) return;
  let active = true;
  const restorers = new Set<() => boolean>();
  function omtShowWorking(this: Host) {
    original.call(this);
    for (const restore of restorers) if (restore()) restorers.delete(restore);
    const indicator = this.activeStatusIndicator;
    if (!indicator || indicator.kind !== "working" || typeof indicator.render !== "function"
      || typeof indicator.renderInBorder !== "function" || render(this.workingIndicatorOptions, 80) === undefined) return;
    const ref = new WeakRef(indicator);
    const options = this.workingIndicatorOptions;
    const originalRender = indicator.render;
    const originalBorder = indicator.renderInBorder;
    function omtRender(this: Indicator, width: number): string[] {
      const line = active ? render(options, width) : undefined;
      return line === undefined ? originalRender.call(this, width) : ["", line];
    }
    function omtBorder(this: Indicator, width: number): string {
      return (active ? render(options, width) : undefined) ?? originalBorder.call(this, width);
    }
    indicator.render = omtRender;
    indicator.renderInBorder = omtBorder;
    restorers.add(() => {
      const component = ref.deref();
      if (!component) return true;
      if (!active) {
        if (component.render === omtRender) component.render = originalRender;
        if (component.renderInBorder === omtBorder) component.renderInBorder = originalBorder;
      }
      return !active;
    });
  }
  target.showWorkingStatusIndicator = omtShowWorking;
  return () => {
    active = false;
    if (target.showWorkingStatusIndicator === omtShowWorking) target.showWorkingStatusIndicator = original;
    for (const restore of restorers) restore();
    restorers.clear();
  };
}
