import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  gradient,
  hysteresis,
  nonMaxSuppress,
  removeSpecks,
  structuralEdges,
  thresholdsFrom,
} from "./edges";

const W = 60;
const H = 60;

function field(fill: number): Float32Array {
  return new Float32Array(W * H).fill(fill);
}

/** A dark vertical bar on white — one object, two real edges. */
function bar(thickness = 8): Float32Array {
  const g = field(255);
  const left = Math.floor((W - thickness) / 2);
  for (let y = 0; y < H; y++) {
    for (let x = left; x < left + thickness; x++) g[y * W + x] = 0;
  }
  return g;
}

/** Smooth shading with no structure at all. */
function ramp(): Float32Array {
  const g = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) g[y * W + x] = (x / W) * 255;
  return g;
}

const count = (m: Uint8Array) => m.reduce<number>((sum, v) => sum + v, 0);

function runsInRow(mask: Uint8Array, y: number): number {
  let runs = 0;
  let inside = false;
  for (let x = 0; x < W; x++) {
    const on = mask[y * W + x] === 1;
    if (on && !inside) runs++;
    inside = on;
  }
  return runs;
}

function widthOfFirstRun(mask: Uint8Array, y: number): number {
  let width = 0;
  let started = false;
  for (let x = 0; x < W; x++) {
    const on = mask[y * W + x] === 1;
    if (on) {
      started = true;
      width++;
    } else if (started) break;
  }
  return width;
}

test("a flat field has no gradient", () => {
  const { magnitude } = gradient(field(128), W, H);
  assert.ok(magnitude.every((value) => value === 0));
});

test("gradient points across an edge, not along it", () => {
  const { gx, gy } = gradient(bar(), W, H);
  const y = H / 2;
  const edge = (W - 8) / 2;
  assert.ok(Math.abs(gx[y * W + edge]) > Math.abs(gy[y * W + edge]), "a vertical edge has a horizontal gradient");
});

/** A soft-edged bar — what a real image has, and what produces a wide band. */
function softBar(): Float32Array {
  const g = field(255);
  const centre = W / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.abs(x - centre);
      g[y * W + x] = d < 6 ? 0 : d < 12 ? ((d - 6) / 6) * 255 : 255;
    }
  }
  return g;
}

test("suppression thins a wide gradient band to a single ridge", () => {
  const edges = gradient(softBar(), W, H);
  const thick = count(Uint8Array.from(edges.magnitude, (v) => (v > 5 ? 1 : 0)));
  const thin = count(Uint8Array.from(nonMaxSuppress(edges, W, H), (v) => (v > 5 ? 1 : 0)));
  assert.ok(thin < thick * 0.75, `suppression did not thin: ${thin} vs ${thick}`);
});

test("an edge survives suppression at full strength", () => {
  const thinned = nonMaxSuppress(gradient(bar(), W, H), W, H);
  assert.ok(Math.max(...thinned) > 200, "the ridge itself must survive");
});

test("gradient strength is absolute, not relative to the picture", () => {
  // A hard step reads near full; a gentle ramp reads near nothing — and a
  // picture containing only the ramp must not have it rescaled to full.
  const step = Math.max(...gradient(bar(), W, H).magnitude);
  const shading = Math.max(...gradient(ramp(), W, H).magnitude);
  assert.ok(step > 200, `a black-to-white step should read strong, got ${step}`);
  assert.ok(shading < 20, `smooth shading should read weak, got ${shading}`);
});

test("a bar comes back as its two edges, one pixel each", () => {
  const mask = structuralEdges(bar(), W, H, { high: 60, low: 24, minRun: 4 });
  assert.equal(runsInRow(mask, H / 2), 2, "one bar has two edges");
  assert.ok(widthOfFirstRun(mask, H / 2) <= 2, `edge came back ${widthOfFirstRun(mask, H / 2)}px wide`);
});

