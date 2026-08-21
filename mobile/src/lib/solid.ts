// Turning an outline into a thing you can hold.
//
// contour.ts gives closed loops in a plane. A printer wants a closed surface in
// space, and "closed" is not a nicety: a slicer intersects the mesh with a
// stack of horizontal planes and follows the resulting loops, so a single
// missing triangle leaves a loop that does not close and the slice is silently
// repaired into something nobody designed.
//
// Two jobs, then. Cap the top and bottom faces, which needs the polygon
// triangulated — including its holes, because a shape with a gap in it is
// common in line art and a cap that ignores the gap fills it in. And run walls
// down every edge. Both have to agree about which way is out, or the mesh is
// closed and inside out, which slices into nothing at all.
//
// Pure geometry. The units are whatever the caller hands in; castingTray.ts
// works in millimetres because that is what an STL is read as.

import type { Point } from "./designProject";
import { signedArea } from "./contour";

export type Mesh = {
  /** Nine numbers per triangle: three vertices of x, y, z. */
  positions: Float32Array;
  /** Triangles, so `positions.length === count * 9`. */
  count: number;
};

export const EMPTY_MESH: Mesh = { positions: new Float32Array(0), count: 0 };

/** Joins meshes into one. The parts do not have to touch. */
export function mergeMeshes(meshes: Mesh[]): Mesh {
  const count = meshes.reduce((sum, mesh) => sum + mesh.count, 0);
  const positions = new Float32Array(count * 9);
  let at = 0;
  for (const mesh of meshes) {
    positions.set(mesh.positions.subarray(0, mesh.count * 9), at);
    at += mesh.count * 9;
  }
  return { positions, count };
}

function cross2(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Whether p sits inside triangle abc, edges counting as inside. */
function inTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  const d1 = cross2(b.x - a.x, b.y - a.y, p.x - a.x, p.y - a.y);
  const d2 = cross2(c.x - b.x, c.y - b.y, p.x - b.x, p.y - b.y);
  const d3 = cross2(a.x - c.x, a.y - c.y, p.x - c.x, p.y - c.y);
  const negative = d1 < 0 || d2 < 0 || d3 < 0;
  const positive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(negative && positive);
}

/**
 * Whether p lies on segment ab, not counting its endpoints.
 *
 * A bridge is allowed to *end* on a vertex and never allowed to pass through
 * one. Running through a vertex pinches the polygon there — two parts joined at
 * a single point — and no ear ever spans a pinch, so the triangulation stops
 * dead partway with no error to show for it.
 */
function onSegment(p: Point, a: Point, b: Point): boolean {
  if (samePoint(p, a) || samePoint(p, b)) return false;
  if (Math.abs(cross2(b.x - a.x, b.y - a.y, p.x - a.x, p.y - a.y)) > 1e-9) return false;
  const along = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
  const length = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  return along > 0 && along < length;
}

/** Whether segments ab and cd cross, not counting shared endpoints. */
function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  if (samePoint(a, c) || samePoint(a, d) || samePoint(b, c) || samePoint(b, d)) return false;

  const d1 = cross2(b.x - a.x, b.y - a.y, c.x - a.x, c.y - a.y);
  const d2 = cross2(b.x - a.x, b.y - a.y, d.x - a.x, d.y - a.y);
  const d3 = cross2(d.x - c.x, d.y - c.y, a.x - c.x, a.y - c.y);
  const d4 = cross2(d.x - c.x, d.y - c.y, b.x - c.x, b.y - c.y);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Reverses a loop when its winding is not the one asked for. */
function wound(points: Point[], positive: boolean): Point[] {
  const area = signedArea(points);
  return area > 0 === positive ? points.slice() : [...points].reverse();
}

/**
 * Whether a loop crosses itself.
 *
 * Offsetting is the operation that breaks this. Grow a shape whose own parts
 * are closer together than twice the offset and the new boundary passes through
 * itself, which triangulates into a knot rather than failing — so the check has
 * to be made rather than assumed.
 */
