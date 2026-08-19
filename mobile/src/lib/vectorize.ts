// Turns a binary stencil mask into real geometry.
//
// src/lib/stencil.ts already reduces a photo to a 1-bit edge mask; everything
// after that point was thrown away as pixels. This module thins that mask to a
// single-pixel skeleton, walks the skeleton into polylines, simplifies them,
// and hands back paths that drop straight into the editable StrokeLayer model.
//
// Deliberately free of Skia and expo-file-system imports: it is pure array
// math on a mask, which keeps the whole tracer unit-testable off-device.

import type { Point, StrokeLayer } from "./designProject";
import { makeStrokeLayer } from "./projectMutations";

export type TraceOptions = {
  /** Discard traced paths shorter than this many pixels. Removes specks. */
  minPathLength: number;
  /** Ramer-Douglas-Peucker tolerance in pixels. 0 keeps every point. */
  simplifyTolerance: number;
  /** Hard cap on emitted paths. The longest survive. */
  maxPaths: number;
};

export const DEFAULT_TRACE: TraceOptions = {
  minPathLength: 6,
  simplifyTolerance: 1.2,
  maxPaths: 4000,
};

/**
 * Zhang-Suen thinning. Erodes the mask to a one-pixel-wide skeleton while
 * preserving connectivity, so a 9px-thick drawn line becomes a single
 * centreline rather than a pair of contours down each side.
 *
 * Border pixels are left alone — the neighbourhood tests need a full ring.
 */
export function skeletonize(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = Uint8Array.from(mask, (value) => (value ? 1 : 0));
  const doomed: number[] = [];

  for (let changed = true; changed; ) {
    changed = false;
    for (const step of [0, 1]) {
      doomed.length = 0;
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const i = y * width + x;
          if (!out[i]) continue;

          // P2..P9, clockwise from north.
          const p2 = out[i - width];
          const p3 = out[i - width + 1];
          const p4 = out[i + 1];
          const p5 = out[i + width + 1];
          const p6 = out[i + width];
          const p7 = out[i + width - 1];
          const p8 = out[i - 1];
          const p9 = out[i - width - 1];

          const filled = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (filled < 2 || filled > 6) continue;

          const ring = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
          let transitions = 0;
          for (let k = 0; k < 8; k++) if (!ring[k] && ring[k + 1]) transitions++;
          if (transitions !== 1) continue;

          if (step === 0) {
            if (p2 * p4 * p6) continue;
            if (p4 * p6 * p8) continue;
          } else {
            if (p2 * p4 * p8) continue;
            if (p2 * p6 * p8) continue;
          }
          doomed.push(i);
        }
      }
      for (const i of doomed) out[i] = 0;
      if (doomed.length) changed = true;
    }
  }
  return out;
}

const NEIGHBOR_DX = [0, 1, 1, 1, 0, -1, -1, -1];
const NEIGHBOR_DY = [-1, -1, 0, 1, 1, 1, 0, -1];

function neighborsOf(skeleton: Uint8Array, width: number, height: number, index: number): number[] {
  const x = index % width;
  const y = (index - x) / width;
  const found: number[] = [];
  for (let k = 0; k < 8; k++) {
    const nx = x + NEIGHBOR_DX[k];
    const ny = y + NEIGHBOR_DY[k];
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    const j = ny * width + nx;
    if (skeleton[j]) found.push(j);
  }
  return found;
}

export function pathLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

/**
 * Walks a skeleton into polylines. Pixels with exactly two neighbours are
 * ordinary path interior; anything else (an endpoint, a junction, a lone
 * speck) is a node that terminates a path. Closed loops carry no node at all,
 * so they get a second pass that seeds anywhere on the ring.
 */
export function tracePolylines(
  skeleton: Uint8Array,
  width: number,
  height: number,
  options: TraceOptions = DEFAULT_TRACE
): Point[][] {
  const live: number[] = [];
  for (let i = 0; i < skeleton.length; i++) if (skeleton[i]) live.push(i);

  // Prune redundant diagonals before counting degrees. Under 8-connectivity a
  // corner or a junction picks up diagonal neighbours that are already reachable
  // the orthogonal way, which inflates the degree and shatters a clean line into
  // node-to-node stubs. Dropping a diagonal whenever a 4-connected detour exists
  // leaves ordinary path pixels at degree 2, where they belong.
  const adjacency = new Map<number, number[]>();
  for (const i of live) {
    const x = i % width;
    const y = (i - x) / width;
    const kept: number[] = [];
    for (const j of neighborsOf(skeleton, width, height, i)) {
      const jx = j % width;
      const jy = (j - jx) / width;
      if (jx !== x && jy !== y && (skeleton[jy * width + x] || skeleton[y * width + jx])) continue;
      kept.push(j);
    }
    adjacency.set(i, kept);
  }

  const usedEdges = new Set<number>();
  const edgeKey = (a: number, b: number) => (a < b ? a * skeleton.length + b : b * skeleton.length + a);
  const toPoint = (index: number): Point => ({ x: index % width, y: Math.floor(index / width) });

  const walk = (start: number, first: number): Point[] => {
    const path = [toPoint(start)];
    let previous = start;
    let current = first;
    for (;;) {
      const key = edgeKey(previous, current);
      if (usedEdges.has(key)) break;
      usedEdges.add(key);
      path.push(toPoint(current));
      const neighbors = adjacency.get(current) ?? [];
      if (neighbors.length !== 2) break;
      const next = neighbors[0] === previous ? neighbors[1] : neighbors[0];
      previous = current;
      current = next;
    }
    return path;
  };

  const paths: Point[][] = [];
  const seedFrom = (wantNode: boolean) => {
    for (const i of live) {
      const neighbors = adjacency.get(i) ?? [];
      if (wantNode === (neighbors.length === 2)) continue;
      for (const n of neighbors) {
        if (usedEdges.has(edgeKey(i, n))) continue;
        paths.push(walk(i, n));
      }
    }
  };
  seedFrom(true);
  seedFrom(false);

  return paths
    .map((points) => ({ points, length: pathLength(points) }))
    .filter((item) => item.length >= options.minPathLength)
    .sort((a, b) => b.length - a.length)
    .slice(0, Math.max(0, options.maxPaths))
    .map((item) => simplify(item.points, options.simplifyTolerance));
}

function perpendicularDistance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const numerator = Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x);
  return numerator / Math.hypot(dx, dy);
}

/**
 * Ramer-Douglas-Peucker. Iterative rather than recursive — a traced contour
 * can run to thousands of points and would otherwise risk the stack.
 */
export function simplify(points: Point[], tolerance: number): Point[] {
  if (tolerance <= 0 || points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    if (last <= first + 1) continue;
    let worst = -1;
    let worstIndex = first;
    for (let i = first + 1; i < last; i++) {
      const distance = perpendicularDistance(points[i], points[first], points[last]);
      if (distance > worst) {
        worst = distance;
        worstIndex = i;
      }
    }
    if (worst > tolerance) {
      keep[worstIndex] = 1;
      stack.push([first, worstIndex], [worstIndex, last]);
    }
  }
  return points.filter((_, index) => keep[index] === 1);
}

export function polylinesToStrokeLayer(
  paths: Point[][],
  width: number,
  height: number,
  strokeWidth: number,
  color = "#111111",
  name = "Traced linework"
): StrokeLayer {
  const layer = makeStrokeLayer(width, height, name);
  return {
    ...layer,
    strokes: paths
      .filter((points) => points.length > 1)
      .map((points) => ({ points, width: strokeWidth, color, mode: "draw" as const, opacity: 1 })),
  };
}
