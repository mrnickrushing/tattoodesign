import { strict as assert } from "node:assert";
import { test } from "node:test";
import { skeletonize } from "./vectorize";
import {
  DEFAULT_CENTERLINE,
  boundary,
  centerlineStencil,
  classifySource,
  distanceInside,
  dilate,
  inkMask,
} from "./lineart";

const W = 80;
const H = 80;

function blank(value = 255): Uint8Array {
  return new Uint8Array(W * H).fill(value);
}

/** A horizontal black bar `thickness` pixels tall, on white. */
function bar(thickness: number, gray = blank()): Uint8Array {
  const top = Math.floor((H - thickness) / 2);
  for (let y = top; y < top + thickness; y++) {
    for (let x = 8; x < W - 8; x++) gray[y * W + x] = 0;
  }
  return gray;
}

/** A photograph-ish field: a smooth gradient, all mid-tones. */
function photo(): Uint8Array {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) out[y * W + x] = 40 + Math.round((x / W) * 170);
  }
  return out;
}

const thin = skeletonize;

test("a drawing is recognised as a drawing", () => {
  assert.equal(classifySource(bar(3)).kind, "lineart");
});

test("a photograph is not", () => {
  assert.equal(classifySource(photo()).kind, "photo");
});

test("blank paper is not mistaken for a drawing", () => {
  // No ink at all: there is nothing to centreline, and calling it line art
  // would send an empty page down the thinning path.
  assert.equal(classifySource(blank()).kind, "photo");
});

test("an empty buffer is handled rather than dividing by zero", () => {
  const profile = classifySource(new Uint8Array(0));
  assert.equal(profile.kind, "photo");
  assert.ok(Number.isFinite(profile.mid));
});

test("the profile accounts for every pixel", () => {
  const profile = classifySource(bar(4));
  assert.ok(Math.abs(profile.paper + profile.ink + profile.mid - 1) < 1e-9);
});

test("ink is everything below the cutoff", () => {
  const gray = Uint8Array.from([0, 100, 200, 255]);
  assert.deepEqual(Array.from(inkMask(gray, 160)), [1, 1, 0, 0]);
});

test("distance inside a region grows toward its middle", () => {
  const mask = new Uint8Array(W * H).fill(1);
  const dist = distanceInside(mask, W, H);
  assert.ok(dist[Math.floor(H / 2) * W + Math.floor(W / 2)] > dist[1 * W + 1]);
  assert.equal(dist[0], 1, "a corner pixel is one step from the outside");
});

test("distance is zero outside the region", () => {
  const mask = new Uint8Array(W * H);
  mask[10 * W + 10] = 1;
  const dist = distanceInside(mask, W, H);
  assert.equal(dist[0], 0);
  assert.equal(dist[10 * W + 10], 1);
});

test("dilation grows a mask and zero radius leaves it alone", () => {
  const mask = new Uint8Array(W * H);
  mask[40 * W + 40] = 1;
  const count = (m: Uint8Array) => m.reduce<number>((s, v) => s + v, 0);
  assert.equal(count(dilate(mask, W, H, 0)), 1);
  assert.ok(count(dilate(mask, W, H, 2)) > 8);
});

test("a boundary is the rim, not the body", () => {
  const mask = new Uint8Array(W * H);
  for (let y = 20; y < 60; y++) for (let x = 20; x < 60; x++) mask[y * W + x] = 1;
  const rim = boundary(mask, W, H);
  assert.equal(rim[20 * W + 20], 1, "corner is on the rim");
  assert.equal(rim[40 * W + 40], 0, "centre is not");
});

/** Count set pixels in one column, which is how many lines cross it. */
function runsInColumn(mask: Uint8Array, x: number): number {
  let runs = 0;
  let inside = false;
  for (let y = 0; y < H; y++) {
    const on = mask[y * W + x] === 1;
    if (on && !inside) runs++;
    inside = on;
  }
  return runs;
}

test("a drawn line comes back as ONE line, not two", () => {
  // This is the whole point. Sobel returns the two edges of a stroke; a
  // centreline returns the stroke.
  const { mask } = centerlineStencil(bar(5), W, H, thin);
  assert.equal(runsInColumn(mask, W / 2), 1, "a single stroke produced more than one line");
});

test("a thicker drawn line still comes back as one line of the same weight", () => {
  const thinBar = centerlineStencil(bar(3), W, H, thin);
  const thickBar = centerlineStencil(bar(7), W, H, thin);
  assert.equal(runsInColumn(thinBar.mask, W / 2), 1);
  assert.equal(runsInColumn(thickBar.mask, W / 2), 1);
  const ink = (m: Uint8Array) => m.reduce<number>((s, v) => s + v, 0);
  // Within a hair of each other: the output weight is chosen, not inherited.
  assert.ok(Math.abs(ink(thinBar.mask) - ink(thickBar.mask)) < ink(thinBar.mask) * 0.35);
});

test("line weight is honoured", () => {
  const hair = centerlineStencil(bar(3), W, H, thin, { ...DEFAULT_CENTERLINE, weight: 1 });
  const heavy = centerlineStencil(bar(3), W, H, thin, { ...DEFAULT_CENTERLINE, weight: 3 });
  const ink = (m: Uint8Array) => m.reduce<number>((s, v) => s + v, 0);
  assert.ok(ink(heavy.mask) > ink(hair.mask) * 2, "a heavier weight should lay more ink");
});

test("a solid shape comes back as its outline, not as a blob", () => {
  // An artist needs to know what to pack solid; a filled mass on a stencil
  // hides the very lines it is supposed to be showing.
  const gray = blank();
  for (let y = 20; y < 60; y++) for (let x = 20; x < 60; x++) gray[y * W + x] = 0;
  const { mask, filled } = centerlineStencil(gray, W, H, thin);
  assert.ok(filled > 0.8, `the shape should read as filled, got ${filled}`);
  assert.equal(mask[40 * W + 40], 0, "the middle of the shape should be clear");
  assert.equal(mask[20 * W + 20], 1, "its outline should survive");
});

test("a thin stroke is never mistaken for a filled shape", () => {
  assert.equal(centerlineStencil(bar(3), W, H, thin).filled, 0);
});

test("a blank page produces a blank stencil rather than throwing", () => {
  const { mask, filled } = centerlineStencil(blank(), W, H, thin);
  assert.equal(mask.reduce<number>((s, v) => s + v, 0), 0);
  assert.equal(filled, 0);
});

test("the output is the same size as the input", () => {
  assert.equal(centerlineStencil(bar(4), W, H, thin).mask.length, W * H);
});
