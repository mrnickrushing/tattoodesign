import test from "node:test";
import assert from "node:assert/strict";
import {
  LETTERING_STYLES,
  arcLayout,
  layoutBounds,
  letteringStyle,
} from "./lettering";

const WIDTHS = [20, 30, 25, 20]; // four glyphs, 95 total advance

function close(actual: number, expected: number, label: string, epsilon = 1e-9) {
  assert.ok(Math.abs(actual - expected) < epsilon, `${label}: expected ${expected}, got ${actual}`);
}

test("zero curve is a plain left-to-right pen advance", () => {
  const placements = arcLayout(WIDTHS, 0);
  assert.equal(placements.length, 4);
  let x = 0;
  placements.forEach((placement, index) => {
    close(placement.x, x, `glyph ${index} x`);
    close(placement.y, 0, `glyph ${index} y`);
    close(placement.rotation, 0, `glyph ${index} rotation`);
    x += WIDTHS[index];
  });
});

test("empty input lays out to nothing, zero widths to a straight stack", () => {
  assert.deepEqual(arcLayout([], 0.5), []);
  const zeros = arcLayout([0, 0], 0.7);
  assert.equal(zeros.length, 2);
  close(zeros[0].y, 0, "zero-width y");
});

test("an arch lifts the middle above the ends", () => {
  const placements = arcLayout(WIDTHS, 0.6);
  const first = placements[0];
  const last = placements.at(-1)!;
  const middle = placements[1];
  // Canvas y grows downward: higher on screen = smaller y.
  assert.ok(middle.y < first.y, "middle should sit above the first glyph");
  assert.ok(middle.y < last.y, "middle should sit above the last glyph");
});

test("a valley sinks the middle below the ends", () => {
  const placements = arcLayout(WIDTHS, -0.6);
  const first = placements[0];
  const middle = placements[1];
  assert.ok(middle.y > first.y, "middle should sit below the ends");
});

test("the arc midpoint touches the baseline", () => {
  // Symmetric widths put glyph 1|2 boundary exactly at the arc midpoint.
  const symmetric = [30, 30];
  for (const curve of [0.4, -0.4, 1, -1]) {
    const placements = arcLayout(symmetric, curve);
    // Both glyph midpoints sit at ±θ/4 — equidistant from the baseline touch.
    close(placements[0].y, placements[1].y, `symmetry at curve ${curve}`, 1e-6);
  }
});

test("rotation tilts glyphs tangent to the arc, mirrored by direction", () => {
  const arch = arcLayout(WIDTHS, 0.8);
  assert.ok(arch[0].rotation < 0, "arch: left glyph tilts counterclockwise");
  assert.ok(arch.at(-1)!.rotation > 0, "arch: right glyph tilts clockwise");

  const valley = arcLayout(WIDTHS, -0.8);
  assert.ok(valley[0].rotation > 0, "valley: left glyph tilts clockwise");
  assert.ok(valley.at(-1)!.rotation < 0, "valley: right glyph tilts counterclockwise");

  // Deeper curve, stronger tilt.
  const gentle = arcLayout(WIDTHS, 0.2);
  assert.ok(Math.abs(arch[0].rotation) > Math.abs(gentle[0].rotation));
});

test("curve is clamped to its documented range", () => {
  const wild = arcLayout(WIDTHS, 9);
  const max = arcLayout(WIDTHS, 1);
  wild.forEach((placement, index) => {
    close(placement.x, max[index].x, `clamped x ${index}`, 1e-9);
    close(placement.y, max[index].y, `clamped y ${index}`, 1e-9);
  });
});

test("mirrored curves mirror y and rotation exactly", () => {
  const up = arcLayout(WIDTHS, 0.5);
  const down = arcLayout(WIDTHS, -0.5);
  up.forEach((placement, index) => {
    close(placement.x, down[index].x, `x ${index}`);
    close(placement.y, -down[index].y, `y ${index}`);
    close(placement.rotation, -down[index].rotation, `rotation ${index}`);
  });
});

test("layout bounds cover every placement with headroom for the glyph body", () => {
  const placements = arcLayout(WIDTHS, 0.7);
  const bounds = layoutBounds(placements, WIDTHS, 40);
  for (const [index, placement] of placements.entries()) {
    assert.ok(placement.x >= bounds.minX, `glyph ${index} x inside`);
    assert.ok(placement.x + WIDTHS[index] <= bounds.maxX, `glyph ${index} right inside`);
    assert.ok(placement.y - 40 >= bounds.minY, `glyph ${index} ascender inside`);
  }
  assert.deepEqual(layoutBounds([], [], 40), { minX: 0, minY: 0, maxX: 0, maxY: 0 });
});

test("the style table is complete and falls back sanely", () => {
  assert.equal(LETTERING_STYLES.length, 3);
  const ids = LETTERING_STYLES.map((style) => style.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const style of LETTERING_STYLES) {
    assert.ok(style.label.length > 0);
    assert.ok(style.fontFamily.length > 0);
    assert.ok(style.simplifyTolerance > 0);
  }
  assert.equal(letteringStyle("script").id, "script");
  assert.equal(letteringStyle("nope" as never).id, "script", "unknown id falls back");
});
