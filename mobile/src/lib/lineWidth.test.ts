import test from "node:test";
import assert from "node:assert/strict";
import { distanceTransform, finestStrokeWidth } from "./lineWidth";

/** A mask with horizontal bars of the given widths, well separated. */
function bars(width: number, height: number, specs: { y: number; thickness: number; from: number; to: number }[]) {
  const mask = new Uint8Array(width * height);
  for (const bar of specs) {
    for (let dy = 0; dy < bar.thickness; dy++) {
      for (let x = bar.from; x < bar.to; x++) mask[(bar.y + dy) * width + x] = 1;
    }
  }
  return mask;
}

test("the transform is zero on set pixels and grows away from them", () => {
  const mask = new Uint8Array(5 * 5);
  mask[2 * 5 + 2] = 1;
  const dist = distanceTransform(mask, 5, 5);
  assert.equal(dist[2 * 5 + 2], 0, "the pixel itself");
  assert.equal(dist[2 * 5 + 3], 1, "one step across");
  assert.equal(dist[2 * 5 + 4], 2, "two steps across");
  assert.ok(Math.abs(dist[1 * 5 + 1] - 1.4142) < 1e-4, "a diagonal step");
});

test("an empty mask is uniformly far from everything", () => {
  const dist = distanceTransform(new Uint8Array(4 * 4), 4, 4);
  assert.ok(dist.every((value) => value >= 4), "nothing to be near");
});

test("a one-pixel line measures one pixel, not two", () => {
  // The transform counts steps to the nearest blank, so the centre of a
  // hairline is already a step away from one. Doubling that alone reads every
  // hairline as twice its width, which is the direction that fails to warn.
  const mask = bars(60, 30, [{ y: 15, thickness: 1, from: 5, to: 55 }]);
  assert.equal(finestStrokeWidth(mask, 60, 30), 1);
});

test("the finest line is measured, not the finest pixel", () => {
  // A 9px bar and a 3px bar. The answer is the thin one, in pixels, whatever
  // the resolution of the frame it sits in.
  const mask = bars(120, 60, [
    { y: 10, thickness: 9, from: 10, to: 110 },
    { y: 40, thickness: 3, from: 10, to: 110 },
  ]);
  const finest = finestStrokeWidth(mask, 120, 60);
  assert.ok(Math.abs(finest - 3) <= 1, `expected about 3px, got ${finest.toFixed(2)}`);
});

test("a heavy piece is not reported as fine just because it is big", () => {
  // The reviewer's case: a high-resolution asset whose every stroke is heavy.
  // One artwork pixel would call this 1px linework; measuring calls it 20.
  const mask = bars(600, 200, [{ y: 90, thickness: 20, from: 20, to: 580 }]);
  const finest = finestStrokeWidth(mask, 600, 200);
  assert.ok(finest >= 16, `a 20px bar should not read as fine, got ${finest.toFixed(2)}`);
});

test("resolution does not change the answer in proportion", () => {
  // The same drawing at two scales: a bar one twentieth of the frame wide.
  const small = finestStrokeWidth(bars(200, 100, [{ y: 45, thickness: 5, from: 10, to: 190 }]), 200, 100);
  const large = finestStrokeWidth(bars(400, 200, [{ y: 90, thickness: 10, from: 20, to: 380 }]), 400, 200);
  assert.ok(Math.abs(large / small - 2) < 0.35, `${small.toFixed(2)} and ${large.toFixed(2)} are not the same drawing`);
});

test("stroke ends and specks do not drag the answer down", () => {
  // A single speck alongside a heavy bar. The strict minimum would be 1px.
  const mask = bars(200, 100, [{ y: 40, thickness: 12, from: 10, to: 190 }]);
  mask[80 * 200 + 100] = 1;
  const finest = finestStrokeWidth(mask, 200, 100);
  assert.ok(finest >= 8, `one speck should not define the piece, got ${finest.toFixed(2)}`);
});

test("a solid silhouette has no fine linework in it", () => {
  const solid = new Uint8Array(80 * 80).fill(1);
  const finest = finestStrokeWidth(solid, 80, 80);
  assert.ok(finest > 20, `a filled square is not fine linework, got ${finest.toFixed(2)}`);
});

test("nothing to measure comes back as nothing", () => {
  assert.equal(finestStrokeWidth(new Uint8Array(60 * 60), 60, 60), 0, "a blank frame");
  assert.equal(finestStrokeWidth(new Uint8Array(4), 2, 2), 0, "too small to have an interior");
  assert.equal(finestStrokeWidth(new Uint8Array(4), 60, 60), 0, "a buffer too short for the frame");
});
