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

import { fillEnclosed, groupContours, traceContours } from "./contour";
import type { Point } from "./designProject";
import { finestStrokeWidth } from "./lineWidth";
import type { ProductionFinding } from "./productionTools";
import {
  extrudePrism,
  extrudeTapered,
  mergeMeshes,
  meshVolume,
  offsetOutline,
  outlineGap,
  type Mesh,
  type Outline,
} from "./solid";
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
  /**
   * The largest flare to put where each shape meets the floor.
   *
   * The silicone gets a sloped corner instead of a square notch, and a square
   * notch is where it tears first when the mold is peeled off.
   *
   * A maximum rather than a figure: fine linework cannot take a flare wider
   * than the line itself, so each shape is offered this and then half of it,
   * and half again, until one fits. All-or-nothing would mean typical line art
   * — arms about a millimetre across — got nothing at all. Zero turns it off.
   */
  filletMm?: number;
  /**
   * How many cavities the tray should hold. One pour, this many pieces.
   */
  copies?: number;
  /**
   * Silicone left between neighbouring cavities. Too thin and the wall
   * between two pieces tears when the mold is peeled off them.
   */
  webbingMm?: number;
  /**
   * Whether an outline should stand up as the shape it outlines. On by
   * default, because line art is usually a silhouette. Off when the marks
   * themselves are the object — a lattice, a monogram cut right through.
   */
  fillOutlines?: boolean;
};

const DEFAULTS = {
  floorMm: 2,
  coverMm: 4,
  marginMm: 8,
  nozzleMm: 0.4,
  bedMm: 220,
  copies: 1,
  webbingMm: 6,
  filletMm: 0.8,
};

export type CavityGrid = {
  columns: number;
  rows: number;
  /** Top-left of each cavity, relative to the block of them. */
  positions: { x: number; y: number }[];
  /** Extent of the whole block, before the tray's own margin. */
  widthMm: number;
  depthMm: number;
};

/**
 * Arranges `count` cavities of one size into the tidiest block.
 *
 * The sheet builder's packers in layout.ts answer the opposite question —
 * they fit cells into a page whose size is already decided, shrinking the
 * cells until they go. Here the cavities are a fixed size, because they are the
 * size of the cookie, and it is the tray that has to grow to fit them.
 *
 * Column counts are all tried and scored on the *longest* side of the result:
 * a print bed is square and its limit is whichever way the tray is widest, so
 * the arrangement closest to square is the one most likely to fit. Ties go to
 * the smaller total footprint, which is less plastic and less silicone.
 */
export function packCavities(
  count: number,
  unitWidthMm: number,
  unitDepthMm: number,
  webbingMm: number
): CavityGrid {
  const wanted = Math.max(1, Math.floor(count));
  const gap = Math.max(0, webbingMm);
  const empty: CavityGrid = { columns: 0, rows: 0, positions: [], widthMm: 0, depthMm: 0 };
  if (!(unitWidthMm > 0) || !(unitDepthMm > 0)) return empty;

  let best: { columns: number; rows: number; widthMm: number; depthMm: number } | null = null;
  for (let columns = 1; columns <= wanted; columns++) {
    const rows = Math.ceil(wanted / columns);
    const widthMm = columns * unitWidthMm + (columns - 1) * gap;
    const depthMm = rows * unitDepthMm + (rows - 1) * gap;
    if (!best) {
      best = { columns, rows, widthMm, depthMm };
      continue;
    }
    const longest = Math.max(widthMm, depthMm);
    const bestLongest = Math.max(best.widthMm, best.depthMm);
    const better =
      longest < bestLongest ||
      (longest === bestLongest && widthMm * depthMm < best.widthMm * best.depthMm);
    if (better) best = { columns, rows, widthMm, depthMm };
  }
  if (!best) return empty;

  const { columns, rows, widthMm, depthMm } = best;
  const positions: { x: number; y: number }[] = [];
  for (let i = 0; i < wanted; i++) {
    const row = Math.floor(i / columns);
    const column = i % columns;
    // A last row that is not full is centred on its own, so the odd one out
    // does not sit against one wall with all the silicone on the other side.
    const inRow = Math.min(columns, wanted - row * columns);
    const rowWidth = inRow * unitWidthMm + (inRow - 1) * gap;
    positions.push({
      x: (widthMm - rowWidth) / 2 + column * (unitWidthMm + gap),
      y: row * (unitDepthMm + gap),
    });
  }
  return { columns, rows, positions, widthMm, depthMm };
}

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

