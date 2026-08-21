// The thing that actually gets printed.
//
// Nobody 3D prints a mold and pours chocolate into it. A printed surface is
// ridged with layer lines that trap what you would rather not eat, and PLA does
// not survive a dishwasher. What gets printed is a *tray*: a shallow walled box
// with the shapes standing proud of its floor. Silicone is poured in, cures
// around them, and the silicone is the mold.
//
// Two useful things follow. Nothing printed ever touches food, so the whole
// question collapses to using food-grade silicone. And the two inversions
// cancel — printed positive, silicone negative, chocolate positive — so what
// comes out of the mold looks like what went into the printer. The tray can be
// previewed as the goodie, which is the only mental model anyone wants.
//
// What does not follow is that surface finish stops mattering. Every layer line
// on a positive is copied into the silicone and then into every piece cast from
// it, forever.

import { groupContours, traceContours } from "./contour";
import type { Point } from "./designProject";
import { finestStrokeWidth } from "./lineWidth";
import type { ProductionFinding } from "./productionTools";
import { extrudePrism, mergeMeshes, meshVolume, type Mesh } from "./solid";
import { INCH_MM } from "./stl";

export type TraySpec = {
  /** Printed width of the artwork, in inches. Everything else scales from it. */
  widthIn: number;
  /** How thick the finished piece is, in millimetres. */
  shapeMm: number;
  /** Tray floor. Thin enough to save plastic, thick enough not to bow. */
  floorMm?: number;
  /** Silicone above the tallest point, so the finished mold has a back. */
  coverMm?: number;
  /** Clear ground between a shape and the tray wall. */
  marginMm?: number;
  /** Nozzle the tray will be printed with. Sets what detail can survive. */
  nozzleMm?: number;
  /** Print bed, for warning before rather than after. */
  bedMm?: number;
};

const DEFAULTS = {
  floorMm: 2,
  coverMm: 4,
  marginMm: 8,
  nozzleMm: 0.4,
  bedMm: 220,
};

/**
 * How far the parts of the tray sink into each other.
 *
 * The floor, the walls and the shapes are separate closed solids in one file,
 * which is how a slicer prefers to be handed an assembly — it unions whatever
 * volume it finds. What it dislikes is two faces at exactly the same height,
 * where rounding decides arbitrarily which is on top. A hair of overlap makes
 * the answer unambiguous and is far below anything the printer can resolve.
 */
const WELD_MM = 0.01;

/** Two perimeters of extrusion is the least that stands up as a wall. */
const MIN_WALL_NOZZLES = 2;

export type Tray = {
  /** Every part, in millimetres, ready to encode. */
  mesh: Mesh;
  /** The closed solids the mesh is made of: floor, walls, and one per shape. */
  parts: Mesh[];
  widthMm: number;
  depthMm: number;
  heightMm: number;
  /** Plastic in the print, in cm³ — roughly what it costs to make. */
  plasticCm3: number;
  /** Silicone to fill it, in millilitres. The expensive half. */
  siliconeMl: number;
  /** Shapes standing on the floor. */
  shapes: number;
  findings: ProductionFinding[];
};

function rectangle(x: number, y: number, width: number, depth: number): Point[] {
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + depth },
    { x, y: y + depth },
  ];
}

/**
 * Builds a printable casting tray from a mask of the artwork.
 *
 * Returns null when there is nothing in the mask to stand up, which a caller
 * should treat as "trace the design first" rather than as a failure.
 */