export function isSimplePolygon(points: Point[]): boolean {
  if (points.length < 3) return false;

  // Touching counts. A vertex that lands on another vertex, or in the middle of
  // an edge it is not an end of, pinches the loop to a point — two lobes joined
  // where the boundary meets itself. Nothing *crosses* there, so the strict
  // crossing test below reports a clean polygon, and the walls raised on it come
  // out with zero-area faces and a seam that never closes. An offset lands
  // exactly here whenever it grows two parts of a shape into contact, which is
  // precisely the case the caller is asking about.
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (samePoint(points[i], points[j])) return false;
    }
    for (let j = 0; j < points.length; j++) {
      const next = (j + 1) % points.length;
      // Its own two edges are the ones a vertex is allowed to sit on.
      if (i === j || i === next) continue;
      if (onSegment(points[i], points[j], points[next])) return false;
    }
  }

  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    for (let j = i + 1; j < points.length; j++) {
      const c = points[j];
      const d = points[(j + 1) % points.length];
      // segmentsCross already ignores edges that merely share an endpoint,
      // which is every adjacent pair.
      if (segmentsCross(a, b, c, d)) return false;
    }
  }
  return true;
}

/**
 * How far a sharp corner may be pushed out before it is cut short.
 *
 * A spike offset properly runs away to a point far outside the shape — the
 * distance goes as one over the sine of half the angle, so a needle-thin arm
 * reaches for infinity. Four times the offset is the same limit SVG stroking
 * uses, and stopping there loses a sliver of a corner nobody could print.
 */
const MITER_LIMIT = 4;

/**
 * Grows or shrinks a loop by moving every vertex along its own bisector.
 *
 * Positive grows the solid: the fill is on the right of travel everywhere in
 * this file, so "out of the solid" is to the left, and a hole handed the same
 * positive distance shrinks — which is what growing the solid around it means.
 *
 * The vertex count is preserved, deliberately. A proper offset would insert a
 * bevel or an arc at every sharp corner, and then the result no longer
 * corresponds vertex for vertex with the shape it came from — which is exactly
 * what the tapered walls need it to do.
 *
 * Null when the loop has a fold in it that has no bisector to move along.
 */
export function offsetPolygon(points: Point[], distance: number): Point[] | null {
  if (points.length < 3) return null;
  if (distance === 0) return points.slice();

  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const previous = points[(i - 1 + points.length) % points.length];
    const vertex = points[i];
    const next = points[(i + 1) % points.length];

    const inLength = Math.hypot(vertex.x - previous.x, vertex.y - previous.y);
    const outLength = Math.hypot(next.x - vertex.x, next.y - vertex.y);
    if (inLength < 1e-9 || outLength < 1e-9) return null;

    // Outward normal of each edge: left of travel.
    const n1 = { x: (vertex.y - previous.y) / inLength, y: -(vertex.x - previous.x) / inLength };
    const n2 = { x: (next.y - vertex.y) / outLength, y: -(next.x - vertex.x) / outLength };

    const bx = n1.x + n2.x;
    const by = n1.y + n2.y;
    const bisectorLength = Math.hypot(bx, by);
    // The two edges double back on each other: the corner folds to nothing and
    // there is no direction that is out of both.
    if (bisectorLength < 1e-9) return null;

    const ux = bx / bisectorLength;
    const uy = by / bisectorLength;
    const cosHalf = ux * n1.x + uy * n1.y;
    if (Math.abs(cosHalf) < 1e-9) return null;

    const reach = distance / cosHalf;
    const limit = Math.abs(distance) * MITER_LIMIT;
    const clamped = Math.max(-limit, Math.min(limit, reach));
    out.push({ x: vertex.x + ux * clamped, y: vertex.y + uy * clamped });
  }

  // An offset that runs past the middle of the shape turns it inside out, and
  // does so quietly: a 4mm gap closed in by 3 from every side comes back as a
  // tidy 2mm square whose corners have swapped over, with the winding intact
  // and no edge crossing anything. What gives it away is that the edge itself
  // now points the other way. Nothing downstream would notice — the mesh would
  // close, around the wrong ground.
  for (let i = 0; i < points.length; i++) {
    const next = (i + 1) % points.length;
    const was = { x: points[next].x - points[i].x, y: points[next].y - points[i].y };
    const now = { x: out[next].x - out[i].x, y: out[next].y - out[i].y };
    if (was.x * now.x + was.y * now.y < 0) return null;
  }
  return out;
}

/**
 * Grows a whole shape, holes and all, or reports that it cannot.
 *
 * Every way this can go wrong is a way that produces a *plausible* polygon
 * rather than an obvious failure, so each is checked: the boundary must have
 * grown rather than shrunk or turned inside out, every hole must have shrunk
 * without inverting or closing up, and nothing may cross itself. A caller that
 * gets null should carry on without the offset rather than with a knot.
 */