/** How many times a flare may be halved before it is not worth having. */
const FILLET_HALVINGS = 4;

/**
 * The most flare any shape on this tray may take before it reaches a neighbour.
 *
 * A flare grows every shape outwards, so two shapes closer together than twice
 * the flare meet at the floor and the slicer welds them into one — quietly
 * turning two cookies into one joined by a web of flash. Both sides move, so
 * half the closest approach is the ceiling, and what is left between them still
 * has to be a nozzle wide: a gap thinner than one extrusion is not a gap the
 * printer can lay a wall into, so it closes anyway.
 *
 * Cavities are the same argument at tray scale. The packer reserves the webbing
 * around each unflared copy, so the shapes along the facing edges are what eats
 * into it — and the webbing is the least those can be apart, whatever the
 * artwork looks like.
 */
function flareLimit(outlines: Outline[], largestMm: number, nozzleMm: number, webbingMm: number): number {
  // Past this the cap stops binding, so measuring further only costs time —
  // it is the gap at which half of what is left is already the whole flare.
  let closest = Math.min(largestMm * 2 + nozzleMm, webbingMm);
  for (let i = 0; i < outlines.length && closest > 0; i++) {
    for (let j = i + 1; j < outlines.length; j++) {
      closest = outlineGap(outlines[i], outlines[j], closest);
      if (closest <= 0) break;
    }
  }
  return Math.min(largestMm, (closest - nozzleMm) / 2);
}

/**
 * The largest flare this shape can take, and the outline that goes with it.
 *
 * offsetOutline refuses anything that would knot the boundary or close a gap,
 * so this is a matter of asking for less until it stops refusing — down to
 * `floorMm`, below which the flare is finer than the printer can lay down and
 * claiming one would be a lie about a surface that came out square anyway.
 *
 * Known limit: a *concave* corner where two arms meet at a shallow angle gets
 * refused, though filling that notch is exactly what a fillet ought to do
 * there. Distinguishing it from a genuine self-intersection needs the offset to
 * clip itself rather than refuse, which is a different and much larger piece of
 * geometry. Until then, detailed line art comes back square-footed and is told
 * so, which is at least true.
 */
