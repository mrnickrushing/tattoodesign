// Printing bigger than the paper.
//
// The printers in printerProfiles.ts top out between 2.83in and 8.1in of
// printable width, which quietly caps the whole app at small work — no back
// pieces, no large toppers. Tiling lifts that cap: split the design across a
// grid of sheets with a margin of overlap, mark each sheet so it can be
// aligned against its neighbours, and assemble.
//
// Pure geometry and string building, so the layout can be verified without a
// printer attached.

export type SheetSpec = {
  /** Printable area of one sheet, in inches — not the paper size. */
  sheetWIn: number;
  sheetHIn: number;
  /** Shared margin between neighbouring sheets, for alignment and glue. */
  overlapIn: number;
};

export type TileSpec = SheetSpec & {
  cols: number;
  rows: number;
  designWIn: number;
  designHIn: number;
};

export type TileRect = {
  index: number;
  col: number;
  row: number;
  /** Where this tile starts within the design, in inches. */
  xIn: number;
  yIn: number;
  /** How much of the design this tile carries. The last row/column is short. */
  wIn: number;
  hIn: number;
};

export type RegistrationMark = {
  /** Position within the tile, in inches. */
  xIn: number;
  yIn: number;
  kind: "corner" | "seam";
};

export const DEFAULT_OVERLAP_IN = 0.25;

/** Overlap has to leave something to advance by, or the grid never terminates. */
function safeOverlap(sheet: SheetSpec): number {
  const smallest = Math.min(sheet.sheetWIn, sheet.sheetHIn);
  if (!Number.isFinite(sheet.overlapIn) || sheet.overlapIn < 0) return 0;
  return Math.min(sheet.overlapIn, smallest / 2);
}

function countAlong(designIn: number, sheetIn: number, overlapIn: number): number {
  if (!(designIn > 0) || !(sheetIn > 0)) return 1;
  if (designIn <= sheetIn) return 1;
  const advance = sheetIn - overlapIn;
  if (advance <= 0) return 1;
  return Math.max(1, Math.ceil((designIn - overlapIn) / advance));
}

/** How many sheets this design needs, and at what overlap. */
export function planTiles(designWIn: number, designHIn: number, sheet: SheetSpec): TileSpec {
  const overlapIn = safeOverlap(sheet);
  return {
    sheetWIn: sheet.sheetWIn,
    sheetHIn: sheet.sheetHIn,
    overlapIn,
    designWIn: Math.max(0, designWIn),
    designHIn: Math.max(0, designHIn),
    cols: countAlong(designWIn, sheet.sheetWIn, overlapIn),
    rows: countAlong(designHIn, sheet.sheetHIn, overlapIn),
  };
}

export function tileCount(spec: TileSpec): number {
  return spec.cols * spec.rows;
}

/** Which slice of the design each sheet carries. */
export function tileRects(spec: TileSpec): TileRect[] {
  const advanceX = Math.max(spec.sheetWIn - spec.overlapIn, 0.0001);
  const advanceY = Math.max(spec.sheetHIn - spec.overlapIn, 0.0001);
  const rects: TileRect[] = [];
  for (let row = 0; row < spec.rows; row++) {
    for (let col = 0; col < spec.cols; col++) {
      const xIn = col * advanceX;
      const yIn = row * advanceY;
      rects.push({
        index: row * spec.cols + col,
        col,
        row,
        xIn,
        yIn,
        wIn: Math.min(spec.sheetWIn, Math.max(0, spec.designWIn - xIn)),
        hIn: Math.min(spec.sheetHIn, Math.max(0, spec.designHIn - yIn)),
      });
    }
  }
  return rects;
}

/** Human-facing sheet name, 1-indexed: row 2, column 3 reads "R2C3". */
export function tileLabel(rect: Pick<TileRect, "row" | "col">): string {
  return `R${rect.row + 1}C${rect.col + 1}`;
}

