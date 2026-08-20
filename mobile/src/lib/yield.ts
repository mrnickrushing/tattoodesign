// What an order actually costs you in materials.
//
// The sheet builder already answers "how do these designs fit on a page". What
// it never answered is the question that comes first: an order is forty-eight
// cookies, so how many sheets is that, how much transfer paper, and how much
// icing of each colour do I need to mix?
//
// Getting that wrong in either direction hurts. Short on icing means mixing a
// second batch that will not match the first — royal icing colour is famously
// hard to reproduce, which is why bakers over-mix on purpose. Short on sheets
// means a second print run and a second alignment.
//
// Pure arithmetic over the packing the sheet already knows how to do, so the
// numbers someone shops from can be checked.

import { fillGrid, type Cell } from "./layout";

export type YieldRequest = {
  /** How many finished pieces the order is for. */
  quantity: number;
  /** Width of one piece, in inches. */
  widthIn: number;
  heightIn: number;
  /** Printable area of one sheet, in inches. */
  sheetWidthIn: number;
  sheetHeightIn: number;
  /** Fraction of a piece's area that gets flooded, 0..1. */
  floodCoverage?: number;
};

export type YieldEstimate = {
  /** Pieces that fit on one sheet. */
  perSheet: number;
  /** Sheets to print, rounded up — you cannot print most of a sheet. */
  sheets: number;
  /** Pieces the last sheet leaves unused. */
  spareOnLastSheet: number;
  /** Sheets to buy, including the spare that saves a second trip. */
  sheetsToBuy: number;
  /** Cups of flood icing, rounded to something measurable. */
  floodCups: number;
  /** Cups of piping icing — the outline, which needs far less. */
  pipingCups: number;
  /** Square inches of surface across the whole order. */
  totalAreaIn: number;
};

/**
 * Cups of royal icing per square inch of flooded surface.
 *
 * From the working rule that a cup floods roughly a hundred square inches at
 * normal consistency — about twenty 2.5-inch cookies. Approximate on purpose:
 * consistency, flood depth and how much stays in the bag all move it, and a
 * number pretending to be precise here would be worse than one that is
 * obviously a guide.
 */
const CUPS_PER_SQUARE_INCH = 1 / 100;

/** Piping uses a fraction of what flooding does — it is a line, not a fill. */
const PIPING_RATIO = 0.22;

/**
 * One spare sheet per ten, minimum one.
 *
 * A ruined transfer mid-batch otherwise means stopping to print again, and
 * transfer sheets are the cheapest thing in the process to have too many of.
 */
function withSpares(sheets: number): number {
  return sheets + Math.max(1, Math.ceil(sheets / 10));
}

/** Rounds to a quarter cup — the smallest thing anyone actually measures. */
function toMeasurable(cups: number): number {
  return Math.max(0.25, Math.round(cups * 4) / 4);
}

export function estimateYield(request: YieldRequest): YieldEstimate | null {
  const { quantity, widthIn, heightIn, sheetWidthIn, sheetHeightIn } = request;
  if (
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    widthIn <= 0 ||
    heightIn <= 0 ||
    sheetWidthIn <= 0 ||
    sheetHeightIn <= 0
  ) {
    return null;
  }

  // The same packing the sheet builder uses, so the estimate and the printed
  // page can never disagree about how many fit.
  const cells: Cell[] = fillGrid(sheetWidthIn, sheetHeightIn, widthIn, heightIn);
  const perSheet = cells.length;
  if (perSheet === 0) return null;

  const sheets = Math.ceil(quantity / perSheet);
  const spareOnLastSheet = sheets * perSheet - quantity;

  const coverage = Math.min(1, Math.max(0, request.floodCoverage ?? 0.8));
  const totalAreaIn = quantity * widthIn * heightIn;
  const floodedArea = totalAreaIn * coverage;

  return {
    perSheet,
    sheets,
    spareOnLastSheet,
    sheetsToBuy: withSpares(sheets),
    floodCups: toMeasurable(floodedArea * CUPS_PER_SQUARE_INCH),
    pipingCups: toMeasurable(floodedArea * CUPS_PER_SQUARE_INCH * PIPING_RATIO),
    totalAreaIn,
  };
}

/**
 * The same estimate split across colours.
 *
 * Weights are relative, not fractions — "mostly pink with a bit of white"
 * is how anyone actually describes an order, and normalising here means the
 * caller never has to make them add up.
 */
export function splitByColour(
  cups: number,
  weights: { id: string; label: string; weight: number }[]
): { id: string; label: string; cups: number }[] {
  const total = weights.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
  if (total <= 0) return weights.map((entry) => ({ id: entry.id, label: entry.label, cups: 0 }));
  return weights.map((entry) => ({
    id: entry.id,
    label: entry.label,
    cups: toMeasurable((cups * Math.max(0, entry.weight)) / total),
  }));
}
