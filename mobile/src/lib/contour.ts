// The outline of a shape, as opposed to the line down the middle of it.
//
// Everything in this app that turns pixels into geometry traces a *skeleton*:
// vectorize.ts thins a mask until a 9px-thick drawn line becomes a single
// centreline, which is exactly right when the output is a path for a needle or
// a piping tip to follow. It is exactly wrong when the output is a solid. A
// cookie cutter is not the centreline of a cookie, and a shape standing proud
// of a casting tray needs to know where its edge is, not where its middle is.
//
// So: closed loops around filled regions, with the holes in them identified,
// wound so that a triangulator can tell the two apart. Pure array maths over a
// mask, no Skia, testable off-device.

import type { Point } from "./designProject";
import { simplify } from "./vectorize";

export type Contour = {
  /**
   * A closed loop. The last point joins back to the first implicitly — the
   * first point is not repeated at the end.
   */
  points: Point[];
  /** True when this loop bounds filled area, false when it bounds a hole. */
  solid: boolean;
  /**
   * Signed area in square pixels: positive for solid, negative for holes.
   *
   * The sign is the winding, and the winding is not decoration — a triangulator
   * needs it to tell which side of a loop is inside. Because y runs down the
   * screen, a positive loop here is one that looks *clockwise* when drawn.
   */
  area: number;
};

/**
 * Vertices live on the lattice *between* pixels, so a mask w wide has w + 1
 * columns of them.
 */
function vertexKey(x: number, y: number, width: number): number {
  return y * (width + 1) + x;
}

/** Shoelace. Positive means the loop winds the way solid loops wind. */
export function signedArea(points: Point[]): number {
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    total += a.x * b.y - b.x * a.y;
  }
  return total / 2;
}

/**
 * Rotates a closed loop to start at its lexicographically smallest vertex.
 *
 * A loop has no natural first point, but simplification does: Ramer-Douglas-
 * Peucker pins both ends and will happily shave whatever corner the loop
 * happened to start on. Starting at an extreme vertex guarantees the pinned
 * point is a real corner of the shape rather than an arbitrary one.
 */
function rotateToExtreme(points: Point[]): Point[] {
  let best = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].x < points[best].x || (points[i].x === points[best].x && points[i].y < points[best].y)) {
      best = i;
    }
  }
  return best === 0 ? points : [...points.slice(best), ...points.slice(0, best)];
}

/**
 * Splits a loop that touches itself into loops that do not.
 *
 * Two regions meeting at a single corner — a saddle — chain into one figure of
 * eight rather than two loops, because the shared lattice vertex has two ways
 * in and two ways out. That is not a polygon: it encloses the right area, so it
 * looks correct by every measure that adds up, but a triangulator handed a
 * pinched loop produces a surface doubled over itself at the pinch, which is
 * closed twice and therefore not closed at all.
 *
 * So the walk is cut wherever it returns to a vertex it has already stood on,
 * and each lap becomes its own loop. The pinch vertex belongs to both, which is
 * the truth about the shape.
 */
function splitSelfTouching(loop: number[]): number[][] {
  const loops: number[][] = [];
  const path: number[] = [];
  const standingAt = new Map<number, number>();

  for (const vertex of loop) {
    const earlier = standingAt.get(vertex);
    if (earlier !== undefined) {
      const lap = path.splice(earlier);
      for (const key of lap) standingAt.delete(key);
      if (lap.length >= 3) loops.push(lap);
    }
    standingAt.set(vertex, path.length);
    path.push(vertex);
  }
  if (path.length >= 3) loops.push(path);
  return loops;
}

/**
 * Traces every closed boundary in a binary mask.
 *
 * Each edge between a filled pixel and an empty one is emitted as a directed
 * segment with the filled side on its right, and the segments are then chained
 * head to tail. Keeping the fill consistently on one side is what makes the
 * winding meaningful: an outer boundary and the boundary of a hole inside it
 * come out wound opposite ways without anything having to work out which is
 * which afterwards.
 *
 * `tolerance` is Ramer-Douglas-Peucker, in pixels, applied to each loop. Zero
 * keeps the raw staircase — right when the mask is already at the resolution
 * of the thing being made, wasteful when it is not.
 */
