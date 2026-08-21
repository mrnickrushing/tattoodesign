import { circle, dome, domeSegments, domeStrayMm, type DomeRelief } from "./dome";
import type { Point } from "./designProject";
import type { ProductionFinding } from "./productionTools";
import { finestStrokeWidth } from "./lineWidth";
import { extrudePrism, mergeMeshes, meshVolume, type Mesh } from "./solid";
import { INCH_MM } from "./stl";

/**
 * Two-part molds, for the round things that are not a prism of anything.
 *
 * A cake pop is a ball on a stick and a truffle is a ball. Neither can be cast
 * in a tray of standing shapes, because a ball has no flat face to stand on and
 * no silicone mold with one piece can be peeled off one. It takes two halves,
 * cast separately and clamped together.
 *
 * So this makes **two trays**, not one. Pour each, cure each, and the two
 * silicone blocks close onto each other:
 *
 *   printed tray  ->  silicone half  ->  half a chocolate
 *
 * The second tray is the first one mirrored. That is the whole trick for
 * getting the halves to line up: turning a block over to face its partner
 * mirrors it, so a mirrored tray brings every cavity back on top of its
 * opposite number, whatever the layout, with no symmetry demanded of it.
 *
 * The designed half carries the drawing; the plain half is smooth. A cake pop
 * has a front, and that is where the picture goes.
 */

export type SphereMoldSpec = {
  /** Across the ball, in inches. A cake pop is 1.5, a truffle 1.1. */
  diameterIn: number;
  /** Cake pops have a stick; the channel for it doubles as the pour hole. */
  stick: boolean;
  /** How many balls one pour should make. */
  copies?: number;
  floorMm?: number;
  /** Silicone over the top of the dome, so the half has a back. */
  coverMm?: number;
  marginMm?: number;
  webbingMm?: number;
  nozzleMm?: number;
  bedMm?: number;
  /** How far the drawing stands off the dome. Zero for a plain ball. */
  reliefMm?: number;
};

const DEFAULTS = {
  floorMm: 2,
  coverMm: 4,
  marginMm: 8,
  webbingMm: 6,
  nozzleMm: 0.4,
  bedMm: 220,
  copies: 1,
  reliefMm: 0.6,
};

const WELD_MM = 0.01;

/**
 * How far the registration pins stand, and how wide.
 *
 * Deep enough that the halves cannot slide once closed, shallow enough that the
 * silicone lets go of them. Four is a corner each: three would locate the
 * halves just as well, and the fourth is what stops anybody closing the mold
 * the wrong way round and only noticing after it has set.
 */
const KEY_RADIUS_MM = 3;
const KEY_DEPTH_MM = 2.5;

export type MoldHalf = {
  mesh: Mesh;
  parts: Mesh[];
  widthMm: number;
  depthMm: number;
  heightMm: number;
  plasticCm3: number;
  siliconeMl: number;
};

export type SphereMold = {
  /** The half with the drawing on it, and the smooth one it closes onto. */
  designed: MoldHalf;
  plain: MoldHalf;
  diameterMm: number;
  cavities: number;
  columns: number;
  rows: number;
  /** How far the drawing actually stands off the dome. Zero when it could not. */
  reliefAppliedMm: number;
  /** Facets around the equator — what the ball's roundness came out as. */
  segments: number;
  /** Parts left out because they could not be closed. Zero in ordinary use. */
  shapesDropped: number;
  findings: ProductionFinding[];
};

/** A rectangle, wound as a solid. */
function rectangle(x: number, y: number, width: number, depth: number): Point[] {
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + depth },
    { x, y: y + depth },
  ];
}

/** Cavity centres, laid out as close to square as the count allows. */
function layout(copies: number, pitchMm: number): { centres: Point[]; columns: number; rows: number } {
  const columns = Math.max(1, Math.ceil(Math.sqrt(copies)));
  const rows = Math.max(1, Math.ceil(copies / columns));
  const centres: Point[] = [];
  for (let i = 0; i < copies; i++) {
    const row = Math.floor(i / columns);
    const inRow = Math.min(columns, copies - row * columns);
    // Short last row centred, so the block does not come out lopsided.
    const indent = ((columns - inRow) * pitchMm) / 2;
    centres.push({
      x: indent + (i % columns) * pitchMm + pitchMm / 2,
      y: row * pitchMm + pitchMm / 2,
    });
  }
  return { centres, columns, rows };
}

/**
 * One half of the mold.
 *
 * `mirrored` builds the partner: every position reflected across the depth of
 * the tray, and the registration keys turned inside out — pins become the
 * hollows those pins will sit in.
 */