test("hysteresis follows a line through a weak stretch", () => {
  // A line that fades in the middle: one threshold would cut it in two.
  const thinned = new Float32Array(W * H);
  for (let x = 5; x < 55; x++) thinned[30 * W + x] = x > 25 && x < 35 ? 30 : 90;
  const linked = hysteresis(thinned, W, H, 20, 70);
  assert.equal(runsInRow(linked, 30), 1, "the weak stretch broke the line");
});

test("hysteresis will not start a line on a weak pixel alone", () => {
  const thinned = new Float32Array(W * H);
  thinned[30 * W + 30] = 30;
  assert.equal(count(hysteresis(thinned, W, H, 20, 70)), 0);
});

test("specks are dropped and real lines are kept", () => {
  const mask = new Uint8Array(W * H);
  for (let x = 5; x < 50; x++) mask[20 * W + x] = 1; // a line
  mask[40 * W + 10] = 1; // dirt
  mask[45 * W + 30] = 1; // dirt
  const cleaned = removeSpecks(mask, W, H, 8);
  assert.equal(cleaned[20 * W + 20], 1, "the line should survive");
  assert.equal(cleaned[40 * W + 10], 0, "the speck should not");
});

test("speck removal keeps diagonally connected runs together", () => {
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < 12; i++) mask[(10 + i) * W + (10 + i)] = 1;
  assert.equal(count(removeSpecks(mask, W, H, 10)), 12);
});

test("a minimum of one keeps everything", () => {
  const mask = new Uint8Array(W * H);
  mask[5] = 1;
  assert.equal(count(removeSpecks(mask, W, H, 1)), 1);
});

test("smooth shading produces no lines at all", () => {
  // This is the case that turned a rendered illustration into a black smear:
  // a gentle tonal ramp must not register as structure.
  const mask = structuralEdges(ramp(), W, H, thresholdsFrom(60, true));
  assert.equal(count(mask), 0, "a smooth ramp should contain no edges");
});

test("structure survives in a picture that also has shading", () => {
  const g = ramp();
  for (let y = 10; y < 50; y++) g[y * W + 30] = 0; // a hard line through the ramp
  const mask = structuralEdges(g, W, H, thresholdsFrom(60, true));
  assert.ok(count(mask) > 20, "the drawn line should survive the shading around it");
  assert.ok(count(mask) < 400, `only the line should survive, got ${count(mask)} pixels`);
});

test("the output is never thicker than the input structure", () => {
  // The old pipeline dilated, which is what welded neighbouring edges into
  // solid black. Nothing here may grow a mask.
  const mask = structuralEdges(bar(20), W, H, thresholdsFrom(60, false));
  assert.ok(widthOfFirstRun(mask, H / 2) <= 2);
});

test("derived thresholds keep the conventional ratio and admit no inversions", () => {
  const opts = thresholdsFrom(80, false);
  assert.equal(opts.high, 80);
  assert.ok(opts.low < opts.high, "the continuing threshold must be the lower one");
  assert.ok(thresholdsFrom(0, false).high >= 8, "a zero setting must not admit everything");
});

test("a rendered source is treated more permissively than a plain one", () => {
  // Its internal edges are soft because the artist blended them, so a strict
  // threshold keeps only the outer silhouette and throws the drawing away.
  const dense = thresholdsFrom(60, true);
  const plain = thresholdsFrom(60, false);
  assert.ok(dense.high < plain.high, "a render needs a lower bar to admit its interior");
  assert.ok(dense.minRun <= plain.minRun, "having admitted them, it must not then delete them as dirt");
});

test("no setting ever puts the continuing threshold above the starting one", () => {
  for (const threshold of [0, 5, 30, 60, 120, 255]) {
    for (const dense of [true, false]) {
      const opts = thresholdsFrom(threshold, dense);
      assert.ok(opts.low < opts.high, `${threshold}/${dense} inverted the pair`);
      assert.ok(opts.high >= 8, `${threshold}/${dense} would admit everything`);
    }
  }
});

test("an empty image is handled rather than throwing", () => {
  assert.equal(count(structuralEdges(new Float32Array(0), 0, 0, thresholdsFrom(60, false))), 0);
});
