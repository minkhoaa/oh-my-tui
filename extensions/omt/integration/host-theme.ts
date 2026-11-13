import { Theme, type ExtensionContext, type ThemeColor } from "@earendil-works/pi-coding-agent";
import { colorToHex, type Color } from "@earendil-works/pi-tui";
import { signatureColor, type SignatureColorRole } from "../presets/omt-signature/rendering.ts";
import { configStore } from "../core/config.ts";
import { getPalette } from "../presets/omt-signature/palette.ts";

const roles = {
  accent: "accent", border: "border", borderAccent: "accent", borderMuted: "border",
  text: "text", muted: "muted", dim: "dim", success: "green", error: "red", warning: "yellow",
  thinkingText: "muted", selectedBg: "hiBg", searchMatchBg: "hiBg", searchMatchText: "hiFg",
  scrollbarTrack: "border", scrollbarThumb: "muted",
  userMessageBg: "surface", userMessageText: "text", customMessageBg: "surface",
  customMessageText: "text", customMessageLabel: "muted",
  toolPendingBg: "surface", toolSuccessBg: "surface", toolErrorBg: "surface",
  toolTitle: "text", toolOutput: "muted", toolDiffAdded: "green", toolDiffRemoved: "red", toolDiffContext: "muted",
  mdHeading: "cyan", mdLink: "cyan", mdLinkUrl: "muted", mdCode: "red", mdCodeBlock: "code",
  mdCodeBlockBorder: "border", mdQuote: "muted", mdQuoteBorder: "border", mdHr: "border", mdListBullet: "muted",
  syntaxComment: "muted", syntaxKeyword: "accent", syntaxFunction: "cyan", syntaxVariable: "text",
  syntaxString: "green", syntaxNumber: "yellow", syntaxType: "cyan", syntaxOperator: "muted", syntaxPunctuation: "muted",
  thinkingOff: "border", thinkingMinimal: "muted", thinkingLow: "cyan", thinkingMedium: "accent",
  thinkingHigh: "plan", thinkingXhigh: "yellow", thinkingMax: "red", bashMode: "shell",
} as const satisfies Partial<Record<keyof Theme["colors"], SignatureColorRole>>;

function colorValue(color: Color): string | number {
  return color.kind === "indexed" ? color.index : colorToHex(color);
}

/** Materialize public values: ctx.ui.theme can be a live facade, not a stable snapshot. */
export function snapshotHostTheme(theme: Theme): Theme {
  const values = {} as Record<keyof Theme["colors"], string | number>;
  const dim: ThemeColor[] = [];
  for (const key of Object.keys(theme.colors)) {
    let ansi: string;
    try {
      ansi = theme.getFgAnsi(key as ThemeColor);
      if (ansi.includes("\x1b[2m")) dim.push(key as ThemeColor);
    } catch {
      ansi = theme.getBgAnsi(key as Parameters<Theme["getBgAnsi"]>[0]);
    }
    // Public ANSI getters retain terminal-default slots and un-dimmed colors;
    // theme.colors intentionally resolves/mixes both and is not a lossless snapshot.
    const rgb = ansi.match(/\x1b\[(?:38|48);2;(\d+);(\d+);(\d+)m/);
    const indexed = ansi.match(/\x1b\[(?:38|48);5;(\d+)m/);
    if (/\x1b\[(?:39|49)m/.test(ansi)) values[key as keyof typeof values] = "";
    else if (rgb) values[key as keyof typeof values] = `#${rgb.slice(1).map(n => Number(n).toString(16).padStart(2, "0")).join("")}`;
    else if (indexed) values[key as keyof typeof values] = Number(indexed[1]);
    else throw new Error("Unsupported public theme color encoding");
  }
  return new Theme(values, values, theme.getColorMode(), {
    name: theme.name, sourcePath: theme.sourcePath, appearance: theme.appearance, dim,
  });
}

export function createSignatureHostTheme(base: Theme, name: string): Theme {
  const colors = Object.fromEntries(Object.entries(base.colors).map(([key, value]) => [key, colorValue(value)])) as Record<keyof Theme["colors"], string | number>;
  for (const [token, role] of Object.entries(roles)) {
    colors[token as keyof typeof colors] = colorValue(signatureColor(base, role));
  }
  // The selected palette determines appearance; auto follows the pre-OMT host.
  const selected = configStore.getSignaturePalette();
  const appearance = selected === "auto" ? base.appearance : getPalette(selected).light ? "light" : "dark";
  return new Theme(colors, colors, base.getColorMode(), { name, appearance });
}

function fingerprint(theme: Theme): string {
  return JSON.stringify([theme.name, theme.getColorMode(), theme.appearance, theme.colors]);
}

/** Public host-wide theme API only; no private Markdown/component mutation. */
export function createHostThemeControl() {
  let baseline: Theme | undefined;
  let owned: string | undefined;
  let yielded = false;
  let serial = 0;
  return {
    refresh(ctx: ExtensionContext, enabled: boolean, claim = false): string | undefined {
      if (!ctx.hasUI) return;
      try {
        const ui = ctx.ui;
        if (typeof ui.setTheme !== "function" || !ui.theme?.colors || typeof ui.theme.getColorMode !== "function") {
          return enabled ? "OMT host theme unavailable: public Theme API required." : undefined;
        }
        if (owned && fingerprint(ui.theme) !== owned) {
          baseline = undefined; owned = undefined; yielded = true;
        }
        if (!enabled) {
          if (owned && baseline) {
            const result = ui.setTheme(baseline);
            if (!result.success) return `OMT host theme unavailable: ${result.error ?? "restore failed"}`;
          }
          baseline = undefined; owned = undefined;
          return;
        }
        if (yielded && !claim) return;
        if (claim) yielded = false;
        baseline ??= snapshotHostTheme(ui.theme);
        const candidate = createSignatureHostTheme(baseline, `omt-signature-host-${serial}`);
        if (owned === fingerprint(candidate)) return;
        const result = ui.setTheme(candidate);
        if (!result.success) {
          if (!owned) baseline = undefined;
          return `OMT host theme unavailable: ${result.error ?? "theme rejected"}`;
        }
        owned = fingerprint(ui.theme);
      } catch {
        return enabled ? "OMT host theme unavailable: incompatible public Theme API." : undefined;
      }
    },
    cleanup(ctx?: ExtensionContext) {
      if (ctx) this.refresh(ctx, false);
      baseline = undefined; owned = undefined; yielded = false; serial++;
    },
  };
}
