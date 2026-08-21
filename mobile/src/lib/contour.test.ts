import test from "node:test";
import assert from "node:assert/strict";
import {
  enclosedArea,
  fillEnclosed,
  groupContours,
  insideContour,
  signedArea,
  traceContours,
  type Contour,
} from "./contour";

/** Fills a rectangle in a mask. */
function rect(mask: Uint8Array, width: number, x0: number, y0: number, x1: number, y1: number, value = 1) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * width + x] = value;
  return mask;
}

function solids(contours: Contour[]) {
  return contours.filter((contour) => contour.solid);
}

function holes(contours: Contour[]) {
  return contours.filter((contour) => !contour.solid);
}

test("a single pixel is a unit square wound the solid way", () => {
  const mask = new Uint8Array(3 * 3);
  mask[1 * 3 + 1] = 1;
  const [contour] = traceContours(mask, 3, 3);
  assert.equal(contour.points.length, 4);
  assert.equal(contour.solid, true);
  assert.equal(contour.area, 1, "one square pixel of area");
});

test("a rectangle traces its own four corners", () => {
  const mask = rect(new Uint8Array(20 * 20), 20, 4, 3, 14, 11);
  const contours = traceContours(mask, 20, 20, 0.5);
  assert.equal(contours.length, 1);
  assert.equal(contours[0].points.length, 4, "four corners, not forty staircase steps");
  assert.equal(contours[0].area, 10 * 8, "the area it actually covers");

  const xs = contours[0].points.map((p) => p.x).sort((a, b) => a - b);
  const ys = contours[0].points.map((p) => p.y).sort((a, b) => a - b);
  assert.deepEqual([xs[0], xs[3]], [4, 14], "spans the filled columns");
  assert.deepEqual([ys[0], ys[3]], [3, 11], "spans the filled rows");
});

test("area is conserved whatever the shape", () => {
  // An L, so the outline is not convex and the shoelace has to do real work.
  const mask = rect(new Uint8Array(20 * 20), 20, 2, 2, 12, 6);
  rect(mask, 20, 2, 6, 6, 16);
  const filledPixels = mask.reduce<number>((sum, value) => sum + value, 0);
  assert.equal(enclosedArea(traceContours(mask, 20, 20)), filledPixels);
});

test("a hole is found and wound the other way", () => {
  const mask = rect(new Uint8Array(30 * 30), 30, 5, 5, 25, 25);
  rect(mask, 30, 12, 12, 18, 18, 0);

  const contours = traceContours(mask, 30, 30);
  assert.equal(solids(contours).length, 1, "one outer boundary");
  assert.equal(holes(contours).length, 1, "one hole in it");
  assert.ok(solids(contours)[0].area > 0);
  assert.ok(holes(contours)[0].area < 0, "opposite winding, without anyone deciding which is which");
  assert.equal(Math.abs(holes(contours)[0].area), 6 * 6);
  assert.equal(enclosedArea(contours), 20 * 20 - 6 * 6, "solid less the hole");
});

test("the outer boundary is reported before the holes inside it", () => {
  const mask = rect(new Uint8Array(30 * 30), 30, 2, 2, 28, 28);
  rect(mask, 30, 6, 6, 10, 10, 0);
  rect(mask, 30, 18, 18, 24, 24, 0);
  const contours = traceContours(mask, 30, 30);
  assert.equal(contours[0].solid, true, "the biggest loop leads");
  assert.equal(holes(contours).length, 2);
  // Sorted by size, so the larger hole comes first.
  assert.ok(Math.abs(contours[1].area) >= Math.abs(contours[2].area));
});

test("separate shapes are separate loops", () => {
  const mask = rect(new Uint8Array(40 * 20), 40, 2, 2, 10, 10);
  rect(mask, 40, 20, 2, 34, 16);
  const contours = traceContours(mask, 40, 20);
  assert.equal(solids(contours).length, 2);
  assert.equal(holes(contours).length, 0);
  assert.equal(enclosedArea(contours), 8 * 8 + 14 * 14);
});

test("two shapes touching at a corner still close into loops", () => {
  // The saddle case: either way of pairing the edges at the shared vertex is
  // valid, and both have to produce closed loops with the right total area.
  const mask = new Uint8Array(6 * 6);
  rect(mask, 6, 1, 1, 3, 3);
  rect(mask, 6, 3, 3, 5, 5);
  const contours = traceContours(mask, 6, 6);
  assert.equal(enclosedArea(contours), 8, "two 2x2 blocks");
  contours.forEach((contour) => {
    assert.ok(contour.points.length >= 4, "every loop closed");
    assert.ok(Number.isFinite(contour.area));
  });
});

test("a ring inside a ring nests without confusion", () => {
  const mask = rect(new Uint8Array(40 * 40), 40, 2, 2, 38, 38);
  rect(mask, 40, 8, 8, 32, 32, 0);
  rect(mask, 40, 14, 14, 26, 26, 1);
  const contours = traceContours(mask, 40, 40);
  assert.equal(solids(contours).length, 2, "the outer ring and the island inside it");
  assert.equal(holes(contours).length, 1, "the gap between them");
  assert.equal(enclosedArea(contours), 36 * 36 - 24 * 24 + 12 * 12);
});

test("simplification keeps the shape it is simplifying", () => {
  // A diagonal edge: the staircase is real detail at tolerance 0 and noise at 1.
  const mask = new Uint8Array(40 * 40);
  for (let y = 2; y < 38; y++) for (let x = 2; x < y; x++) mask[y * 40 + x] = 1;

  const raw = traceContours(mask, 40, 40)[0];
  const eased = traceContours(mask, 40, 40, 1)[0];
  assert.ok(eased.points.length < raw.points.length, "the staircase collapses");
  assert.ok(eased.points.length >= 3);
  const drift = Math.abs(eased.area - raw.area) / Math.abs(raw.area);
  assert.ok(drift < 0.05, `simplifying moved ${(drift * 100).toFixed(1)}% of the area`);
});

