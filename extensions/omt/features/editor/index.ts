import type { ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { getActiveTheme } from "../../core/theme.ts";
import { readNativeTerminalColors } from "../../core/native-ui.ts";
import { CleanEditor, type SignatureStatuslineData, type SignatureStatuslineProvider } from "../../presets/shared/editor.ts";
import { isSignatureTheme } from "../../presets/shared/style.ts";
import { setActiveTui } from "../../core/motion.ts";
import { configStore } from "../../core/config.ts";

export { CleanEditor, type SignatureStatuslineData, type SignatureStatuslineProvider } from "../../presets/shared/editor.ts";
type EditorFactory = NonNullable<Parameters<ExtensionUIContext["setEditorComponent"]>[0]>;

export interface EditorControl {
  on(ctx: ExtensionContext): string;
  off(ctx: ExtensionContext): string;
  isEnabled(): boolean;
  applyTheme(ctx: ExtensionContext): void;
  cleanup(ctx?: ExtensionContext): void;
  setStatuslineProvider?(provider: SignatureStatuslineProvider | undefined): void;
  updateSignatureMetadata?(data: SignatureStatuslineData): void;
  getInstance?(): CleanEditor | undefined;
  setSubmitPresentation?(transform: ((text: string) => string) | undefined): void;
  setCommandInterceptor?(interceptor: ((text: string) => Promise<boolean> | boolean) | undefined): void;
}

/** One stable factory identity per extension runtime; never reclaim another owner. */
export function createEditorControl(): EditorControl {
  let factory: EditorFactory | undefined;
  let instance: CleanEditor | undefined;
  let currentContext: ExtensionContext | undefined;
  let enabled = true;
  let storedStatuslineProvider: SignatureStatuslineProvider | undefined;
  let storedMetadata: SignatureStatuslineData | undefined;
  let submitPresentation: ((text: string) => string) | undefined;
  let storedCommandInterceptor: ((text: string) => Promise<boolean> | boolean) | undefined;

  function shouldFrame(): boolean {
    const active = getActiveTheme();
    return isSignatureTheme(active) ? (configStore.getSignature().framed ?? true) : false;
  }

  function syncFramed(): void {
    if (!instance || !enabled) return;
    const framed = shouldFrame();
    if (instance.isFramed() !== framed) {
      instance.setFramed(framed);
      instance.refreshPresentation();
    }
  }

  let unsubscribe: (() => void) | undefined = configStore.subscribe(() => {
    syncFramed();
  });

  function compatible(ctx: ExtensionContext): boolean {
    return ctx.mode === "tui" && typeof ctx.ui?.getEditorComponent === "function"
      && typeof ctx.ui.setEditorComponent === "function" && typeof ctx.ui.getEditorText === "function"
      && typeof ctx.ui.setEditorText === "function";
  }

  function mount(ctx: ExtensionContext): void {
    if (!factory) factory = (tui, theme, keys) => {
      setActiveTui(tui);
      instance = new CleanEditor(
        tui,
        theme,
        keys,
        () => currentContext?.ui.theme ?? ctx.ui.theme,
        () => [currentContext?.model?.name ?? currentContext?.model?.id, currentContext?.model?.provider].filter(Boolean).join(" · "),
        () => readNativeTerminalColors(currentContext?.ui ?? ctx.ui),
        {
          framed: shouldFrame(),
          statuslineProvider: storedStatuslineProvider ?? (() => {
            const usage = currentContext?.getContextUsage?.();
            const isIdle = currentContext?.isIdle?.() ?? true;
            return {
              model: [currentContext?.model?.name ?? currentContext?.model?.id, currentContext?.model?.provider].filter(Boolean).join(" · "),
              contextUsage: usage ? { percent: usage.percent, contextWindow: usage.contextWindow } : undefined,
              isThinking: !isIdle,
            };
          }),
        },
      );
      if (storedMetadata) instance.updateSignatureMetadata(storedMetadata);
      if (storedCommandInterceptor) instance.setCommandInterceptor(storedCommandInterceptor);
      instance.setSubmitPresentation(submitPresentation);
      return instance;
    };
    const draft = ctx.ui.getEditorText(); // Public API expands native paste markers.
    ctx.ui.setEditorComponent(factory);
    ctx.ui.setEditorText(draft);
  }

  function unmount(ctx: ExtensionContext): void {
    if (factory && ctx.ui.getEditorComponent() === factory) {
      const draft = ctx.ui.getEditorText();
      ctx.ui.setEditorComponent(undefined);
      ctx.ui.setEditorText(draft);
    }
  }

  return {
    on(ctx: ExtensionContext): string {
      if (!compatible(ctx)) return "OMT editor unavailable: native editor APIs required in TUI mode.";
      currentContext = ctx;
      enabled = true;
      const current = ctx.ui.getEditorComponent();
      if (current && current !== factory) return "OMT editor inactive: another extension owns the editor.";
      const active = getActiveTheme();
      if (active.id === "native") {
        unmount(ctx);
        return "OMT editor on (native presentation).";
      }
      if (!factory || current !== factory) {
        mount(ctx);
      } else if (instance) {
        instance.setFramed(shouldFrame());
        instance.refreshPresentation();
      }
      return "OMT editor on.";
    },
    off(ctx: ExtensionContext): string {
      if (!compatible(ctx)) return "OMT editor unavailable: native editor APIs required in TUI mode.";
      currentContext = ctx;
      enabled = false;
      unmount(ctx);
      return "OMT editor off; other editors left unchanged.";
    },
    isEnabled(): boolean {
      return enabled;
    },
    applyTheme(ctx: ExtensionContext): void {
      if (!compatible(ctx)) return;
      currentContext = ctx;
      const active = getActiveTheme();
      if (active.id === "native") {
        unmount(ctx);
        return;
      }
      if (enabled) {
        const current = ctx.ui.getEditorComponent();
        if (current === factory && factory) {
          instance?.setFramed(shouldFrame());
          instance?.refreshPresentation();
        }
        else if (!current) mount(ctx);
      }
    },
    cleanup(ctx?: ExtensionContext): void {
      enabled = false;
      unsubscribe?.();
      unsubscribe = undefined;
      if (ctx && compatible(ctx)) {
        unmount(ctx);
      }
      instance = undefined;
      currentContext = undefined;
    },
    setStatuslineProvider(provider: SignatureStatuslineProvider | undefined): void {
      storedStatuslineProvider = provider;
      instance?.setStatuslineProvider(provider);
    },
    updateSignatureMetadata(data: SignatureStatuslineData): void {
      storedMetadata = { ...storedMetadata, ...data };
      instance?.updateSignatureMetadata(data);
    },
    getInstance(): CleanEditor | undefined {
      return instance;
    },
    setSubmitPresentation(transform: ((text: string) => string) | undefined): void {
      submitPresentation = transform;
      instance?.setSubmitPresentation(transform);
    },
    setCommandInterceptor(interceptor: ((text: string) => Promise<boolean> | boolean) | undefined): void {
      storedCommandInterceptor = interceptor;
      instance?.setCommandInterceptor(interceptor);
    },
  };
}
