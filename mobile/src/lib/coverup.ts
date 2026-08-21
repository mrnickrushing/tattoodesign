// Will this design actually cover what's already there?
//
// Cover-ups are the hardest thing an artist gets asked for and the thing they
// have least help with: the decision is made by eye, in the shop, with the
// client already hopeful. Ink does not erase ink — a new piece hides an old one
// only where it puts down at least as much pigment, and the places it does not
// are exactly the places nobody notices until it has healed.
//
// So: reduce both pieces to how much ink sits in each patch of skin, and report
// where the new one is too open to bury the old one. Pure array maths over
// masks, the same shape of work spacing.ts does for gaps, and Skia-free for the
// same reason.

import { gradient } from "./edges";
import type { ProductionFinding } from "./productionTools";

export type DensityMap = {
  /**
   * Ink pixels in each cell, row-major. Sums to the mask's own ink count — the
   * grid redistributes the ink, it does not weigh it differently.
   */
  cells: Float32Array;
  columns: number;
  rows: number;
  /** Edge length of one cell, in source pixels. */
  cell: number;
  /** The frame the cells were measured over, so a count can become a fraction. */
  width: number;
  height: number;
};

/**
 * How much ink sits in each patch of the design.
 *
 * `cell` is the patch size in pixels, and it is the whole judgement in this
 * function: too fine and every gap between two lines reads as a hole, too
 * coarse and a bare patch the size of a thumb averages away against the solid
 * black beside it. A few millimetres at print size is about right.
 *
 * The right-hand and bottom cells are partial when the image does not divide
 * evenly. Left that way on purpose — padding them to full width would invent
 * empty skin that the design was never asked to cover.
 */
export function inkDensityMap(
  mask: Uint8Array,
  width: number,
  height: number,
  cell: number
): DensityMap {
  const size = Math.max(1, Math.floor(cell));
  const columns = Math.max(1, Math.ceil(width / size));
  const rows = Math.max(1, Math.ceil(height / size));
  const cells = new Float32Array(columns * rows);
  const map: DensityMap = { cells, columns, rows, cell: size, width, height };
  if (width <= 0 || height <= 0 || mask.length < width * height) return map;

  for (let y = 0; y < height; y++) {
    const row = Math.floor(y / size) * columns;
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) cells[row + Math.floor(x / size)]++;
    }
  }
  return map;
}

/**
 * Ink in one cell as a fraction of the skin it covers, 0..1.
 *
 * The cells along the right and bottom edges are partial when the image does
 * not divide evenly, so the divisor is the cell's own area rather than the
 * nominal one — otherwise a solid strip down the right-hand edge would read as
 * half empty.
 */
function cellFraction(map: DensityMap, index: number): number {
  const column = index % map.columns;
  const row = (index - column) / map.columns;
  const w = Math.min(map.cell, map.width - column * map.cell);
  const h = Math.min(map.cell, map.height - row * map.cell);
  const area = Math.max(0, w) * Math.max(0, h);
  return area ? Math.min(1, map.cells[index] / area) : 0;
}

/**
 * How crisp the old piece still is, 0 (a faded blur) to 1 (a fresh hard edge).
 *
 * Averaged over the sharpest tenth of the image rather than over all of it: a
 * small tattoo in a large photograph is mostly blank skin, and averaging that
 * in would report every small piece as faded regardless of what it looks like.
 * What matters for a cover-up is how hard the hardest edges are, because those
 * are what shows through.
 */
export function edgeStrength(gray: Uint8Array, width: number, height: number): number {
  if (width < 3 || height < 3 || gray.length < width * height) return 0;

  const { magnitude } = gradient(Float32Array.from(gray), width, height);

  // Percentile by histogram rather than by sorting: this runs on every frame of
  // a preview, and half a megapixel of Float32 is not worth sorting for a cutoff.
  //
  // Flat pixels are left out of the count entirely. Counting them would mean a
  // sparse subject — a few hard lines on a lot of clear skin — has fewer edge
  // pixels than the decile asks for, and the cutoff would slide down to zero
  // and average the blank skin back in. That reports the crispest possible
  // piece as the faintest.
  const bins = new Uint32Array(256);
  let counted = 0;
  for (const value of magnitude) {
    const bin = Math.min(255, Math.round(value));
    if (bin < 1) continue;
    bins[bin]++;
    counted++;
  }
  if (!counted) return 0;

  const wanted = Math.max(1, Math.round(counted * 0.1));
  let cutoff = 1;
  for (let bin = 255, seen = 0; bin >= 1; bin--) {
    seen += bins[bin];
    if (seen >= wanted) {
      cutoff = bin;
      break;
    }
  }

  let total = 0;
  let taken = 0;
  for (const value of magnitude) {
    if (value < cutoff) continue;
    total += value;
    taken++;
  }
  if (!taken) return 0;
  return Math.min(1, total / taken / 255);
}

