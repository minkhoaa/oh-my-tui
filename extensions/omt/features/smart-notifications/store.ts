import type { NotificationLevel, SmartNotification } from "./types.ts";

export class NotificationStore {
  private notifications: SmartNotification[] = [];
  private counter = 0;
  private maxCapacity: number;

  constructor(maxCapacity = 100) {
    this.maxCapacity = maxCapacity;
  }

  push(
    message: string,
    level: NotificationLevel = "info",
    durationMs?: number,
    sticky?: boolean,
  ): SmartNotification {
    this.counter++;
    const notification: SmartNotification = {
      id: `notif-${this.counter}-${Date.now()}`,
      message,
      level,
      timestamp: Date.now(),
      durationMs,
      read: false,
      sticky: sticky ?? false,
    };
    this.notifications.unshift(notification);
    if (this.notifications.length > this.maxCapacity) {
      this.notifications.length = this.maxCapacity;
    }
    return notification;
  }

  markRead(id: string): boolean {
    const item = this.notifications.find((n) => n.id === id);
    if (item) {
      item.read = true;
      return true;
    }
    return false;
  }

  markAllRead(): void {
    for (const item of this.notifications) {
      item.read = true;
    }
  }

  clear(): void {
    this.notifications = [];
  }

  getAll(): SmartNotification[] {
    return [...this.notifications];
  }

  getUnreadCount(): number {
    return this.notifications.filter((n) => !n.read).length;
  }

  getById(id: string): SmartNotification | undefined {
    return this.notifications.find((n) => n.id === id);
  }

  remove(id: string): boolean {
    const idx = this.notifications.findIndex((n) => n.id === id);
    if (idx >= 0) {
      this.notifications.splice(idx, 1);
      return true;
    }
    return false;
  }

  get count(): number {
    return this.notifications.length;
  }
}

/**
 * Global shared notification store singleton.
 */
export const notificationStore = new NotificationStore();