/** Distance from p to the nearest point of segment ab. */
function pointToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-18) return Math.hypot(p.x - a.x, p.y - a.y);
  const along = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared;
  const t = Math.max(0, Math.min(1, along));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** The closest approach between two loops, given up on once it cannot win. */
function loopGap(a: Point[], b: Point[], ceiling: number): number {
  if (a.length < 2 || b.length < 2) return ceiling;

  // Boxes first. Two loops already further apart than the best gap so far
  // cannot beat it, and on detailed line art that discards nearly every pair
  // before a single edge is looked at — which is what keeps this affordable
  // when a design traces out fifty separate shapes.
  let aMinX = Infinity, aMinY = Infinity, aMaxX = -Infinity, aMaxY = -Infinity;
  for (const point of a) {
    if (point.x < aMinX) aMinX = point.x;
    if (point.x > aMaxX) aMaxX = point.x;
    if (point.y < aMinY) aMinY = point.y;
    if (point.y > aMaxY) aMaxY = point.y;
  }
  let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
  for (const point of b) {
    if (point.x < bMinX) bMinX = point.x;
    if (point.x > bMaxX) bMaxX = point.x;
    if (point.y < bMinY) bMinY = point.y;
    if (point.y > bMaxY) bMaxY = point.y;
  }
  const apart = Math.hypot(
    Math.max(0, Math.max(aMinX - bMaxX, bMinX - aMaxX)),
    Math.max(0, Math.max(aMinY - bMaxY, bMinY - aMaxY))
  );
  if (apart >= ceiling) return ceiling;

  let best = ceiling;
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i];
    const a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const b1 = b[j];
      const b2 = b[(j + 1) % b.length];
      // Neither loop crosses the other — they are traced from disjoint runs of
      // the same mask — and for segments that do not meet, the closest approach
      // is always at an end of one of them.
      const gap = Math.min(
        pointToSegment(a1, b1, b2),
        pointToSegment(a2, b1, b2),
        pointToSegment(b1, a1, a2),
        pointToSegment(b2, a1, a2)
      );
      if (gap < best) best = gap;
      if (best <= 0) return 0;
    }
  }
  return best;
}

/**
 * The closest approach between the boundaries of two outlines.
 *
 * Every loop counts, holes included: a shape sitting in another shape's hole is
 * as close to it as two shapes side by side are to each other, and an offset
 * closes both kinds of gap at the same rate.
 *
 * `ceiling` is the largest answer worth having. Anything further apart than
 * that is reported as exactly `ceiling`, which is what lets the box test throw
 * work away instead of measuring distances nobody will act on.
 */
export function outlineGap(a: Outline, b: Outline, ceiling = Infinity): number {
  let best = ceiling;
  for (const left of [a.outer, ...a.holes]) {
    for (const right of [b.outer, ...b.holes]) {
      best = loopGap(left, right, best);
      if (best <= 0) return 0;
    }
  }
  return best;
}

export function offsetOutline(outline: Outline, distance: number): Outline | null {
  const outer = offsetPolygon(wound(outline.outer, true), distance);
  if (!outer || !isSimplePolygon(outer)) return null;

  const grown = signedArea(outer);
  const before = Math.abs(signedArea(outline.outer));
  if (grown <= 0 || grown <= before) return null;

  const holes: Point[][] = [];
  for (const hole of outline.holes) {
    if (hole.length < 3) continue;
    const shrunk = offsetPolygon(wound(hole, false), distance);
    if (!shrunk || !isSimplePolygon(shrunk)) return null;
    const area = signedArea(shrunk);
    // Still a hole, still wound as one, and smaller than it was — a gap that
    // grew, flipped, or vanished means the offset ate through it.
    if (area >= 0 || Math.abs(area) >= Math.abs(signedArea(hole))) return null;
    holes.push(shrunk);
  }
  return { outer, holes };
}

/**
 * Splices each hole into the outer loop along a bridge.
 *
 * Ear clipping only understands one loop, so a shape with holes has to become
 * one loop first. The trick is old and slightly grubby: cut from a hole to a
 * vertex of the outer boundary it can see, walk the hole, and cut back along
 * the same line. The bridge is traversed twice in opposite directions, so it
 * encloses no area and the result is still exactly the original shape — it is
 * simply now a single loop with a zero-width slit in it.
 *
 * The bridge has to be a line that leaves the shape's interior alone, so
 * candidates are tried nearest-first and rejected if they cross any edge.
 */
