// Blowout detection: where will two lines close into one blob?
//
// Ink spreads when it goes into skin, and icing spreads when it comes out of a
// tip. Below a certain gap the negative space between two lines disappears and
// the piece reads as a smudge. That gap is physical — millimetres on the body,
// not pixels on a canvas — so everything here works in real units.
//
// Skia-free on purpose: productionTools.ts imports Skia and cannot run under
// `tsx --test`, so the geometry lives here where it can be verified.

import type { Point } from "./designProject";
import type { ProductionFinding } from "./productionTools";

/**
 * Smallest gap that survives production, in millimetres.
 *
 * A tattoo liner holds about 0.8mm before the lines bleed together as the
 * piece heals; a piping tip is far coarser. Starting estimates — see the
 * owner-gated blockers in docs/wave-plan-vector-production.md.
 */
export const MIN_LINE_GAP_MM: Record<"ink" | "sugar", number> = {
  ink: 0.8,
  sugar: 2.0,
};

const MM_PER_INCH = 25.4;

/** Pixels per millimetre for artwork printed at `dpi`. */
export function pxPerMmFromDpi(dpi: number): number {
  return dpi / MM_PER_INCH;
}

export type SpacingReport = {
  /** Segment pairs closer than the threshold. */
  violations: number;
  /** Tightest gap found, in millimetres. Null when nothing was close. */
  worstGapMm: number | null;
  /** How many line segments were compared. */
  checkedSegments: number;
};

type Segment = {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  path: number;
  /** Distance along its own path to this segment's midpoint. */
  arc: number;
};

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function segmentsIntersect(a: Segment, b: Segment): boolean {
  const d = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) =>
    (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1);
  const d1 = d(a.ax, a.ay, a.bx, a.by, b.ax, b.ay);
  const d2 = d(a.ax, a.ay, a.bx, a.by, b.bx, b.by);
  const d3 = d(b.ax, b.ay, b.bx, b.by, a.ax, a.ay);
  const d4 = d(b.ax, b.ay, b.bx, b.by, a.bx, a.by);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/** Minimum distance between two line segments. */
export function segmentDistance(a: Segment, b: Segment): number {
  if (segmentsIntersect(a, b)) return 0;
  return Math.min(
    distanceToSegment(a.ax, a.ay, b.ax, b.ay, b.bx, b.by),
    distanceToSegment(a.bx, a.by, b.ax, b.ay, b.bx, b.by),
    distanceToSegment(b.ax, b.ay, a.ax, a.ay, a.bx, a.by),
    distanceToSegment(b.bx, b.by, a.ax, a.ay, a.bx, a.by)
  );
}

function toSegments(paths: Point[][]): Segment[] {
  const segments: Segment[] = [];
  paths.forEach((points, path) => {
    let arc = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      segments.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, path, arc: arc + length / 2 });
      arc += length;
    }
  });
  return segments;
}

/**
 * Finds places where linework will close up at print size.
 *
 * Two segments of the *same* path that sit near each other along that path are
 * ignored — consecutive segments always touch, and flagging them would report
 * every stroke against itself. A path that folds back on itself from far away
 * is a genuine blowout and is still reported.
 *
 * Candidate pairs come from a uniform grid keyed on the threshold; comparing
 * every segment against every other is O(n²) and stalls on a dense trace.
 */
export function checkLineSpacing(paths: Point[][], pxPerMm: number, minGapMm: number): SpacingReport {
  const segments = toSegments(paths);
  const report: SpacingReport = { violations: 0, worstGapMm: null, checkedSegments: segments.length };
  if (segments.length < 2 || pxPerMm <= 0 || minGapMm <= 0) return report;

  const minGapPx = minGapMm * pxPerMm;
  // Two bits of one path this far apart along it are separate lines, not the
  // same stroke curving.
  const arcSkipPx = minGapPx * 4;
  const cell = Math.max(1, minGapPx);
  const buckets = new Map<string, number[]>();

  segments.forEach((segment, index) => {
    const minX = Math.min(segment.ax, segment.bx) - minGapPx;
    const maxX = Math.max(segment.ax, segment.bx) + minGapPx;
    const minY = Math.min(segment.ay, segment.by) - minGapPx;
    const maxY = Math.max(segment.ay, segment.by) + minGapPx;
    for (let cx = Math.floor(minX / cell); cx <= Math.floor(maxX / cell); cx++) {
      for (let cy = Math.floor(minY / cell); cy <= Math.floor(maxY / cell); cy++) {
        const key = `${cx}:${cy}`;
        const bucket = buckets.get(key);
        if (bucket) bucket.push(index);
        else buckets.set(key, [index]);
      }
    }
  });

  const seen = new Set<number>();
  let worstPx = Infinity;
  for (const bucket of buckets.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i];
        const b = bucket[j];
        const pairKey = a < b ? a * segments.length + b : b * segments.length + a;
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);

        const first = segments[a];
        const second = segments[b];
        if (first.path === second.path && Math.abs(first.arc - second.arc) < arcSkipPx) continue;

        const gap = segmentDistance(first, second);
        if (gap >= minGapPx) continue;
        report.violations++;
        if (gap < worstPx) worstPx = gap;
      }
    }
  }

  if (report.violations) report.worstGapMm = worstPx / pxPerMm;
  return report;
}

/** Renders a spacing report as a Production desk finding. */
export function spacingFinding(report: SpacingReport, brand: "ink" | "sugar", minGapMm: number): ProductionFinding {
  const subject = brand === "sugar" ? "piping" : "the needle";
  if (!report.checkedSegments) {
    return {
      level: "warn",
      title: "Line spacing",
      detail: "No vector linework to measure. Trace the design first to check spacing.",
    };
  }
  if (!report.violations) {
    return {
      level: "pass",
      title: "Line spacing",
      detail: `Every line holds at least ${minGapMm}mm of clearance at print size — enough for ${subject} to keep them separate.`,
    };
  }
  const worst = report.worstGapMm ?? 0;
  const one = report.violations === 1;
  return {
    level: "warn",
    title: "Line spacing",
    detail: `${report.violations} place${one ? "" : "s"} ${one ? "falls" : "fall"} below ${minGapMm}mm at print size, the tightest at ${worst.toFixed(2)}mm — too tight for ${subject} to hold them apart. Open them out or scale the piece up.`,
  };
}
