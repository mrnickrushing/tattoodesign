import test from "node:test";
import assert from "node:assert/strict";
import {
  extrudePrism,
  inspectMesh,
  mergeMeshes,
  meshVolume,
  triangulate,
  EMPTY_MESH,
} from "./solid";
import { groupContours, signedArea, traceContours } from "./contour";
import type { Point } from "./designProject";

function square(size: number, at = 0): Point[] {
  return [
    { x: at, y: at },
    { x: at + size, y: at },
    { x: at + size, y: at + size },
    { x: at, y: at + size },
  ];
}

/** Total area of a triangulation, for comparing against the polygon's own. */
function triangleArea(triangles: Point[]): number {
  let total = 0;
  for (let i = 0; i < triangles.length; i += 3) {
    total += Math.abs(signedArea([triangles[i], triangles[i + 1], triangles[i + 2]]));
  }
  return total;
}

test("a triangulated polygon covers exactly its own area", () => {
  const triangles = triangulate(square(10));
  assert.equal(triangles.length, 6, "a square is two triangles");
  assert.ok(Math.abs(triangleArea(triangles) - 100) < 1e-6);
});

test("a concave polygon is triangulated without spilling outside it", () => {
  // An L. A naive fan from one vertex would cover ground the shape does not.
  const el: Point[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 4 },
    { x: 4, y: 4 },
    { x: 4, y: 10 },
    { x: 0, y: 10 },
  ];
  const triangles = triangulate(el);
  assert.equal(triangles.length / 3, el.length - 2, "n - 2 triangles");
  assert.ok(Math.abs(triangleArea(triangles) - (10 * 4 + 4 * 6)) < 1e-6);
});

test("winding on the way in does not change what comes out", () => {
  const forward = triangleArea(triangulate(square(10)));
  const backward = triangleArea(triangulate([...square(10)].reverse()));
  assert.ok(Math.abs(forward - backward) < 1e-6, "a reversed outline is the same shape");
});

test("a hole is a hole, not something to fill in", () => {
  const outer = square(20);
  const hole = [...square(6, 7)].reverse();
  const triangles = triangulate(outer, [hole]);
  assert.ok(Math.abs(triangleArea(triangles) - (400 - 36)) < 1e-6, "the gap is left out");

  const centre = { x: 10, y: 10 };
  const covers = (p: Point) => {
    for (let i = 0; i < triangles.length; i += 3) {
      const [a, b, c] = [triangles[i], triangles[i + 1], triangles[i + 2]];
      const d1 = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      const d2 = (c.x - b.x) * (p.y - b.y) - (c.y - b.y) * (p.x - b.x);
      const d3 = (a.x - c.x) * (p.y - c.y) - (a.y - c.y) * (p.x - c.x);
      if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return true;
    }
    return false;
  };
  assert.equal(covers(centre), false, "nothing is laid across the middle of the hole");
  assert.equal(covers({ x: 2, y: 2 }), true, "but the ring around it is covered");
});

test("two holes are both left out", () => {
  const triangles = triangulate(square(40), [
    [...square(5, 5)].reverse(),
    [...square(8, 25)].reverse(),
  ]);
  assert.ok(Math.abs(triangleArea(triangles) - (1600 - 25 - 64)) < 1e-6);
});

test("a degenerate outline triangulates to nothing rather than hanging", () => {
  assert.deepEqual(triangulate([]), []);
  assert.deepEqual(triangulate([{ x: 0, y: 0 }, { x: 1, y: 1 }]), []);
  // Three collinear points enclose no area.
  assert.equal(triangleArea(triangulate([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }])), 0);
});

test("an extruded square is a closed box of the right volume", () => {
  const mesh = extrudePrism(square(10), [], 0, 3);
  const report = inspectMesh(mesh);
  assert.equal(report.watertight, true, `unmatched ${report.unmatched}, degenerate ${report.degenerate}`);
  assert.ok(Math.abs(meshVolume(mesh) - 300) < 1e-3, `expected 300, got ${meshVolume(mesh)}`);
});

test("the solid faces outward, not inward", () => {
  // Volume comes out positive only when every triangle faces out. Inside out
  // gives exactly the negation, and looks identical in a render.
  assert.ok(meshVolume(extrudePrism(square(10), [], 0, 3)) > 0);
  assert.ok(meshVolume(extrudePrism([...square(10)].reverse(), [], 0, 3)) > 0, "even from a reversed outline");
});

test("bottom and top can be given either way round", () => {
  const up = meshVolume(extrudePrism(square(10), [], 2, 5));
  const down = meshVolume(extrudePrism(square(10), [], 5, 2));
  assert.ok(Math.abs(up - down) < 1e-6, "the same solid, described backwards");
  assert.ok(Math.abs(up - 300) < 1e-3);
});

