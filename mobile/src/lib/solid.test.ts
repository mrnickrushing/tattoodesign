import test from "node:test";
import assert from "node:assert/strict";
import {
  extrudePrism,
  extrudeTapered,
  isSimplePolygon,
  offsetOutline,
  offsetPolygon,
  outlineGap,
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

test("growing a square grows it by the offset on every side", () => {
  const grown = offsetPolygon(square(10), 2)!;
  assert.equal(grown.length, 4, "the vertex count is preserved");
  const xs = grown.map((p) => p.x).sort((a, b) => a - b);
  const ys = grown.map((p) => p.y).sort((a, b) => a - b);
  assert.deepEqual([xs[0], xs[3]], [-2, 12]);
  assert.deepEqual([ys[0], ys[3]], [-2, 12]);
  assert.ok(Math.abs(signedArea(grown) - 14 * 14) < 1e-6);
});

test("a negative offset shrinks it by the same amount", () => {
  const shrunk = offsetPolygon(square(10), -2)!;
  assert.ok(Math.abs(signedArea(shrunk) - 6 * 6) < 1e-6);
});

test("the raw offset follows the winding it is given", () => {
  // "Outward" means left of travel, so a reversed loop grows the other way —
  // which is exactly why offsetOutline normalises the winding before offsetting
  // rather than trusting whatever it was handed.
  assert.ok(Math.abs(signedArea(offsetPolygon(square(10), 2)!) - 14 * 14) < 1e-6);
  assert.ok(Math.abs(Math.abs(signedArea(offsetPolygon([...square(10)].reverse(), 2)!)) - 6 * 6) < 1e-6);

  // offsetOutline is the one that does not care.
  const forward = offsetOutline({ outer: square(10), holes: [] }, 2)!;
  const backward = offsetOutline({ outer: [...square(10)].reverse(), holes: [] }, 2)!;
  assert.ok(Math.abs(signedArea(forward.outer) - signedArea(backward.outer)) < 1e-6);
});

test("an offset that turns the shape inside out is refused", () => {
  // The quiet failure: every corner crosses the middle and comes back a tidy
  // smaller square, wound the same way, crossing nothing, with an area that has
  // honestly shrunk. Only the edges give it away, by pointing the other way.
  assert.equal(offsetPolygon(square(4), -3), null, "shrunk past its own middle");
  assert.ok(offsetPolygon(square(4), -1), "a modest shrink still comes back");
  assert.ok(Math.abs(signedArea(offsetPolygon(square(4), -1)!) - 2 * 2) < 1e-6);
});

test("a sharp corner is cut short rather than run away to a point", () => {
  // A needle. Offsetting it properly sends the tip off toward infinity —
  // the reach goes as one over the sine of half the angle.
  // Wound the way a solid is wound, so the offset grows it rather than
  // collapsing it — offsetPolygon takes the winding at its word.
  const needle: Point[] = [
    { x: 0, y: 0 },
    { x: 100, y: -1 },
    { x: 100, y: 1 },
  ];
  assert.ok(signedArea(needle) > 0, "the test shape has to be wound as a solid");
  const grown = offsetPolygon(needle, 2)!;
  assert.ok(grown, "it still offsets");
  grown.forEach((p) => {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
    // Four times the offset is as far as any corner may travel.
    assert.ok(Math.hypot(p.x, p.y) < 200, `a corner ran to ${p.x.toFixed(0)},${p.y.toFixed(0)}`);
  });
});

test("a folded corner has no bisector and is refused", () => {
  assert.equal(offsetPolygon([{ x: 0, y: 0 }, { x: 10, y: 0 }], 1), null, "not a polygon");
  // Doubling straight back on itself: no direction is out of both edges.
  assert.equal(offsetPolygon([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 5 }], 1), null);
  assert.equal(
    offsetPolygon([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 1),
    null,
    "a repeated vertex has no edge direction"
  );
});

test("a loop that crosses itself is recognised as one", () => {
  assert.equal(isSimplePolygon(square(10)), true);
  // A bow tie.
  assert.equal(
    isSimplePolygon([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }]),
    false
  );
  assert.equal(isSimplePolygon([{ x: 0, y: 0 }, { x: 1, y: 1 }]), false, "too few points to be a loop");
});

test("growing a shape shrinks the holes in it", () => {
  const outline = { outer: square(30), holes: [[...square(8, 11)].reverse()] };
  const grown = offsetOutline(outline, 2)!;
  assert.ok(grown, "a shape with room to grow does");
  assert.ok(Math.abs(signedArea(grown.outer) - 34 * 34) < 1e-6, "the boundary grew");
  assert.ok(Math.abs(Math.abs(signedArea(grown.holes[0])) - 4 * 4) < 1e-6, "and the gap in it closed in");
  assert.ok(signedArea(grown.holes[0]) < 0, "still wound as a hole");
});

test("an offset that would eat through a hole is refused", () => {
  // A 4mm gap cannot survive being closed in by 3 from every side.
  const outline = { outer: square(30), holes: [[...square(4, 13)].reverse()] };
  assert.equal(offsetOutline(outline, 3), null);
});

test("an offset that would knot the boundary is refused", () => {
  // A narrow C: grow it enough and the two arms pass through each other.
  const c: Point[] = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 6 },
    { x: 8, y: 6 },
    { x: 8, y: 20 },
    { x: 40, y: 20 },
    { x: 40, y: 26 },
    { x: 0, y: 26 },
  ];
  const modest = offsetOutline({ outer: c, holes: [] }, 1);
  assert.ok(modest, "a small offset is fine");
  assert.equal(isSimplePolygon(modest!.outer), true);

  const greedy = offsetOutline({ outer: c, holes: [] }, 9);
  assert.equal(greedy, null, "one that closes the mouth of the C is not");
});

