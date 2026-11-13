import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { sliceByColumn, stripTerminalSequences, visibleWidth, type Component, type Focusable, type OverlayAnchor, type TUI } from "@earendil-works/pi-tui";

export interface ModalPresentation {
  anchor?: OverlayAnchor;
  /** Keep source-rendered horizontal margins instead of centering twice. */
  fullWidth?: boolean;
  /** Rows reserved below a bottom panel (source tree leaves two hint rows). */
  bottomInset?: number;
  /** Tree-only: compose the last native visible transcript rows above the panel. */
  transcriptTail?: boolean;
}

export type ModalFactory<T> = (tui: any, theme: any, keybindings: any, done: (value?: T) => void) => any;

/** One modal guard per extension runtime; Pi owns focus, keys and disposal. */
export function createModalHost() {
  let active = false;
  let generation = 0;
  let cancelCurrent: (() => void) | undefined;
  return {
    reset() {
      const cancel = cancelCurrent;
      cancelCurrent = undefined;
      generation++;
      active = false;
      cancel?.();
    },
    async open<T>(
      ctx: ExtensionContext,
      factory: ModalFactory<T>,
      presentation?: ModalPresentation,
    ): Promise<T | undefined> {
      if (!ctx.hasUI || ctx.mode !== "tui") {
        ctx.ui?.notify?.("Interactive UI requires TUI mode.", "warning");
        return undefined;
      }
      if (active) {
        ctx.ui?.notify?.("Another OMT dialog is already open.", "warning");
        return undefined;
      }
      active = true;
      const epoch = ++generation;
      try {
        let child: (Component & Partial<Focusable> & { dispose?(): void }) | undefined;
        const complete = (done: (value: T | undefined) => void) => {
          cancelCurrent = () => done(undefined);
          return (value?: T) => {
            if (epoch !== generation) return;
            active = false;
            cancelCurrent = undefined;
            done(value);
          };
        };
        if (!presentation) {
          return await ctx.ui.custom<T | undefined>((tui, theme, keybindings, done) =>
            factory(tui, theme, keybindings, complete(done)));
        }
        return await ctx.ui.custom<T | undefined>((tui, theme, keybindings, done) => {
          const component = factory(tui, theme, keybindings, complete(done)) as NonNullable<typeof child>;
          child = component;
          let pendingFrame: string | undefined;

          function getGeometry(termWidth: number, termHeight: number) {
            const anchor = presentation!.anchor ?? "center";
            const requestedInset = presentation!.bottomInset ?? 0;
            const inset = Number.isFinite(requestedInset) ? Math.max(0, Math.floor(requestedInset)) : 0;
            const availBottomH = Math.max(1, termHeight - inset);
            const lines = component.render(termWidth).slice(0, anchor.startsWith("bottom") ? availBottomH : termHeight);
            const naturalWidth = presentation!.fullWidth
              ? termWidth
              : lines.reduce((max, line) => Math.max(max, visibleWidth(line)), 1);
            const boxW = Math.min(termWidth, naturalWidth);
            const freeCols = Math.max(0, termWidth - boxW);
            const leftPad = anchor.includes("left") ? 0 : anchor.includes("right") ? freeCols : Math.floor(freeCols / 2);
            let topPad = 0;
            if (anchor.startsWith("top")) {
              topPad = 0;
            } else if (anchor.startsWith("bottom")) {
              topPad = Math.max(0, availBottomH - lines.length);
            } else {
              // OMT centers dialogs within (winH - 2), reserving bottom rows for dialog hints
              const availH = Math.max(1, termHeight - 2);
              topPad = Math.max(0, Math.floor((availH - lines.length) / 2));
            }
            return { lines, boxW, leftPad, topPad };
          }

          return {
            get focused() { return component.focused ?? false; },
            set focused(value: boolean) { component.focused = value; },
            get capturesViewportInput() { return component.capturesViewportInput; },
            get wantsKeyRelease() { return component.wantsKeyRelease; },
            render(renderWidth?: number) {
              const termWidth = Math.max(1, tui.terminal?.columns ?? renderWidth ?? 80);
              const termHeight = Math.max(1, tui.terminal?.rows ?? 24);
              const effectiveWidth = renderWidth ?? termWidth;
              const { lines, boxW, leftPad, topPad } = getGeometry(termWidth, termHeight);

              const out: string[] = [];
              const reader = (ctx.ui as typeof ctx.ui & {
                getNativeTranscriptRows?(width: number, height: number): string[] | undefined;
              }).getNativeTranscriptRows;
              const tail = presentation!.transcriptTail && reader
                ? reader.call(ctx.ui, termWidth, termHeight) : undefined;
              if (tail) {
                while (tail.length && !stripTerminalSequences(tail.at(-1)!).trim()) tail.pop();
                pendingFrame = undefined;
                const visible = topPad > 0 ? tail.slice(-topPad) : [];
                for (let r = visible.length; r < topPad; r++) out.push(" ".repeat(effectiveWidth));
                if (topPad > 0) for (const line of visible) {
                  const clipped = sliceByColumn(line, 0, effectiveWidth, true);
                  out.push(clipped + " ".repeat(Math.max(0, effectiveWidth - visibleWidth(clipped))));
                }
              } else {
                const geometry = `${termWidth}x${termHeight}`;
                if (presentation!.transcriptTail && reader && pendingFrame !== geometry) {
                  pendingFrame = geometry;
                  tui.requestRender(); // native publishes its new layout after this overlay pass
                }
                for (let r = 0; r < topPad; r++) out.push(" ".repeat(effectiveWidth));
              }
              for (const line of lines) {
                const lineW = visibleWidth(line);
                const safeLeftPad = Math.min(leftPad, Math.max(0, effectiveWidth - lineW));
                const padLeft = " ".repeat(safeLeftPad);
                const padRight = " ".repeat(Math.max(0, effectiveWidth - safeLeftPad - lineW));
                const paddedLine = padLeft + line + padRight;
                out.push(visibleWidth(paddedLine) > effectiveWidth ? sliceByColumn(paddedLine, 0, effectiveWidth, true) : paddedLine);
              }
              while (out.length < termHeight) {
                out.push(" ".repeat(effectiveWidth));
              }
              return out;
            },
            handleInput(data: string) { component.handleInput?.(data); },
            handleMouse(event) {
              const termWidth = Math.max(1, tui.terminal?.columns ?? event.width ?? 80);
              const termHeight = Math.max(1, tui.terminal?.rows ?? event.height ?? 24);
              const { lines, boxW, leftPad, topPad } = getGeometry(termWidth, termHeight);
              const childHeight = lines.length;

              // Check if mouse event is within the child dialog rectangle
              const childX = event.x - leftPad;
              const childY = event.y - topPad;
              if (childX < 0 || childX >= boxW || childY < 0 || childY >= childHeight) {
                return undefined;
              }

              return component.handleMouse?.({
                ...event,
                x: childX,
                y: childY,
                width: termWidth,
                height: childHeight,
              });
            },
            invalidate() { component.invalidate(); },
            dispose() { component.dispose?.(); },
          };
        }, {
          overlay: true,
          overlayOptions: () => ({
            width: "100%",
            maxHeight: "100%",
            row: 0,
            col: 0,
          }),
        });
      } finally { if (epoch === generation) { active = false; cancelCurrent = undefined; } }
    },
  };
}