/**
 * Ink the new piece needs, as a multiple of the old piece's, to bury it.
 *
 * Starting estimate, same footing as MIN_LINE_GAP_MM in spacing.ts: a soft old
 * piece needs a little more than it had, a crisp one needs a lot more. Neither
 * end is 1.0 — laying down exactly what is already there leaves the old shape
 * legible through the new one.
 */
const COVER_FLOOR = 1.15;
const COVER_SPAN = 1.35;

export function coverupThreshold(edge: number): number {
  const clamped = Math.min(1, Math.max(0, edge));
  return COVER_FLOOR + COVER_SPAN * clamped;
}

/** A patch of skin the new design leaves too open, in source pixels. */
export type Region = {
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * How far short the worst cell in this patch falls, 0..1. 1 means the new
   * design puts nothing at all where the old piece is solid.
   */
  shortfall: number;
};

/**
 * Finds where the new design will not cover the old piece.
 *
 * A cell fails when the design's ink there is less than `threshold` times the
 * existing ink. Cells the old piece never touched cannot fail — there is
 * nothing to hide — which is why bare skin around a small tattoo does not come
 * back as one enormous gap.
 *
 * Failing cells are merged into rectangles so the result is a handful of places
 * to look at rather than a scatter of squares. The two maps must share a grid;
 * a mismatch returns nothing rather than comparing unrelated patches.
 */
export function coverageGaps(design: DensityMap, existing: DensityMap, threshold: number): Region[] {
  if (design.columns !== existing.columns || design.rows !== existing.rows) return [];
  if (design.cell !== existing.cell) return [];

  const { columns, rows, cell } = design;
  const shortfalls = new Float32Array(columns * rows);
  for (let i = 0; i < shortfalls.length; i++) {
    const already = cellFraction(existing, i);
    if (already <= 0) continue;
    // Capped at solid: skin only holds so much pigment, and asking for twice
    // the ink of an already-solid old piece would report every cover-up of
    // heavy blackwork as impossible. Solid over solid does cover — what it
    // cannot do is cover it and still read as the new design, which is a
    // question about the artwork rather than about the ink.
    const required = Math.min(1, already * threshold);
    const missing = required - cellFraction(design, i);
    if (missing > 0) shortfalls[i] = missing / required;
  }

  const seen = new Uint8Array(shortfalls.length);
  const stack: number[] = [];
  const regions: Region[] = [];

  for (let seed = 0; seed < shortfalls.length; seed++) {
    if (!shortfalls[seed] || seen[seed]) continue;
    seen[seed] = 1;
    stack.push(seed);

    let minColumn = columns;
    let maxColumn = -1;
    let minRow = rows;
    let maxRow = -1;
    let worst = 0;

    while (stack.length) {
      const index = stack.pop()!;
      const column = index % columns;
      const row = (index - column) / columns;
      if (column < minColumn) minColumn = column;
      if (column > maxColumn) maxColumn = column;
      if (row < minRow) minRow = row;
      if (row > maxRow) maxRow = row;
      if (shortfalls[index] > worst) worst = shortfalls[index];

      const push = (next: number) => {
        if (seen[next] || !shortfalls[next]) return;
        seen[next] = 1;
        stack.push(next);
      };
      if (column > 0) push(index - 1);
      if (column < columns - 1) push(index + 1);
      if (row > 0) push(index - columns);
      if (row < rows - 1) push(index + columns);
    }

    regions.push({
      x: minColumn * cell,
      y: minRow * cell,
      width: (maxColumn - minColumn + 1) * cell,
      height: (maxRow - minRow + 1) * cell,
      shortfall: worst,
    });
  }

  // Worst first: an artist checking three places should see the bad one first.
  return regions.sort((a, b) => b.shortfall - a.shortfall);
}

/** Renders a cover-up assessment as a Production desk finding. */
export function coverupFinding(gaps: Region[], threshold: number): ProductionFinding {
  if (!gaps.length) {
    return {
      level: "pass",
      title: "Cover-up",
      detail: `The design lays down at least ${threshold.toFixed(1)}x the existing ink everywhere it needs to. Nothing of the old piece should read through.`,
    };
  }
  const worst = gaps[0];
  const one = gaps.length === 1;
  return {
    level: "warn",
    title: "Cover-up",
    detail: `${gaps.length} patch${one ? "" : "es"} ${one ? "is" : "are"} too open to bury what's underneath, the worst missing ${Math.round(worst.shortfall * 100)}% of the ink it needs. Close ${one ? "it" : "them"} up with solid black or shading before the stencil goes on.`,
  };
}