function buildHalf(
  spec: Required<Pick<SphereMoldSpec, "floorMm" | "coverMm" | "marginMm" | "nozzleMm">>,
  radiusMm: number,
  centres: Point[],
  widthMm: number,
  depthMm: number,
  segments: number,
  sprueMm: number,
  mirrored: boolean,
  relief: DomeRelief | undefined,
  onDropped: () => void
): MoldHalf {
  const { floorMm, coverMm, marginMm } = spec;
  const heightMm = floorMm + radiusMm + coverMm;
  const flip = (point: Point): Point => (mirrored ? { x: point.x, y: depthMm - point.y } : point);

  // Four keys, one to a corner, inside the margin.
  const inset = marginMm / 2 + KEY_RADIUS_MM + 1;
  const keys = [
    { x: inset, y: inset },
    { x: widthMm - inset, y: inset },
    { x: inset, y: depthMm - inset },
    { x: widthMm - inset, y: depthMm - inset },
  ].map(flip);

  // Kept apart on purpose. What the silicone fills is the box above the floor
  // less whatever *stands in* it, and the floor and walls are not that — an
  // index into one flat list of parts would answer that question correctly
  // until the day somebody pushes a part in a different order.
  const base: Mesh[] = [];
  const standing: Mesh[] = [];

  // On the mirrored half the keys are hollows in the floor, so the floor is cut
  // for them and a thinner slab laid underneath — a pocket, built rather than
  // subtracted, because nothing here does booleans.
  const pockets = mirrored ? keys.map((key) => circle(key, KEY_RADIUS_MM)) : [];
  base.push(extrudePrism(rectangle(0, 0, widthMm, depthMm), pockets.map((p) => [...p].reverse()), 0, floorMm));
  for (const key of keys.slice(0, pockets.length)) {
    // A hair wider than the hole it sits under, so the two do not share a
    // single vertex. Parts of this tray overlap all over — the slicer unions
    // them — but two faces built on the *same* corners are a different thing:
    // the edges pair off against each other instead of against their own
    // solid, and the assembled file reads as open.
    base.push(extrudePrism(circle(key, KEY_RADIUS_MM + WELD_MM), [], 0, floorMm - KEY_DEPTH_MM));
  }

  base.push(
    extrudePrism(
      rectangle(0, 0, widthMm, depthMm),
      [[...rectangle(marginMm / 2, marginMm / 2, widthMm - marginMm, depthMm - marginMm)].reverse()],
      floorMm - WELD_MM,
      heightMm
    )
  );

  if (!mirrored) {
    for (const key of keys) {
      standing.push(extrudePrism(circle(key, KEY_RADIUS_MM), [], floorMm - WELD_MM, floorMm + KEY_DEPTH_MM));
    }
  }

  for (const centre of centres) {
    const at = flip(centre);
    const ball = dome(at, radiusMm, floorMm, segments, WELD_MM, relief);
    if (!ball.count) onDropped();
    standing.push(ball);

    // The pour channel goes straight up out of the back of the smooth half.
    //
    // Along the floor to the nearest wall was the obvious route and the wrong
    // one: a ball in the back row has a ball in front of it, and the channel
    // ran through it. Up through the back has nothing in its way whatever the
    // layout, leaves the designed dome untouched, and the hole comes out where
    // you would want to pour into anyway — the flat back of the closed mold.
    if (!mirrored || sprueMm <= 0) continue;
    standing.push(
      extrudePrism(
        circle(at, sprueMm / 2),
        [],
        floorMm + radiusMm - WELD_MM,
        floorMm + radiusMm + coverMm
      )
    );
  }

  const kept = [...base, ...standing].filter((part) => part.count > 0);
  const plasticMm3 = kept.reduce((sum, part) => sum + meshVolume(part), 0);

  // Silicone fills the box above the floor, less whatever is standing in it —
  // and also fills the key pockets, which are below the floor rather than above
  // it and so are not in that box at all.
  const standingMm3 = standing.reduce((sum, part) => sum + meshVolume(part), 0);
  const pocketMm3 = pockets.length * Math.PI * KEY_RADIUS_MM ** 2 * KEY_DEPTH_MM;
  const cavityMm3 =
    (widthMm - marginMm) * (depthMm - marginMm) * (heightMm - floorMm) - standingMm3 + pocketMm3;

  return {
    mesh: mergeMeshes(kept),
    parts: kept,
    widthMm,
    depthMm,
    heightMm,
    plasticCm3: Math.max(0, plasticMm3) / 1000,
    siliconeMl: Math.max(0, cavityMm3) / 1000,
  };
}

