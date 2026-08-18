// Grid math for laying designs out on a sheet.
//
// Placing twelve cookie toppers or a six-up flash sheet by dragging each one
// is the slowest thing in the app, and the result is never quite square. This
// is the arithmetic behind doing it in one tap; it's kept separate from the
// screen so the spacing rules live in one place.

/** Kept clear at the page edge. Printers can't reach the very edge anyway,
 *  and a flash sheet wants a border to trim against. */
export const MARGIN_IN = 0.25;
/** Breathing room between designs — enough to cut between them. */
export const GAP_IN = 0.15;

export type Cell = { xIn: number; yIn: number; wIn: number; hIn: number };

/**
 * As many cells of `wIn` × `hIn` as fit on the page, as a centered block.
 * Returns an empty array when even one copy won't fit.
 */
export function fillGrid(
  pageW: number,
  pageH: number,
  wIn: number,
  hIn: number
): Cell[] {
  const usableW = pageW - MARGIN_IN * 2;
  const usableH = pageH - MARGIN_IN * 2;
  const cols = Math.floor((usableW + GAP_IN) / (wIn + GAP_IN));
  const rows = Math.floor((usableH + GAP_IN) / (hIn + GAP_IN));
  if (cols < 1 || rows < 1) return [];

  const blockW = cols * wIn + (cols - 1) * GAP_IN;
  const blockH = rows * hIn + (rows - 1) * GAP_IN;
  const originX = (pageW - blockW) / 2;
  const originY = (pageH - blockH) / 2;

  const cells: Cell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({
        xIn: originX + c * (wIn + GAP_IN),
        yIn: originY + r * (hIn + GAP_IN),
        wIn,
        hIn,
      });
    }
  }
  return cells;
}

/**
 * The roomiest grid that holds `count` designs, as centered cells.
 *
 * Column counts are all tried and scored on the shorter side of the resulting
 * cell rather than its area: a cell that's wide and flat technically has more
 * room, but designs are roughly square, so the flat one wastes it.
 */
export function packGrid(pageW: number, pageH: number, count: number): Cell[] {
  if (count < 1) return [];
  const usableW = pageW - MARGIN_IN * 2;
  const usableH = pageH - MARGIN_IN * 2;

  let best = { cols: 1, rows: count, score: -1, cellW: 0, cellH: 0 };
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const cellW = (usableW - (cols - 1) * GAP_IN) / cols;
    const cellH = (usableH - (rows - 1) * GAP_IN) / rows;
    if (cellW <= 0 || cellH <= 0) continue;
    const score = Math.min(cellW, cellH);
    if (score > best.score) best = { cols, rows, score, cellW, cellH };
  }
  if (best.score < 0) return [];

  const { cols, rows, cellW, cellH } = best;
  const blockH = rows * cellH + (rows - 1) * GAP_IN;
  const originY = (pageH - blockH) / 2;

  const cells: Cell[] = [];
  for (let i = 0; i < count; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    // A last row that isn't full gets centered on its own, so a leftover
    // design doesn't sit off to one side of an otherwise even sheet.
    const inRow = Math.min(cols, count - r * cols);
    const rowW = inRow * cellW + (inRow - 1) * GAP_IN;
    const originX = (pageW - rowW) / 2;
    cells.push({
      xIn: originX + c * (cellW + GAP_IN),
      yIn: originY + r * (cellH + GAP_IN),
      wIn: cellW,
      hIn: cellH,
    });
  }
  return cells;
}
