import test from "node:test";
import assert from "node:assert/strict";
import {
  applyMatrix,
  consolidateStrokes,
  consolidateWithin,
  deskewMatrix,
  deskewSize,
  estimatePaperQuad,
  isAxisAligned,
  otsuThreshold,
  quadArea,
  quadCorners,
  sheetMask,
  type Quad,
} from "./sketch";
import type { Point } from "./designProject";

// 254 DPI is exactly 10 pixels per millimetre, same convention as spacing.test.
const PX_PER_MM = 10;

/**
 * Rasterises a filled convex polygon into a mask, the way a paper region arrives.
 *
 * Pixel (x, y) is set when the polygon covers the point (x, y) — the same
 * convention the tracer uses, so a corner recovered from the mask is directly
 * comparable to the corner the polygon was built from.
 */
function maskOfPolygon(corners: Point[], width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  const inside = (x: number, y: number) => {
    let sign = 0;
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % corners.length];
      const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
      if (Math.abs(cross) < 1e-9) continue;
      const current = cross > 0 ? 1 : -1;
      if (!sign) sign = current;
      else if (sign !== current) return false;
    }
    return true;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (inside(x, y)) mask[y * width + x] = 1;
    }
  }
  return mask;
}

function rotatedRect(cx: number, cy: number, w: number, h: number, radians: number): Point[] {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [
    { x: -w / 2, y: -h / 2 },
    { x: w / 2, y: -h / 2 },
    { x: w / 2, y: h / 2 },
    { x: -w / 2, y: h / 2 },
  ].map((p) => ({ x: cx + p.x * cos - p.y * sin, y: cy + p.x * sin + p.y * cos }));
}

function nearestCornerDistance(quad: Quad, expected: Point[]): number {
  return Math.max(
    ...quadCorners(quad).map((corner) =>
      Math.min(...expected.map((e) => Math.hypot(corner.x - e.x, corner.y - e.y)))
    )
  );
}

test("an unrotated sheet is found at its own corners", () => {
  const corners = rotatedRect(60, 50, 80, 60, 0);
  const quad = estimatePaperQuad(maskOfPolygon(corners, 120, 100), 120, 100);
  assert.ok(quad, "should find the sheet");
  assert.ok(nearestCornerDistance(quad!, corners) <= 1, "corners should land on the rectangle");
});

test("a rotated sheet is still found, at its rotated corners", () => {
  for (const degrees of [10, 20, 35, 45, 70]) {
    const corners = rotatedRect(100, 100, 90, 70, (degrees * Math.PI) / 180);
    const quad = estimatePaperQuad(maskOfPolygon(corners, 200, 200), 200, 200);
    assert.ok(quad, `should find the sheet at ${degrees} degrees`);
    // Sub-pixel: the corners come from intersecting the fitted edges, not from
    // whichever staircase vertex the hull happened to leave standing.
    const error = nearestCornerDistance(quad!, corners);
    assert.ok(error <= 1, `corners at ${degrees} degrees were off by ${error.toFixed(2)}px`);
  }
});

test("corner ordering winds tl -> tr -> br -> bl", () => {
  const quad = estimatePaperQuad(maskOfPolygon(rotatedRect(60, 50, 80, 60, 0), 120, 100), 120, 100)!;
  assert.ok(quad.tl.x < quad.tr.x, "tl is left of tr");
  assert.ok(quad.tl.y < quad.bl.y, "tl is above bl");
  assert.ok(quad.br.x > quad.bl.x, "br is right of bl");
  assert.ok(quad.tr.y < quad.br.y, "tr is above br");
});

test("the same photo always yields the same corners", () => {
  // A square at exactly 45 degrees ties two corners on x + y; the tie-break has
  // to be decided by the code, not by which pixel the hull started from.
  const mask = maskOfPolygon(rotatedRect(100, 100, 80, 80, Math.PI / 4), 200, 200);
  const first = estimatePaperQuad(mask, 200, 200);
  const second = estimatePaperQuad(mask, 200, 200);
  assert.deepEqual(first, second);
});

