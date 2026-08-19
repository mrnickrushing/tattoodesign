import test from "node:test";
import assert from "node:assert/strict";
import { HEAL_AGES, agePixels, healingProfile, inkCoverage, type HealAge } from "./healing";

const PX_PER_MM = 10; // 254 DPI — one pixel is a tenth of a millimetre.
const W = 40;
const H = 40;

function paper(): Uint8Array {
  return new Uint8Array(W * H).fill(255);
}

/** A vertical ink line one pixel wide at column `x`. */
function line(gray: Uint8Array, x: number) {
  for (let y = 0; y < H; y++) gray[y * W + x] = 0;
}

function darkCount(gray: Uint8Array): number {
  return gray.reduce((total, value) => total + (value < 128 ? 1 : 0), 0);
}

test("a fresh piece has no migration at all", () => {
  const profile = healingProfile("fresh", PX_PER_MM);
  assert.equal(profile.spreadPx, 0);
  assert.equal(profile.blurPx, 0);
  assert.equal(profile.contrast, 1);
});

test("migration grows with age", () => {
  const ages: HealAge[] = ["fresh", "twoYear", "tenYear"];
  const profiles = ages.map((age) => healingProfile(age, PX_PER_MM));
  for (let i = 1; i < profiles.length; i++) {
    assert.ok(profiles[i].spreadPx > profiles[i - 1].spreadPx, "spread should increase");
    assert.ok(profiles[i].blurPx > profiles[i - 1].blurPx, "blur should increase");
    assert.ok(profiles[i].contrast < profiles[i - 1].contrast, "contrast should fade");
  }
});

test("migration scales linearly with print density", () => {
  const single = healingProfile("tenYear", 10);
  const double = healingProfile("tenYear", 20);
  assert.ok(Math.abs(double.spreadPx - single.spreadPx * 2) < 1e-9);
  assert.ok(Math.abs(double.blurPx - single.blurPx * 2) < 1e-9);
  assert.equal(double.contrast, single.contrast, "fading is not a function of resolution");
});

test("a nonsense density degrades to no migration rather than NaN", () => {
  for (const density of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const profile = healingProfile("tenYear", density);
    assert.ok(Number.isFinite(profile.spreadPx), `spread should stay finite for ${density}`);
    assert.equal(profile.spreadPx, 0);
    assert.equal(profile.blurPx, 0);
  }
});

test("ageing preserves the image dimensions", () => {
  const gray = paper();
  line(gray, 20);
  const aged = agePixels(gray, W, H, healingProfile("tenYear", PX_PER_MM));
  assert.equal(aged.length, gray.length);
});

test("a fresh render leaves the pixels alone", () => {
  const gray = paper();
  line(gray, 20);
  const aged = agePixels(gray, W, H, healingProfile("fresh", PX_PER_MM));
  assert.deepEqual(Array.from(aged), Array.from(gray));
});

test("ageing thickens a line", () => {
  const gray = paper();
  line(gray, 20);
  const before = darkCount(gray);
  const after = darkCount(agePixels(gray, W, H, healingProfile("tenYear", PX_PER_MM)));
  assert.ok(after > before, `expected spread, went from ${before} to ${after} dark pixels`);
});

test("ten years spreads further than two", () => {
  const gray = paper();
  line(gray, 20);
  const two = darkCount(agePixels(gray, W, H, healingProfile("twoYear", PX_PER_MM)));
  const ten = darkCount(agePixels(gray, W, H, healingProfile("tenYear", PX_PER_MM)));
  assert.ok(ten > two, `ten years (${ten}) should spread past two (${two})`);
});

test("two lines that start apart close up with age — the whole point", () => {
  const gray = paper();
  line(gray, 19);
  line(gray, 23); // a 3px gap: 0.3mm at this density
  const gapAt = (buffer: Uint8Array) => {
    let open = 0;
    for (let x = 20; x <= 22; x++) if (buffer[10 * W + x] > 200) open++;
    return open;
  };
  assert.equal(gapAt(gray), 3, "the gap starts fully open");
  assert.ok(gapAt(agePixels(gray, W, H, healingProfile("tenYear", PX_PER_MM))) < 3, "the gap should close");
});

test("fading lightens ink without erasing it", () => {
  const gray = paper();
  line(gray, 20);
  const aged = agePixels(gray, W, H, healingProfile("tenYear", PX_PER_MM));
  const centre = aged[10 * W + 20];
  assert.ok(centre > 0, "aged ink is no longer pure black");
  assert.ok(centre < 200, "aged ink is still clearly visible");
});

test("blank skin ages to blank skin", () => {
  const gray = paper();
  const aged = agePixels(gray, W, H, healingProfile("tenYear", PX_PER_MM));
  assert.ok(aged.every((value) => value > 240), "nothing should appear out of nowhere");
});

test("ink coverage reports the darkened share", () => {
  const gray = paper();
  assert.equal(inkCoverage(gray), 0);
  line(gray, 20);
  assert.ok(Math.abs(inkCoverage(gray) - H / (W * H)) < 1e-9);
  assert.equal(inkCoverage(new Uint8Array(0)), 0);
});

test("every offered age has a profile and readable copy", () => {
  assert.equal(HEAL_AGES.length, 3);
  for (const age of HEAL_AGES) {
    assert.ok(age.label.length > 0);
    assert.ok(age.caption.length > 0);
    assert.ok(Number.isFinite(healingProfile(age.id, PX_PER_MM).spreadPx));
  }
});