export function bridgeHoles(outer: Point[], holes: Point[][]): Point[] {
  let merged = wound(outer, true);
  // Rightmost hole first: its bridge is the least likely to be blocked by
  // another hole still waiting to be spliced in.
  const pending = holes
    .filter((hole) => hole.length >= 3)
    .map((hole) => wound(hole, false))
    .sort((a, b) => Math.max(...b.map((p) => p.x)) - Math.max(...a.map((p) => p.x)));

  for (const hole of pending) {
    let from = 0;
    for (let i = 1; i < hole.length; i++) if (hole[i].x > hole[from].x) from = i;
    const anchor = hole[from];

    const candidates = merged
      .map((point, index) => ({ index, distance: Math.hypot(point.x - anchor.x, point.y - anchor.y) }))
      .sort((a, b) => a.distance - b.distance);

    let chosen = -1;
    for (const candidate of candidates) {
      const target = merged[candidate.index];
      const others = pending.filter((other) => other !== hole);
      const crosses = (loop: Point[]) =>
        loop.some((point, i) => segmentsCross(anchor, target, point, loop[(i + 1) % loop.length]));
      const grazes = (loop: Point[]) => loop.some((point) => onSegment(point, anchor, target));

      const blocked =
        crosses(merged) ||
        crosses(hole) ||
        others.some(crosses) ||
        grazes(merged) ||
        grazes(hole) ||
        others.some(grazes);
      if (!blocked) {
        chosen = candidate.index;
        break;
      }
    }
    // No line of sight at all should not happen for a simple polygon, but a
    // self-touching contour can produce one. Dropping the hole loses the gap
    // rather than the whole shape.
    if (chosen < 0) continue;

    const walk = [...hole.slice(from), ...hole.slice(0, from), anchor];
    merged = [
      ...merged.slice(0, chosen + 1),
      ...walk,
      ...merged.slice(chosen),
    ];
  }
  return merged;
}

/**
 * Ear clipping. Returns triangles as flat triples of points.
 *
 * Every simple polygon has at least two "ears" — a vertex whose two
 * neighbours can be joined without leaving the shape — so repeatedly cutting
 * one off terminates with the polygon triangulated. Slow on paper and entirely
 * fast enough here, where a simplified outline is tens of points rather than
 * thousands.
 */
export function triangulate(outer: Point[], holes: Point[][] = []): Point[] {
  const loop = holes.length ? bridgeHoles(outer, holes) : wound(outer, true);
  if (loop.length < 3) return [];

  const remaining = loop.map((_, i) => i);
  const out: Point[] = [];
  const convex = (previous: Point, vertex: Point, next: Point) =>
    cross2(vertex.x - previous.x, vertex.y - previous.y, next.x - vertex.x, next.y - vertex.y) > 0;

  // Bounded so a degenerate loop cannot spin forever; the worst honest case
  // clips one ear per pass through the remaining vertices.
  let guard = remaining.length * remaining.length + 16;
  while (remaining.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < remaining.length; i++) {
      const previous = loop[remaining[(i - 1 + remaining.length) % remaining.length]];
      const vertex = loop[remaining[i]];
      const next = loop[remaining[(i + 1) % remaining.length]];
      if (!convex(previous, vertex, next)) continue;

      const swallows = remaining.some((index, j) => {
        if (j === i || j === (i - 1 + remaining.length) % remaining.length || j === (i + 1) % remaining.length) {
          return false;
        }
        const candidate = loop[index];
        // A bridged hole deliberately repeats two vertices — the anchor and the
        // outer vertex it was cut to — so the loop contains points that *are*
        // corners of this ear rather than points inside it. Counting those as
        // swallowed rejects every ear there is, and the polygon never clips.
        if (samePoint(candidate, previous) || samePoint(candidate, vertex) || samePoint(candidate, next)) {
          return false;
        }
        return inTriangle(candidate, previous, vertex, next);
      });
      if (swallows) continue;

      out.push(previous, vertex, next);
      remaining.splice(i, 1);
      clipped = true;
      break;
    }
    if (clipped) continue;

    // Nothing was clippable. Bridging leaves the loop with artefacts that are
    // not ears and not real geometry either: a vertex repeated where a bridge
    // meets the outline, and collinear runs where the same line is walked out
    // and back. Removing one of those changes no area and frees the rest of
    // the polygon to clip. Only give up once there is nothing left to tidy.
    let tidied = false;
    for (let i = 0; i < remaining.length; i++) {
      const previous = loop[remaining[(i - 1 + remaining.length) % remaining.length]];
      const vertex = loop[remaining[i]];
      const next = loop[remaining[(i + 1) % remaining.length]];
      const redundant =
        samePoint(previous, vertex) ||
        Math.abs(cross2(vertex.x - previous.x, vertex.y - previous.y, next.x - vertex.x, next.y - vertex.y)) <
          1e-9;
      if (!redundant) continue;
      remaining.splice(i, 1);
      tidied = true;
      break;
    }
    if (!tidied) break;
  }
  if (remaining.length === 3) {
    out.push(loop[remaining[0]], loop[remaining[1]], loop[remaining[2]]);
  }

  // A triangle with two corners in the same place has no facing for a slicer
  // to read, and dropping one is safe: its two real edges run in opposite
  // directions and cancel each other out, so the surface around it still
  // closes.
  //
  // A *collinear* sliver — three distinct corners on one line — is a different
  // animal and has to stay. It covers nothing either, but its three edges are
  // three distinct edges, and the triangles beside it are relying on them.
  // Dropping one tears three holes in a surface that was closed.
  const kept: Point[] = [];
  for (let i = 0; i < out.length; i += 3) {
    const [a, b, c] = [out[i], out[i + 1], out[i + 2]];
    if (samePoint(a, b) || samePoint(b, c) || samePoint(c, a)) continue;
    kept.push(a, b, c);
  }
  return kept;
}

