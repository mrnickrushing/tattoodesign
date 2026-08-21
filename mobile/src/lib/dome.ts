import type { Point } from "./designProject";
import { EMPTY_MESH, inspectMesh, type Mesh } from "./solid";

/**
 * A hemisphere standing on the tray floor, with the drawing raised on it.
 *
 * Everything else in this file's neighbourhood extrudes a flat outline upward,
 * which is right for a cookie and no use at all for a cake pop. A ball is not a
 * prism of anything, so it gets built the way a ball is built: rings of
 * vertices from the equator up to the pole, banded together.
 *
 * The two inversions still cancel — printed dome, silicone hollow, chocolate
 * dome — so what stands proud here stands proud on the sweet.
 */

/** How the drawing is laid onto the dome, and how far it stands off it. */
export type DomeRelief = {
  /** Ink mask, row-major, non-zero where the drawing is. */
  mask: Uint8Array;
  width: number;
  height: number;
  /** How far the inked parts stand off the surface, in millimetres. */
  mm: number;
};

/**
 * Where a point on the dome falls on a flat drawing.
 *
 * Straight down the pole, looking at the ball from above: the pole is the
 * middle of the drawing and the equator is its rim, with distance from the
 * middle growing evenly with the angle down from the pole. It is the projection
 * you get by pressing a round sticker onto a ball from directly above, which is
 * what a design for a cake pop is, and it leaves the middle of the drawing
 * undistorted where the eye goes first.
 */
function sample(relief: DomeRelief, theta: number, downFromPole: number): boolean {
  // 0 at the pole, 1 at the equator.
  const across = downFromPole / (Math.PI / 2);
  const radius = Math.min(relief.width, relief.height) / 2;
  const x = Math.round(relief.width / 2 + Math.cos(theta) * across * radius);
  const y = Math.round(relief.height / 2 + Math.sin(theta) * across * radius);
  if (x < 0 || y < 0 || x >= relief.width || y >= relief.height) return false;
  return relief.mask[y * relief.width + x] !== 0;
}

/**
 * How smooth is smooth enough, as a distance rather than a facet count.
 *
 * A flat facet cuts a chord across the true curve, and what matters is how far
 * the chord strays from it — not how long the facet is. Fifty microns is a
 * quarter of a layer on a printer laying two-tenths, which is below anything it
 * could express even if the mesh were perfect.
 */
const SMOOTH_TOLERANCE_MM = 0.05;

/**
 * How many facets to go round in.
 *
 * Two separate demands, and the answer is whichever is greater.
 *
 * **Roundness** is the chord one, measured across a *triangle*, not an edge.
 * Bands here run in both directions and the latitude step is built to match the
 * longitude one, so a triangle's diagonal spans root-two times the angle either
 * of its sides does — and sag goes as the square of the angle, which makes the
 * diagonal stray twice as far as the equatorial edge everybody reaches for
 * first. Measured on real meshes the ratio is 1.95 at 44 facets and 1.99 by
 * 128: exactly the two the algebra asks for.
 *
 * Sizing on the edge alone therefore delivers a ball twice as faceted as it
 * claims. It is a far weaker demand than it still looks — a 1.5in ball needs 64
 * facets to hold fifty microns across a whole triangle.
 *
 * Judging a facet by its *length* against the nozzle instead, which is what
 * this did first, asks for 256 facets and thirty-three thousand triangles a
 * ball to buy an accuracy of one and a half microns. No printer can lay that
 * down and no file wants to carry it.
 *
 * **Relief** is the real reason to go fine. A drawing raised on the dome is
 * only as sharp as the facets under it, so the finest thing in the drawing has
 * to span a facet or two. Passing its size in raises the count for that alone —
 * and only the half that carries a drawing pays for it.
 */
export function domeSegments(radiusMm: number, reliefFeatureMm = 0): number {
  if (!(radiusMm > 0)) return MIN_SEGMENTS;

  // Smallest count whose *triangle* stays inside the tolerance. The root two is
  // the diagonal: a facet spans one angular step each way, and the far corner
  // of it is that much further round the ball than the near edge is.
  const ratio = Math.max(-1, Math.min(1, 1 - SMOOTH_TOLERANCE_MM / radiusMm));
  const round = Math.ceil((Math.PI * Math.SQRT2) / Math.acos(ratio));

  // And fine enough that the drawing's own detail survives being drawn on it:
  // two facets across the finest feature, which is as coarse as a step can be
  // and still read as an edge rather than a corner.
  const detail =
    reliefFeatureMm > 0 ? Math.ceil((2 * Math.PI * radiusMm) / (reliefFeatureMm / 2)) : 0;

  const wanted = Math.max(round, detail, MIN_SEGMENTS);
  const capped = Math.min(MAX_SEGMENTS, wanted);
  return capped + ((4 - (capped % 4)) % 4);
}

