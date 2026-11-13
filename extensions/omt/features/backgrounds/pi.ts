import * as PiTui from "@earendil-works/pi-tui";
import type { TUI } from "@earendil-works/pi-tui";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

/** Read the host renderer without mounting a widget or replacing any layout. */
export function readNativeBackgroundTui(ui: ExtensionUIContext): TUI | undefined {
  const getter = (ui as ExtensionUIContext & { getBackgroundTui?(): TUI }).getBackgroundTui;
  return typeof getter === "function" ? getter.call(ui) : undefined;
}

type BackdropHost = TUI & {
  mode: string;
  altScreenActive: boolean;
  stopped: boolean;
  applySearchHighlights(screen: string[], layout: unknown): string[];
  doRender(): void;
  previousScreen: string[];
  selectionAnchor?: { scrollView?: unknown };
  getActiveSelectionText(): string | undefined;
  handleViewportInput(data: string): unknown;
  beforeTerminalStart(): void;
  beforeTerminalStop(options: unknown): void;
};

/** Pipeline-version guard, not a package-version allowlist: 1.5.0 and 1.5.1
 * differ in image output, but share this pre-overlay/pre-selection boundary. */
export function supportsNativeBackdrop(tui: unknown): boolean {
  const constructor = (PiTui as unknown as { TuiAltScreen?: { prototype: BackdropHost } }).TuiAltScreen;
  if (!constructor || !tui || Object.getPrototypeOf(tui) !== constructor.prototype) return false;
  const host = tui as BackdropHost;
  const source = constructor.prototype.doRender?.toString() ?? "";
  const stages = [".resolveFakeCursors(", ".applySearchHighlights(", ".compositeOverlays(", ".applySelection(", ".extractCursorPosition(", ".applyLineResets(", ".terminal.write("];
  let previous = -1;
  for (const stage of stages) {
    const index = source.indexOf(stage);
    if (index <= previous) return false;
    previous = index;
  }
  return host.mode === "fullscreen" && typeof host.altScreenActive === "boolean"
    && host.applySearchHighlights === constructor.prototype.applySearchHighlights
    && host.applySearchHighlights?.name === "applySearchHighlights"
    && host.getActiveSelectionText === constructor.prototype.getActiveSelectionText
    && host.getActiveSelectionText?.name === "getActiveSelectionText"
    && host.getActiveSelectionText.toString().includes(".scrollContentLines")
    && ["handleViewportInput", "beforeTerminalStart", "beforeTerminalStop"].every((key) => {
      const method = key as "handleViewportInput" | "beforeTerminalStart" | "beforeTerminalStop";
      return typeof host[method] === "function" && host[method] === constructor.prototype[method];
    });
}

/** Native layout, selection source, images, diffing and terminal output stay Pi-owned. */
export function installNativeBackdrop(
  tui: TUI,
  compose: (screen: string[], width: number, height: number) => string[],
  visibilityChanged: (visible: boolean) => void = () => {},
): { owned(): boolean; visible(): boolean; dispose(): void } | undefined {
  if (!supportsNativeBackdrop(tui)) return;
  const host = tui as BackdropHost;
  const original = host.applySearchHighlights;
  const originalSelection = host.getActiveSelectionText;
  const originalInput = host.handleViewportInput;
  const originalStart = host.beforeTerminalStart;
  const originalStop = host.beforeTerminalStop;
  let foreground: string[] = [];
  let active = true;
  function omtBackdrop(this: BackdropHost, screen: string[], layout: unknown): string[] {
    if (active) foreground = screen;
    const lines = owned() && this.altScreenActive && !this.stopped
      ? compose(screen, Math.max(1, this.terminal.columns), Math.max(1, this.terminal.rows)) : screen;
    return original.call(this, lines, layout);
  }
  function omtSelection(this: BackdropHost): string | undefined {
    if (!owned() || this.hasOverlay() || this.selectionAnchor?.scrollView) return originalSelection.call(this);
    // Native fixed-region selection otherwise reads previousScreen (wallpaper
    // included). Supply the untouched foreground only for this synchronous read.
    const screen = this.previousScreen;
    try { this.previousScreen = foreground; return originalSelection.call(this); }
    finally { this.previousScreen = screen; }
  }
  function omtInput(this: BackdropHost, data: string): unknown {
    if (active && (data === "\x1b[I" || data === "\x1b[O")) visibilityChanged(data === "\x1b[I");
    return originalInput.call(this, data);
  }
  function omtStart(this: BackdropHost): void {
    originalStart.call(this);
    if (active) visibilityChanged(true);
  }
  function omtStop(this: BackdropHost, options: unknown): void {
    if (active) visibilityChanged(false);
    originalStop.call(this, options);
  }
  function owned(): boolean {
    return active && host.applySearchHighlights === omtBackdrop && host.getActiveSelectionText === omtSelection
      && host.handleViewportInput === omtInput && host.beforeTerminalStart === omtStart && host.beforeTerminalStop === omtStop;
  }
  host.applySearchHighlights = omtBackdrop;
  host.getActiveSelectionText = omtSelection;
  host.handleViewportInput = omtInput;
  host.beforeTerminalStart = omtStart;
  host.beforeTerminalStop = omtStop;
  return {
    owned,
    visible: () => host.altScreenActive && !host.stopped,
    dispose() {
      active = false; // Foreign wrappers may retain us: become inert too.
      foreground = [];
      if (host.handleViewportInput === omtInput) delete (host as Partial<BackdropHost>).handleViewportInput;
      if (host.beforeTerminalStart === omtStart) delete (host as Partial<BackdropHost>).beforeTerminalStart;
      if (host.beforeTerminalStop === omtStop) delete (host as Partial<BackdropHost>).beforeTerminalStop;
      if (host.getActiveSelectionText === omtSelection) delete (host as Partial<BackdropHost>).getActiveSelectionText;
      if (host.applySearchHighlights === omtBackdrop) {
        delete (host as Partial<BackdropHost>).applySearchHighlights;
        tui.requestRender();
      }
    },
  };
}

