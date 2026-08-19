// One button between "traced" and "printable".
//
// A trace is rarely clean: stray specks from sensor noise, hairline breaks
// where a contour lost a pixel, regions so dense they'll close up under ink.
// The primitives to find all three already shipped — this module composes
// them into a report and a repaired set of paths, leaving the editor to apply
// the result as one undoable commit.
//
// Pure geometry over Point[][] — no Skia, fully unit-testable.

import type { Point } from "./designProject";
import { pathLength } from "./vectorize";
import { checkLineSpacing, type SpacingReport } from "./spacing";

export type CleanupOptions = {
  /** Paths shorter than this are specks, in canvas px. */
  speckMaxLengthPx: number;
  /** Endpoints closer than this get bridged, in canvas px. */
  bridgeMaxGapPx: number;
};

export const DEFAULT_CLEANUP: CleanupOptions = {
  speckMaxLengthPx: 14,
  bridgeMaxGapPx: 10,
};

export type CleanupResult = {
  paths: Point[][];
  specksRemoved: number;
  gapsBridged: number;
};

export type CleanupReport = {
  specks: number;
  bridgeableGaps: number;
  spacing: SpacingReport;
};

/** Splits paths into keepers and specks by traced length. */
export function findSpecks(
  paths: Point[][],
  maxLengthPx: number
): { kept: Point[][]; specks: Point[][] } {
  const kept: Point[][] = [];
  const specks: Point[][] = [];
  for (const path of paths) {
    (pathLength(path) <= maxLengthPx ? specks : kept).push(path);
  }
  return { kept, specks };
}

type Endpoint = { path: number; end: "start" | "finish"; point: Point };

function endpointsOf(paths: Point[][]): Endpoint[] {
  const endpoints: Endpoint[] = [];
  paths.forEach((points, path) => {
    if (points.length < 2) return;
    const first = points[0];
    const last = points.at(-1)!;
    // A closed loop has nothing to bridge.
    if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-6) return;
    endpoints.push({ path, end: "start", point: first });
    endpoints.push({ path, end: "finish", point: last });
  });
  return endpoints;
}

/**
 * Joins paths whose free ends nearly touch — the hairline breaks a trace
 * leaves where a contour lost a pixel.
 *
 * Greedy nearest-pair: repeatedly join the closest qualifying pair of ends
 * until none remain under the threshold. The two ends of one path are never
 * joined to each other (that would weld a stroke into a loop the artist
 * didn't draw), but a path may gain joins at both ends across iterations.
 */
export function bridgeGaps(paths: Point[][], maxGapPx: number): { paths: Point[][]; bridged: number } {
  if (maxGapPx <= 0) return { paths, bridged: 0 };
  let working = paths.map((points) => [...points]);
  let bridged = 0;

  for (;;) {
    const endpoints = endpointsOf(working);
    let best: { a: Endpoint; b: Endpoint; distance: number } | null = null;
    for (let i = 0; i < endpoints.length; i++) {
      for (let j = i + 1; j < endpoints.length; j++) {
        const a = endpoints[i];
        const b = endpoints[j];
        if (a.path === b.path) continue;
        const distance = Math.hypot(a.point.x - b.point.x, a.point.y - b.point.y);
        if (distance > maxGapPx) continue;
        if (!best || distance < best.distance) best = { a, b, distance };
      }
    }
    if (!best) break;

    const { a, b } = best;
    // Orient both fragments so the join is tail-of-A to head-of-B.
    const first = a.end === "finish" ? working[a.path] : [...working[a.path]].reverse();
    const second = b.end === "start" ? working[b.path] : [...working[b.path]].reverse();
    const joined = [...first, ...second];
    working = working.filter((_, index) => index !== a.path && index !== b.path);
    working.push(joined);
    bridged++;
  }

  return { paths: working, bridged };
}

/** What cleanup would do, without doing it — drives the editor's summary. */
export function cleanupReport(
  paths: Point[][],
  pxPerMm: number,
  minGapMm: number,
  options: CleanupOptions = DEFAULT_CLEANUP
): CleanupReport {
  const { kept, specks } = findSpecks(paths, options.speckMaxLengthPx);
  const { bridged } = bridgeGaps(kept, options.bridgeMaxGapPx);
  return {
    specks: specks.length,
    bridgeableGaps: bridged,
    spacing: checkLineSpacing(kept, pxPerMm, minGapMm),
  };
}

/** Applies speck removal then gap bridging; the editor commits it as one step. */
export function applyCleanup(
  paths: Point[][],
  options: CleanupOptions = DEFAULT_CLEANUP
): CleanupResult {
  const { kept, specks } = findSpecks(paths, options.speckMaxLengthPx);
  const { paths: repaired, bridged } = bridgeGaps(kept, options.bridgeMaxGapPx);
  return { paths: repaired, specksRemoved: specks.length, gapsBridged: bridged };
}