/**
 * Alignment marks for one tile, in tile-local inches: corners always, plus a
 * seam mark centred on each edge that meets another sheet. Overlapping tiles
 * put their seam marks at the same point on the design, so lining the marks up
 * lines the artwork up.
 */
export function registrationMarks(spec: TileSpec, index: number): RegistrationMark[] {
  const rect = tileRects(spec)[index];
  if (!rect) return [];
  const marks: RegistrationMark[] = [
    { xIn: 0, yIn: 0, kind: "corner" },
    { xIn: rect.wIn, yIn: 0, kind: "corner" },
    { xIn: 0, yIn: rect.hIn, kind: "corner" },
    { xIn: rect.wIn, yIn: rect.hIn, kind: "corner" },
  ];
  const half = spec.overlapIn / 2;
  if (rect.col > 0) marks.push({ xIn: half, yIn: rect.hIn / 2, kind: "seam" });
  if (rect.col < spec.cols - 1) marks.push({ xIn: rect.wIn - half, yIn: rect.hIn / 2, kind: "seam" });
  if (rect.row > 0) marks.push({ xIn: rect.wIn / 2, yIn: half, kind: "seam" });
  if (rect.row < spec.rows - 1) marks.push({ xIn: rect.wIn / 2, yIn: rect.hIn - half, kind: "seam" });
  return marks;
}

export function describeTiling(spec: TileSpec): string {
  const total = tileCount(spec);
  if (total <= 1) return "Fits on one sheet.";
  return `${spec.cols} × ${spec.rows} sheets (${total} total) with ${spec.overlapIn.toFixed(2)}in overlap.`;
}

/**
 * A print job: one page per tile, each carrying its slice of the artwork plus
 * marks and a label. The image is positioned by negative offset inside a
 * clipping window, so every sheet prints from the same source at the same
 * scale — no per-tile resampling to drift out of alignment.
 */
export function tiledSheetHtml(
  spec: TileSpec,
  imageDataUrl: string,
  { title = "Inkline tiled print", mirrored = false }: { title?: string; mirrored?: boolean } = {}
): string {
  const escape = (value: string) =>
    value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const pages = tileRects(spec)
    .map((rect) => {
      const marks = registrationMarks(spec, rect.index)
        .map(
          (mark) =>
            `<i class="${mark.kind}" style="left:${mark.xIn}in;top:${mark.yIn}in"></i>`
        )
        .join("");
      return (
        `<section style="width:${rect.wIn}in;height:${rect.hIn}in">` +
        // Mirroring flips the whole design about its own centre before it is
        // sliced, so the tiles remain a left-to-right reading of the mirrored
        // artwork rather than a set of individually-flipped fragments.
        `<img src="${escape(imageDataUrl)}" style="width:${spec.designWIn}in;height:${spec.designHIn}in;left:${-rect.xIn}in;top:${-rect.yIn}in${mirrored ? ";transform:scaleX(-1)" : ""}"/>` +
        marks +
        `<b>${tileLabel(rect)}</b>` +
        `</section>`
      );
    })
    .join("");

  return (
    `<html><head><meta charset="utf-8"/><title>${escape(title)}</title><style>` +
    `@page{size:${spec.sheetWIn}in ${spec.sheetHIn}in;margin:0}` +
    `body{margin:0;font-family:-apple-system,sans-serif}` +
    `section{position:relative;overflow:hidden;page-break-after:always;break-after:page}` +
    `section:last-child{page-break-after:auto;break-after:auto}` +
    `img{position:absolute;max-width:none}` +
    `i{position:absolute;width:12px;height:12px;margin:-6px 0 0 -6px;border-left:1px solid #000;border-top:1px solid #000}` +
    `i.seam{border:1px solid #000;border-radius:50%}` +
    `b{position:absolute;right:2px;bottom:2px;font-size:7pt;font-weight:600;opacity:.55}` +
    `</style></head><body>${pages}</body></html>`
  );
}
