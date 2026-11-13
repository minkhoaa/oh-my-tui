import { Container, visibleWidth, truncateToWidth, matchesKey, Key, type Component, type KeybindingsManager, type TUI } from "@earendil-works/pi-tui";
import { DynamicBorder, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import type { PermissionRequest, PermissionReviewOptions, PermissionReviewFactory } from "./types.ts";
import { getBorderStyler } from "../../presets/shared/style.ts";
import { DANGER_LEVEL_MAP, fgSafe, boldSafe, dimSafe, assessRisk } from "./model.ts";

export class PermissionReviewComponent extends Container {
  private tui: TUI;
  private theme: Theme;
  private keybindings: KeybindingsManager;
  private done: (result?: { approved: boolean; remember?: boolean }) => void;
  private ctx: ExtensionContext;
  private options: PermissionReviewOptions;

  private topBorder: DynamicBorder;
  private midBorder: DynamicBorder;
  private botBorder: DynamicBorder;
  private scrollOffset = 0;
  private isClosed = false;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (result?: { approved: boolean; remember?: boolean }) => void,
    ctx: ExtensionContext,
    options: PermissionReviewOptions,
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done;
    this.ctx = ctx;
    this.options = options;

    const borderStyle = getBorderStyler(theme);
    this.topBorder = new DynamicBorder(borderStyle);
    this.midBorder = new DynamicBorder(borderStyle);
    this.botBorder = new DynamicBorder(borderStyle);

    this.addChild(this.topBorder);
    this.addChild(this.midBorder);
    this.addChild(this.botBorder);
  }

  getRequest(): PermissionRequest {
    return this.options.request;
  }

  getScrollOffset(): number {
    return this.scrollOffset;
  }

  private approve(remember: boolean): void {
    if (this.isClosed) return;
    this.isClosed = true;
    if (remember) {
      this.options.onApproveAlways?.();
    } else {
      this.options.onApprove?.();
    }
    this.done({ approved: true, remember });
  }

  private reject(remember = false): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.options.onReject?.();
    this.done({ approved: false, remember });
  }

  handleInput(data: string): void {
    if (this.isClosed) return;

    // 'y' / 'Y' -> Approve this time
    if (data === "y" || data === "Y") {
      this.approve(false);
      return;
    }

    // 'a' / 'A' -> Approve always
    if (data === "a" || data === "A") {
      this.approve(true);
      return;
    }

    // 'n' / 'N' -> Reject
    if (data === "n" || data === "N") {
      this.reject(false);
      return;
    }

    // Esc / 'q' / 'Q' -> Cancel (Reject)
    if (
      this.keybindings?.matches?.(data, "tui.select.cancel") ||
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.esc) ||
      data === "\x1b" ||
      data === "q" ||
      data === "Q"
    ) {
      this.reject(false);
      return;
    }

    // Up Arrow / 'k' -> Scroll preview up
    if (
      this.keybindings?.matches?.(data, "tui.select.up") ||
      matchesKey(data, Key.up) ||
      data === "\x1b[A" ||
      data === "k"
    ) {
      if (this.scrollOffset > 0) {
        this.scrollOffset--;
        this.tui.requestRender?.();
      }
      return;
    }

    // Down Arrow / 'j' -> Scroll preview down
    if (
      this.keybindings?.matches?.(data, "tui.select.down") ||
      matchesKey(data, Key.down) ||
      data === "\x1b[B" ||
      data === "j"
    ) {
      this.scrollOffset++;
      this.tui.requestRender?.();
      return;
    }
  }

  override render(width: number): string[] {
    const safeWidth = Math.max(1, width);
    const theme = this.theme;
    const req = this.options.request;
    const levelInfo = DANGER_LEVEL_MAP[req.dangerLevel] ?? DANGER_LEVEL_MAP.medium;

    const clamp = (line: string): string => {
      if (visibleWidth(line) > safeWidth) {
        return truncateToWidth(line, safeWidth, "");
      }
      return line;
    };

    const lines: string[] = [];

    // --- 1. Header Banner ---
    const badgeStr = fgSafe(
      theme,
      levelInfo.color,
      safeWidth >= 55 ? levelInfo.badge : levelInfo.shortBadge,
    );

    if (safeWidth >= 65) {
      const title = boldSafe(theme, fgSafe(theme, "accent", "⚠ Permission Review Required"));
      const hint = dimSafe(theme, "y: Approve · n: Reject · Esc: Cancel");
      const pad = Math.max(1, safeWidth - visibleWidth(title) - visibleWidth(hint));
      lines.push(clamp(`${title}${" ".repeat(pad)}${hint}`));
    } else if (safeWidth >= 38) {
      lines.push(clamp(boldSafe(theme, fgSafe(theme, "accent", "⚠ Permission Review"))));
    } else if (safeWidth >= 20) {
      lines.push(clamp(boldSafe(theme, "[Security Review]")));
    } else {
      lines.push(clamp("[Review]"));
    }

    // --- 2. Top Border ---
    lines.push(clamp(this.topBorder.render(safeWidth)[0] ?? "─".repeat(safeWidth)));

    // --- 3. Request Metadata ---
    const toolLabel = boldSafe(theme, `Tool: ${req.toolName ?? req.type}`);
    if (safeWidth >= 60) {
      lines.push(clamp(`  ${badgeStr}  ${toolLabel}`));
    } else {
      lines.push(clamp(`  ${badgeStr} ${toolLabel}`));
    }

    // Target command or path
    const target = req.command ?? req.path;
    if (target) {
      const targetLabel = req.command ? "Command:" : "Target:";
      if (safeWidth >= 40) {
        lines.push(clamp(`  ${dimSafe(theme, targetLabel)} ${boldSafe(theme, target)}`));
      } else {
        lines.push(clamp(`  ${boldSafe(theme, target)}`));
      }
    }

    // Explanation
    if (req.explanation) {
      if (safeWidth >= 45) {
        lines.push(clamp(`  ${boldSafe(theme, "Risk:")} ${req.explanation}`));
      } else {
        lines.push(clamp(`  ${req.explanation}`));
      }
    }

    // Specific Warnings
    const assessed = assessRisk(req.toolName ?? "", req.command ?? req.path ?? "");
    for (const warn of assessed.warnings) {
      const warnStyled = fgSafe(theme, levelInfo.color, `⚠ ${warn}`);
      lines.push(clamp(`  ${warnStyled}`));
    }

    // --- 4. Diff / Command Preview ---
    if (req.diffPreview && safeWidth >= 25) {
      lines.push(clamp(this.midBorder.render(safeWidth)[0] ?? "─".repeat(safeWidth)));
      lines.push(clamp(`  ${dimSafe(theme, "Execution Payload Preview:")}`));

      const previewLines = req.diffPreview.split("\n");
      const maxLines = 5;
      const maxScroll = Math.max(0, previewLines.length - maxLines);
      if (this.scrollOffset > maxScroll) {
        this.scrollOffset = maxScroll;
      }
      const slice = previewLines.slice(this.scrollOffset, this.scrollOffset + maxLines);

      for (const pline of slice) {
        lines.push(clamp(`    ${dimSafe(theme, pline)}`));
      }

      if (previewLines.length > maxLines && safeWidth >= 35) {
        lines.push(
          clamp(
            `    ${dimSafe(
              theme,
              `[Scroll ${this.scrollOffset + 1}-${Math.min(previewLines.length, this.scrollOffset + maxLines)} of ${previewLines.length} (↑↓ scroll)]`,
            )}`,
          ),
        );
      }
    }

    // --- 5. Bottom Border ---
    lines.push(clamp(this.botBorder.render(safeWidth)[0] ?? "─".repeat(safeWidth)));

    // --- 6. Action Controls Footer ---
    if (safeWidth >= 65) {
      const yBtn = boldSafe(theme, fgSafe(theme, "success", "[y] Approve"));
      const aBtn = boldSafe(theme, fgSafe(theme, "accent", "[a] Always Approve"));
      const nBtn = boldSafe(theme, fgSafe(theme, "error", "[n] Reject"));
      const escBtn = dimSafe(theme, "[Esc] Cancel");
      lines.push(clamp(`  ${yBtn}    ${aBtn}    ${nBtn}    ${escBtn}`));
    } else if (safeWidth >= 40) {
      lines.push(clamp(`  ${boldSafe(theme, "y")}: approve · ${boldSafe(theme, "n")}: reject · ${boldSafe(theme, "a")}: always · Esc: cancel`));
    } else if (safeWidth >= 20) {
      lines.push(clamp(`  y:ok n:no a:all Esc`));
    } else {
      lines.push(clamp(`  y/n`));
    }

    return lines;
  }
}

/**
 * Factory creating interactive Permission Review Component.
 */
export const createPermissionReviewComponent: PermissionReviewFactory = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (result?: { approved: boolean; remember?: boolean }) => void,
  ctx: ExtensionContext,
  options: PermissionReviewOptions,
): Component => {
  return new PermissionReviewComponent(tui, theme, keybindings, done, ctx, options);
};
