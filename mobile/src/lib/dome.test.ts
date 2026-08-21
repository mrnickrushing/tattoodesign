import test from "node:test";
import assert from "node:assert/strict";
import { circle, dome, domeSegments } from "./dome";
import { inspectMesh, meshVolume, extrudePrism } from "./solid";

const W = 64;
const H = 64;

/** Every pixel inked, so the whole dome is raised. */
function all(): Uint8Array {
  return new Uint8Array(W * H).fill(1);
}

/** Nothing inked. */
function nothing(): Uint8Array {
  return new Uint8Array(W * H);
}

test("a dome closes, whatever it is built out of", () => {
  for (const radius of [5, 13.97, 19.05]) {
    for (const segments of [48, 128, 256]) {
      const mesh = dome({ x: 0, y: 0 }, radius, 2, segments, 0.01);
      const report = inspectMesh(mesh);
      assert.equal(report.watertight, true, `r=${radius} seg=${segments}: unmatched ${report.unmatched}`);
      assert.ok(meshVolume(mesh) > 0, `r=${radius} seg=${segments} faces inward`);
    }
  }
});

test("a dome holds the volume of the half ball it stands for", () => {
  const radius = 19.05;
  const weld = 0.01;
  // Half a ball, plus the hair of it sunk into the floor.
  const want = (2 / 3) * Math.PI * radius ** 3 + Math.PI * radius ** 2 * weld;

  let previous = Infinity;
  for (const segments of [48, 128, 256]) {
    const got = meshVolume(dome({ x: 0, y: 0 }, radius, 2, segments, weld));
    // A many-sided solid inscribed in a ball is always a little smaller than
    // the ball, and closes on it as the sides get finer. Under, and by less
    // each time, is the whole shape of the claim.
    assert.ok(got < want, `${segments} facets came out larger than the ball itself`);
    const shortfall = (want - got) / want;
    assert.ok(shortfall < previous, `${segments} facets were no closer than the last`);
    previous = shortfall;
  }
  assert.ok(previous < 0.001, `256 facets are still ${(previous * 100).toFixed(2)}% short`);
});

test("the drawing pushes the surface out where it covers it", () => {
  const radius = 10;
  const bare = meshVolume(dome({ x: 0, y: 0 }, radius, 2, 128, 0.01));

  const raised = meshVolume(
    dome({ x: 0, y: 0 }, radius, 2, 128, 0.01, { mask: all(), width: W, height: H, mm: 0.6 })
  );
  // Covered everywhere, the dome is a dome one relief bigger — so what it
  // gained is the shell between the two radii.
  const shell = (2 / 3) * Math.PI * (radius + 0.6) ** 3 - (2 / 3) * Math.PI * radius ** 3;
  assert.ok(Math.abs(raised - bare - shell) / shell < 0.01, `gained ${(raised - bare).toFixed(1)} against ${shell.toFixed(1)}`);

  // Covered nowhere, it is the bare dome to the last decimal — not merely close.
  const blank = meshVolume(
    dome({ x: 0, y: 0 }, radius, 2, 128, 0.01, { mask: nothing(), width: W, height: H, mm: 0.6 })
  );
  assert.equal(blank, bare, "a blank drawing moved the surface");

  // And a drawing covering half of it lands between the two.
  const half = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W / 2; x++) half[y * W + x] = 1;
  const partly = meshVolume(dome({ x: 0, y: 0 }, radius, 2, 128, 0.01, { mask: half, width: W, height: H, mm: 0.6 }));
  assert.ok(partly > bare && partly < raised, `half covered came out at ${partly.toFixed(1)}`);
});

test("a raised drawing still closes", () => {
  // Displacement is per vertex, so a drawing with an edge in it steps the
  // surface. The step is where a mesh would tear if the bands were built off
  // the undisplaced positions.
  const speckled = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) speckled[y * W + x] = (x + y) % 3 === 0 ? 1 : 0;
  const mesh = dome({ x: 0, y: 0 }, 12, 2, 128, 0.01, { mask: speckled, width: W, height: H, mm: 0.6 });
  const report = inspectMesh(mesh);
  assert.equal(report.watertight, true, `unmatched ${report.unmatched}, degenerate ${report.degenerate}`);
  assert.ok(meshVolume(mesh) > 0);
});

test("the drawing is pressed on from straight above the ball", () => {
  // The middle of the drawing lands on the pole and the rim reaches the
  // equator. So a drawing inked only in the middle raises the top of the ball
  // and leaves its sides alone.
  const middle = new Uint8Array(W * H);
  for (let y = 24; y < 40; y++) for (let x = 24; x < 40; x++) middle[y * W + x] = 1;
  const mesh = dome({ x: 0, y: 0 }, 10, 2, 128, 0.01, { mask: middle, width: W, height: H, mm: 1 });

  let highest = -Infinity;
  let widest = 0;
  for (let i = 0; i < mesh.count * 3; i++) {
    highest = Math.max(highest, mesh.positions[i * 3 + 2]);
    widest = Math.max(widest, Math.hypot(mesh.positions[i * 3], mesh.positions[i * 3 + 1]));
  }
  assert.ok(Math.abs(highest - (2 + 11)) < 1e-4, `the pole is at ${highest}, not raised to 11 above the floor`);
  assert.ok(widest < 10.001, `the equator grew to ${widest} — the drawing reached the sides it does not cover`);
});

test("roundness is chosen for the printer, and capped", () => {
  // Finer nozzle, more facets — up to a ceiling, because a ball at a tenth of a
  // millimetre a facet is a file nobody can open.
  assert.ok(domeSegments(19.05, 0.8) < domeSegments(19.05, 0.4), "a finer nozzle earns more facets");
  assert.equal(domeSegments(19.05, 0.05), 256, "and stops at the cap");
  assert.equal(domeSegments(1, 0.4), 48, "a tiny ball still gets enough to read as round");
  assert.equal(domeSegments(19.05, 0.4) % 4, 0, "divisible into rings");
});

test("a circle is a closed outline that extrudes into a post", () => {
  const post = extrudePrism(circle({ x: 5, y: 5 }, 3, 24), [], 0, 2);
  assert.equal(inspectMesh(post).watertight, true);
  // A 24-sided polygon is a little under the circle it is drawn in.
  const want = Math.PI * 9 * 2;
  const got = meshVolume(post);
  assert.ok(got < want && got > want * 0.97, `${got.toFixed(2)} against a circle's ${want.toFixed(2)}`);
});