/**
 * A two-part mold for a ball, with the drawing raised on one half of it.
 *
 * Null when the numbers do not describe a ball.
 */
export function buildSphereMold(
  mask: Uint8Array,
  maskWidth: number,
  maskHeight: number,
  spec: SphereMoldSpec
): SphereMold | null {
  if (!(spec.diameterIn > 0)) return null;
  if (maskWidth <= 0 || maskHeight <= 0 || mask.length < maskWidth * maskHeight) return null;

  const floorMm = spec.floorMm ?? DEFAULTS.floorMm;
  const coverMm = spec.coverMm ?? DEFAULTS.coverMm;
  const marginMm = spec.marginMm ?? DEFAULTS.marginMm;
  const webbingMm = Math.max(0, spec.webbingMm ?? DEFAULTS.webbingMm);
  const nozzleMm = spec.nozzleMm ?? DEFAULTS.nozzleMm;
  const bedMm = spec.bedMm ?? DEFAULTS.bedMm;
  const printerAssumed = spec.nozzleMm === undefined && spec.bedMm === undefined;
  const copies = Math.max(1, Math.floor(spec.copies ?? DEFAULTS.copies));
  const reliefMm = Math.max(0, spec.reliefMm ?? DEFAULTS.reliefMm);

  const diameterMm = spec.diameterIn * INCH_MM;
  const radiusMm = diameterMm / 2;

  // The finest thing in the drawing, measured on the ball rather than on the
  // page. The drawing's rim maps to the equator, so a mask pixel is worth this
  // much arc — and the facets have to be finer than the detail they carry.
  const drawnRadiusPx = Math.min(maskWidth, maskHeight) / 2;
  const arcPerPixelMm = drawnRadiusPx > 0 ? ((Math.PI / 2) * radiusMm) / drawnRadiusPx : 0;
  const finestMm = Math.max(nozzleMm, finestStrokeWidth(mask, maskWidth, maskHeight) * arcPerPixelMm);

  const pitchMm = diameterMm + webbingMm;
  const { centres, columns, rows } = layout(copies, pitchMm);
  const widthMm = columns * pitchMm + marginMm;
  const depthMm = rows * pitchMm + marginMm;
  const placed = centres.map((c) => ({ x: c.x + marginMm / 2, y: c.y + marginMm / 2 }));

  // A stick is thicker than a pour hole needs to be, and for a cake pop the two
  // are the same hole — so the channel is sized for whichever it has to carry.
  const sprueMm = spec.stick ? 4 : 3;

  // Raised at all only if a bead of plastic can hold it. Same rule as the flat
  // trays: a ridge on a face is held up by the face, so one bead does it.
  const reliefApplied = reliefMm >= nozzleMm ? reliefMm : 0;
  const relief: DomeRelief | undefined =
    reliefApplied > 0 ? { mask, width: maskWidth, height: maskHeight, mm: reliefApplied } : undefined;

  // Only the half carrying a drawing pays for the facets to hold it. The smooth
  // one is a plain ball and needs no more than roundness asks for, which on a
  // cake pop is a fraction of the count — and it is half the file.
  const segments = domeSegments(radiusMm, relief ? finestMm : 0);
  const plainSegments = domeSegments(radiusMm);

  let shapesDropped = 0;
  const drop = () => {
    shapesDropped++;
  };
  const shared = { floorMm, coverMm, marginMm, nozzleMm };
  const designed = buildHalf(shared, radiusMm, placed, widthMm, depthMm, segments, sprueMm, false, relief, drop);
  const plain = buildHalf(shared, radiusMm, placed, widthMm, depthMm, plainSegments, sprueMm, true, undefined, drop);

  return {
    designed,
    plain,
    diameterMm,
    cavities: placed.length,
    columns,
    rows,
    reliefAppliedMm: reliefApplied,
    segments,
    shapesDropped,
    findings: inspect({
      widthMm,
      depthMm,
      bedMm,
      nozzleMm,
      printerAssumed,
      diameterMm,
      cavities: placed.length,
      reliefMm,
      reliefApplied,
      segments,
      sprueMm,
      shapesDropped,
      stick: spec.stick,
      siliconeMl: designed.siliconeMl + plain.siliconeMl,
      plasticCm3: designed.plasticCm3 + plain.plasticCm3,
    }),
  };
}