test("nothing convincing in the frame yields null rather than a guess", () => {
  assert.equal(estimatePaperQuad(new Uint8Array(100 * 100), 100, 100), null, "empty mask");
  const hairline = new Uint8Array(100 * 100);
  for (let x = 10; x < 90; x++) hairline[50 * 100 + x] = 1;
  assert.equal(estimatePaperQuad(hairline, 100, 100), null, "a single row has no area");
  assert.equal(estimatePaperQuad(new Uint8Array(4), 100, 100), null, "a mask too small for the frame");
});

test("the corrected size averages each pair of opposite edges", () => {
  // A trapezoid: top edge 100 wide, bottom edge 60. The sheet is really about
  // 80 across, which is what the mean of the two recovers.
  const quad: Quad = {
    tl: { x: 0, y: 0 },
    tr: { x: 100, y: 0 },
    br: { x: 80, y: 50 },
    bl: { x: 20, y: 50 },
  };
  assert.deepEqual(deskewSize(quad), { width: 80, height: Math.round((Math.hypot(20, 50) + Math.hypot(20, 50)) / 2) });
});

test("an already-square sheet deskews to the identity", () => {
  const quad: Quad = {
    tl: { x: 0, y: 0 },
    tr: { x: 40, y: 0 },
    br: { x: 40, y: 30 },
    bl: { x: 0, y: 30 },
  };
  assert.ok(isAxisAligned(quad), "should be recognised as square-on");
  const { width, height } = deskewSize(quad);
  assert.deepEqual({ width, height }, { width: 40, height: 30 });

  const matrix = deskewMatrix(quad, width, height)!;
  assert.ok(matrix, "a square quad still has a homography");
  const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  matrix.forEach((value, i) => {
    assert.ok(Math.abs(value - identity[i]) < 1e-9, `matrix[${i}] was ${value}, expected ${identity[i]}`);
  });
});

test("deskewing an already-square sheet moves no pixel", () => {
  const quad: Quad = {
    tl: { x: 0, y: 0 },
    tr: { x: 40, y: 0 },
    br: { x: 40, y: 30 },
    bl: { x: 0, y: 30 },
  };
  const matrix = deskewMatrix(quad, 40, 30)!;
  for (const point of [{ x: 0, y: 0 }, { x: 17, y: 9 }, { x: 40, y: 30 }]) {
    const mapped = applyMatrix(matrix, point);
    assert.ok(Math.hypot(mapped.x - point.x, mapped.y - point.y) < 1e-9, `${point.x},${point.y} moved`);
  }
});

test("the homography lays each photographed corner onto the sheet corner", () => {
  const quad: Quad = {
    tl: { x: 12, y: 9 },
    tr: { x: 96, y: 21 },
    br: { x: 88, y: 74 },
    bl: { x: 6, y: 61 },
  };
  const { width, height } = deskewSize(quad);
  const matrix = deskewMatrix(quad, width, height)!;
  const destination = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  quadCorners(quad).forEach((corner, i) => {
    const mapped = applyMatrix(matrix, corner);
    const target = destination[i];
    assert.ok(Math.hypot(mapped.x - target.x, mapped.y - target.y) < 1e-6, `corner ${i} did not land square`);
  });
});

test("a degenerate quad has no homography and no area", () => {
  const collapsed: Quad = {
    tl: { x: 0, y: 0 },
    tr: { x: 10, y: 0 },
    br: { x: 20, y: 0 },
    bl: { x: 30, y: 0 },
  };
  assert.equal(quadArea(collapsed), 0);
  assert.equal(deskewMatrix(collapsed, 10, 10), null);
  assert.equal(deskewMatrix({ ...collapsed, br: { x: 10, y: 5 } }, 0, 10), null, "a zero-size output");
});

/** A horizontal line at `y`, sampled every 10px. */
function horizontal(y: number, x0 = 0, x1 = 100): Point[] {
  const points: Point[] = [];
  for (let x = x0; x <= x1; x += 10) points.push({ x, y });
  return points;
}

