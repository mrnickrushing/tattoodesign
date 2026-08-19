import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SYMMETRY,
  MAX_SEGMENTS,
  MIN_SEGMENTS,
  clampSegments,
  describeSymmetry,
  replicateStroke,
  symmetryGuides,
  type SymmetrySettings,
} from "./symmetry";
import type { Point } from "./designProject";

const CANVAS = { width: 1000, height: 800 };
const STROKE: Point[] = [
  { x: 200, y: 100 },
  { x: 300, y: 250 },
];

function settings(patch: Partial<SymmetrySettings> = {}): SymmetrySettings {
  return { ...DEFAULT_SYMMETRY, ...patch };
}

function close(actual: number, expected: number, label: string) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: expected ${expected}, got ${actual}`);
}

test("symmetry off commits exactly the drawn path", () => {
  const paths = replicateStroke(STROKE, settings({ mode: "off" }), CANVAS);
  assert.equal(paths.length, 1);
  assert.deepEqual(paths[0], STROKE);
});

test("an empty path replicates to nothing rather than empty copies", () => {
  assert.deepEqual(replicateStroke([], settings({ mode: "radial" }), CANVAS), []);
  assert.deepEqual(replicateStroke([], settings({ mode: "mirror" }), CANVAS), []);
});

test("vertical mirror reflects across the canvas centre and keeps the original first", () => {
  const paths = replicateStroke(STROKE, settings({ mode: "mirror", axis: "vertical" }), CANVAS);
  assert.equal(paths.length, 2);
  assert.deepEqual(paths[0], STROKE);
  assert.deepEqual(paths[1], [
    { x: 800, y: 100 },
    { x: 700, y: 250 },
  ]);
});

test("horizontal mirror reflects y and leaves x alone", () => {
  const paths = replicateStroke(STROKE, settings({ mode: "mirror", axis: "horizontal" }), CANVAS);
  assert.deepEqual(paths[1], [
    { x: 200, y: 700 },
    { x: 300, y: 550 },
  ]);
});

test("quad mirror emits four paths covering both reflections and their combination", () => {
  const paths = replicateStroke(STROKE, settings({ mode: "mirror", axis: "both" }), CANVAS);
  assert.equal(paths.length, 4);
  assert.deepEqual(paths[3], [
    { x: 800, y: 700 },
    { x: 700, y: 550 },
  ]);
});

test("a point on the mirror line stays put", () => {
  const onAxis: Point[] = [{ x: CANVAS.width / 2, y: 400 }];
  const paths = replicateStroke(onAxis, settings({ mode: "mirror", axis: "vertical" }), CANVAS);
  assert.deepEqual(paths[1], onAxis);
});

test("radial symmetry emits one path per segment", () => {
  for (const segments of [2, 6, 8, 12]) {
    const paths = replicateStroke(STROKE, settings({ mode: "radial", segments }), CANVAS);
    assert.equal(paths.length, segments, `expected ${segments} paths`);
    assert.deepEqual(paths[0], STROKE, "original stays first");
  }
});

test("a quarter turn rotates about the canvas centre", () => {
  const point: Point[] = [{ x: 600, y: 400 }]; // 100px right of centre (500,400)
  const paths = replicateStroke(point, settings({ mode: "radial", segments: 4 }), CANVAS);
  // Quarter turn puts it 100px below centre; half turn 100px to the left.
  close(paths[1][0].x, 500, "quarter turn x");
  close(paths[1][0].y, 500, "quarter turn y");
  close(paths[2][0].x, 400, "half turn x");
  close(paths[2][0].y, 400, "half turn y");
});

test("rotation preserves distance from the centre", () => {
  const paths = replicateStroke(STROKE, settings({ mode: "radial", segments: 7 }), CANVAS);
  const radius = (point: Point) => Math.hypot(point.x - 500, point.y - 400);
  for (const path of paths) {
    close(radius(path[0]), radius(STROKE[0]), "radius preserved");
  }
});

test("segment counts clamp to a usable range", () => {
  assert.equal(clampSegments(0), MIN_SEGMENTS);
  assert.equal(clampSegments(-5), MIN_SEGMENTS);
  assert.equal(clampSegments(999), MAX_SEGMENTS);
  assert.equal(clampSegments(6.4), 6);
  assert.equal(clampSegments(Number.NaN), MIN_SEGMENTS);
  assert.equal(replicateStroke(STROKE, settings({ mode: "radial", segments: 500 }), CANVAS).length, MAX_SEGMENTS);
});

test("guides mark the fold for mirror and every spoke for radial", () => {
  assert.equal(symmetryGuides(settings({ mode: "off" }), CANVAS).length, 0);
  const vertical = symmetryGuides(settings({ mode: "mirror", axis: "vertical" }), CANVAS);
  assert.equal(vertical.length, 1);
  assert.equal(vertical[0].x1, 500);
  assert.equal(vertical[0].x2, 500);
  assert.equal(symmetryGuides(settings({ mode: "mirror", axis: "both" }), CANVAS).length, 2);
  assert.equal(symmetryGuides(settings({ mode: "radial", segments: 9 }), CANVAS).length, 9);
});

test("radial spokes start at the centre and reach past the corner", () => {
  const guides = symmetryGuides(settings({ mode: "radial", segments: 6 }), CANVAS);
  const reach = Math.hypot(500, 400);
  for (const guide of guides) {
    assert.equal(guide.x1, 500);
    assert.equal(guide.y1, 400);
    close(Math.hypot(guide.x2 - 500, guide.y2 - 400), reach, "spoke length");
  }
});

test("the mode label reads back what is active", () => {
  assert.equal(describeSymmetry(settings({ mode: "off" })), "Off");
  assert.equal(describeSymmetry(settings({ mode: "mirror", axis: "vertical" })), "Mirror · vertical");
  assert.equal(describeSymmetry(settings({ mode: "mirror", axis: "both" })), "Mirror · quad");
  assert.equal(describeSymmetry(settings({ mode: "radial", segments: 12 })), "Radial · 12×");
});