test("nothing in the mask means nothing to trace", () => {
  assert.deepEqual(traceContours(new Uint8Array(10 * 10), 10, 10), []);
  assert.deepEqual(traceContours(new Uint8Array(4), 10, 10), [], "a buffer too short for the frame");
  assert.deepEqual(traceContours(new Uint8Array(0), 0, 0), []);
});

test("a shape running to the frame edge is still closed", () => {
  // No border of empty pixels to trace around — the loop has to close along
  // the frame itself.
  const mask = new Uint8Array(10 * 10).fill(1);
  const contours = traceContours(mask, 10, 10);
  assert.equal(contours.length, 1);
  assert.equal(contours[0].area, 100);
});

test("the shoelace agrees with itself", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 4 },
    { x: 0, y: 4 },
  ];
  assert.equal(signedArea(square), 16);
  assert.equal(signedArea([...square].reverse()), -16, "reversing flips the sign, not the size");
});

test("two shapes touching at a corner are two shapes, not a figure of eight", () => {
  // A saddle: the shared lattice vertex has two ways in and two ways out, and
  // chaining naively makes one pinched loop that encloses the right area while
  // being no kind of polygon.
  const mask = rect(new Uint8Array(12 * 12), 12, 1, 1, 5, 5);
  rect(mask, 12, 5, 5, 10, 10);

  const contours = traceContours(mask, 12, 12);
  assert.equal(solids(contours).length, 2, "two laps, not one pinched one");
  assert.equal(enclosedArea(contours), 16 + 25);
  contours.forEach((contour) => {
    const seen = new Set(contour.points.map((p) => `${p.x},${p.y}`));
    assert.equal(seen.size, contour.points.length, "no loop stands on the same vertex twice");
  });
});

test("holes are grouped with the piece they are holes in", () => {
  const mask = rect(new Uint8Array(60 * 30), 60, 2, 2, 26, 28);
  rect(mask, 60, 8, 8, 14, 14, 0);
  rect(mask, 60, 32, 2, 58, 28);
  rect(mask, 60, 38, 8, 48, 20, 0);

  const shapes = groupContours(traceContours(mask, 60, 30));
  assert.equal(shapes.length, 2, "two pieces");
  shapes.forEach((shape) => assert.equal(shape.holes.length, 1, "each keeps its own gap"));

  // The gap really is inside the piece it was given to.
  shapes.forEach((shape) => {
    assert.equal(insideContour(shape.holes[0].points[0], shape.outer.points), true);
  });
});

test("a hole in a ring goes to the ring, not to whatever else surrounds it", () => {
  const mask = rect(new Uint8Array(40 * 40), 40, 2, 2, 38, 38);
  rect(mask, 40, 8, 8, 32, 32, 0);
  rect(mask, 40, 14, 14, 26, 26, 1);
  rect(mask, 40, 18, 18, 22, 22, 0);

  const shapes = groupContours(traceContours(mask, 40, 40));
  assert.equal(shapes.length, 2, "the outer ring and the island inside it");
  const island = shapes.find((shape) => Math.abs(shape.outer.area) < 200)!;
  const ring = shapes.find((shape) => shape !== island)!;
  assert.equal(island.holes.length, 1, "the smallest gap belongs to the smallest piece containing it");
  assert.equal(Math.abs(island.holes[0].area), 4 * 4);
  assert.equal(ring.holes.length, 1);
  assert.equal(Math.abs(ring.holes[0].area), 24 * 24);
});

test("grouping an empty trace is an empty list", () => {
  assert.deepEqual(groupContours([]), []);
});

test("an outline stands up as the shape it outlines", () => {
  // A hollow square, the way line art arrives. Traced literally it is a ring
  // of its own linework; what anyone making a mold wants is the square.
  const mask = rect(new Uint8Array(20 * 20), 20, 4, 4, 16, 16);
  rect(mask, 20, 6, 6, 14, 14, 0);
  assert.equal(enclosedArea(traceContours(mask, 20, 20)), 12 * 12 - 8 * 8, "the ring on its own");

  const filled = fillEnclosed(mask, 20, 20);
  assert.equal(enclosedArea(traceContours(filled, 20, 20)), 12 * 12, "and the silhouette once filled");
});

test("filling reaches into a concave bay without closing it off", () => {
  // A C shape: the bay is open to the outside, so it stays open.
  const mask = rect(new Uint8Array(20 * 20), 20, 4, 4, 16, 16);
  rect(mask, 20, 8, 8, 20, 12, 0);
  const before = enclosedArea(traceContours(mask, 20, 20));
  assert.equal(enclosedArea(traceContours(fillEnclosed(mask, 20, 20), 20, 20)), before, "nothing to fill");
});

test("filling an already-solid shape changes nothing", () => {
  const mask = rect(new Uint8Array(20 * 20), 20, 4, 4, 16, 16);
  assert.deepEqual(Array.from(fillEnclosed(mask, 20, 20)), Array.from(mask));
});

test("filling a blank or short frame is safe", () => {
  assert.equal(fillEnclosed(new Uint8Array(100), 10, 10).reduce<number>((s, v) => s + v, 0), 0);
  assert.equal(fillEnclosed(new Uint8Array(4), 10, 10).length, 100);
});
