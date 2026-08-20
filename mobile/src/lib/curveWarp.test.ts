import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  MAX_SPAN,
  SURFACES,
  compensate,
  effectiveSize,
  minRadiusIn,
  findSurface,
  foreshorten,
  maxApparentWidthIn,
  printScale,
  radiusOf,
  surfacesFor,
  warpMesh,
  type Surface,
} from "./curveWarp";

const flat = findSurface("flat")!;
const wrist = findSurface("wrist")!;
const thigh = findSurface("thigh")!;
const cakepop = findSurface("cakepop")!;
const forearm = findSurface("forearm")!;

test("every surface is complete and uniquely identified", () => {
  const ids = SURFACES.map((surface) => surface.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const surface of SURFACES) {
    assert.ok(surface.label.trim().length > 0, `${surface.id} label`);
    assert.ok(surface.caption.trim().length > 0, `${surface.id} caption`);
    if (surface.kind !== "flat") assert.ok(surface.circumferenceIn > 0, `${surface.id} circumference`);
    if (surface.kind === "cone") assert.ok(surface.farCircumferenceIn, `${surface.id} needs a far end`);
  }
});

test("each brand gets its own surfaces plus the shared flat one", () => {
  for (const brand of ["ink", "sugar"] as const) {
    const list = surfacesFor(brand);
    assert.ok(list.some((surface) => surface.id === "flat"));
    assert.ok(list.every((surface) => surface.brand === "both" || surface.brand === brand));
    assert.ok(list.length > 3, `${brand} needs real choices`);
  }
});

test("a cake pop is a sphere and a forearm is not", () => {
  assert.equal(cakepop.kind, "sphere");
  assert.equal(forearm.kind, "cone");
  assert.equal(thigh.kind, "cylinder");
});

test("radius follows circumference", () => {
  assert.ok(Math.abs(radiusOf(2 * Math.PI) - 1) < 1e-9);
});

test("a flat surface changes nothing, in either direction", () => {
  for (const u of [0, 0.25, 0.5, 0.75, 1]) {
    assert.deepEqual(compensate({ u, v: 0.3 }, flat, 3, 3), { u, v: 0.3 });
    assert.deepEqual(foreshorten({ u, v: 0.3 }, flat, 3, 3), { u, v: 0.3 });
  }
});

test("the centre of a piece never moves", () => {
  for (const surface of [wrist, thigh, cakepop, forearm]) {
    const out = compensate({ u: 0.5, v: 0.5 }, surface, 2, 2);
    assert.ok(Math.abs(out.u - 0.5) < 1e-6, `${surface.id} moved the centre horizontally`);
    assert.ok(Math.abs(out.v - 0.5) < 1e-6, `${surface.id} moved the centre vertically`);
  }
});

test("compensation gives the edges more of the paper", () => {
  // The far edges of the piece are the part turning away from the viewer, so
  // they need proportionally more printed width. Everything inside them
  // therefore lands closer to the centre of the printed sheet than it sat in
  // the design — the piece as a whole gets wider, not the detail.
  const out = compensate({ u: 0.25, v: 0.5 }, wrist, 1.2, 1.2);
  assert.ok(out.u > 0.25, `expected the interior to pull inward, got ${out.u}`);
  assert.ok(out.u < 0.4, "a correction, not a collapse to the centre");
  assert.ok(printScale(wrist, 1.2) > 1, "and the sheet itself has to get wider");
});

test("compensate and foreshorten are inverses", () => {
  for (const surface of [wrist, thigh, forearm, cakepop]) {
    for (const u of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      for (const v of [0.2, 0.5, 0.8]) {
        const round = foreshorten(compensate({ u, v }, surface, 1, 1), surface, 1, 1);
        assert.ok(
          Math.abs(round.u - u) < 0.01 && Math.abs(round.v - v) < 0.01,
          `${surface.id} did not round-trip ${u},${v} — got ${round.u},${round.v}`
        );
      }
    }
  }
});

test("a tighter curve distorts more than a loose one", () => {
  const tight = Math.abs(compensate({ u: 0.2, v: 0.5 }, wrist, 1.2, 1.2).u - 0.2);
  const loose = Math.abs(compensate({ u: 0.2, v: 0.5 }, thigh, 1.2, 1.2).u - 0.2);
  assert.ok(tight > loose * 3, `a wrist (${tight}) should bend far more than a thigh (${loose})`);
});

test("a cylinder leaves the vertical alone; a sphere does not", () => {
  assert.equal(compensate({ u: 0.2, v: 0.2 }, thigh, 2, 2).v, 0.2);
  assert.notEqual(compensate({ u: 0.2, v: 0.2 }, cakepop, 1, 1).v, 0.2);
});

test("a cone bends more at its narrow end", () => {
  // forearm tapers from 11in to 7.5in, so the bottom of the artwork sits on a
  // tighter curve than the top.
  const top = compensate({ u: 0.2, v: 0 }, forearm, 1.5, 1.5).u;
  const bottom = compensate({ u: 0.2, v: 1 }, forearm, 1.5, 1.5).u;
  assert.ok(bottom > top, `the narrow end should distort more: ${bottom} vs ${top}`);
});

