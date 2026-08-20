import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  DEFAULT_BANDS,
  MAX_BANDS,
  MIN_BANDS,
  bandMask,
  bandTones,
  clampBands,
  coverage,
  histogram,
  posterize,
  renderStudy,
  thresholds,
} from "./tone";

/** A ramp using the whole range: 0..255 spread evenly. */
function ramp(length = 256): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => Math.round((i / (length - 1)) * 255));
}

/** A photo shot in flat light: everything crammed into 100..126, which sits
 *  entirely inside one quarter of the range. */
function flat(length = 400): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => 100 + (i % 27));
}

test("band counts are clamped to what a stencil can separate", () => {
  assert.equal(clampBands(0), MIN_BANDS);
  assert.equal(clampBands(99), MAX_BANDS);
  assert.equal(clampBands(Number.NaN), DEFAULT_BANDS);
  assert.equal(clampBands(3.4), 3);
});

test("the histogram counts every pixel", () => {
  const bins = histogram(ramp());
  assert.equal(bins.reduce((sum, n) => sum + n, 0), 256);
});

test("even thresholds split the range regardless of content", () => {
  assert.deepEqual(thresholds(flat(), 4, "even"), [64, 128, 192]);
});

test("even bands collapse a flat photo into one band", () => {
  const source = flat();
  const bands = posterize(source, thresholds(source, 4, "even"));
  const spread = coverage(bands, 4);
  const used = spread.filter((share) => share > 0.01).length;
  assert.equal(used, 1, `a flat photo should defeat even bands, got ${JSON.stringify(spread)}`);
});

test("balanced bands separate the same flat photo", () => {
  const source = flat();
  const bands = posterize(source, thresholds(source, 4, "balanced"));
  const spread = coverage(bands, 4);
  assert.ok(
    spread.every((share) => share > 0.15),
    `every band should carry real weight, got ${JSON.stringify(spread)}`
  );
});

test("balanced bands hold roughly equal populations", () => {
  const source = ramp(1000);
  const spread = coverage(posterize(source, thresholds(source, 4, "balanced")), 4);
  for (const share of spread) assert.ok(Math.abs(share - 0.25) < 0.05, `uneven band: ${share}`);
});

test("band zero is the darkest", () => {
  const source = ramp();
  const bands = posterize(source, thresholds(source, 4, "even"));
  assert.equal(bands[0], 0);
  assert.equal(bands[bands.length - 1], 3);
});

test("an image of one value does not fabricate bands", () => {
  const source = new Uint8Array(200).fill(90);
  const bands = posterize(source, thresholds(source, 4, "balanced"));
  const used = new Set(Array.from(bands));
  assert.equal(used.size, 1, "there is only one value; there is only one band");
});

test("a band mask selects exactly that band", () => {
  const bands = Uint8Array.from([0, 1, 2, 3, 2, 1]);
  assert.deepEqual(Array.from(bandMask(bands, 2)), [0, 0, 1, 0, 1, 0]);
});

test("including darker bands is cumulative, the way ink accumulates", () => {
  const bands = Uint8Array.from([0, 1, 2, 3]);
  assert.deepEqual(Array.from(bandMask(bands, 2, true)), [1, 1, 1, 0]);
});

test("the darkest mask is the same either way", () => {
  const bands = Uint8Array.from([0, 1, 2, 0]);
  assert.deepEqual(Array.from(bandMask(bands, 0)), Array.from(bandMask(bands, 0, true)));
});

test("coverage sums to one", () => {
  const source = ramp(500);
  const total = coverage(posterize(source, thresholds(source, 5, "balanced")), 5).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
});

test("coverage of an empty image is all zeroes rather than NaN", () => {
  assert.deepEqual(coverage(new Uint8Array(0), 3), [0, 0, 0]);
});

test("band tones ascend from dark to light", () => {
  const tones = bandTones([64, 128, 192]);
  assert.equal(tones.length, 4);
  for (let i = 1; i < tones.length; i++) assert.ok(tones[i] > tones[i - 1]);
  assert.ok(tones[0] < 64, "the darkest band should preview dark");
  assert.ok(tones[3] > 192, "the lightest band should preview light");
});

test("the study renders one flat tone per band", () => {
  const source = ramp();
  const cuts = thresholds(source, 3, "even");
  const study = renderStudy(posterize(source, cuts), cuts);
  assert.equal(new Set(Array.from(study)).size, 3);
  assert.deepEqual(Array.from(new Set(Array.from(study))).sort((a, b) => a - b), bandTones(cuts));
});

test("the study is the same size as what it was made from", () => {
  const source = ramp(137);
  const cuts = thresholds(source, 4, "balanced");
  assert.equal(renderStudy(posterize(source, cuts), cuts).length, 137);
});
