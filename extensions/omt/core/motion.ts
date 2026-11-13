import { configStore, type AnimationMode, type ReducedMotionPreference } from "./config.ts";

export type { AnimationMode, ReducedMotionPreference };

let activeTuiInstance: { requestRender?(): void } | undefined;

export function setActiveTui(tui: { requestRender?(): void } | undefined): void {
  activeTuiInstance = tui;
}

export function getActiveTui(): { requestRender?(): void } | undefined {
  return activeTuiInstance;
}

/**
 * Checks whether reduced motion is actively in effect.
 * When preference is "auto", checks terminal environment (OMT_REDUCED_MOTION === "1").
 */
export function isReducedMotionActive(preference?: ReducedMotionPreference): boolean {
  const pref = preference ?? configStore.getAnimation().reducedMotion;
  if (pref === "reduced") return true;
  if (pref === "normal") return false;
  return process.env.OMT_REDUCED_MOTION === "1";
}

/**
 * Whether animations are currently enabled for rendering.
 * False if mode is "off", or if reduced motion is active unless mode is forced to "full".
 */
export function isAnimationActive(mode?: AnimationMode, preference?: ReducedMotionPreference): boolean {
  const m = mode ?? configStore.getAnimation().mode;
  if (m === "off") return false;
  if (isReducedMotionActive(preference) && m !== "full") return false;
  return true;
}

/**
 * Scales elapsed time by animation speed multiplier.
 */
export function scaleElapsed(elapsedMs: number, speed?: number): number {
  const s = speed ?? configStore.getAnimation().speed;
  return Math.max(0, elapsedMs * s);
}

/**
 * Scales frame interval (in ms) by speed multiplier.
 * Higher speed = shorter interval. Clamped to minimum 16ms (~60fps).
 */
export function scaleInterval(intervalMs: number, speed?: number): number {
  const s = speed ?? configStore.getAnimation().speed;
  return Math.max(16, Math.round(intervalMs / Math.max(0.25, s)));
}

/**
 * Central animation coordinator.
 * Schedules render frames while animations or explicitly essential countdowns are active.
 * Disabled/reduced motion stops animation work, not semantic expiry. Idle/dispose stop all work.
 * Reuses a single shared timer across all components to eliminate timer duplication.
 */
export class MotionCoordinator {
  private activeSources = new Set<string>();
  private intervals = new Map<string, number>();
  // Semantic expiry/countdown work must still run with visual motion disabled.
  private essentialSources = new Set<string>();
  private scheduledInterval = 0;
  private timer: NodeJS.Timeout | null = null;
  private renderCallback: (() => void) | null = null;
  private baseIntervalMs = 50;

  setRenderCallback(callback: (() => void) | null): void {
    this.renderCallback = callback;
    if (callback && this.activeSources.size > 0 && !this.timer && (isAnimationActive() || this.essentialSources.size > 0)) {
      this.start();
    }
  }

  setBaseInterval(ms: number): void {
    this.baseIntervalMs = ms;
    if (this.timer) {
      this.restart();
    }
  }

  register(sourceId: string, intervalMs?: number, options?: { essential?: boolean }): void {
    if (!isAnimationActive() && !options?.essential) return;
    this.activeSources.add(sourceId);
    if (options?.essential) this.essentialSources.add(sourceId);
    if (intervalMs !== undefined) this.intervals.set(sourceId, Math.max(16, intervalMs));
    if (this.timer && this.scheduledInterval !== this.interval()) this.restart();
    else if (!this.timer) this.start();
  }

  private interval(): number {
    const sources = [...this.activeSources].filter(id => isAnimationActive() || this.essentialSources.has(id));
    return Math.min(...sources.map(id => this.intervals.get(id) ?? scaleInterval(this.baseIntervalMs)));
  }

  unregister(sourceId: string): void {
    this.activeSources.delete(sourceId);
    this.essentialSources.delete(sourceId);
    this.intervals.delete(sourceId);
    if (this.activeSources.size === 0) this.stop();
    else if (this.timer && this.scheduledInterval !== this.interval()) this.restart();
  }

  hasActive(): boolean {
    return this.activeSources.size > 0;
  }

  activeCount(): number {
    return this.activeSources.size;
  }

  clear(): void {
    this.activeSources.clear();
    this.essentialSources.clear();
    this.intervals.clear();
    this.stop();
  }

  clearTransient(): void {
    for (const src of this.activeSources) {
      if (src.startsWith("tool:") || src.startsWith("assistant:")) {
        this.activeSources.delete(src);
        this.essentialSources.delete(src);
        this.intervals.delete(src);
      }
    }
    if (this.activeSources.size === 0) this.stop();
    else if (this.timer && this.scheduledInterval !== this.interval()) this.restart();
  }

  dispose(): void {
    this.clear();
    this.renderCallback = null;
  }

  private start(): void {
    if (this.timer) return;
    if (!this.renderCallback && !activeTuiInstance) return;
    const interval = this.scheduledInterval = this.interval();
    this.timer = setInterval(() => {
      if (this.activeSources.size === 0 || (!isAnimationActive() && this.essentialSources.size === 0)) {
        this.stop();
        return;
      }
      if (this.scheduledInterval !== this.interval()) { this.restart(); return; }
      try {
        if (this.renderCallback) {
          this.renderCallback();
        } else if (activeTuiInstance && typeof activeTuiInstance.requestRender === "function") {
          activeTuiInstance.requestRender();
        }
      } catch {
        /* ignore render callback errors */
      }
    }, interval);
    this.timer.unref?.();
  }

  private stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private restart(): void {
    this.stop();
    if (this.activeSources.size > 0 && (isAnimationActive() || this.essentialSources.size > 0)) {
      this.start();
    }
  }
}

export const motionCoordinator = new MotionCoordinator();
