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
 * How many facets to go round in, for a ball of this size on this printer.
 *
 * Facets finer than the nozzle are detail the printer cannot lay down and file
 * size nobody wanted — a ball at half a millimetre a facet is already tens of
 * thousands of triangles, and a tray holds several. Coarser than about a
 * millimetre and the ball reads as faceted in the chocolate rather than round.
 */
export function domeSegments(radiusMm: number, nozzleMm: number): number {
  const wanted = Math.round((Math.PI * 2 * radiusMm) / Math.max(0.05, nozzleMm));
  return Math.max(48, Math.min(256, wanted - (wanted % 4)));
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
