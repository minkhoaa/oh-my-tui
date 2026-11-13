import { Container, Text, visibleWidth, truncateToWidth, matchesKey, Key, type Component, type KeybindingsManager, type TUI } from "@earendil-works/pi-tui";
import { DynamicBorder, type ExtensionContext, type Theme, type ThemeColor } from "@earendil-works/pi-coding-agent";
import type { NotificationLevel, SmartNotification, NotificationCenterOptions, NotificationCenterFactory } from "./types.ts";
import { getBorderStyler } from "../../presets/shared/style.ts";

export type {
  NotificationLevel,
  SmartNotification,
  NotificationCenterOptions,
  NotificationCenterFactory,
};

/**
 * Styling and badge metadata per notification severity level.
 */
export interface NotificationLevelInfo {
  icon: string;
  badge: string;
  shortBadge: string;
  color: ThemeColor;
}

export const NOTIFICATION_LEVEL_MAP: Record<NotificationLevel, NotificationLevelInfo> = {
  info: { icon: "ℹ", badge: "[INFO]", shortBadge: "[i]", color: "accent" },
  warning: { icon: "⚠", badge: "[WARN]", shortBadge: "[!]", color: "warning" },
  error: { icon: "✖", badge: "[ERR ]", shortBadge: "[x]", color: "error" },
  success: { icon: "✔", badge: "[ OK ]", shortBadge: "[v]", color: "success" },
};

/**
 * Safe Theme styling helpers.
 */
function fgSafe(theme: Theme | undefined, color: ThemeColor, text: string): string {
  try {
    return theme?.fg ? theme.fg(color, text) : text;
  } catch {
    return text;
  }
}

function boldSafe(theme: Theme | undefined, text: string): string {
  try {
    return theme?.bold ? theme.bold(text) : text;
  } catch {
    return text;
  }
}

function dimSafe(theme: Theme | undefined, text: string): string {
  try {
    if (typeof (theme as any)?.dim === "function") {
      return (theme as any).dim(text);
    }
    return typeof theme?.fg === "function" ? theme.fg("dim", text) : text;
  } catch {
    return text;
  }
}

/**
 * Time formatting helpers.
 */
