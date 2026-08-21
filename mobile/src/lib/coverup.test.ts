import test from "node:test";
import assert from "node:assert/strict";
import {
  coverageGaps,
  coverupFinding,
  coverupThreshold,
  edgeStrength,
  inkDensityMap,
  type DensityMap,
} from "./coverup";

/** A mask with ink in the given rectangle. */
function inkRect(width: number, height: number, x0: number, y0: number, x1: number, y1: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * width + x] = 1;
  return mask;
}

function total(map: DensityMap): number {
  let sum = 0;
  for (const value of map.cells) sum += value;
  return sum;
}

test("the grid redistributes the ink without changing how much there is", () => {
  const mask = inkRect(40, 30, 5, 4, 33, 27);
  const ink = mask.reduce<number>((sum, value) => sum + value, 0);
  for (const cell of [1, 3, 8, 16, 64]) {
    assert.equal(total(inkDensityMap(mask, 40, 30, cell)), ink, `cell size ${cell} lost or gained ink`);
  }
});

test("the grid covers the image without running past it", () => {
  // 40 does not divide by 16: the last column and row are partial on purpose.
  const map = inkDensityMap(inkRect(40, 30, 0, 0, 40, 30), 40, 30, 16);
  assert.equal(map.columns, 3);
  assert.equal(map.rows, 2);
  assert.equal(map.cell, 16);
  assert.equal(total(map), 40 * 30, "every pixel landed in exactly one cell");
});

test("ink lands in the cell it belongs to", () => {
  // One cell's worth of ink in the top-left corner.
  const map = inkDensityMap(inkRect(20, 20, 0, 0, 10, 10), 20, 20, 10);
  assert.deepEqual(Array.from(map.cells), [100, 0, 0, 0]);
});

test("a mask too short for the frame yields an empty grid, not a crash", () => {
  const map = inkDensityMap(new Uint8Array(4), 40, 30, 8);
  assert.equal(total(map), 0);
  assert.equal(map.cells.length, map.columns * map.rows);
  assert.equal(total(inkDensityMap(new Uint8Array(0), 0, 0, 8)), 0);
});

test("a cell size below one pixel is still a cell", () => {
  const map = inkDensityMap(inkRect(4, 4, 0, 0, 4, 4), 4, 4, 0);
  assert.equal(map.cell, 1);
  assert.equal(total(map), 16);
});

test("a design that strictly dominates leaves no gaps", () => {
  const existing = inkDensityMap(inkRect(40, 40, 10, 10, 30, 30), 40, 40, 10);
  const design = inkDensityMap(inkRect(40, 40, 0, 0, 40, 40), 40, 40, 10);
  assert.deepEqual(coverageGaps(design, existing, 2), [], "solid black covers anything");
});

test("bare skin around the old piece is not a gap", () => {
  // The new design is exactly the old one, in one cell of a much larger frame.
  // Everywhere the old piece never touched there is nothing to hide, so only
  // that one cell can ever fall short.
  const halfDense = new Uint8Array(40 * 40);
  for (let y = 10; y < 20; y++) for (let x = 10; x < 15; x++) halfDense[y * 40 + x] = 1;
  const map = inkDensityMap(halfDense, 40, 40, 10);

  assert.deepEqual(coverageGaps(map, map, 1), [], "matching the old ink exactly clears a 1x threshold");

  const short = coverageGaps(map, map, 2);
  assert.equal(short.length, 1, "at 2x, half-dense ink is half of what's needed");
  assert.deepEqual(
    { x: short[0].x, y: short[0].y, width: short[0].width, height: short[0].height },
    { x: 10, y: 10, width: 10, height: 10 },
    "and the gap is only where the old piece is"
  );
});

test("solid black over solid black covers, whatever the threshold asks for", () => {
  // Skin holds only so much pigment. A threshold above 1 against an already
  // solid old piece is asking for ink that does not exist, and reporting that
  // as a gap would call every cover-up of heavy blackwork impossible.
  const solid = inkDensityMap(inkRect(30, 30, 0, 0, 30, 30), 30, 30, 10);
  assert.deepEqual(coverageGaps(solid, solid, 2.5), []);
});

test("a partial cell is measured against its own area, not a full one", () => {
  // 25 does not divide by 10: the right-hand column is 5px wide. Ink filling
  // it is solid, and must not read as half empty.
  const mask = new Uint8Array(25 * 10);
  for (let y = 0; y < 10; y++) for (let x = 20; x < 25; x++) mask[y * 25 + x] = 1;
  const map = inkDensityMap(mask, 25, 10, 10);
  assert.equal(map.columns, 3);
  assert.deepEqual(coverageGaps(map, map, 1), [], "solid in a narrow cell is still solid");
});