function pushTriangle(
  into: number[],
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number]
) {
  into.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
}

/**
 * Extrudes an outline into a closed solid between two heights.
 *
 * The caps are the triangulated outline, laid flat at each height; the walls
 * run down every edge of every loop, holes included, so the inside of a hole is
 * a surface too. Winding is normalised on the way in — outer loops one way,
 * holes the other — so a caller that hands over a reversed contour still gets a
 * solid whose outsides face out rather than one that is inside out.
 */
export function extrudePrism(outer: Point[], holes: Point[][], bottom: number, top: number): Mesh {
  return extrudeBetween({ outer, holes }, { outer, holes }, bottom, top);
}

/** One end of a solid: a boundary and the gaps in it, in the plane. */
export type Outline = { outer: Point[]; holes: Point[][] };

/**
 * Extrudes between two outlines of the same shape at different sizes.
 *
 * The walls lean rather than standing vertical, which is what a fillet at the
 * foot of a shape is: the same outline, flared at the bottom and true at the
 * top. Vertex counts have to match loop for loop, because wall i runs from
 * bottom vertex i to top vertex i and there is no sensible answer if there are
 * different numbers of them.
 */
export function extrudeTapered(bottom: Outline, top: Outline, bottomZ: number, topZ: number): Mesh {
  return extrudeBetween(bottom, top, bottomZ, topZ);
}