test("three passes at the same line collapse to one", () => {
  // 0.3mm apart at 10px/mm is 3px; the searching tolerance is 1mm.
  const consolidated = consolidateStrokes([horizontal(0), horizontal(3), horizontal(6)], 1, PX_PER_MM);
  assert.equal(consolidated.length, 1, "three attempts are one line");
  const averaged = consolidated[0].map((p) => p.y);
  assert.ok(
    averaged.every((y) => Math.abs(y - 3) < 1e-9),
    `should sit at the mean of the three, got ${averaged[0]}`
  );
});

test("a genuine double line survives consolidation", () => {
  // 3mm apart is well beyond a 1mm hand wobble: the artist meant two lines.
  const consolidated = consolidateStrokes([horizontal(0), horizontal(30)], 1, PX_PER_MM);
  assert.equal(consolidated.length, 2, "two lines stay two lines");
  assert.deepEqual(consolidated.map((path) => path[0].y).sort((a, b) => a - b), [0, 30]);
});

test("a short overlapping stroke merges into the long one it was drawn over", () => {
  const long = horizontal(0, 0, 100);
  const patch = horizontal(2, 0, 30);
  const consolidated = consolidateStrokes([long, patch], 1, PX_PER_MM);
  assert.equal(consolidated.length, 1, "a retraced section is not a second line");
  assert.equal(consolidated[0].length, long.length, "the longest member sets the shape");
  // The far end had no second attempt alongside it and must not be dragged back.
  assert.equal(consolidated[0][consolidated[0].length - 1].y, 0);
  assert.ok(consolidated[0][0].y === 1, "the retraced end averages the two");
});

test("crossing lines are not welded together", () => {
  const across: Point[] = [];
  for (let y = -50; y <= 50; y += 10) across.push({ x: 50, y });
  const consolidated = consolidateStrokes([horizontal(0), across], 1, PX_PER_MM);
  assert.equal(consolidated.length, 2, "a crossbar meeting a stem is still two strokes");
});

test("consolidation is a no-op when there is nothing to compare", () => {
  assert.deepEqual(consolidateStrokes([], 1, PX_PER_MM), []);
  assert.deepEqual(consolidateStrokes([horizontal(0)], 1, PX_PER_MM), [horizontal(0)]);
  // A zero tolerance means the caller has switched consolidation off.
  assert.equal(consolidateStrokes([horizontal(0), horizontal(1)], 0, PX_PER_MM).length, 2);
});

test("consolidation preserves per-point pen width", () => {
  const withWidth: Point[] = [
    { x: 0, y: 0, w: 3 },
    { x: 10, y: 0, w: 5 },
  ];
  const merged = consolidateStrokes([withWidth, [{ x: 0, y: 2 }, { x: 10, y: 2 }]], 1, PX_PER_MM);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].map((p) => p.w), [3, 5]);
});

test("Otsu splits a two-population image between its modes", () => {
  const gray = new Uint8Array(1000);
  gray.fill(40, 0, 400); // table
  gray.fill(210, 400); // paper
  const threshold = otsuThreshold(gray);
  assert.ok(threshold > 40 && threshold < 210, `expected a split between the modes, got ${threshold}`);
});

test("Otsu tracks the lighting rather than a fixed cutoff", () => {
  const dim = new Uint8Array(1000);
  dim.fill(10, 0, 500);
  dim.fill(90, 500);
  const bright = new Uint8Array(1000);
  bright.fill(120, 0, 500);
  bright.fill(240, 500);
  assert.ok(otsuThreshold(dim) < 90, "a dim bench splits low");
  assert.ok(otsuThreshold(bright) > 120, "a bright bench splits high");
});

test("Otsu on a flat image has nothing to split", () => {
  assert.equal(otsuThreshold(new Uint8Array(0)), 0);
  assert.equal(otsuThreshold(new Uint8Array(100).fill(128)), 0, "one population, no between-class variance");
});

