import test from "node:test";
import assert from "node:assert/strict";
import { circle, dome, domeSegments, domeStrayMm } from "./dome";
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

test("roundness is judged by how far a facet strays, not how long it is", () => {
  // The distinction the first version of this got wrong. A facet's *length*
  // against the nozzle demands 256 facets on a cake pop to buy an accuracy of
  // one and a half microns; what matters is how far the flat facet strays from
  // the ball.
  for (const radius of [19.05, 13.97, 5]) {
    const segments = domeSegments(radius);
    assert.ok(domeStrayMm(radius, segments) <= 0.05, `r=${radius}: ${segments} facets stray ${domeStrayMm(radius, segments)}`);
    // And no further than it has to: four fewer would be outside the tolerance,
    // or it is already at the floor.
    assert.ok(
      segments === 32 || domeStrayMm(radius, segments - 4) > 0.05,
      `r=${radius}: ${segments} facets is finer than the tolerance asks for`
    );
  }

  // A bigger ball needs more facets to hold the same tolerance.
  assert.ok(domeSegments(19.05) > domeSegments(5));
});

test("the ball really is as round as it is said to be", () => {
  // Measured off the triangles rather than worked out again.
  //
  // The version of this that shipped asserted the segment count against the
  // same formula the code used to choose it, which proves only that the
  // arithmetic was done twice. It was the wrong formula both times: it measured
  // the sag of one equatorial edge, while the mesh bands in both directions and
  // a triangle's diagonal spans root-two times the angle its sides do. Every
  // ball was twice as faceted as it claimed, and this test agreed with it.
  const sampleWorstSag = (radius: number, segments: number): number => {
    const mesh = dome({ x: 0, y: 0 }, radius, 0, segments, 0.01);
    let worst = 0;
    for (let t = 0; t < mesh.count; t++) {
      const corner = [0, 1, 2].map((k) => [
        mesh.positions[t * 9 + k * 3],
        mesh.positions[t * 9 + k * 3 + 1],
        mesh.positions[t * 9 + k * 3 + 2],
      ]);
      // The flat underside and the skirt are not meant to be round.
      if (corner.some((point) => point[2] < 0.001)) continue;

      const u = corner[1].map((c, k) => c - corner[0][k]);
      const v = corner[2].map((c, k) => c - corner[0][k]);
      const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const length = Math.hypot(...normal);
      if (length < 1e-12) continue;
      const unit = normal.map((c) => c / length);
      const offset = unit[0] * corner[0][0] + unit[1] * corner[0][1] + unit[2] * corner[0][2];

      // Walk the patch the triangle stands in for, push each point out to the
      // true ball, and see how far from the flat facet it lands.
      for (let a = 0; a <= 5; a++) {
        for (let b = 0; a + b <= 5; b++) {
          const c = 5 - a - b;
          const inside = [0, 1, 2].map((k) => (a * corner[0][k] + b * corner[1][k] + c * corner[2][k]) / 5);
          const reach = Math.hypot(...inside);
          if (reach < 1e-9) continue;
          const onBall = inside.map((x) => (x / reach) * radius);
          worst = Math.max(worst, Math.abs(onBall[0] * unit[0] + onBall[1] * unit[1] + onBall[2] * unit[2] - offset));
        }
      }
    }
    return worst;
  };

  for (const radius of [19.05, 13.97]) {
    const segments = domeSegments(radius);
    const measured = sampleWorstSag(radius, segments);
    assert.ok(measured <= 0.05, `r=${radius}: ${segments} facets actually stray ${measured.toFixed(4)}mm`);
    // And what the code says about itself is an honest ceiling on what it
    // built — not under it, which would be telling somebody half a truth, and
    // not wildly over it either, which would be a different way of not knowing.
    // Sampling a patch on a grid can only ever find the worst point
    // approximately, so the ceiling is allowed to sit a little above it.
    const claimed = domeStrayMm(radius, segments);
    assert.ok(measured <= claimed * 1.02, `r=${radius}: claims ${claimed.toFixed(4)}mm, strays ${measured.toFixed(4)}mm`);
    assert.ok(measured >= claimed * 0.8, `r=${radius}: claims ${claimed.toFixed(4)}mm for an actual ${measured.toFixed(4)}mm`);
  }
});

test("a drawing on the ball is what makes it worth going finer", () => {
  const radius = 19.05;
  const plain = domeSegments(radius);

  // Detail to carry raises the count, and finer detail raises it further.
  const coarse = domeSegments(radius, 2);
  const fine = domeSegments(radius, 1);
  assert.ok(coarse > plain, `${coarse} facets for 2mm detail against ${plain} plain`);
  assert.ok(fine > coarse, `${fine} for 1mm detail against ${coarse} for 2mm`);

  // Detail coarser than the ball's own roundness asks for changes nothing —
  // there is no reason to go finer for a feature the facets already resolve.
  assert.equal(domeSegments(radius, 8), plain, "a broad feature is carried by a plain ball's facets");

  // Two facets across the finest feature is the demand, so the facet is about
  // half of it — the coarsest a step can be and still read as an edge.
  const facet = (2 * Math.PI * radius) / coarse;
  assert.ok(facet <= 2 / 2 + 0.01, `a 2mm feature got ${facet.toFixed(2)}mm facets`);

  // And it stops, because a ball here is one of several on two trays.
  assert.equal(domeSegments(radius, 0.01), 192, "capped");
  assert.equal(domeSegments(0.0001), 32, "and floored");
  assert.equal(domeSegments(radius, 1) % 4, 0, "divisible into rings");
});

test("a circle is a closed outline that extrudes into a post", () => {
  const post = extrudePrism(circle({ x: 5, y: 5 }, 3, 24), [], 0, 2);
  assert.equal(inspectMesh(post).watertight, true);
  // A 24-sided polygon is a little under the circle it is drawn in.
  const want = Math.PI * 9 * 2;
  const got = meshVolume(post);
  assert.ok(got < want && got > want * 0.97, `${got.toFixed(2)} against a circle's ${want.toFixed(2)}`);
});