test("a tapered solid is closed and holds the volume of a frustum", () => {
  // A 14mm square at the bottom narrowing to 10mm at the top, 2 tall.
  const bottom = { outer: offsetPolygon(square(10), 2)!, holes: [] };
  const top = { outer: square(10), holes: [] };
  const mesh = extrudeTapered(bottom, top, 0, 2);

  const report = inspectMesh(mesh);
  assert.equal(report.watertight, true, `unmatched ${report.unmatched}, degenerate ${report.degenerate}`);

  // Prismatoid rule: (h/6)(A_bottom + 4*A_middle + A_top), the middle section
  // being a 12mm square.
  const expected = (2 / 6) * (14 * 14 + 4 * (12 * 12) + 10 * 10);
  assert.ok(Math.abs(meshVolume(mesh) - expected) < 1e-2, `got ${meshVolume(mesh).toFixed(3)}, expected ${expected}`);
});

test("a tapered solid with a hole through it is still closed", () => {
  const top = { outer: square(30), holes: [[...square(8, 11)].reverse()] };
  const bottom = offsetOutline(top, 2)!;
  const mesh = extrudeTapered(bottom, top, 0, 3);
  assert.equal(inspectMesh(mesh).watertight, true);
  assert.ok(meshVolume(mesh) > 0, "and faces outward");
});

test("ends that do not correspond produce nothing rather than a guess", () => {
  const five: Point[] = [...square(10), { x: 5, y: 12 }];
  assert.equal(extrudeTapered({ outer: square(10), holes: [] }, { outer: five, holes: [] }, 0, 2).count, 0);
  assert.equal(
    extrudeTapered({ outer: square(10), holes: [] }, { outer: square(10), holes: [square(4, 3)] }, 0, 2).count,
    0,
    "one end with a hole the other does not have"
  );
  assert.equal(extrudeTapered({ outer: square(10), holes: [] }, { outer: square(10), holes: [] }, 2, 2).count, 0);
});

test("a taper described upside down is the same solid", () => {
  const wide = { outer: offsetPolygon(square(10), 2)!, holes: [] };
  const narrow = { outer: square(10), holes: [] };
  const up = meshVolume(extrudeTapered(wide, narrow, 0, 2));
  const down = meshVolume(extrudeTapered(narrow, wide, 2, 0));
  assert.ok(Math.abs(up - down) < 1e-6, `${up} against ${down}`);
  assert.ok(up > 0);
});

test("a loop that merely touches itself is not simple either", () => {
  // Two lobes meeting at a point. Nothing crosses — every edge stays on its own
  // side — so a strict crossing test calls this clean and the walls built on it
  // come out with a seam. It is what an offset produces the moment it grows two
  // parts of a shape into contact, which is the case worth catching.
  assert.equal(
    isSimplePolygon([
      { x: 0, y: 0 }, { x: 4, y: 4 }, { x: 8, y: 0 },
      { x: 8, y: 8 }, { x: 4, y: 4 }, { x: 0, y: 8 },
    ]),
    false,
    "pinched at a repeated vertex"
  );

  // A vertex landing in the middle of an edge it is not an end of: the same
  // pinch, without a duplicate point to give it away.
  assert.equal(
    isSimplePolygon([
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 },
      { x: 5, y: 0 }, { x: 0, y: 10 },
    ]),
    false,
    "a vertex sitting on a far edge"
  );

  // Doubling back along the line it came in on: no crossing, no repeated point,
  // and no solid between the two passes.
  assert.equal(
    isSimplePolygon([
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 6 },
    ]),
    false,
    "collinear overlap"
  );

  // And the ordinary cases still pass: a square has collinear neighbours only
  // where it is entitled to them.
  assert.equal(isSimplePolygon(square(10)), true);
  assert.equal(
    isSimplePolygon([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]),
    true,
    "a redundant point along an edge is not a pinch"
  );
});

test("the gap between two outlines is the closest their boundaries come", () => {
  const left = { outer: square(10), holes: [] };
  // Side by side, so the gap is along one axis only.
  const right = {
    outer: [
      { x: 14, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 10 }, { x: 14, y: 10 },
    ],
    holes: [],
  };
  assert.ok(Math.abs(outlineGap(left, right) - 4) < 1e-9, `got ${outlineGap(left, right)}`);

  // A ceiling is an answer nobody will act on, not a measurement.
  assert.equal(outlineGap(left, right, 2), 2, "further apart than asked about");
  assert.ok(Math.abs(outlineGap(left, right, 9) - 4) < 1e-9, "nearer than the ceiling, so measured");

  // Set diagonally, the nearest approach is corner to corner and counts both
  // axes — square(size, at) steps along x and y together.
  const corner = { outer: square(10, 13), holes: [] };
  assert.ok(
    Math.abs(outlineGap(left, corner) - Math.hypot(3, 3)) < 1e-9,
    `got ${outlineGap(left, corner)}`
  );
});

test("a shape inside another's hole is as near to it as any neighbour", () => {
  // A ring with a small square standing in the middle of it. The gap that
  // matters is to the *hole*, not to the ring's outer edge — and an offset
  // closes it from both sides just the same.
  const ring = { outer: square(30), holes: [[...square(20, 5)].reverse()] };
  const island = { outer: square(4, 13), holes: [] };
  // The hole runs 5..25; the island 13..17. Eight either side.
  assert.ok(Math.abs(outlineGap(ring, island) - 8) < 1e-9, `got ${outlineGap(ring, island)}`);
});