function flareFor(outline: Outline, largestMm: number, floorMm: number): { outline: Outline; mm: number } | null {
  for (let mm = largestMm, step = 0; step <= FILLET_HALVINGS; mm /= 2, step++) {
    if (mm < floorMm) break;
    const flared = offsetOutline(outline, mm);
    if (flared) return { outline: flared, mm };
  }
  return null;
}

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
  /** Shapes standing on the floor, across every cavity. */
  shapes: number;
  /** Shapes too fine for even the smallest flare, left square-footed instead. */
  filletsSkipped: number;
  /** The smallest flare actually applied, in millimetres. Zero when none was. */
  filletAppliedMm: number;
  /** Cavities on the tray, and how they were arranged. */
  cavities: number;
  columns: number;
  rows: number;
  /**
   * Whether filling enclosed regions actually changed the shape.
   *
   * False means the artwork was already a silhouette and the two readings are
   * the same tray — so there is no choice worth putting to anyone. True means
   * the drawing contains something that could be an inside or could be a hole,
   * and only the person who drew it knows which.
   */
  outlinesFilled: boolean;
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
  const copies = Math.max(1, Math.floor(spec.copies ?? DEFAULTS.copies));
  const filletMm = Math.max(0, spec.filletMm ?? DEFAULTS.filletMm);
  const webbingMm = Math.max(0, spec.webbingMm ?? DEFAULTS.webbingMm);

  if (maskWidth <= 0 || maskHeight <= 0 || mask.length < maskWidth * maskHeight) return null;
  if (!(spec.widthIn > 0) || !(spec.shapeMm > 0)) return null;

  const mmPerPx = (spec.widthIn * INCH_MM) / maskWidth;
  const shape = spec.fillOutlines === false ? mask : fillEnclosed(mask, maskWidth, maskHeight);
  let outlinesFilled = false;
  for (let i = 0; i < maskWidth * maskHeight; i++) {
    if (shape[i] !== mask[i]) {
      outlinesFilled = true;
      break;
    }
  }

  // Simplified to a tenth of a millimetre: finer than the printer resolves, so
  // the staircase goes without any of the shape going with it.
  const contours = traceContours(shape, maskWidth, maskHeight, 0.1 / mmPerPx);
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
  //
  // Into cavity-local millimetres: the artwork's own corner becomes the origin,
  // and each copy of it is then offset to where the packer put that cavity.
  const toMm = (point: Point, at: { x: number; y: number }): Point => ({
    x: (point.x - minX) * mmPerPx + at.x + marginMm,
    y: (maxY - point.y) * mmPerPx + at.y + marginMm,
  });

  const unitWidthMm = (maxX - minX) * mmPerPx;
  const unitDepthMm = (maxY - minY) * mmPerPx;
  const grid = packCavities(copies, unitWidthMm, unitDepthMm, webbingMm);
  if (!grid.positions.length) return null;

  const widthMm = grid.widthMm + marginMm * 2;
  const depthMm = grid.depthMm + marginMm * 2;
  const heightMm = floorMm + spec.shapeMm + coverMm;

  const floor = extrudePrism(rectangle(0, 0, widthMm, depthMm), [], 0, floorMm);
  const walls = extrudePrism(
    rectangle(0, 0, widthMm, depthMm),
    [[...rectangle(marginMm / 2, marginMm / 2, widthMm - marginMm, depthMm - marginMm)].reverse()],
    floorMm - WELD_MM,
    heightMm
  );

  // Laid out once at the origin, then carried to each cavity. The copies are
  // translations of one another, so whatever the flare has to clear in one of
  // them it has to clear in all of them.
  const unitOutlines: Outline[] = shapes.map((shape) => ({
    outer: shape.outer.points.map((point) => toMm(point, { x: 0, y: 0 })),
    holes: shape.holes.map((hole) => hole.points.map((point) => toMm(point, { x: 0, y: 0 }))),
  }));

  const flareLimitMm =
    filletMm <= 0
      ? 0
      : flareLimit(unitOutlines, filletMm, nozzleMm, grid.positions.length > 1 ? webbingMm : Infinity);

  // One solid per shape per cavity: six cookies from one design is six
  // separate closed solids, not one shape repeated by the slicer.
  let filletsSkipped = 0;
  let smallestFlareMm = Infinity;
  const positives = grid.positions.flatMap((at) =>
    unitOutlines.flatMap((unit) => {
      const outline: Outline = {
        outer: unit.outer.map((point) => ({ x: point.x + at.x, y: point.y + at.y })),
        holes: unit.holes.map((hole) => hole.map((point) => ({ x: point.x + at.x, y: point.y + at.y }))),
      };

      // The skirt is the same outline flared at the floor and true a flare's
      // height above it. A shape too fine for even the smallest flare is better
      // left square than left wrong.
      const flare = flareLimitMm > 0 ? flareFor(outline, flareLimitMm, nozzleMm / 2) : null;
      const skirt = flare && extrudeTapered(flare.outline, outline, floorMm - WELD_MM, floorMm + flare.mm);
      if (!flare || !skirt || !skirt.count) {
        if (filletMm > 0) filletsSkipped++;
        return [extrudePrism(outline.outer, outline.holes, floorMm - WELD_MM, floorMm + spec.shapeMm)];
      }
      if (flare.mm < smallestFlareMm) smallestFlareMm = flare.mm;

      // The body starts at the top of the skirt, not at the floor. Reaching
      // lower would cost nothing to print — the slicer unions the overlap — but
      // every volume below is a sum over separate closed meshes, which cannot
      // see that two of them share a footprint. The shared part would be
      // counted twice: too much filament quoted, and too little silicone, which
      // is the number somebody stands at a bench and mixes from.
      const body = extrudePrism(
        outline.outer,
        outline.holes,
        floorMm + flare.mm - WELD_MM,
        floorMm + spec.shapeMm
      );
      return [body, skirt];
    })
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
    // Shapes, not solids: a shape with a fillet is a body and a skirt, and
    // nobody counting the cookies on a tray means that.
    shapes: grid.positions.length * shapes.length,
    filletsSkipped,
    filletAppliedMm: Number.isFinite(smallestFlareMm) ? smallestFlareMm : 0,
    cavities: grid.positions.length,
    columns: grid.columns,
    rows: grid.rows,
    outlinesFilled,
    findings: inspectTray(shape, maskWidth, maskHeight, mmPerPx, {
      widthMm,
      depthMm,
      nozzleMm,
      bedMm,
      copies,
      unitWidthMm,
      unitDepthMm,
      webbingMm,
      marginMm,
      filletMm,
      filletsSkipped,
      filletAppliedMm: Number.isFinite(smallestFlareMm) ? smallestFlareMm : 0,
    }),
  };
}

