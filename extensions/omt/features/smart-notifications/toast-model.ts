export const TOAST_TTL_MS = 10_000;
export const MAX_TOASTS = 10;
export interface ToastItem {
  message: string;
  type: "info" | "warning" | "error";
  at: number;
}

/** Uniform ten-second TTL, oldest-first stack capped at ten. */
export class ToastQueue {
  private items: ToastItem[] = [];
  push(message: string, type: ToastItem["type"], now = Date.now()): void {
    this.prune(now);
    this.items.push({ message, type, at: now });
    this.items = this.items.slice(-MAX_TOASTS);
  }
  prune(now = Date.now()): void {
    this.items = this.items.filter(item => now - item.at < TOAST_TTL_MS);
  }
  getAll(now = Date.now()): readonly ToastItem[] { this.prune(now); return [...this.items]; }
  clear(): void { this.items = []; }
}

export function toastGeometry(columns: number, rows: number, docked: boolean) {
  const mainWidth = Math.max(0, columns - (docked ? 34 : 0));
  const innerWidth = Math.min(Math.max(24, Math.floor(mainWidth / 3)), mainWidth - 2);
  return { width: Math.max(0, innerWidth + 2), col: Math.max(0, mainWidth - innerWidth - 2), row: 1,
    maxHeight: Math.max(0, rows - 7), visible: innerWidth >= 8 && rows > 9 };
}