/** Enough to read as round at all, whatever the arithmetic says. */
const MIN_SEGMENTS = 32;

/**
 * The ceiling, and it is a real one.
 *
 * A ball here is one of several on a tray and there are two trays, so the count
 * is paid for many times over. Past this, a mold stops being a file a phone can
 * build and share.
 */
const MAX_SEGMENTS = 192;

/**
 * How far the true ball strays from the flat triangles standing in for it.
 *
 * Across a triangle rather than along an edge — see `domeSegments`. Anything
 * telling somebody how round their ball came out has to quote this one, or it
 * quotes half of what the mesh actually does.
 */
export function domeStrayMm(radiusMm: number, segments: number): number {
  if (!(radiusMm > 0) || segments < 3) return 0;
  return radiusMm * (1 - Math.cos((Math.PI * Math.SQRT2) / segments));
}

/**
 * A closed dome: flat side down, sunk into the floor by `weldMm`.
 *
 * The skirt below the base is what welds it to the floor, the same hair of
 * overlap every other part of the tray uses so no two faces land at the same
 * height.
 */
export function dome(
  centre: Point,
  radiusMm: number,
  baseZ: number,
  segments: number,
  weldMm: number,
  relief?: DomeRelief
): Mesh {
  if (!(radiusMm > 0) || segments < 8) return EMPTY_MESH;
  // A quarter turn from equator to pole, so rings are spaced like segments are.
  const rings = Math.max(4, Math.round(segments / 4));
  const positions: number[] = [];

  const push = (a: number[], b: number[], c: number[]) => {
    positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  };

  // Ring 0 is the equator, ring `rings` is the pole. Each vertex is pushed out
  // along its own radius where the drawing covers it.
  const at = (ring: number, step: number): number[] => {
    const theta = (step / segments) * Math.PI * 2;
    const downFromPole = (Math.PI / 2) * (1 - ring / rings);
    const raise = relief && relief.mm > 0 && sample(relief, theta, downFromPole) ? relief.mm : 0;
    const r = radiusMm + raise;
    const horizontal = r * Math.sin(downFromPole);
    return [
      centre.x + Math.cos(theta) * horizontal,
      centre.y + Math.sin(theta) * horizontal,
      baseZ + r * Math.cos(downFromPole),
    ];
  };

  // The equator, dropped to the weld: the flat face the dome stands on.
  const foot = (step: number): number[] => {
    const point = at(0, step);
    return [point[0], point[1], baseZ - weldMm];
  };

  for (let step = 0; step < segments; step++) {
    const next = (step + 1) % segments;

    // The underside, facing down.
    push(foot(step), [centre.x, centre.y, baseZ - weldMm], foot(next));

    // The skirt from the weld up to the equator.
    push(foot(step), foot(next), at(0, next));
    push(foot(step), at(0, next), at(0, step));

    // Bands up the dome. The last one closes on the pole as a fan.
    for (let ring = 0; ring < rings; ring++) {
      const lowHere = at(ring, step);
      const lowNext = at(ring, next);
      const highHere = at(ring + 1, step);
      const highNext = at(ring + 1, next);
      if (ring + 1 === rings) {
        push(lowHere, lowNext, highHere);
        continue;
      }
      push(lowHere, lowNext, highNext);
      push(lowHere, highNext, highHere);
    }
  }

  const mesh = { positions: Float32Array.from(positions), count: positions.length / 9 };
  // Same rule the extrusions hold themselves to: what cannot be vouched for as
  // closed is handed back as nothing, so a caller can count it rather than a
  // printer discovering it.
  return inspectMesh(mesh).watertight ? mesh : EMPTY_MESH;
}

/** A circle as a closed outline, for the parts of a mold that are just posts. */
export function circle(centre: Point, radiusMm: number, segments = 24): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    points.push({ x: centre.x + Math.cos(theta) * radiusMm, y: centre.y + Math.sin(theta) * radiusMm });
  }
  return points;
}