/** The largest number of cavities that still fits the bed, asked of the packer. */
function describeFit(limits: {
  bedMm: number;
  copies: number;
  unitWidthMm: number;
  unitDepthMm: number;
  webbingMm: number;
  marginMm: number;
}): string {
  const room = limits.bedMm - limits.marginMm * 2;
  for (let count = limits.copies - 1; count >= 1; count--) {
    const grid = packCavities(count, limits.unitWidthMm, limits.unitDepthMm, limits.webbingMm);
    if (grid.widthMm <= room && grid.depthMm <= room) {
      return `${count} would — print ${Math.ceil(limits.copies / count)} trays, or make the piece smaller.`;
    }
  }
  return "Not even one fits at this size. Make the piece smaller.";
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
  limits: {
    widthMm: number;
    depthMm: number;
    nozzleMm: number;
    bedMm: number;
    copies: number;
    unitWidthMm: number;
    unitDepthMm: number;
    webbingMm: number;
    marginMm: number;
    filletMm: number;
    filletsSkipped: number;
    filletAppliedMm: number;
  }
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
          detail: `${limits.widthMm.toFixed(0)} x ${limits.depthMm.toFixed(0)}mm, inside a ${limits.bedMm}mm bed${
            limits.copies > 1 ? ` — ${limits.copies} cavities` : ""
          }.`,
        }
      : {
          level: "warn",
          title: "Bed",
          // Saying how many *would* fit turns a dead end into a decision. The
          // answer is not the ratio of the areas: the packer rearranges the
          // grid at every count, so the only way to know is to ask it.
          detail: `${limits.widthMm.toFixed(0)} x ${limits.depthMm.toFixed(0)}mm will not fit a ${limits.bedMm}mm bed. ${describeFit(limits)}`,
        }
  );

  if (limits.filletMm > 0) {
    findings.push(
      limits.filletsSkipped === 0
        ? {
            level: "pass",
            title: "Demolding",
            detail: `Every shape is flared at least ${limits.filletAppliedMm.toFixed(2)}mm where it meets the floor, so the silicone gets a slope to peel off rather than a square notch to tear at.`,
          }
        : {
            level: "warn",
            title: "Demolding",
            // Not a failure to fix so much as a consequence to know about: the
            // shape has no room to grow by this much without welding itself to
            // something — its own detail or its neighbour — so it stands
            // square-footed and the silicone will want more care coming off it.
            detail: `${limits.filletsSkipped} shape${limits.filletsSkipped === 1 ? " has" : "s have"} nothing to flare into — the smallest flare this printer can lay down, ${(limits.nozzleMm / 2).toFixed(2)}mm, would already weld something together, whether that is a shape's own detail closing on itself or the piece sitting next to it — so ${limits.filletsSkipped === 1 ? "it stands" : "they stand"} square on the floor. The silicone will come off, but pull it slowly: a square corner is where it tears.`,
          }
    );
  }

  findings.push({
    level: "pass",
    title: "Food safety",
    detail:
      "Nothing printed here touches food — the silicone cast in it does. Use a food-grade silicone and the layer lines on the print stay a surface-finish question rather than a hygiene one.",
  });

  return findings;
}
