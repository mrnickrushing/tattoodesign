import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TRACE,
  pathLength,
  polylinesToStrokeLayer,
  simplify,
  skeletonize,
  tracePolylines,
  type TraceOptions,
} from "./vectorize";
import type { Point } from "./designProject";

const W = 24;
const H = 24;

function blank(): Uint8Array {
  return new Uint8Array(W * H);
}

function setPixel(mask: Uint8Array, x: number, y: number) {
  mask[y * W + x] = 1;
}

/** A horizontal bar `thickness` pixels tall, centred on `y`. */
function bar(mask: Uint8Array, y: number, x0: number, x1: number, thickness: number) {
  const half = Math.floor(thickness / 2);
  for (let x = x0; x <= x1; x++) {
    for (let dy = -half; dy <= half; dy++) setPixel(mask, x, y + dy);
  }
}

function count(mask: Uint8Array): number {
  return mask.reduce((total, value) => total + (value ? 1 : 0), 0);
}

function options(patch: Partial<TraceOptions> = {}): TraceOptions {
  return { ...DEFAULT_TRACE, ...patch };
}

test("thinning reduces a thick bar to a single-pixel centreline", () => {
  const mask = blank();
  bar(mask, 12, 4, 19, 5);
  const skeleton = skeletonize(mask, W, H);
  assert.ok(count(skeleton) < count(mask), "skeleton should be thinner than the source");

  // Every surviving pixel sits on the bar's centre row, and no column holds
  // more than one — that is what "one pixel wide" means here. The ends erode
  // by roughly half the thickness, which is ordinary Zhang-Suen behaviour, so
  // the span is checked as a floor rather than an exact range.
  let spanned = 0;
  for (let x = 0; x < W; x++) {
    let column = 0;
    for (let y = 0; y < H; y++) {
      if (!skeleton[y * W + x]) continue;
      column++;
      assert.equal(y, 12, `column ${x} strayed off the centre row`);
    }
    assert.ok(column <= 1, `column ${x} should hold at most one skeleton pixel`);
    spanned += column;
  }
  assert.ok(spanned >= 8, `expected a usable centreline, got ${spanned} pixels`);
});

test("thinning is idempotent — a skeleton thins to itself", () => {
  const mask = blank();
  bar(mask, 12, 4, 19, 5);
  const once = skeletonize(mask, W, H);
  const twice = skeletonize(once, W, H);
  assert.deepEqual(Array.from(twice), Array.from(once));
});

test("an already-thin line survives thinning", () => {
  const mask = blank();
  for (let x = 4; x <= 19; x++) setPixel(mask, x, 12);
  const skeleton = skeletonize(mask, W, H);
  assert.equal(count(skeleton), 16);
});

test("a straight run traces to one path spanning the whole line", () => {
  const mask = blank();
  for (let x = 4; x <= 19; x++) setPixel(mask, x, 12);
  const paths = tracePolylines(mask, W, H, options({ simplifyTolerance: 0 }));
  assert.equal(paths.length, 1);
  assert.equal(paths[0].length, 16);
  assert.deepEqual(paths[0][0], { x: 4, y: 12 });
  assert.deepEqual(paths[0].at(-1), { x: 19, y: 12 });
});

test("a cross splits into four paths meeting at the junction", () => {
  const mask = blank();
  for (let x = 4; x <= 20; x++) setPixel(mask, x, 12);
  for (let y = 4; y <= 20; y++) setPixel(mask, 12, y);
  const paths = tracePolylines(mask, W, H, options({ simplifyTolerance: 0, minPathLength: 1 }));
  assert.equal(paths.length, 4, "one arm per direction");
  for (const path of paths) {
    const touchesCentre = path.some((point) => point.x === 12 && point.y === 12);
    assert.ok(touchesCentre, "every arm should terminate at the junction");
  }
});

test("a closed ring traces even though it has no endpoint", () => {
  const mask = blank();
  for (let x = 6; x <= 17; x++) {
    setPixel(mask, x, 6);
    setPixel(mask, x, 17);
  }
  for (let y = 6; y <= 17; y++) {
    setPixel(mask, 6, y);
    setPixel(mask, 17, y);
  }
  const paths = tracePolylines(mask, W, H, options({ simplifyTolerance: 0, minPathLength: 1 }));
  assert.ok(paths.length >= 1, "the ring should produce at least one path");
  assert.ok(pathLength(paths[0]) > 40, "the ring path should run most of the perimeter");
});