export function traceContours(
  mask: Uint8Array,
  width: number,
  height: number,
  tolerance = 0
): Contour[] {
  if (width <= 0 || height <= 0 || mask.length < width * height) return [];

  // Outgoing edges keyed by their start vertex. A vertex normally has one; at
  // a saddle — two filled pixels touching only at a corner — it has two, and
  // either pairing closes into valid loops.
  const exits = new Map<number, number[]>();
  const addEdge = (fromX: number, fromY: number, toX: number, toY: number) => {
    const from = vertexKey(fromX, fromY, width);
    const to = vertexKey(toX, toY, width);
    const list = exits.get(from);
    if (list) list.push(to);
    else exits.set(from, [to]);
  };

  const filled = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] !== 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!filled(x, y)) continue;
      // Filled on the right of travel, all four times round.
      if (!filled(x, y - 1)) addEdge(x, y, x + 1, y);
      if (!filled(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1);
      if (!filled(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1);
      if (!filled(x - 1, y)) addEdge(x, y + 1, x, y);
    }
  }

  const toPoint = (key: number): Point => {
    const x = key % (width + 1);
    return { x, y: (key - x) / (width + 1) };
  };

  const contours: Contour[] = [];
  for (const start of [...exits.keys()].sort((a, b) => a - b)) {
    for (;;) {
      const first = exits.get(start);
      if (!first || !first.length) break;

      const loop: number[] = [start];
      let current = first.pop()!;
      while (current !== start) {
        loop.push(current);
        const next = exits.get(current);
        // A dangling chain cannot happen on a well-formed mask — every vertex
        // with an entry has an exit — but a truncated buffer could produce one,
        // and half a loop is worse than none.
        if (!next || !next.length) {
          loop.length = 0;
          break;
        }
        current = next.pop()!;
      }
      if (!loop.length) continue;

      for (const lap of splitSelfTouching(loop)) {
        let points = lap.map(toPoint);
        if (tolerance > 0 && points.length > 3) {
          const closed = rotateToExtreme(points);
          const simplified = simplify([...closed, closed[0]], tolerance);
          // Drop the repeated seam point the simplifier was given to pin.
          points = simplified.slice(0, -1);
        }
        if (points.length < 3) continue;

        const area = signedArea(points);
        if (area === 0) continue;
        contours.push({ points, solid: area > 0, area });
      }
    }
  }

  // Largest first, so the outer boundary of a piece leads the holes inside it.
  return contours.sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
}

/** Ray casting: whether a point falls inside a closed loop. */
export function insideContour(point: Point, loop: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i];
    const b = loop[j];
    if (a.y > point.y !== b.y > point.y) {
      const crossing = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
      if (point.x < crossing) inside = !inside;
    }
  }
  return inside;
}

export type Shape = {
  /** The boundary of one piece. */
  outer: Contour;
  /** The gaps in it. */
  holes: Contour[];
};

/**
 * Groups holes with the piece they are holes in.
 *
 * The tracer knows a loop is a hole from its winding, but not *whose*. On a
 * tray of six shapes that matters: a gap belongs to the one shape it sits
 * inside, and handing it to any other would cut a hole through solid ground.
 *
 * Each hole goes to the smallest piece containing it, which is what makes a
 * ring inside a ring come out right — the gap belongs to the inner island's
 * surroundings, not to the outermost boundary that also happens to contain it.
 */
export function groupContours(contours: Contour[]): Shape[] {
  const shapes: Shape[] = contours
    .filter((contour) => contour.solid)
    .map((outer) => ({ outer, holes: [] as Contour[] }));

  for (const hole of contours.filter((contour) => !contour.solid)) {
    let best: Shape | null = null;
    for (const shape of shapes) {
      if (!insideContour(hole.points[0], shape.outer.points)) continue;
      if (!best || Math.abs(shape.outer.area) < Math.abs(best.outer.area)) best = shape;
    }
    // A hole with nothing around it cannot happen from a real mask, but a
    // caller assembling contours by hand could produce one. Dropping it loses
    // the gap rather than cutting it out of an unrelated piece.
    if (best) best.holes.push(hole);
  }
  return shapes;
}

/**
 * Total filled area the contours enclose, in square pixels — solid loops less
 * the holes in them.
 */
export function enclosedArea(contours: Contour[]): number {
  return contours.reduce((sum, contour) => sum + contour.area, 0);
}
