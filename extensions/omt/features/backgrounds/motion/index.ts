export interface FrameTiming {
  frame: number;
  ended: boolean;
}

/**
 * Calculates current frame index and whether the animation has finished its loops.
 * Pure timing calculation; owns no graphics or asset content.
 */
export function calculateFrameAt(
  elapsed: number,
  frameCount: number,
  frameMs: number,
  loops = 0,
): FrameTiming {
  if (frameCount <= 1) {
    return { frame: 0, ended: true };
  }
  const safeFrameMs = Math.max(1, frameMs);
  const duration = frameCount * safeFrameMs;
  const ended = loops > 0 && elapsed >= duration * loops;
  const frame = ended
    ? frameCount - 1
    : Math.floor(Math.max(0, elapsed) / safeFrameMs) % frameCount;
  return { frame, ended };
}

/**
 * Backward-compatible helper for LoadedBackground assets.
 */
export function backgroundFrameAt(
  asset: { metadata: { frameCount: number; frameMs: number; loops?: number } },
  elapsed: number,
): FrameTiming {
  return calculateFrameAt(
    elapsed,
    asset.metadata.frameCount,
    asset.metadata.frameMs,
    asset.metadata.loops ?? 0,
  );
}

/**
 * Quantizes elapsed time to fixed FPS intervals to prevent sub-frame jitter.
 */
export function quantizeTime(elapsed: number, fps: number): number {
  const safeFps = Math.max(1, Math.min(60, fps));
  const interval = 1000 / safeFps;
  return Math.floor(Math.max(0, elapsed) / interval) * interval;
}

/**
 * Elapsed playback time excludes all hidden/paused intervals; speed changes are
 * integrated, never multiplied by wall-clock uptime. No timer of its own.
 */
export class BackgroundPlayhead {
  time = 0;
  private last: number | undefined;

  advance(now: number, running: boolean, speed: number): number {
    if (running && this.last !== undefined) {
      this.time += Math.max(0, now - this.last) * Math.max(0, speed);
    }
    this.last = running ? now : undefined;
    return this.time;
  }

  suspend(): void {
    this.last = undefined;
  }

  reset(): void {
    this.time = 0;
    this.last = undefined;
  }
}