test("Otsu cuts through the middle of the valley, not the edge of it", () => {
  // Two spikes with nothing between them: every cut in the gap scores the
  // same, so the one that gets picked has to be a decision, not an accident.
  const gray = new Uint8Array(200);
  gray.fill(60, 0, 100);
  gray.fill(200, 100);
  assert.equal(otsuThreshold(gray), 130);
});

/** A dark frame with a bright rectangle in it, the way a sheet on a bench reads. */
function photoOfSheet(width: number, height: number, sheet: { x: number; y: number; w: number; h: number }) {
  const gray = new Uint8Array(width * height).fill(30);
  for (let y = sheet.y; y < sheet.y + sheet.h; y++) {
    for (let x = sheet.x; x < sheet.x + sheet.w; x++) gray[y * width + x] = 220;
  }
  return gray;
}

test("the sheet is isolated from the bench it is lying on", () => {
  const gray = photoOfSheet(100, 100, { x: 20, y: 15, w: 50, h: 60 });
  const mask = sheetMask(gray, 100, 100);
  assert.equal(mask[15 * 100 + 20], 1, "a sheet pixel is kept");
  assert.equal(mask[5 * 100 + 5], 0, "a bench pixel is dropped");
  const kept = mask.reduce<number>((sum, value) => sum + value, 0);
  assert.equal(kept, 50 * 60, "exactly the sheet");
});

test("a highlight elsewhere in the frame loses to the sheet", () => {
  const gray = photoOfSheet(100, 100, { x: 20, y: 15, w: 50, h: 60 });
  // A mug catching the light in the corner.
  for (let y = 85; y < 95; y++) for (let x = 85; x < 95; x++) gray[y * 100 + x] = 240;
  const mask = sheetMask(gray, 100, 100);
  assert.equal(mask[90 * 100 + 90], 0, "the brightest thing in frame is not always the sheet");
  assert.equal(mask[40 * 100 + 40], 1, "the largest one is");
});

test("drawing on the sheet does not confuse the corners", () => {
  const gray = photoOfSheet(140, 120, { x: 20, y: 15, w: 90, h: 80 });
  // A heavy contour drawn across the middle of the paper.
  for (let x = 25; x < 105; x++) {
    for (let y = 50; y < 54; y++) gray[y * 140 + x] = 20;
  }
  const quad = estimatePaperQuad(sheetMask(gray, 140, 120), 140, 120);
  assert.ok(quad, "the sheet is still found");
  const expected = [
    { x: 20, y: 15 },
    { x: 109, y: 15 },
    { x: 109, y: 94 },
    { x: 20, y: 94 },
  ];
  assert.ok(nearestCornerDistance(quad!, expected) <= 1, "the ink inside is not a corner");
});

test("a frame that is all sheet is all sheet", () => {
  // A flat scan of blank paper: there is no bench to separate from, and the
  // useful answer is the whole frame, which deskews to a no-op downstream.
  const mask = sheetMask(new Uint8Array(100 * 100).fill(200), 100, 100);
  assert.equal(mask.reduce<number>((sum, value) => sum + value, 0), 100 * 100);
  const quad = estimatePaperQuad(mask, 100, 100)!;
  assert.ok(quad, "the frame itself is the sheet");
  assert.ok(isAxisAligned(quad), "and it is already square-on");
});

test("a buffer too short for the frame yields an empty mask, not a crash", () => {
  const mask = sheetMask(new Uint8Array(4), 100, 100);
  assert.equal(mask.length, 100 * 100);
  assert.equal(mask.reduce<number>((sum, value) => sum + value, 0), 0);
});

test("the pixel-space entry point is the same collapse", () => {
  const paths = [horizontal(0), horizontal(3), horizontal(6)];
  assert.deepEqual(consolidateWithin(paths, 10), consolidateStrokes(paths, 1, PX_PER_MM));
  assert.equal(consolidateWithin(paths, 0).length, 3, "no tolerance, no consolidation");
  assert.equal(consolidateWithin([], 10).length, 0);
});
