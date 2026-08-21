// What the work is worth.
//
// Both studios systematically undercharge, and both already have the numbers
// to know better. The tattoo side has true size from measure.ts and detail
// density from spacing.ts; the bakery side has piece count, colour count and
// sheets from yield.ts. What has been missing is the arithmetic that turns
// those into hours, and hours into a figure you can say out loud.
//
// Nothing here decides what an hour is worth — that is the artist's number and
// it is an input. What it does decide is how long the work takes, which is the
// part people get wrong in their own favour.

import { recipeFor, type Recipe } from "./icingRecipe";
import type { SpacingReport } from "./spacing";
import { estimateYield, toMeasurable } from "./yield";

export type PlacementId =
  | "forearm"
  | "outerArm"
  | "thigh"
  | "calf"
  | "shoulder"
  | "back"
  | "chest"
  | "ribs"
  | "sternum"
  | "neck"
  | "knee"
  | "elbow"
  | "hand"
  | "foot";

export type BodyPlacement = {
  id: PlacementId;
  label: string;
  /**
   * How much longer the same piece takes here than on a forearm. Skin that
   * moves, curves away, or hurts enough to need breaks is slower to work,
   * and none of that shows up in the square inches.
   */
  difficulty: number;
  note: string;
};

/**
 * Placement difficulty, forearm as 1.0.
 *
 * Starting estimates in the same spirit as MIN_LINE_GAP_MM in spacing.ts —
 * they encode the ordering every artist agrees on (flat panels are fast, ribs
 * and hands are not) rather than any one artist's book.
 */
export const PLACEMENTS: BodyPlacement[] = [
  { id: "forearm", label: "Forearm", difficulty: 1, note: "Flat, still, easy to reach." },
  { id: "outerArm", label: "Outer arm", difficulty: 1.05, note: "Gentle curve, sits well." },
  { id: "thigh", label: "Thigh", difficulty: 1.05, note: "Roomy and forgiving." },
  { id: "calf", label: "Calf", difficulty: 1.1, note: "Curves more than it looks." },
  { id: "shoulder", label: "Shoulder", difficulty: 1.15, note: "Rounds away at the edges." },
  { id: "back", label: "Back", difficulty: 1.15, note: "Large but hard to keep flat." },
  { id: "chest", label: "Chest", difficulty: 1.25, note: "Moves with breathing." },
  { id: "knee", label: "Knee", difficulty: 1.45, note: "Bone, movement, and a long sit." },
  { id: "sternum", label: "Sternum", difficulty: 1.45, note: "Bone right under the needle." },
  { id: "elbow", label: "Elbow", difficulty: 1.5, note: "Stretches; needs breaks." },
  { id: "ribs", label: "Ribs", difficulty: 1.5, note: "Painful enough to slow the session." },
  { id: "foot", label: "Foot", difficulty: 1.5, note: "Thin skin over bone." },
  { id: "neck", label: "Neck", difficulty: 1.55, note: "Tight, awkward, unforgiving." },
  { id: "hand", label: "Hand", difficulty: 1.6, note: "Thin skin, constant movement." },
];

export function findPlacement(id: string): BodyPlacement | undefined {
  return PLACEMENTS.find((placement) => placement.id === id);
}

/**
 * Detail density, 0..1, out of what the spacing check already measured.
 *
 * A proxy rather than a measurement: the fraction of compared segment pairs
 * sitting at the tight end of what a needle holds. A piece full of fine detail
 * crowds a lot of line into a little skin and shows up here; an open
 * traditional piece does not. Good enough to move an estimate, not good enough
 * to be quoted as a statistic.
 */
export function detailDensity(report: SpacingReport): number {
  if (!report.checkedSegments) return 0;
  return Math.min(1, report.violations / report.checkedSegments);
}

export type QuoteInput = {
  widthIn: number;
  heightIn: number;
  /** Detail density, 0 (open linework) to 1 (as tight as it gets). */
  density: number;
  placement: PlacementId;
  hourlyRate: number;
  /** Shop minimum, if there is one. Nothing bills below it. */
  minimum?: number;
};

/**
 * Square inches an hour at reference detail on a forearm.
 *
 * Covers linework and shading together, which is why it is well under what a
 * liner alone manages.
 */
const SQUARE_INCHES_PER_HOUR = 12;

/** Stencil, setup, breakdown. Charged whatever the piece is. */
const SETUP_HOURS = 0.5;

/** Density 0 works out about half again faster than density 1. */
const DENSITY_FLOOR = 0.7;
const DENSITY_SPAN = 1.1;

/** Nobody books to the minute. */
function toBookable(hours: number): number {
  return Math.round(hours * 4) / 4;
}

/**
 * How long the piece takes, in hours.
 *
 * Area sets the base, detail multiplies it, placement multiplies it once, and
 * setup is added afterwards so that it is not scaled by where the piece goes —
 * wrapping a stencil round a wrist is not half again more setup than laying one
 * on a forearm.
 */