test("an empty design leaves the whole old piece showing through", () => {
  const existing = inkDensityMap(inkRect(30, 30, 0, 0, 30, 30), 30, 30, 10);
  const design = inkDensityMap(new Uint8Array(30 * 30), 30, 30, 10);
  const gaps = coverageGaps(design, existing, 1.5);
  assert.equal(gaps.length, 1, "one contiguous patch, not nine squares");
  assert.equal(gaps[0].shortfall, 1, "missing all of the ink it needed");
  assert.deepEqual(
    { x: gaps[0].x, y: gaps[0].y, width: gaps[0].width, height: gaps[0].height },
    { x: 0, y: 0, width: 30, height: 30 }
  );
});

test("separate holes come back as separate patches, worst first", () => {
  const existing = inkDensityMap(inkRect(50, 10, 0, 0, 50, 10), 50, 10, 10);
  // The design covers everything except cell 0 (nothing at all) and cell 4
  // (half of what it needs).
  const design: DensityMap = {
    ...existing,
    cells: Float32Array.from([0, 100, 100, 100, 50]),
  };
  const gaps = coverageGaps(design, existing, 1);
  assert.equal(gaps.length, 2, "two holes with covered ground between them");
  assert.ok(gaps[0].shortfall > gaps[1].shortfall, "the worse hole is reported first");
  assert.equal(gaps[0].x, 0);
  assert.equal(gaps[1].x, 40);
});

test("grids that do not line up are not compared", () => {
  const fine = inkDensityMap(inkRect(40, 40, 0, 0, 20, 20), 40, 40, 5);
  const coarse = inkDensityMap(inkRect(40, 40, 0, 0, 20, 20), 40, 40, 10);
  assert.deepEqual(coverageGaps(fine, coarse, 1.5), [], "unrelated patches are worse than no answer");
});

test("a crisp old piece demands more ink than a faded one", () => {
  assert.ok(coverupThreshold(0.9) > coverupThreshold(0.2));
  assert.ok(coverupThreshold(0) > 1, "even a blur needs more than it had");
  assert.equal(coverupThreshold(-5), coverupThreshold(0), "out-of-range readings clamp");
  assert.equal(coverupThreshold(12), coverupThreshold(1));
});

/** A gray buffer with a hard black bar down the middle. */
function hardEdge(width: number, height: number): Uint8Array {
  const gray = new Uint8Array(width * height).fill(255);
  for (let y = 0; y < height; y++) {
    for (let x = width / 2 - 3; x < width / 2 + 3; x++) gray[y * width + Math.floor(x)] = 0;
  }
  return gray;
}

test("a hard edge reads as crisp and a soft one as faded", () => {
  const crisp = edgeStrength(hardEdge(40, 40), 40, 40);

  // The same bar, blurred out the way an old tattoo spreads.
  const soft = new Uint8Array(40 * 40).fill(255);
  for (let y = 0; y < 40; y++) {
    for (let x = 0; x < 40; x++) {
      const distance = Math.abs(x - 20);
      soft[y * 40 + x] = Math.round(255 * Math.min(1, distance / 12));
    }
  }
  const blurred = edgeStrength(soft, 40, 40);
  assert.ok(crisp > blurred, `crisp ${crisp.toFixed(3)} should beat blurred ${blurred.toFixed(3)}`);
  assert.ok(crisp > 0.5, "a hard black-to-white step is about as crisp as it gets");
});

test("edge strength ignores how much blank skin is in the shot", () => {
  // The same bar in a much larger frame. Averaging over every pixel would call
  // this faded; averaging over the sharpest tenth does not.
  const tight = edgeStrength(hardEdge(40, 40), 40, 40);
  const wide = new Uint8Array(200 * 200).fill(255);
  for (let y = 80; y < 120; y++) {
    for (let x = 97; x < 103; x++) wide[y * 200 + x] = 0;
  }
  const loose = edgeStrength(wide, 200, 200);
  assert.ok(Math.abs(tight - loose) < 0.25, `${tight.toFixed(3)} vs ${loose.toFixed(3)} — framing changed the verdict`);
});

test("a blank photo has no edges", () => {
  assert.equal(edgeStrength(new Uint8Array(40 * 40).fill(200), 40, 40), 0);
  assert.equal(edgeStrength(new Uint8Array(4), 2, 2), 0, "too small to have an interior");
  assert.equal(edgeStrength(new Uint8Array(4), 40, 40), 0, "a buffer too short for the frame");
});

test("the finding says what to do about it", () => {
  const clean = coverupFinding([], 1.8);
  assert.equal(clean.level, "pass");
  assert.ok(clean.detail.includes("1.8x"));

  const one = coverupFinding([{ x: 0, y: 0, width: 10, height: 10, shortfall: 0.4 }], 1.8);
  assert.equal(one.level, "warn");
  assert.ok(one.detail.includes("1 patch is"), `singular copy: ${one.detail}`);
  assert.ok(one.detail.includes("40%"));

  const many = coverupFinding(
    [
      { x: 0, y: 0, width: 10, height: 10, shortfall: 0.4 },
      { x: 20, y: 0, width: 10, height: 10, shortfall: 0.1 },
    ],
    1.8
  );
  assert.ok(many.detail.includes("2 patches are"), `plural copy: ${many.detail}`);
  assert.ok(!/\$\{|undefined|NaN/.test(many.detail));
});