function inspect(limits: {
  widthMm: number;
  depthMm: number;
  bedMm: number;
  nozzleMm: number;
  printerAssumed: boolean;
  diameterMm: number;
  cavities: number;
  reliefMm: number;
  reliefApplied: number;
  segments: number;
  sprueMm: number;
  shapesDropped: number;
  stick: boolean;
  siliconeMl: number;
  plasticCm3: number;
}): ProductionFinding[] {
  const findings: ProductionFinding[] = [];

  if (limits.printerAssumed) {
    findings.push({
      // A stated premise, not a fault in the file. Marking it a warning would
      // put "Export anyway" on every single export until a printer is bought,
      // which is how a person learns to click past warnings — and the warnings
      // here are the entire point.
      level: "pass",
      title: "Printer",
      detail: `Assuming a ${limits.nozzleMm}mm nozzle on a ${limits.bedMm}mm bed, because no printer is set yet — that is the common size, and a guess. How round the ball comes out and how deep the drawing can be raised are both measured against that nozzle. Set the real one in Settings and they move with it.`,
    });
  }

  findings.push({
    level: "pass",
    title: "Two halves",
    detail: `A ball has no flat side to stand on, so this comes as two trays: one with the drawing and one smooth. Pour and cure each, then close the two silicone blocks onto each other — the keys only let them meet one way round. Together they want about ${limits.siliconeMl.toFixed(
      0
    )}ml of silicone and ${limits.plasticCm3.toFixed(0)}cm³ of filament.`,
  });

  const fits = limits.widthMm <= limits.bedMm && limits.depthMm <= limits.bedMm;
  findings.push(
    fits
      ? {
          level: "pass",
          title: "Bed",
          detail: `Each tray is ${limits.widthMm.toFixed(0)} x ${limits.depthMm.toFixed(0)}mm, inside a ${
            limits.bedMm
          }mm bed — and there are two of them to print.`,
        }
      : {
          level: "warn",
          title: "Bed",
          detail: `Each tray is ${limits.widthMm.toFixed(0)} x ${limits.depthMm.toFixed(0)}mm, over the ${
            limits.bedMm
          }mm bed. Ask for fewer at a time.`,
        }
  );

  // How far a flat facet strays from the ball it is drawn in — which is the
  // question, rather than how long the facet is. A facet the length of a nozzle
  // sounds like the bar to clear and is nothing of the kind: on a 1.5in ball it
  // is an accuracy of one and a half microns, bought with thirty-three thousand
  // triangles that no printer can express.
  //
  // Measured across a triangle, not along an edge. The edge is the number that
  // comes to hand and it is half the truth — see domeStrayMm.
  const strayMm = domeStrayMm(limits.diameterMm / 2, limits.segments);
  findings.push({
    level: "pass",
    title: "Roundness",
    detail: `The ball is ${limits.segments} facets round, straying ${(strayMm * 1000).toFixed(
      0
    )} microns from a true sphere at the worst of it — far under the ${(limits.nozzleMm / 2).toFixed(
      2
    )}mm layers this printer lays down, so the facets are gone before the plastic is.`,
  });

  if (limits.reliefMm > 0) {
    findings.push(
      limits.reliefApplied > 0
        ? {
            level: "pass",
            title: "Relief",
            detail: `The drawing stands ${limits.reliefApplied.toFixed(
              2
            )}mm off the dome, pressed on from directly above the way a round sticker goes onto a ball — the middle of the drawing lands on the top of the ball undistorted, and the edge of it reaches the equator.`,
          }
        : {
            level: "warn",
            title: "Relief",
            detail: `A ${limits.reliefMm.toFixed(2)}mm relief is under the ${
              limits.nozzleMm
            }mm bead this nozzle lays down, so the ball comes out smooth. Ask for a deeper relief, or print with a finer nozzle.`,
          }
    );
  }

  findings.push({
    level: "pass",
    title: limits.stick ? "Stick and pour" : "Pour hole",
    detail: limits.stick
      ? `A ${limits.sprueMm}mm channel runs from each ball out to the edge — wide enough for a lollipop stick, and the same hole the chocolate goes in through.`
      : `A ${limits.sprueMm}mm channel runs from each ball out to the edge, to pour through. Trim the sprue off the finished truffle.`,
  });

  if (limits.shapesDropped > 0) {
    findings.push({
      level: "warn",
      title: "Left out",
      detail: `${limits.shapesDropped} ball${
        limits.shapesDropped === 1 ? "" : "s"
      } could not be closed into a solid and ${
        limits.shapesDropped === 1 ? "was" : "were"
      } left out rather than written open. The rest of the mold is sound.`,
    });
  }

  findings.push({
    level: "pass",
    title: "Food safety",
    detail:
      "Nothing printed here touches food — the silicone cast in it does. Use a food-grade silicone and the layer lines on the print stay a surface-finish question rather than a hygiene one.",
  });

  return findings;
}
