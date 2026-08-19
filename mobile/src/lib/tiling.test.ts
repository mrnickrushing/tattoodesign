import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_OVERLAP_IN,
  describeTiling,
  planTiles,
  registrationMarks,
  tileCount,
  tileLabel,
  tileRects,
  tiledSheetHtml,
  type SheetSpec,
} from "./tiling";

// The BLE roll printer: the constraint that makes tiling necessary at all.
const ROLL: SheetSpec = { sheetWIn: 2.83, sheetHIn: 8, overlapIn: DEFAULT_OVERLAP_IN };
const LETTER: SheetSpec = { sheetWIn: 8, sheetHIn: 10.5, overlapIn: DEFAULT_OVERLAP_IN };

test("a design that fits needs exactly one sheet", () => {
  const spec = planTiles(6, 9, LETTER);
  assert.equal(spec.cols, 1);
  assert.equal(spec.rows, 1);
  assert.equal(tileCount(spec), 1);
  assert.equal(describeTiling(spec), "Fits on one sheet.");
});

test("a design exactly the sheet size still needs one sheet", () => {
  const spec = planTiles(LETTER.sheetWIn, LETTER.sheetHIn, LETTER);
  assert.equal(tileCount(spec), 1);
});

test("a back piece on a roll printer tiles out", () => {
  const spec = planTiles(12, 16, ROLL);
  assert.ok(spec.cols > 1 && spec.rows > 1, `expected a grid, got ${spec.cols}x${spec.rows}`);
  assert.match(describeTiling(spec), /sheets/);
});

test("the tiles always cover the whole design", () => {
  for (const [w, h] of [[12, 16], [9, 9], [3, 20], [8.6, 10.6], [24, 30]]) {
    for (const sheet of [ROLL, LETTER]) {
      const spec = planTiles(w, h, sheet);
      const rects = tileRects(spec);
      const right = Math.max(...rects.map((rect) => rect.xIn + rect.wIn));
      const bottom = Math.max(...rects.map((rect) => rect.yIn + rect.hIn));
      assert.ok(right >= w - 1e-9, `${w}x${h} on ${sheet.sheetWIn}in: right edge ${right} < ${w}`);
      assert.ok(bottom >= h - 1e-9, `${w}x${h} on ${sheet.sheetWIn}in: bottom edge ${bottom} < ${h}`);
    }
  }
});

test("neighbouring tiles share exactly the overlap", () => {
  const spec = planTiles(20, 24, LETTER);
  const rects = tileRects(spec);
  const first = rects.find((rect) => rect.col === 0 && rect.row === 0)!;
  const second = rects.find((rect) => rect.col === 1 && rect.row === 0)!;
  const shared = first.xIn + first.wIn - second.xIn;
  assert.ok(Math.abs(shared - spec.overlapIn) < 1e-9, `expected ${spec.overlapIn}in of shared width, got ${shared}`);
});

test("no tile runs past the sheet it prints on", () => {
  const spec = planTiles(19, 23, LETTER);
  for (const rect of tileRects(spec)) {
    assert.ok(rect.wIn <= spec.sheetWIn + 1e-9, "tile wider than the sheet");
    assert.ok(rect.hIn <= spec.sheetHIn + 1e-9, "tile taller than the sheet");
    assert.ok(rect.wIn > 0 && rect.hIn > 0, "empty tile emitted");
  }
});

test("more overlap costs more sheets", () => {
  const tight = planTiles(20, 20, { ...LETTER, overlapIn: 0.1 });
  const generous = planTiles(20, 20, { ...LETTER, overlapIn: 1.5 });
  assert.ok(tileCount(generous) >= tileCount(tight), "wider seams should need at least as many sheets");
});

test("an absurd overlap is clamped rather than looping forever", () => {
  const spec = planTiles(20, 20, { ...LETTER, overlapIn: 999 });
  assert.ok(spec.overlapIn <= LETTER.sheetWIn / 2);
  assert.ok(Number.isFinite(tileCount(spec)) && tileCount(spec) > 0);
  assert.equal(tileRects(spec).length, tileCount(spec));
});

