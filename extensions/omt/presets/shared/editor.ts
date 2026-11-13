// Shared native editor geometry and preset decorations.
import { CustomEditor, type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, renderFakeCursor, stripTerminalSequences, type EditorTheme, type TerminalColors, type TUI, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { contentPadding, isCleanTheme, isRailTheme, isEmberTheme, isSignatureTheme, omtStyle, quiet } from "./style.ts";
import { getActiveTheme } from "../../core/theme.ts";
import { primeCleanPalette, queryCleanPalette } from "../omt-clean/rendering.ts";
import { railEditor } from "../omt-rail/editor.ts";
import { cleanEditor } from "../omt-clean/editor.ts";
import { promptEditor } from "./editor-prompt.ts";
import { emberEditor, emberEditorBorder } from "../omt-ember/editor.ts";
import { signatureEditor, signatureEditorBorder, signatureEditorStatusline, formatSignatureHints, formatSignatureStatsLine, type SignatureEditorOptions, type SignatureStatuslineData } from "../omt-signature/editor.ts";
import type { SignatureColorRole } from "../omt-signature/rendering.ts";

export type { SignatureStatuslineData } from "../omt-signature/editor.ts";
export type SignatureStatuslineProvider = () => SignatureStatuslineData | undefined;

// Obtain the unfocused cursor marker through the exported presentation helper.
const fakeCursorPrefix = renderFakeCursor("\u0000").split("\u0000")[0]!;

export interface CleanEditorOptions {
  framed?: boolean;
  statuslineProvider?: SignatureStatuslineProvider;
}

/** Display-only decoration: Pi owns layout, cursor, completion and all input. */
export class CleanEditor extends CustomEditor {
  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    palette: () => Theme,
    metadata: () => string = () => "",
    terminalColors: () => TerminalColors | undefined = () => undefined,
    options?: CleanEditorOptions,
  ) {
    super(tui, theme, keybindings);
    this.palette = palette;
    this.metadata = metadata;
    this.framed = options?.framed ?? false;
    this.statuslineProvider = options?.statuslineProvider;
    this.nativePadding = 1;
    const active = getActiveTheme();
    super.setPaddingX(isSignatureTheme(active) ? Math.max(4, contentPadding(1)) : contentPadding(1));
    this.repaint = () => tui.requestRender();
    this.queryPalette = () => {
      const colors = terminalColors();
      if (colors) primeCleanPalette(tui, colors);
      else queryCleanPalette(tui);
    };
    if (isCleanTheme(getActiveTheme())) this.queryPalette();

    // Dynamic own-property descriptor: active only for omt-signature
    Object.defineProperty(this, "embedWorkingStatus", {
      get: () => isSignatureTheme(getActiveTheme()),
      set: (_val: boolean) => {},
      configurable: true,
      enumerable: true,
    });

    // Dynamic own-property descriptor for public onSubmit wrapping
    type Submit = (text: string) => void | Promise<void>;
    let submit = this.onSubmit as Submit | undefined;
    Object.defineProperty(this, "onSubmit", {
      get: () => submit,
      set: (handler: Submit | undefined) => {
        // Capture each assigned handler by value. A later decorator may retain
        // the previous wrapper; referring to the latest handler would recurse.
        submit = handler && (async (text: string) => {
          if (this.commandInterceptor && (await this.commandInterceptor(text))) return;
          return handler(this.submitPresentation?.(text) ?? text);
        });
      },
      configurable: true,
      enumerable: true,
    });
  }

  private readonly palette: () => Theme;
  private readonly metadata: () => string;
  private readonly repaint: () => void;
  private readonly queryPalette: () => void;
  private nativePadding = 1;
  private framed: boolean;
  private statuslineProvider?: SignatureStatuslineProvider;
  private signatureMetadata?: SignatureStatuslineData;
  private commandInterceptor?: (text: string) => Promise<boolean> | boolean;
  private submitPresentation?: (text: string) => string;

  setSubmitPresentation(transform: ((text: string) => string) | undefined): void {
    this.submitPresentation = transform;
  }
  private signatureRows?: { start: number; nativeVisible: number; visible: number };

  setStatuslineProvider(provider: SignatureStatuslineProvider | undefined): void {
    this.statuslineProvider = provider;
    this.invalidate();
    this.repaint();
  }

  updateSignatureMetadata(data: SignatureStatuslineData): void {
    this.signatureMetadata = { ...this.signatureMetadata, ...data };
    this.invalidate();
    this.repaint();
  }

  setCommandInterceptor(interceptor: ((text: string) => Promise<boolean> | boolean) | undefined): void {
    this.commandInterceptor = interceptor;
  }

  getSignatureStatuslineData(): SignatureStatuslineData {
    if (this.statuslineProvider) {
      const data = this.statuslineProvider();
      if (data) return data;
    }
    const isWorking = (this as any).workingStatusIndicator !== undefined;
    return {
      model: this.metadata(),
      isThinking: isWorking,
      ...this.signatureMetadata,
    };
  }

  /** Configure rounded framing presentation. */
  setFramed(framed: boolean): void {
    this.framed = framed;
    this.invalidate();
    this.repaint();
  }

  isFramed(): boolean {
    return this.framed;
  }

  /** Live presets share one native editor, including cursor, undo and completion. */
  refreshPresentation(): void {
    const active = getActiveTheme();
    const effectivePadding = isSignatureTheme(active) ? Math.max(4, contentPadding(this.nativePadding)) : contentPadding(this.nativePadding);
    super.setPaddingX(effectivePadding);
    if (isCleanTheme(active)) this.queryPalette();
    this.invalidate();
    this.repaint();
  }

  override setPaddingX(padding: number): void {
    // Reserve space for the indicator using native padding, not a text offset.
    this.nativePadding = padding;
    const active = getActiveTheme();
    const effectivePadding = isSignatureTheme(active) ? Math.max(4, contentPadding(padding)) : contentPadding(padding);
    super.setPaddingX(effectivePadding);
  }

  protected override renderTopBorder(width: number, hidden: number): string {
    if (width < omtStyle.minWidth) return super.renderTopBorder(width, hidden);
    return this.frame(super.renderTopBorder(width, hidden), "top", width);
  }

  protected override renderBottomBorder(width: number, hidden: number): string {
    if (width < omtStyle.minWidth) return super.renderBottomBorder(width, hidden);
    return this.frame(super.renderBottomBorder(width, hidden), "bottom", width);
  }

  private frame(border: string, position?: "top" | "bottom", width?: number): string {
    const active = getActiveTheme();
    if (active.editor.frame === "native") return border;
    if (isEmberTheme(active)) return emberEditorBorder(this.palette(), stripTerminalSequences(border));
    if (isSignatureTheme(active)) {
      const statusData = this.getSignatureStatuslineData();
      const isWorking = Boolean(
        statusData.isThinking ||
        statusData.isStreaming ||
        (this as any).workingStatusIndicator !== undefined ||
        statusData.compacting ||
        statusData.branchSummarizing
      );
      const role: SignatureColorRole = statusData.shellOn
        ? "cyan"
        : isWorking
          ? "green"
          : "input";
      return signatureEditorBorder(this.palette(), stripTerminalSequences(border), {
        position,
        framed: this.framed,
        role,
        width,
      });
    }
    if (active.editor.frame === "line") {
      return this.palette().fg(active.color.border, border);
    }
    // Blank framing keeps native cursor geometry; retain overflow/status labels.
    return quiet(this.palette(), stripTerminalSequences(border).replace(/─/g, " "));
  }

  override handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    const active = getActiveTheme();
    const rows = this.signatureRows;
    if (!isSignatureTheme(active) || !rows) return super.handleMouse?.(event);
    const statuslineRow = rows.visible + 1;
    const bottomBorderRow = rows.visible + 2;
    if (event.y === statuslineRow || event.y === bottomBorderRow) {
      if (event.type === "wheel") return undefined;
      return { handled: true, focus: event.button === "left" && (event.type === "click" || event.type === "press"), render: false };
    }
    if (event.y >= 1 && event.y <= rows.visible) {
      const nativeRow = Math.min(rows.nativeVisible, rows.start + event.y);
      return super.handleMouse?.({ ...event, y: nativeRow });
    }
    if (this.isShowingAutocomplete() && event.y > bottomBorderRow) {
      const shift = rows.visible + 1 - rows.nativeVisible;
      return super.handleMouse?.({ ...event, y: event.y - shift });
    }
    return super.handleMouse?.(event);
  }

  override render(width: number): string[] {
    this.signatureRows = undefined;
    const lines = super.render(width);
    if (width < omtStyle.minWidth) return lines;
    const theme = this.palette();
    const active = getActiveTheme();
    if (active.id === "native") return lines;

    const host = this as unknown as { renderedAutocompleteHeight?: number };
    const autocompleteHeight = host.renderedAutocompleteHeight ?? 0;
    const boxHeight = lines.length - autocompleteHeight;

    if (isSignatureTheme(active)) {
      const statusData = this.getSignatureStatuslineData();
      const isWorking = Boolean(
        statusData.isThinking ||
        statusData.isStreaming ||
        (this as any).workingStatusIndicator !== undefined ||
        statusData.compacting ||
        statusData.branchSummarizing
      );
      const role: SignatureColorRole = statusData.shellOn
        ? "cyan"
        : isWorking
          ? "green"
          : "input";

      const left = formatSignatureHints(statusData);
      const right = formatSignatureStatsLine(statusData);
      const statusline = signatureEditorStatusline(theme, width, {
        left,
        right,
        framed: this.framed,
        role,
      });

      const nativeBody = lines.slice(1, boxHeight - 1);
      const cursorRow = Math.max(0, nativeBody.findIndex(line => line.includes(CURSOR_MARKER) || (fakeCursorPrefix.length > 0 && line.includes(fakeCursorPrefix))));
      const visible = 3;
      const start = Math.max(0, Math.min(cursorRow - visible + 1, nativeBody.length - visible));
      const body = nativeBody.slice(start, start + visible);
      while (body.length < visible) body.push(" ".repeat(width));
      this.signatureRows = { start, nativeVisible: nativeBody.length, visible };
      const boxLines = [lines[0]!, ...body, lines[boxHeight - 1]!];
      const autocompleteLines = lines.slice(boxHeight);

      const data = {
        lines: boxLines,
        width,
        boxHeight: boxLines.length,
        padding: this.getPaddingX(),
        text: this.getText(),
        metadata: this.metadata(),
      };
      const decorated = signatureEditor(theme, data, {
        framed: this.framed,
        role,
        focused: this.focused,
        scrollStart: start,
        placeholder: statusData.shellOn
          ? "Shell mode — type a command, Enter runs it · Esc exits"
          : "Type a message… (/ commands · ^V paste)",
      });

      // Insert statusline immediately before bottom border (at index decorated.length - 1)
      const bottomBorder = decorated[decorated.length - 1]!;
      return [
        ...decorated.slice(0, -1),
        statusline,
        bottomBorder,
        ...autocompleteLines,
      ];
    }

    const data = { lines, width, boxHeight, padding: this.getPaddingX(), text: this.getText(), metadata: this.metadata() };
    return isRailTheme(active)
      ? railEditor(theme, data)
      : isCleanTheme(active)
        ? cleanEditor(theme, data)
        : isEmberTheme(active)
          ? emberEditor(theme, data)
          : promptEditor(theme, data);
  }
}