function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatShortTime(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Notification Store managing in-memory smart notifications.
 */
export { NotificationStore, notificationStore } from "./store.ts";
import { NotificationStore, notificationStore } from "./store.ts";

/**
 * Compact banner formatter for smart notifications.
 * Fits within viewport width without line wrapping or truncation overflow.
 */
export function formatNotificationBanner(
  notification: SmartNotification,
  theme: Theme,
  width: number,
): string {
  const safeWidth = Math.max(1, width);
  const info = NOTIFICATION_LEVEL_MAP[notification.level] ?? NOTIFICATION_LEVEL_MAP.info;

  const iconColored = fgSafe(theme, info.color, info.icon);
  const badgeColored = boldSafe(theme, fgSafe(theme, info.color, info.badge));
  const timeStr = formatShortTime(notification.timestamp);
  const msgClean = notification.message.replace(/[\r\n\t]+/g, " ").trim();

  let line = "";
  if (safeWidth >= 70) {
    line = `${iconColored} ${badgeColored} ${dimSafe(theme, timeStr)}  ${msgClean}`;
  } else if (safeWidth >= 45) {
    line = `${iconColored} ${badgeColored} ${msgClean}`;
  } else if (safeWidth >= 25) {
    line = `${iconColored} ${fgSafe(theme, info.color, info.shortBadge)} ${msgClean}`;
  } else {
    line = `${iconColored} ${msgClean}`;
  }

  return truncateToWidth(line, safeWidth, "");
}

/**
 * Interactive Notification Center Component.
 */
export class NotificationCenterComponent extends Container {
  private tui: TUI;
  private theme: Theme;
  private keybindings: KeybindingsManager;
  private done: (value?: unknown) => void;
  private ctx: ExtensionContext;
  private options?: NotificationCenterOptions;

  private notifications: SmartNotification[] = [];
  private selectedIndex = 0;
  private topBorder: DynamicBorder;
  private midBorder: DynamicBorder;
  private botBorder: DynamicBorder;
  private isClosed = false;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (value?: unknown) => void,
    ctx: ExtensionContext,
    options?: NotificationCenterOptions,
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done;
    this.ctx = ctx;
    this.options = options;

    if (options?.notifications !== undefined) {
      this.notifications = [...options.notifications];
    } else {
      this.notifications = notificationStore.getAll();
    }

    if (this.notifications.length > 0) {
      this.selectedIndex = 0;
    } else {
      this.selectedIndex = -1;
    }

    const borderStyle = getBorderStyler(theme);
    this.topBorder = new DynamicBorder(borderStyle);
    this.midBorder = new DynamicBorder(borderStyle);
    this.botBorder = new DynamicBorder(borderStyle);

    this.addChild(this.topBorder);
    this.addChild(this.midBorder);
    this.addChild(this.botBorder);
  }

  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  getSelectedNotification(): SmartNotification | undefined {
    return this.selectedIndex >= 0 ? this.notifications[this.selectedIndex] : undefined;
  }

  getNotifications(): SmartNotification[] {
    return [...this.notifications];
  }

  markSelectedAsRead(): void {
    if (this.selectedIndex >= 0 && this.selectedIndex < this.notifications.length) {
      const selected = this.notifications[this.selectedIndex];
      if (selected && !selected.read) {
        selected.read = true;
        notificationStore.markRead(selected.id);
        this.tui.requestRender?.();
      }
    }
  }

  clear(): void {
    this.notifications = [];
    this.selectedIndex = -1;
    notificationStore.clear();
    this.options?.onClear?.();
    this.tui.requestRender?.();
  }

  private close(result?: unknown): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.done(result);
  }

  handleInput(data: string): void {
    if (this.isClosed) return;

    // Esc / 'q' / 'Q' -> Close
    if (
      this.keybindings?.matches?.(data, "tui.select.cancel") ||
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.esc) ||
      data === "\x1b" ||
      data === "q" ||
      data === "Q"
    ) {
      this.close();
      return;
    }

    // Up Arrow / 'k' -> Move selection up
    if (
      this.keybindings?.matches?.(data, "tui.select.up") ||
      matchesKey(data, Key.up) ||
      data === "\x1b[A" ||
      data === "k"
    ) {
      if (this.notifications.length > 0) {
        this.selectedIndex =
          this.selectedIndex <= 0
            ? this.notifications.length - 1
            : this.selectedIndex - 1;
        this.tui.requestRender?.();
      }
      return;
    }

    // Down Arrow / 'j' -> Move selection down
    if (
      this.keybindings?.matches?.(data, "tui.select.down") ||
      matchesKey(data, Key.down) ||
      data === "\x1b[B" ||
      data === "j"
    ) {
      if (this.notifications.length > 0) {
        this.selectedIndex =
          this.selectedIndex >= this.notifications.length - 1
            ? 0
            : this.selectedIndex + 1;
        this.tui.requestRender?.();
      }
      return;
    }

    // 'c' / 'C' -> Clear all notifications
    if (data === "c" || data === "C") {
      this.clear();
      return;
    }

    // Enter / 'r' / 'R' / Space -> Mark selected as read
    if (
      this.keybindings?.matches?.(data, "tui.select.confirm") ||
      matchesKey(data, Key.enter) ||
      matchesKey(data, Key.return) ||
      data === "\r" ||
      data === "\n" ||
      data === "r" ||
      data === "R" ||
      data === " "
    ) {
      this.markSelectedAsRead();
      return;
    }
  }

  override render(width: number): string[] {
    const safeWidth = Math.max(1, width);
    const theme = this.theme;

    const clamp = (line: string): string => {
      if (visibleWidth(line) > safeWidth) {
        return truncateToWidth(line, safeWidth, "");
      }
      return line;
    };

    const lines: string[] = [];
    const unreadCount = this.notifications.filter((n) => !n.read).length;
    const totalCount = this.notifications.length;

    // --- 1. Header Line ---
    if (safeWidth >= 65) {
      const title = boldSafe(theme, fgSafe(theme, "accent", "◆ Notification Center"));
      const stats = dimSafe(theme, `(${unreadCount} unread · ${totalCount} total)`);
      const hint = dimSafe(theme, "Esc/q: close · c: clear");
      const leftPart = `${title} ${stats}`;
      const pad = Math.max(1, safeWidth - visibleWidth(leftPart) - visibleWidth(hint));
      lines.push(clamp(`${leftPart}${" ".repeat(pad)}${hint}`));
    } else if (safeWidth >= 38) {
      const title = boldSafe(theme, fgSafe(theme, "accent", "◆ Notifications"));
      const stats = dimSafe(theme, `(${unreadCount}/${totalCount})`);
      lines.push(clamp(`${title} ${stats}`));
    } else if (safeWidth >= 22) {
      lines.push(clamp(boldSafe(theme, fgSafe(theme, "accent", `[Notifs ${unreadCount}/${totalCount}]`))));
    } else {
      lines.push(clamp(boldSafe(theme, `[${unreadCount}/${totalCount}]`)));
    }

    // --- 2. Top Border ---
    lines.push(clamp(this.topBorder.render(safeWidth)[0] ?? "─".repeat(safeWidth)));

    // --- 3. Notification Items List ---
    if (this.notifications.length === 0) {
      lines.push(clamp(`  ${dimSafe(theme, "No notifications recorded.")}`));
    } else {
      const maxVisible = 6;
      let startIdx = 0;
      if (this.notifications.length > maxVisible) {
        startIdx = Math.max(
          0,
          Math.min(
            this.selectedIndex - Math.floor(maxVisible / 2),
            this.notifications.length - maxVisible,
          ),
        );
      }
      const visibleItems = this.notifications.slice(startIdx, startIdx + maxVisible);

      for (let i = 0; i < visibleItems.length; i++) {
        const actualIdx = startIdx + i;
        const notif = visibleItems[i]!;
        const isSel = actualIdx === this.selectedIndex;
        const levelInfo = NOTIFICATION_LEVEL_MAP[notif.level] ?? NOTIFICATION_LEVEL_MAP.info;

        const cursor = isSel ? boldSafe(theme, fgSafe(theme, "accent", "→ ")) : "  ";
        const readDot = notif.read
          ? dimSafe(theme, "○")
          : boldSafe(theme, fgSafe(theme, levelInfo.color, "●"));

        const badgeStr = fgSafe(
          theme,
          levelInfo.color,
          safeWidth >= 45 ? levelInfo.badge : levelInfo.shortBadge,
        );

        const timeStr = safeWidth >= 65
          ? dimSafe(theme, formatTime(notif.timestamp))
          : safeWidth >= 40
            ? dimSafe(theme, formatShortTime(notif.timestamp))
            : "";

        const cleanMsg = notif.message.replace(/[\r\n\t]+/g, " ").trim();
        const msgStyled = isSel
          ? boldSafe(theme, cleanMsg)
          : notif.read
            ? dimSafe(theme, cleanMsg)
            : cleanMsg;

        let itemLine = "";
        if (safeWidth >= 65) {
          itemLine = `${cursor}${readDot} ${badgeStr} ${timeStr}  ${msgStyled}`;
        } else if (safeWidth >= 40) {
          itemLine = `${cursor}${readDot} ${badgeStr} ${msgStyled}`;
        } else if (safeWidth >= 25) {
          itemLine = `${cursor}${badgeStr} ${msgStyled}`;
        } else {
          itemLine = `${cursor}${levelInfo.icon} ${msgStyled}`;
        }

        lines.push(clamp(itemLine));
      }

      if (this.notifications.length > maxVisible && safeWidth >= 30) {
        lines.push(
          clamp(
            `  ${dimSafe(
              theme,
              `[${this.selectedIndex + 1}/${this.notifications.length} · ↑↓ scroll]`,
            )}`,
          ),
        );
      }
    }

    // --- 4. Selected Detail Section ---
    const selected = this.getSelectedNotification();
    if (selected && safeWidth >= 30) {
      lines.push(clamp(this.midBorder.render(safeWidth)[0] ?? "─".repeat(safeWidth)));
      const info = NOTIFICATION_LEVEL_MAP[selected.level] ?? NOTIFICATION_LEVEL_MAP.info;
      const statusLabel = selected.read ? dimSafe(theme, "read") : boldSafe(theme, fgSafe(theme, info.color, "NEW"));
      const timeFull = formatTime(selected.timestamp);

      if (safeWidth >= 60) {
        lines.push(
          clamp(
            `  ${boldSafe(theme, "Detail:")} ${fgSafe(theme, info.color, info.badge)} [${statusLabel}] ${dimSafe(theme, timeFull)}`,
          ),
        );
      } else {
        lines.push(clamp(`  ${fgSafe(theme, info.color, info.shortBadge)} [${statusLabel}]`));
      }
      lines.push(clamp(`  ${selected.message}`));
    }

    // --- 5. Bottom Border ---
    lines.push(clamp(this.botBorder.render(safeWidth)[0] ?? "─".repeat(safeWidth)));

    // --- 6. Footer Controls ---
    if (safeWidth >= 65) {
      lines.push(
        clamp(
          `  ${dimSafe(
            theme,
            "↑/↓: navigate · c: clear · Enter/r: mark read · Esc/q: close",
          )}`,
        ),
      );
    } else if (safeWidth >= 38) {
      lines.push(clamp(`  ${dimSafe(theme, "↑↓:nav · c:clr · r:read · q:close")}`));
    } else if (safeWidth >= 20) {
      lines.push(clamp(`  ${dimSafe(theme, "c:clr q:close")}`));
    } else {
      lines.push(clamp(`  ${dimSafe(theme, "q:exit")}`));
    }

    return lines;
  }
}

/**
 * Factory creating interactive Notification Center Component.
 */
export const createNotificationCenterComponent: NotificationCenterFactory = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (value?: unknown) => void,
  ctx: ExtensionContext,
  options?: NotificationCenterOptions,
): Component => {
  return new NotificationCenterComponent(tui, theme, keybindings, done, ctx, options);
};

export {
  createOmtNotificationHistoryComponent,
  OmtNotificationHistoryComponent,
  type OmtNotificationOptions,
  type OmtNotificationItem,
  createOmtBlockActionsComponent,
  OmtBlockActionsComponent,
  type BlockActionsDialogOptions,
  type BlockSemanticContent,
  type BlockActionKind,
  type BlockActionOption,
} from "../omt-dialogs/index.ts";