test("isolated specks are dropped rather than traced", () => {
  const mask = blank();
  setPixel(mask, 3, 3);
  setPixel(mask, 20, 20);
  for (let x = 6; x <= 18; x++) setPixel(mask, x, 12);
  const paths = tracePolylines(mask, W, H, options({ simplifyTolerance: 0 }));
  assert.equal(paths.length, 1, "only the real line survives");
});

test("minPathLength filters short fragments", () => {
  const mask = blank();
  for (let x = 4; x <= 19; x++) setPixel(mask, x, 8);
  for (let x = 4; x <= 6; x++) setPixel(mask, x, 16);
  assert.equal(tracePolylines(mask, W, H, options({ minPathLength: 1, simplifyTolerance: 0 })).length, 2);
  assert.equal(tracePolylines(mask, W, H, options({ minPathLength: 6, simplifyTolerance: 0 })).length, 1);
});

test("maxPaths keeps the longest paths", () => {
  const mask = blank();
  for (let x = 2; x <= 21; x++) setPixel(mask, x, 6);
  for (let x = 2; x <= 12; x++) setPixel(mask, x, 12);
  for (let x = 2; x <= 8; x++) setPixel(mask, x, 18);
  const paths = tracePolylines(mask, W, H, options({ minPathLength: 1, simplifyTolerance: 0, maxPaths: 2 }));
  assert.equal(paths.length, 2);
  assert.ok(pathLength(paths[0]) >= pathLength(paths[1]), "sorted longest first");
  assert.ok(pathLength(paths[1]) > 8, "the shortest of the three was dropped");
});

test("an empty mask traces to nothing", () => {
  assert.deepEqual(tracePolylines(blank(), W, H, options()), []);
});

test("simplify collapses a straight run to its endpoints", () => {
  const straight: Point[] = Array.from({ length: 20 }, (_, index) => ({ x: index, y: 0 }));
  assert.deepEqual(simplify(straight, 1), [
    { x: 0, y: 0 },
    { x: 19, y: 0 },
  ]);
});

test("simplify keeps a corner that exceeds the tolerance", () => {
  const corner: Point[] = [
    { x: 0, y: 0 },
    { x: 5, y: 5 },
    { x: 10, y: 0 },
  ];
  assert.equal(simplify(corner, 1).length, 3);
  assert.equal(simplify(corner, 10).length, 2, "a loose tolerance flattens it");
});

test("simplify never drops the endpoints and never grows a path", () => {
  const wobbly: Point[] = Array.from({ length: 40 }, (_, index) => ({
    x: index,
    y: index % 2 === 0 ? 0 : 0.4,
  }));
  const result = simplify(wobbly, 1);
  assert.deepEqual(result[0], wobbly[0]);
  assert.deepEqual(result.at(-1), wobbly.at(-1));
  assert.ok(result.length <= wobbly.length);
});

test("simplify passes through degenerate input untouched", () => {
  assert.deepEqual(simplify([], 1), []);
  assert.deepEqual(simplify([{ x: 1, y: 1 }], 1), [{ x: 1, y: 1 }]);
  const pair: Point[] = [{ x: 0, y: 0 }, { x: 4, y: 4 }];
  assert.deepEqual(simplify(pair, 1), pair);
  assert.deepEqual(simplify(pair, 0), pair, "zero tolerance keeps everything");
});

test("traced paths become an editable stroke layer", () => {
  const paths: Point[][] = [
    [{ x: 0, y: 0 }, { x: 10, y: 10 }],
    [{ x: 5, y: 5 }],
  ];
  const layer = polylinesToStrokeLayer(paths, 400, 300, 3);
  assert.equal(layer.kind, "stroke");
  assert.equal(layer.strokes.length, 1, "single-point paths are not strokes");
  assert.equal(layer.strokes[0].width, 3);
  assert.equal(layer.strokes[0].mode, "draw");
  assert.equal(layer.transform.width, 400);
  assert.equal(layer.transform.height, 300);
});

test("path length measures real distance", () => {
  assert.equal(pathLength([]), 0);
  assert.equal(pathLength([{ x: 0, y: 0 }]), 0);
  assert.equal(pathLength([{ x: 0, y: 0 }, { x: 3, y: 4 }]), 5);
});