test("a solid with a hole through it is still closed, and hollow", () => {
  const mesh = extrudePrism(square(20), [[...square(6, 7)].reverse()], 0, 2);
  const report = inspectMesh(mesh);
  assert.equal(report.watertight, true, `unmatched ${report.unmatched}, degenerate ${report.degenerate}`);
  assert.ok(Math.abs(meshVolume(mesh) - (400 - 36) * 2) < 1e-3, "the hole is not filled");
});

test("a shape traced from a mask extrudes into a closed solid", () => {
  // The real path: mask -> contours -> solid, holes and all.
  const mask = new Uint8Array(40 * 40);
  for (let y = 4; y < 36; y++) for (let x = 4; x < 36; x++) mask[y * 40 + x] = 1;
  for (let y = 14; y < 26; y++) for (let x = 14; x < 26; x++) mask[y * 40 + x] = 0;

  const contours = traceContours(mask, 40, 40, 0.5);
  const outer = contours.find((c) => c.solid)!;
  const holes = contours.filter((c) => !c.solid).map((c) => c.points);
  const mesh = extrudePrism(outer.points, holes, 0, 4);

  assert.equal(inspectMesh(mesh).watertight, true);
  assert.ok(Math.abs(meshVolume(mesh) - (32 * 32 - 12 * 12) * 4) < 1, "volume matches the mask it came from");
});

test("merging keeps every triangle and every part closed", () => {
  const a = extrudePrism(square(4), [], 0, 1);
  const b = extrudePrism(square(4, 100), [], 0, 2);
  const merged = mergeMeshes([a, b]);
  assert.equal(merged.count, a.count + b.count);
  assert.equal(inspectMesh(merged).watertight, true, "two separate closed lumps are still closed");
  assert.ok(Math.abs(meshVolume(merged) - (16 + 32)) < 1e-3, "volumes add");
  assert.equal(mergeMeshes([]).count, 0);
});

test("nothing to extrude produces nothing, not a broken mesh", () => {
  assert.equal(extrudePrism([], [], 0, 1), EMPTY_MESH);
  assert.equal(extrudePrism(square(10), [], 2, 2).count, 0, "no height, no solid");
  assert.equal(meshVolume(EMPTY_MESH), 0);
  assert.equal(inspectMesh(EMPTY_MESH).watertight, false, "an empty mesh is not a closed one");
});

test("a hole in a mesh is caught rather than reported as closed", () => {
  const box = extrudePrism(square(10), [], 0, 3);
  // Drop the last triangle: a render would not show this, a slicer would.
  const broken = { positions: box.positions.subarray(0, (box.count - 1) * 9), count: box.count - 1 };
  const report = inspectMesh(broken);
  assert.equal(report.watertight, false);
  assert.ok(report.unmatched > 0, "the edges around the gap have nothing on the other side");
});

/** Deterministic pseudo-random, so a failure is reproducible. */
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test("random blobs all extrude into closed solids of the right volume", () => {
  // The whole chain on shapes nobody chose: mask -> contours -> grouped pieces
  // -> mesh. Volume is the sharp end of this — it comes out right only if every
  // surface closes and every triangle faces out, and no rendering would show
  // either fault.
  const random = seeded(20260821);
  const W = 34;
  const H = 34;

  for (let trial = 0; trial < 60; trial++) {
    const mask = new Uint8Array(W * H);
    const blobs = 1 + Math.floor(random() * 4);
    for (let b = 0; b < blobs; b++) {
      const w = 4 + Math.floor(random() * 12);
      const h = 4 + Math.floor(random() * 12);
      const x0 = 1 + Math.floor(random() * (W - w - 2));
      const y0 = 1 + Math.floor(random() * (H - h - 2));
      const fill = random() < 0.75 ? 1 : 0; // some blobs punch holes
      for (let y = y0; y < y0 + h; y++) {
        for (let x = x0; x < x0 + w; x++) mask[y * W + x] = fill;
      }
    }

    const filled = mask.reduce<number>((sum, value) => sum + value, 0);
    if (!filled) continue;

    // Every piece separately, holes attributed to the piece they sit in —
    // including the trials where two blobs meet at nothing but a corner.
    const shapes = groupContours(traceContours(mask, W, H));
    let volume = 0;
    shapes.forEach((shape, i) => {
      const mesh = extrudePrism(shape.outer.points, shape.holes.map((hole) => hole.points), 0, 2);
      const report = inspectMesh(mesh);
      assert.equal(
        report.watertight,
        true,
        `trial ${trial} piece ${i}: unmatched ${report.unmatched}, degenerate ${report.degenerate}`
      );
      volume += meshVolume(mesh);
    });

    assert.ok(
      Math.abs(volume - filled * 2) < 1e-3,
      `trial ${trial}: volume ${volume.toFixed(2)} against ${filled * 2} pixels of mask`
    );
  }
});