test("a piece is never allowed past the horizon", () => {
  // At the horizon the surface is edge-on and compensation would need infinite
  // width. An absurd request has to clamp, not produce NaN.
  const out = compensate({ u: 0, v: 0.5 }, cakepop, 40, 40);
  assert.ok(Number.isFinite(out.u) && Number.isFinite(out.v), `got ${JSON.stringify(out)}`);
  assert.ok(out.u >= -0.01 && out.u <= 1.01);
});

test("the widest a piece may appear is short of the full diameter", () => {
  const limit = maxApparentWidthIn(wrist);
  assert.ok(limit < 2 * radiusOf(wrist.circumferenceIn));
  assert.ok(Math.abs(limit - 2 * radiusOf(wrist.circumferenceIn) * MAX_SPAN) < 1e-9);
  assert.equal(maxApparentWidthIn(flat), Infinity);
});

test("a cone is limited by its narrow end, not its wide one", () => {
  assert.ok(minRadiusIn(forearm) < radiusOf(forearm.circumferenceIn));
  assert.ok(maxApparentWidthIn(forearm) < 2 * radiusOf(forearm.circumferenceIn) * MAX_SPAN);
});

test("an oversized piece is shrunk to fit, and says so", () => {
  const fits = effectiveSize(wrist, 1, 1);
  assert.equal(fits.clamped, false);
  assert.equal(fits.widthIn, 1);

  const over = effectiveSize(wrist, 40, 40);
  assert.equal(over.clamped, true);
  assert.ok(over.widthIn <= maxApparentWidthIn(wrist) + 1e-9);
});

test("a sphere is capped on its diagonal, so the corners stay on the ball", () => {
  const size = effectiveSize(cakepop, 1.2, 1.2);
  const radius = radiusOf(cakepop.circumferenceIn);
  assert.ok(Math.hypot(size.widthIn / 2, size.heightIn / 2) <= radius * MAX_SPAN + 1e-9);
  // Shrunk evenly, or a square piece would come out rectangular.
  assert.ok(Math.abs(size.widthIn - size.heightIn) < 1e-9);
});

test("print scale says how much wider to print than it will read", () => {
  assert.equal(printScale(flat, 3), 1);
  assert.ok(printScale(thigh, 1) < 1.02, "a small piece on a thigh is effectively flat");
  const wristScale = printScale(wrist, 1.2);
  assert.ok(wristScale > 1.05, `a 1.2in piece on a wrist needs real compensation, got ${wristScale}`);
  assert.ok(wristScale < 1.7, `${wristScale} is not a plausible correction`);
});

test("the bigger the piece on the same curve, the more it has to grow", () => {
  assert.ok(printScale(wrist, 1.5) > printScale(wrist, 0.6));
});

test("the mesh covers the image and indexes only vertices it has", () => {
  const mesh = warpMesh(400, 300, wrist, 3, 2, "compensate", 8);
  assert.equal(mesh.positions.length, (8 + 1) * (8 + 1));
  assert.equal(mesh.uvs.length, mesh.positions.length);
  assert.equal(mesh.indices.length, 8 * 8 * 6);
  for (const index of mesh.indices) assert.ok(index >= 0 && index < mesh.positions.length);

  const xs = mesh.positions.map((point) => point.x);
  const ys = mesh.positions.map((point) => point.y);
  assert.equal(Math.min(...xs), 0);
  assert.equal(Math.max(...xs), 400);
  assert.equal(Math.min(...ys), 0);
  assert.equal(Math.max(...ys), 300);
});

test("no mesh ever samples outside the source image", () => {
  for (const surface of SURFACES) {
    const mesh = warpMesh(200, 200, surface, 4, 4, "compensate", 6);
    for (const uv of mesh.uvs) {
      assert.ok(uv.x >= 0 && uv.x <= 200 && uv.y >= 0 && uv.y <= 200, `${surface.id} sampled ${uv.x},${uv.y}`);
      assert.ok(Number.isFinite(uv.x) && Number.isFinite(uv.y), `${surface.id} produced a non-finite sample`);
    }
  }
});

test("a flat mesh is the identity", () => {
  const mesh = warpMesh(120, 90, flat, 3, 3, "compensate", 4);
  mesh.positions.forEach((point, index) => {
    assert.ok(Math.abs(point.x - mesh.uvs[index].x) < 1e-6);
    assert.ok(Math.abs(point.y - mesh.uvs[index].y) < 1e-6);
  });
});

test("a degenerate surface is treated as flat rather than dividing by zero", () => {
  const broken: Surface = { id: "x", label: "x", caption: "x", kind: "cylinder", circumferenceIn: 0, brand: "both" };
  assert.deepEqual(compensate({ u: 0.3, v: 0.4 }, broken, 2, 2), { u: 0.3, v: 0.4 });
  assert.equal(printScale(broken, 3), 1);
});