test("a negative overlap is treated as none", () => {
  assert.equal(planTiles(20, 20, { ...LETTER, overlapIn: -4 }).overlapIn, 0);
});

test("degenerate sizes do not produce a grid", () => {
  assert.equal(tileCount(planTiles(0, 0, LETTER)), 1);
  assert.equal(tileCount(planTiles(-5, -5, LETTER)), 1);
  assert.equal(tileCount(planTiles(10, 10, { ...LETTER, sheetWIn: 0, sheetHIn: 0, overlapIn: 0 })), 1);
});

test("sheets are labelled by row and column, 1-indexed", () => {
  assert.equal(tileLabel({ row: 0, col: 0 }), "R1C1");
  assert.equal(tileLabel({ row: 1, col: 2 }), "R2C3");
});

test("every tile carries corner marks, and seams only where a neighbour is", () => {
  const spec = planTiles(20, 24, LETTER);
  const rects = tileRects(spec);
  for (const rect of rects) {
    const marks = registrationMarks(spec, rect.index);
    assert.equal(marks.filter((mark) => mark.kind === "corner").length, 4);
    const seams = marks.filter((mark) => mark.kind === "seam").length;
    const neighbours =
      (rect.col > 0 ? 1 : 0) +
      (rect.col < spec.cols - 1 ? 1 : 0) +
      (rect.row > 0 ? 1 : 0) +
      (rect.row < spec.rows - 1 ? 1 : 0);
    assert.equal(seams, neighbours, `${tileLabel(rect)} should carry one seam mark per neighbour`);
  }
});

test("a single sheet needs no seam marks at all", () => {
  const spec = planTiles(5, 5, LETTER);
  assert.equal(registrationMarks(spec, 0).filter((mark) => mark.kind === "seam").length, 0);
});

test("marks stay inside their own tile", () => {
  const spec = planTiles(20, 24, LETTER);
  for (const rect of tileRects(spec)) {
    for (const mark of registrationMarks(spec, rect.index)) {
      assert.ok(mark.xIn >= 0 && mark.xIn <= rect.wIn + 1e-9, "mark outside the tile horizontally");
      assert.ok(mark.yIn >= 0 && mark.yIn <= rect.hIn + 1e-9, "mark outside the tile vertically");
    }
  }
});

test("an out-of-range tile index yields no marks", () => {
  const spec = planTiles(20, 24, LETTER);
  assert.deepEqual(registrationMarks(spec, 999), []);
  assert.deepEqual(registrationMarks(spec, -1), []);
});

test("the print job carries one page per tile at the full design scale", () => {
  const spec = planTiles(20, 24, LETTER);
  const html = tiledSheetHtml(spec, "data:image/png;base64,AAAA");
  assert.equal(html.split("<section").length - 1, tileCount(spec));
  // Every page draws the whole design and clips it, rather than resampling.
  assert.equal(html.split(`width:${spec.designWIn}in`).length - 1, tileCount(spec));
  assert.match(html, /@page\{size:8in 10\.5in;margin:0\}/);
  assert.match(html, /R1C1/);
  assert.match(html, /R2C2/);
});

test("the print job escapes anything injected through its inputs", () => {
  const spec = planTiles(5, 5, LETTER);
  const html = tiledSheetHtml(spec, 'data:image/png;base64,AAAA"onerror="alert(1)', { title: "</title><script>bad()</script>" });
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /"onerror="alert/);
});

test("a mirrored job flips the design once, not each fragment", () => {
  const spec = planTiles(20, 24, LETTER);
  const plain = tiledSheetHtml(spec, "data:image/png;base64,AAAA");
  const mirrored = tiledSheetHtml(spec, "data:image/png;base64,AAAA", { mirrored: true });
  assert.doesNotMatch(plain, /scaleX\(-1\)/);
  // The transform sits on the full-design image box on every page, so slicing
  // still reads left to right across the mirrored artwork.
  assert.equal(mirrored.split("scaleX(-1)").length - 1, tileCount(spec));
});
