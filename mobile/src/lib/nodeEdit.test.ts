import test from "node:test";
import assert from "node:assert/strict";
import {
  canvasToLayer,
  deleteNode,
  insertMidpoint,
  layerToCanvas,
  moveNode,
  nearestNode,
  nearestSegment,
} from "./nodeEdit";
import type { Point, Stroke, StrokeLayer } from "./designProject";

function stroke(points: Point[], mode: Stroke["mode"] = "draw"): Stroke {
  return { points, width: 4, color: "#111111", mode, opacity: 1 };
}

function layer(strokes: Stroke[], transform: Partial<StrokeLayer["transform"]> = {}): StrokeLayer {
  return {
    id: "l1",
    kind: "stroke",
    name: "Lines",
    visible: true,
    locked: false,
    opacity: 1,
    transform: { x: 0, y: 0, width: 1000, height: 800, rotation: 0, scaleX: 1, scaleY: 1, ...transform },
    strokes,
  };
}

function close(actual: Point, expected: Point, label: string) {
  assert.ok(
    Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1e-6,
    `${label}: expected (${expected.x},${expected.y}), got (${actual.x},${actual.y})`
  );
}

test("layer/canvas transforms round-trip under rotation, scale, and offset", () => {
  const rotated = layer([], { x: 120, y: 80, rotation: 33, scaleX: 1.6, scaleY: 0.7 });
  for (const point of [{ x: 0, y: 0 }, { x: 500, y: 400 }, { x: 999, y: 1 }]) {
    close(canvasToLayer(rotated, layerToCanvas(rotated, point)), point, "round-trip");
  }
});

test("an identity transform maps points to themselves", () => {
  const plain = layer([]);
  close(layerToCanvas(plain, { x: 123, y: 456 }), { x: 123, y: 456 }, "identity");
});

test("a degenerate scale degrades to wrong-position, never NaN", () => {
  const broken = layer([], { scaleX: 0 });
  const mapped = canvasToLayer(broken, { x: 10, y: 10 });
  assert.ok(Number.isFinite(mapped.x) && Number.isFinite(mapped.y));
});

test("nearestNode grabs the closest point inside the radius", () => {
  const value = layer([stroke([{ x: 100, y: 100 }, { x: 200, y: 100 }])]);
  assert.deepEqual(nearestNode(value, { x: 104, y: 102 }, 12), { strokeIndex: 0, pointIndex: 0 });
  assert.deepEqual(nearestNode(value, { x: 195, y: 100 }, 12), { strokeIndex: 0, pointIndex: 1 });
  assert.equal(nearestNode(value, { x: 150, y: 160 }, 12), null, "outside the radius");
});

test("nearestNode respects the layer transform", () => {
  // Point (100,100) in a layer shifted +50,+20 sits at canvas (150,120).
  const value = layer([stroke([{ x: 100, y: 100 }, { x: 200, y: 100 }])], { x: 50, y: 20 });
  assert.deepEqual(nearestNode(value, { x: 150, y: 120 }, 8), { strokeIndex: 0, pointIndex: 0 });
  assert.equal(nearestNode(value, { x: 100, y: 100 }, 8), null, "untransformed position misses");
});

test("erase strokes expose no nodes and no segments", () => {
  const value = layer([stroke([{ x: 100, y: 100 }, { x: 200, y: 100 }], "erase")]);
  assert.equal(nearestNode(value, { x: 100, y: 100 }, 20), null);
  assert.equal(nearestSegment(value, { x: 150, y: 100 }, 20), null);
});

test("nearestSegment finds the run between nodes, not just endpoints", () => {
  const value = layer([stroke([{ x: 100, y: 100 }, { x: 300, y: 100 }])]);
  assert.deepEqual(nearestSegment(value, { x: 200, y: 106 }, 12), { strokeIndex: 0, pointIndex: 0 });
  assert.equal(nearestSegment(value, { x: 200, y: 140 }, 12), null);
});

test("moveNode places the node at the touched canvas position", () => {
  const value = layer([stroke([{ x: 100, y: 100 }, { x: 200, y: 100 }])], { x: 50, y: 0 });
  const moved = moveNode(value, { strokeIndex: 0, pointIndex: 1 }, { x: 260, y: 130 });
  // Canvas (260,130) in a layer shifted +50 is layer-local (210,130).
  close(moved.strokes[0].points[1], { x: 210, y: 130 }, "moved point");
  close(moved.strokes[0].points[0], { x: 100, y: 100 }, "other point untouched");
});

test("moveNode under rotation lands where the finger is", () => {
  const value = layer([stroke([{ x: 500, y: 400 }, { x: 600, y: 400 }])], { rotation: 90 });
  const target = { x: 450, y: 500 };
  const moved = moveNode(value, { strokeIndex: 0, pointIndex: 0 }, target);
  close(layerToCanvas(moved, moved.strokes[0].points[0]), target, "canvas round-trip");
});

test("deleteNode removes a point, and removes the stroke below two points", () => {
  const three = layer([stroke([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }])]);
  const two = deleteNode(three, { strokeIndex: 0, pointIndex: 1 });
  assert.equal(two.strokes[0].points.length, 2);
  assert.deepEqual(two.strokes[0].points[1], { x: 20, y: 0 });

  const gone = deleteNode(two, { strokeIndex: 0, pointIndex: 0 });
  assert.equal(gone.strokes.length, 0, "a two-point stroke deletes whole");
});

test("deleteNode leaves other strokes alone", () => {
  const value = layer([
    stroke([{ x: 0, y: 0 }, { x: 10, y: 0 }]),
    stroke([{ x: 0, y: 50 }, { x: 10, y: 50 }, { x: 20, y: 50 }]),
  ]);
  const next = deleteNode(value, { strokeIndex: 0, pointIndex: 0 });
  assert.equal(next.strokes.length, 1);
  assert.equal(next.strokes[0].points.length, 3, "the surviving stroke is the untouched one");
});

test("insertMidpoint splits a segment in place", () => {
  const value = layer([stroke([{ x: 0, y: 0 }, { x: 100, y: 40 }])]);
  const next = insertMidpoint(value, { strokeIndex: 0, pointIndex: 0 });
  assert.equal(next.strokes[0].points.length, 3);
  close(next.strokes[0].points[1], { x: 50, y: 20 }, "midpoint");
});

test("out-of-range refs are no-ops, never crashes", () => {
  const value = layer([stroke([{ x: 0, y: 0 }, { x: 10, y: 0 }])]);
  assert.deepEqual(moveNode(value, { strokeIndex: 5, pointIndex: 0 }, { x: 1, y: 1 }), value);
  assert.deepEqual(deleteNode(value, { strokeIndex: 0, pointIndex: 9 }).strokes[0].points.length, 2);
  assert.equal(insertMidpoint(value, { strokeIndex: 0, pointIndex: 1 }).strokes[0].points.length, 2, "no segment after the last point");
});

test("edits are immutable — the input layer never changes", () => {
  const value = layer([stroke([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }])]);
  const snapshot = JSON.stringify(value);
  moveNode(value, { strokeIndex: 0, pointIndex: 0 }, { x: 5, y: 5 });
  deleteNode(value, { strokeIndex: 0, pointIndex: 1 });
  insertMidpoint(value, { strokeIndex: 0, pointIndex: 0 });
  assert.equal(JSON.stringify(value), snapshot);
});