export function estimateHours(input: QuoteInput): number {
  const area = Math.max(0, input.widthIn) * Math.max(0, input.heightIn);
  if (!Number.isFinite(area) || area <= 0) return 0;

  const density = Math.min(1, Math.max(0, input.density));
  const difficulty = findPlacement(input.placement)?.difficulty ?? 1;
  const working = (area / SQUARE_INCHES_PER_HOUR) * (DENSITY_FLOOR + DENSITY_SPAN * density) * difficulty;
  return toBookable(working + SETUP_HOURS);
}

export type QuoteLine = {
  label: string;
  detail: string;
  /** Whole currency units. */
  amount: number;
};

export type Quote = {
  hours: number;
  subtotal: number;
  lines: QuoteLine[];
};

function money(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * Turns a piece into a figure and the reasoning behind it.
 *
 * The placement multiplier is inside `hours` and nowhere else. It is tempting
 * to also show it as a surcharge line, and that is how a quote quietly bills
 * ribs twice.
 */
export function quote(input: QuoteInput): Quote {
  const hours = estimateHours(input);
  const rate = Math.max(0, input.hourlyRate);
  const placement = findPlacement(input.placement);

  const lines: QuoteLine[] = [];
  const time = money(hours * rate);
  if (hours > 0) {
    const difficulty = placement?.difficulty ?? 1;
    const where = placement
      ? difficulty > 1
        ? ` — ${placement.label.toLowerCase()} runs ${Math.round((difficulty - 1) * 100)}% longer than a forearm`
        : ` — ${placement.label.toLowerCase()}, no surcharge`
      : "";
    lines.push({
      label: "Time",
      detail: `${hours} h at ${rate}/h${where}`,
      amount: time,
    });
  }

  let subtotal = time;
  const minimum = Math.max(0, input.minimum ?? 0);
  if (minimum > subtotal) {
    lines.push({
      label: "Shop minimum",
      detail: `Brings a ${money(subtotal)} sitting up to the ${money(minimum)} minimum`,
      amount: money(minimum - subtotal),
    });
    subtotal = minimum;
  }

  return { hours, subtotal: money(subtotal), lines };
}

/** One design in a batch order, and how much of the order it is. */
export type BatchDesign = {
  id: string;
  label: string;
  /** How many of this design the order wants. */
  count: number;
  widthIn: number;
  heightIn: number;
  /**
   * Colours used, with relative weights — "mostly pink with a bit of white" is
   * how anyone describes an order, so the weights need not add up to anything.
   */
  colours: { hex: string; label: string; weight: number }[];
  /** Fraction of the piece that gets flooded rather than left bare, 0..1. */
  floodCoverage?: number;
};

export type IcingLine = {
  hex: string;
  label: string;
  /** Cups to mix, rounded to a quarter. */
  cups: number;
  /**
   * Before rounding. Two orders combine, or one scales, on this figure —
   * adding rounded quarters together drifts a cup high over a long run sheet.
   */
  exactCups: number;
  /** How to mix it from the gels on the shelf, when the colour can be matched. */
  recipe: Recipe | null;
};

/** Cups per square inch and the piping ratio, matching yield.ts. */
const CUPS_PER_SQUARE_INCH = 1 / 100;
const PIPING_RATIO = 0.22;

/**
 * The shopping list: how much of each colour to mix for the whole order.
 *
 * `quantity` scales the designs' own counts — pass the order size and the
 * designs describe the proportions, or pass 0 and their counts stand as
 * written. Colours are merged across designs by hex, because mixing the same
 * pink twice for two different cookies is how a batch ends up with two pinks.
 */
export function icingPlan(designs: BatchDesign[], quantity: number): IcingLine[] {
  const stated = designs.reduce((sum, design) => sum + Math.max(0, design.count), 0);
  const scale = quantity > 0 && stated > 0 ? quantity / stated : 1;

  const byColour = new Map<string, { label: string; cups: number }>();
  for (const design of designs) {
    const count = Math.max(0, design.count) * scale;
    const area = Math.max(0, design.widthIn) * Math.max(0, design.heightIn);
    if (count <= 0 || area <= 0) continue;

    const coverage = Math.min(1, Math.max(0, design.floodCoverage ?? 0.8));
    // Flood and piping both come out of the same bag of that colour.
    const cups = count * area * coverage * CUPS_PER_SQUARE_INCH * (1 + PIPING_RATIO);

    const weight = design.colours.reduce((sum, colour) => sum + Math.max(0, colour.weight), 0);
    if (weight <= 0) continue;
    for (const colour of design.colours) {
      const share = (cups * Math.max(0, colour.weight)) / weight;
      if (share <= 0) continue;
      const key = colour.hex.trim().toLowerCase();
      const existing = byColour.get(key);
      if (existing) existing.cups += share;
      else byColour.set(key, { label: colour.label, cups: share });
    }
  }

  return [...byColour.entries()]
    .map(([hex, entry]) => ({
      hex,
      label: entry.label,
      cups: toMeasurable(entry.cups),
      exactCups: entry.cups,
      recipe: recipeFor(hex, entry.cups),
    }))
    // Most icing first: the biggest batch is the one to mix while the kitchen
    // is still clean.
    .sort((a, b) => b.exactCups - a.exactCups || a.hex.localeCompare(b.hex));
}

export type BatchQuoteInput = {
  designs: BatchDesign[];
  /** Order size. 0 uses the designs' own counts. */
  quantity: number;
  sheetWidthIn: number;
  sheetHeightIn: number;
  hourlyRate: number;
  /** Cost of one bare cookie — dough, bake, packaging. */
  perPieceCost?: number;
  minimum?: number;
};

export type BatchRun = {
  perDesign: {
    design: BatchDesign;
    count: number;
    /** Transfer sheets this design needs, from the same packing the builder uses. */
    sheets: number;
    perSheet: number;
  }[];
  /** Total transfer sheets to print. */
  sheets: number;
  icing: IcingLine[];
  hours: number;
  subtotal: number;
  lines: QuoteLine[];
};

/** One colour on one piece: outline, flood, and the wait between. */
const BASE_MINUTES_PER_PIECE = 2.5;
const EXTRA_COLOUR_MINUTES = 1;
/** A 2.5-inch round is the piece the per-piece minutes are calibrated on. */
const REFERENCE_AREA_IN = 6.25;
/** Mixing and matching one colour, once, for the whole run. */
const COLOUR_SETUP_HOURS = 0.25;
/** Printing and cutting the transfers, once. */
const PRINT_SETUP_HOURS = 0.25;

/**
 * A whole batch order in one pass: how many of each design, how many sheets,
 * how much icing of each colour, and what to charge.
 *
 * Decorating time scales on the square root of area, not on area: a cookie
 * twice as wide is not four times the work, because most of the time goes into
 * the outline and the colour changes rather than into filling.
 */
export function planBatch(input: BatchQuoteInput): BatchRun | null {
  const { designs, sheetWidthIn, sheetHeightIn } = input;
  if (!designs.length || sheetWidthIn <= 0 || sheetHeightIn <= 0) return null;

  const stated = designs.reduce((sum, design) => sum + Math.max(0, design.count), 0);
  if (stated <= 0) return null;
  const scale = input.quantity > 0 ? input.quantity / stated : 1;

  const perDesign: BatchRun["perDesign"] = [];
  let sheets = 0;
  let decoratingMinutes = 0;
  let pieces = 0;

  for (const design of designs) {
    const count = Math.round(Math.max(0, design.count) * scale);
    if (count <= 0) continue;

    const estimate = estimateYield({
      quantity: count,
      widthIn: design.widthIn,
      heightIn: design.heightIn,
      sheetWidthIn,
      sheetHeightIn,
      floodCoverage: design.floodCoverage,
    });
    if (!estimate) continue;

    perDesign.push({ design, count, sheets: estimate.sheets, perSheet: estimate.perSheet });
    sheets += estimate.sheets;
    pieces += count;

    const area = Math.max(0, design.widthIn) * Math.max(0, design.heightIn);
    const colours = Math.max(1, design.colours.length);
    const minutes = (BASE_MINUTES_PER_PIECE + EXTRA_COLOUR_MINUTES * (colours - 1)) * Math.sqrt(area / REFERENCE_AREA_IN);
    decoratingMinutes += minutes * count;
  }

  if (!perDesign.length) return null;

  const icing = icingPlan(designs, input.quantity);
  const setup = PRINT_SETUP_HOURS + COLOUR_SETUP_HOURS * icing.length;
  const hours = toBookable(decoratingMinutes / 60 + setup);

  const rate = Math.max(0, input.hourlyRate);
  const labour = money(hours * rate);
  const lines: QuoteLine[] = [
    {
      label: "Decorating",
      detail: `${hours} h at ${rate}/h — ${pieces} pieces, ${icing.length} colour${icing.length === 1 ? "" : "s"}`,
      amount: labour,
    },
  ];

  let subtotal = labour;
  const perPiece = Math.max(0, input.perPieceCost ?? 0);
  if (perPiece > 0) {
    const materials = money(perPiece * pieces);
    lines.push({ label: "Cookies", detail: `${pieces} at ${money(perPiece)} each`, amount: materials });
    subtotal = money(subtotal + materials);
  }

  const minimum = Math.max(0, input.minimum ?? 0);
  if (minimum > subtotal) {
    lines.push({
      label: "Order minimum",
      detail: `Brings a ${money(subtotal)} order up to the ${money(minimum)} minimum`,
      amount: money(minimum - subtotal),
    });
    subtotal = minimum;
  }

  return { perDesign, sheets, icing, hours, subtotal: money(subtotal), lines };
}