export function buildTray(
  mask: Uint8Array,
  maskWidth: number,
  maskHeight: number,
  spec: TraySpec
): Tray | null {
  const floorMm = spec.floorMm ?? DEFAULTS.floorMm;
  const coverMm = spec.coverMm ?? DEFAULTS.coverMm;
  const marginMm = spec.marginMm ?? DEFAULTS.marginMm;
  const nozzleMm = spec.nozzleMm ?? DEFAULTS.nozzleMm;
  const bedMm = spec.bedMm ?? DEFAULTS.bedMm;

  if (maskWidth <= 0 || maskHeight <= 0 || mask.length < maskWidth * maskHeight) return null;
  if (!(spec.widthIn > 0) || !(spec.shapeMm > 0)) return null;

  const mmPerPx = (spec.widthIn * INCH_MM) / maskWidth;

  // Simplified to a tenth of a millimetre: finer than the printer resolves, so
  // the staircase goes without any of the shape going with it.
  const contours = traceContours(mask, maskWidth, maskHeight, 0.1 / mmPerPx);
  const shapes = groupContours(contours);
  if (!shapes.length) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const shape of shapes) {
    for (const point of shape.outer.points) {
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    }
  }

  // Image y runs down the screen and a printed tray is looked at from above, so
  // the artwork is flipped on the way into millimetres. Without it every design
  // comes out of the mold upside down, and lettering comes out unreadable.
  const toMm = (point: Point): Point => ({
    x: (point.x - minX) * mmPerPx + marginMm,
    y: (maxY - point.y) * mmPerPx + marginMm,
  });

  const widthMm = (maxX - minX) * mmPerPx + marginMm * 2;
  const depthMm = (maxY - minY) * mmPerPx + marginMm * 2;
  const heightMm = floorMm + spec.shapeMm + coverMm;

  const floor = extrudePrism(rectangle(0, 0, widthMm, depthMm), [], 0, floorMm);
  const walls = extrudePrism(
    rectangle(0, 0, widthMm, depthMm),
    [[...rectangle(marginMm / 2, marginMm / 2, widthMm - marginMm, depthMm - marginMm)].reverse()],
    floorMm - WELD_MM,
    heightMm
  );

  const positives = shapes.map((shape) =>
    extrudePrism(
      shape.outer.points.map(toMm),
      shape.holes.map((hole) => hole.points.map(toMm)),
      floorMm - WELD_MM,
      floorMm + spec.shapeMm
    )
  );

  const parts = [floor, walls, ...positives].filter((part) => part.count > 0);
  const mesh = mergeMeshes(parts);

  const plasticMm3 = parts.reduce((sum, part) => sum + meshVolume(part), 0);
  // Everything inside the walls that the shapes and floor do not already fill.
  const cavityMm3 =
    (widthMm - marginMm) * (depthMm - marginMm) * (heightMm - floorMm) -
    positives.reduce((sum, part) => sum + meshVolume(part), 0);

  return {
    mesh,
    parts,
    widthMm,
    depthMm,
    heightMm,
    plasticCm3: Math.max(0, plasticMm3) / 1000,
    siliconeMl: Math.max(0, cavityMm3) / 1000,
    shapes: positives.length,
    findings: inspectTray(mask, maskWidth, maskHeight, mmPerPx, {
      widthMm,
      depthMm,
      heightMm,
      nozzleMm,
      bedMm,
    }),
  };
}

/**
 * What will go wrong before it goes wrong.
 *
 * Two questions a printer cannot answer for itself: whether the finest detail
 * in the artwork is coarser than the nozzle that has to draw it — anything
 * below simply does not appear, silently — and whether the tray fits the bed.
 */
function inspectTray(
  mask: Uint8Array,
  maskWidth: number,
  maskHeight: number,
  mmPerPx: number,
  limits: { widthMm: number; depthMm: number; heightMm: number; nozzleMm: number; bedMm: number }
): ProductionFinding[] {
  const findings: ProductionFinding[] = [];

  const finestMm = finestStrokeWidth(mask, maskWidth, maskHeight) * mmPerPx;
  const minimumMm = limits.nozzleMm * MIN_WALL_NOZZLES;
  findings.push(
    finestMm >= minimumMm
      ? {
          level: "pass",
          title: "Detail",
          detail: `The finest detail is about ${finestMm.toFixed(2)}mm, over the ${minimumMm.toFixed(2)}mm a ${limits.nozzleMm}mm nozzle needs to lay down a standing wall.`,
        }
      : {
          level: "warn",
          title: "Detail",
          detail: `The finest detail is about ${finestMm.toFixed(2)}mm, under the ${minimumMm.toFixed(2)}mm a ${limits.nozzleMm}mm nozzle can hold. It will not print — not badly, but not at all. Scale the piece up or take the fine lines out.`,
        }
  );

  const fits = limits.widthMm <= limits.bedMm && limits.depthMm <= limits.bedMm;
  findings.push(
    fits
      ? {
          level: "pass",
          title: "Bed",
          detail: `${limits.widthMm.toFixed(0)} x ${limits.depthMm.toFixed(0)}mm, inside a ${limits.bedMm}mm bed.`,
        }
      : {
          level: "warn",
          title: "Bed",
          detail: `${limits.widthMm.toFixed(0)} x ${limits.depthMm.toFixed(0)}mm will not fit a ${limits.bedMm}mm bed. Print the shapes across two trays, or make them smaller.`,
        }
  );

  findings.push({
    level: "pass",
    title: "Food safety",
    detail:
      "Nothing printed here touches food — the silicone cast in it does. Use a food-grade silicone and the layer lines on the print stay a surface-finish question rather than a hygiene one.",
  });

  return findings;
}