function extrudeBetween(bottom: Outline, top: Outline, bottomZ: number, topZ: number): Mesh {
  if (bottom.outer.length < 3 || top.outer.length < 3 || bottomZ === topZ) return EMPTY_MESH;

  // Height is signed, and a caller who asks for a solid from 5 down to 2 means
  // the same solid as 2 up to 5 — so the outlines swap with it.
  const flipped = bottomZ > topZ;
  const low = flipped ? topZ : bottomZ;
  const high = flipped ? bottomZ : topZ;
  const lower = flipped ? top : bottom;
  const upper = flipped ? bottom : top;

  const lowShell = wound(lower.outer, true);
  const highShell = wound(upper.outer, true);
  const lowGaps = lower.holes.filter((hole) => hole.length >= 3).map((hole) => wound(hole, false));
  const highGaps = upper.holes.filter((hole) => hole.length >= 3).map((hole) => wound(hole, false));

  // Walls pair vertex for vertex, so a mismatch is a caller error rather than
  // something to paper over — a mesh built from a guess would close over the
  // wrong ground and no check downstream would notice.
  if (lowShell.length !== highShell.length || lowGaps.length !== highGaps.length) return EMPTY_MESH;
  if (lowGaps.some((gap, i) => gap.length !== highGaps[i].length)) return EMPTY_MESH;

  const lowCap = triangulate(lowShell, lowGaps);
  const highCap = triangulate(highShell, highGaps);
  if (!lowCap.length || !highCap.length) return EMPTY_MESH;

  const positions: number[] = [];
  // The top faces up, so it keeps the triangulation's winding; the bottom
  // faces down and takes the reverse.
  for (let i = 0; i < highCap.length; i += 3) {
    const [a, b, c] = [highCap[i], highCap[i + 1], highCap[i + 2]];
    pushTriangle(positions, [a.x, a.y, high], [b.x, b.y, high], [c.x, c.y, high]);
  }
  for (let i = 0; i < lowCap.length; i += 3) {
    const [a, b, c] = [lowCap[i], lowCap[i + 1], lowCap[i + 2]];
    pushTriangle(positions, [c.x, c.y, low], [b.x, b.y, low], [a.x, a.y, low]);
  }

  const loops: [Point[], Point[]][] = [[lowShell, highShell], ...lowGaps.map((gap, i): [Point[], Point[]] => [gap, highGaps[i]])];
  for (const [lowLoop, highLoop] of loops) {
    for (let i = 0; i < lowLoop.length; i++) {
      const next = (i + 1) % lowLoop.length;
      const a = lowLoop[i];
      const b = lowLoop[next];
      const c = highLoop[next];
      const d = highLoop[i];
      pushTriangle(positions, [a.x, a.y, low], [b.x, b.y, low], [c.x, c.y, high]);
      pushTriangle(positions, [a.x, a.y, low], [c.x, c.y, high], [d.x, d.y, high]);
    }
  }

  return { positions: Float32Array.from(positions), count: positions.length / 9 };
}

/**
 * Volume of a closed mesh, by the divergence theorem.
 *
 * Worth having for its own sake — it is how much resin or filament the thing
 * costs — but mostly it is the sharpest check there is that the mesh is right.
 * It comes out positive and correct only when the surface is closed *and* every
 * triangle faces outward; a mesh that is inside out returns the volume negated,
 * and one with a hole in it returns something meaningless.
 */
export function meshVolume(mesh: Mesh): number {
  const p = mesh.positions;
  let total = 0;
  for (let t = 0; t < mesh.count; t++) {
    const i = t * 9;
    const ax = p[i], ay = p[i + 1], az = p[i + 2];
    const bx = p[i + 3], by = p[i + 4], bz = p[i + 5];
    const cx = p[i + 6], cy = p[i + 7], cz = p[i + 8];
    total += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return total / 6;
}

export type WatertightReport = {
  watertight: boolean;
  /** Edges with anything other than one triangle on each side. */
  unmatched: number;
  /** Triangles with two identical corners, which have no facing at all. */
  degenerate: number;
};

/**
 * Whether the surface actually closes.
 *
 * In a closed, consistently wound surface every edge is walked exactly twice —
 * once in each direction, by the two triangles that share it. An edge walked
 * once is a hole; an edge walked twice the *same* way is two triangles facing
 * opposite ways across a seam. Both slice badly and neither is visible by
 * looking at a render.
 */
export function inspectMesh(mesh: Mesh): WatertightReport {
  const p = mesh.positions;
  const directed = new Map<string, number>();
  let degenerate = 0;

  // Quantised so that two vertices meant to be the same are the same. Float32
  // rounding on a shared corner would otherwise read as a crack.
  const key = (i: number) => `${p[i].toFixed(4)},${p[i + 1].toFixed(4)},${p[i + 2].toFixed(4)}`;

  for (let t = 0; t < mesh.count; t++) {
    const i = t * 9;
    const corners = [key(i), key(i + 3), key(i + 6)];
    if (corners[0] === corners[1] || corners[1] === corners[2] || corners[2] === corners[0]) {
      degenerate++;
      continue;
    }
    for (let e = 0; e < 3; e++) {
      const edge = `${corners[e]}|${corners[(e + 1) % 3]}`;
      directed.set(edge, (directed.get(edge) ?? 0) + 1);
    }
  }

  let unmatched = 0;
  for (const [edge, times] of directed) {
    const [from, to] = edge.split("|");
    if (times !== 1 || (directed.get(`${to}|${from}`) ?? 0) !== 1) unmatched++;
  }

  return { watertight: unmatched === 0 && degenerate === 0 && mesh.count > 0, unmatched, degenerate };
}
