import { homedir } from "node:os";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, type TUI, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { getActiveTheme } from "../../core/theme.ts";
import { signatureFg } from "../../presets/omt-signature/rendering.ts";

export const OMT_HEADER_OWNER = Symbol.for("oh-my-tui.header-owner");

function shortenCwd(p: string): string {
  const home = homedir();
  if (home && (p === home || p.startsWith(home + "/") || p.startsWith(home + "\\"))) {
    return "~" + p.slice(home.length);
  }
  return p;
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

const BRAND_GLYPHS = [
  ["█████", "█   █", "█   █", "█   █", "█████"], // O
  ["█   █", "██ ██", "█ █ █", "█   █", "█   █"], // M
  ["█████", "  █  ", "  █  ", "  █  ", "  █  "], // T
];

function buildBrandLogo(): string[] {
  const rows: string[] = [];
  for (let r = 0; r < 5; r++) {
    const parts = BRAND_GLYPHS.map((g) => g[r]!);
    rows.push("      " + parts.join(" "));
  }
  return rows;
}

export interface HeaderControl {
  on(ctx: ExtensionContext): string;
  off(ctx: ExtensionContext): string;
  isEnabled(): boolean;
  applyTheme(ctx: ExtensionContext): void;
  cleanup(ctx?: ExtensionContext): void;
}

interface CommandSummary {
  ext: number;
  prompt: number;
  skill: number;
  builtin: number | undefined;
}

function summarizeCommands(pi?: ExtensionAPI, ctx?: ExtensionContext): CommandSummary {
  let cmds: Array<{ source?: string }> = [];
  try {
    if (typeof pi?.getCommands === "function") {
      cmds = pi.getCommands() as Array<{ source?: string }>;
    } else if (typeof (ctx as any)?.getCommands === "function") {
      cmds = (ctx as any).getCommands() as Array<{ source?: string }>;
    } else if (Array.isArray((ctx as any)?.commands)) {
      cmds = (ctx as any).commands;
    }
  } catch {
    cmds = [];
  }

  let ext = 0;
  let prompt = 0;
  let skill = 0;
  // Public Pi getCommands excludes interactive built-ins. Absence is unknown,
  // not a measured zero; only explicit source-tagged observations can count them.
  let builtin: number | undefined;

  for (const c of cmds) {
    const s = c?.source;
    if (s === "extension") {
      ext++;
    } else if (s === "prompt") {
      prompt++;
    } else if (s === "skill") {
      skill++;
    } else if (s === "builtin" || s === "omt") {
      builtin = (builtin ?? 0) + 1;
    }
  }

  return { ext, prompt, skill, builtin };
}

export class CleanHeaderComponent implements Component {
  readonly [OMT_HEADER_OWNER] = true;
  private readonly getCtx: () => ExtensionContext | undefined;
  private readonly theme: () => Theme;
  private readonly pi?: ExtensionAPI;

  constructor(
    theme: Theme | (() => Theme),
    getCtx: () => ExtensionContext | undefined,
    pi?: ExtensionAPI,
  ) {
    this.theme = typeof theme === "function" ? theme : () => theme;
    this.getCtx = getCtx;
    this.pi = pi;
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (width <= 0) return [];
    const theme = this.theme();
    const active = getActiveTheme();

    if (active.id === "omt-signature") {
      return this.renderSignatureHeader(width, theme);
    }

    return this.renderStandardHeader(width, theme, active.id);
  }

  private renderSignatureHeader(width: number, theme: Theme): string[] {
    let ctx: ExtensionContext | undefined;
    try { ctx = this.getCtx(); } catch { /* A retained transition header may outlive its session context. */ }
    let cwd = "";
    try { cwd = ctx?.cwd ? shortenCwd(ctx.cwd) : ""; } catch { /* Keep the retained welcome safe until the new session mounts. */ }
    let session = "";
    try {
      session = ctx?.sessionManager?.getSessionName?.() ?? "";
      if (!session) {
        const sid = ctx?.sessionManager?.getSessionId?.();
        if (sid) session = shortId(sid);
      }
    } catch {}

    let headerLeft = cwd;
    if (session && cwd) {
      headerLeft = `${session} · ${cwd}`;
    } else if (session) {
      headerLeft = session;
    }

    // Short header line to at most 48 columns
    const maxHeaderLen = Math.min(48, width);
    headerLeft = truncateToWidth(headerLeft, maxHeaderLen, "…");
    const headerLine = theme.fg("muted", headerLeft);

    let isEmptySession = true;
    try {
      const entries = ctx?.sessionManager?.getEntries?.() ?? [];
      if (entries.some((e: any) => e.type === "message")) {
        isEmptySession = false;
      }
    } catch {
      isEmptySession = false;
    }

    if (!isEmptySession) {
      return [headerLine];
    }

    const welcomeLines = this.renderSignatureWelcome(width, theme);
    return [headerLine, ...welcomeLines];
  }

  private renderSignatureWelcome(width: number, theme: Theme): string[] {
    const brandLogo = buildBrandLogo();
    const logo = brandLogo.map((ln) => signatureFg(theme, "text", ln));

    const title = theme.bold(signatureFg(theme, "text", "OMT"));
    const hints = signatureFg(theme, "muted", "/ commands · ! bash · ctrl+o more");
    const ready = signatureFg(theme, "green", "●") + " " + theme.bold(signatureFg(theme, "text", "ready"));
    const details = [title, hints, ready];

    const counts = summarizeCommands(this.pi, this.getCtx());
    const res =
      theme.bold(signatureFg(theme, "text", "◆")) + " " +
      theme.bold(signatureFg(theme, "text", "Resources")) +
      signatureFg(theme, "muted", "  ·  ext ") +
      theme.bold(signatureFg(theme, "text", String(counts.ext))) +
      signatureFg(theme, "muted", "  ·  prompt ") +
      theme.bold(signatureFg(theme, "text", String(counts.prompt))) +
      signatureFg(theme, "muted", "  ·  skill ") +
      theme.bold(signatureFg(theme, "text", String(counts.skill))) +
      signatureFg(theme, "muted", "  ·  builtin ") +
      theme.bold(signatureFg(theme, "text", counts.builtin === undefined ? "—" : String(counts.builtin)));

    const logoW = visibleWidth(brandLogo[0] ?? "");
    let detailW = 0;
    for (const d of details) {
      const dw = visibleWidth(d);
      if (dw > detailW) detailW = dw;
    }

    let rows: string[] = [];
    if (width >= logoW + 3 + detailW) {
      const start = Math.max(0, logo.length - details.length);
      rows = logo.map((row, i) => {
        const j = i - start;
        if (j >= 0 && j < details.length) {
          return row + "   " + details[j];
        }
        return row;
      });
      rows.push("", res);
    } else {
      rows = [...logo, "", ...details, "", res];
    }

    // Signature gutter: bullet on its own row, then all five logo rows at one column.
    const bullet = signatureFg(theme, "muted", "●");
    const result: string[] = [bullet];
    for (const ln of rows) {
      if (ln === "") {
        result.push("");
        continue;
      }
      result.push(ln);
    }

    return result.map((ln) => truncateToWidth(ln, width, ""));
  }

  private renderStandardHeader(width: number, theme: Theme, activeId: string): string[] {
    const appName = "Oh My TUI";
    const cardWidth = Math.min(width, 100);

    // Line 1: Top framed border with brand title and preset badge
    const title = signatureFg(theme, "accent", "◈ ") + theme.bold(signatureFg(theme, "text", appName));
    const badge = signatureFg(theme, "dim", "[") + signatureFg(theme, "cyan", activeId) + signatureFg(theme, "dim", "]");
    const prefix = signatureFg(theme, "border", "╭─ ");
    const suffix = signatureFg(theme, "border", " ─╮");
    const fixLen = 3 + visibleWidth(title) + 2 + visibleWidth(badge) + 3;
    const fillLen = Math.max(1, cardWidth - fixLen);
    const line1 = prefix + title + signatureFg(theme, "border", " " + "─".repeat(fillLen) + " ") + badge + suffix;

    // Line 2: Bottom framed border with quick discoverable controls (avoids duplicating footer model/branch)
    const ctrlPrefix = signatureFg(theme, "dim", "Controls: ");
    const cmds = ["/omt settings", "/omt palette", "/omt git", "/omt doctor"]
      .map((c) => signatureFg(theme, "teal", c))
      .join(signatureFg(theme, "dim", "  ·  "));
    const content = ctrlPrefix + cmds;

    const bPrefix = signatureFg(theme, "border", "╰─ ");
    const bSuffix = signatureFg(theme, "border", " ─╯");
    const bFixLen = 3 + visibleWidth(content) + 1 + 3;
    const bFillLen = Math.max(1, cardWidth - bFixLen);
    const line2 = bPrefix + content + signatureFg(theme, "border", " " + "─".repeat(bFillLen)) + bSuffix;

    return [truncateToWidth(line1, width, ""), truncateToWidth(line2, width, "")];
  }
}

export function createHeaderControl(pi?: ExtensionAPI): HeaderControl {
  let enabled = true;
  let currentContext: ExtensionContext | undefined;

  function compatible(ctx: ExtensionContext): boolean {
    return ctx.mode === "tui" && typeof ctx.ui?.setHeader === "function"
      && typeof (ctx.ui as { getHeaderComponent?: unknown }).getHeaderComponent === "function";
  }

  function foreign(ctx: ExtensionContext): boolean {
    const current = (ctx.ui as typeof ctx.ui & { getHeaderComponent(): unknown }).getHeaderComponent();
    return Boolean(current && !(current as Record<symbol, unknown>)[OMT_HEADER_OWNER]);
  }

  function mount(ctx: ExtensionContext): void {
    if (!compatible(ctx) || foreign(ctx)) return;
    const active = getActiveTheme();
    if (active.id === "native") {
      ctx.ui.setHeader(undefined);
      return;
    }
    const ui = ctx.ui;
    const factory = (_tui: TUI, theme: Theme) => new CleanHeaderComponent(() => ui.theme ?? theme, () => ctx, pi);
    (factory as unknown as Record<symbol, unknown>)[OMT_HEADER_OWNER] = true;
    ctx.ui.setHeader(factory);
  }

  function unmount(ctx: ExtensionContext): void {
    if (compatible(ctx) && !foreign(ctx)) {
      ctx.ui.setHeader(undefined);
    }
  }

  return {
    on(ctx: ExtensionContext): string {
      if (!compatible(ctx)) return "OMT header unavailable: native header ownership API required in TUI mode.";
      if (foreign(ctx)) return "OMT header inactive: another extension owns the header.";
      currentContext = ctx;
      enabled = true;
      mount(ctx);
      return "OMT header on.";
    },
    off(ctx: ExtensionContext): string {
      if (!compatible(ctx)) return "OMT header unavailable: native header ownership API required in TUI mode.";
      currentContext = ctx;
      enabled = false;
      unmount(ctx);
      return "OMT header off.";
    },
    isEnabled(): boolean {
      return enabled;
    },
    applyTheme(ctx: ExtensionContext): void {
      if (!compatible(ctx)) return;
      currentContext = ctx;
      if (enabled) {
        mount(ctx);
      }
    },
    cleanup(ctx?: ExtensionContext): void {
      enabled = false;
      if (ctx && compatible(ctx)) {
        unmount(ctx);
      }
      currentContext = undefined;
    },
  };
}
