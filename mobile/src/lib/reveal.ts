import type { Point } from "./designProject";
import { pathLength } from "./vectorize";

export type RevealTiming = {
  index: number;
  delayMs: number;
  durationMs: number;
  length: number;
};

export const DEFAULT_REVEAL = { totalMs: 1200, minPathMs: 90, staggerRatio: 0.35 } as const;

type ScheduledPath = {
  pathIndex: number;
  length: number;
  durationMs: number;
  delayMs: number;
};

/** The silhouette lands before its detail, and ties preserve drawing order. */
export function orderForReveal(paths: Point[][]): number[] {
  return paths
    .map((points, pathIndex) => ({ pathIndex, length: pathLength(points) }))
    .sort((left, right) => right.length - left.length || left.pathIndex - right.pathIndex)
    .map(({ pathIndex }) => pathIndex);
}

/**
 * Allocates the reveal budget in sorted order, then returns it in the caller's
 * path order so each rendered path can look up its own timing directly.
 */
export function revealTimings(paths: Point[][], totalMs: number = DEFAULT_REVEAL.totalMs): RevealTiming[] {
  if (paths.length === 0) return [];

  const total = Math.max(0, Number.isFinite(totalMs) ? totalMs : DEFAULT_REVEAL.totalMs);
  if (paths.length === 1) {
    return [{ index: 0, delayMs: 0, durationMs: total, length: pathLength(paths[0]) }];
  }

  const ordered = orderForReveal(paths);
  const lengths = ordered.map((pathIndex) => pathLength(paths[pathIndex]));
  const schedule: ScheduledPath[] = ordered.map((pathIndex, index) => ({
    pathIndex,
    length: lengths[index],
    // Length is intentionally the unscaled unit here. Scaling the finished
    // schedule preserves its proportions while fitting the caller's budget.
    durationMs: Math.max(DEFAULT_REVEAL.minPathMs, lengths[index]),
    delayMs: 0,
  }));

  for (let index = 1; index < schedule.length; index++) {
    schedule[index].delayMs = schedule[index - 1].delayMs
      + schedule[index - 1].durationMs * DEFAULT_REVEAL.staggerRatio;
  }
  const unscaledEnd = Math.max(...schedule.map((entry) => entry.delayMs + entry.durationMs));
  const scale = unscaledEnd === 0 ? 0 : total / unscaledEnd;
  for (const entry of schedule) {
    entry.durationMs *= scale;
    entry.delayMs *= scale;
  }

  const timings: RevealTiming[] = paths.map((points) => ({
    index: 0,
    delayMs: 0,
    durationMs: 0,
    length: pathLength(points),
  }));
  for (let index = 0; index < schedule.length; index++) {
    const entry = schedule[index];
    timings[entry.pathIndex] = {
      index,
      delayMs: entry.delayMs,
      durationMs: entry.durationMs,
      length: entry.length,
    };
  }
  return timings;
}
