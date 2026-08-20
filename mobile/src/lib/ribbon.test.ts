import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { Point } from "./designProject";
import {
  hasVariableWidth,
  outlinePathData,
  polylinePathData,
  renderStroke,
  ribbonOutline,
} from "./ribbon";

/** Area of a closed ring, via the shoelace formula. Sign-free. */
function area(ring: Point[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

function bounds(ring: Point[]) {
  return {
    minX: Math.min(...ring.map((p) => p.x)),
    maxX: Math.max(...ring.map((p) => p.x)),
    minY: Math.min(...ring.map((p) => p.y)),
    maxY: Math.max(...ring.map((p) => p.y)),
  };
}

const flat: Point[] = [
  { x: 0, y: 0 },
  { x: 50, y: 0 },
  { x: 100, y: 0 },
];

const tapered: Point[] = [
  { x: 0, y: 0, w: 2 },
  { x: 50, y: 0, w: 20 },
  { x: 100, y: 0, w: 2 },
];

test("points without widths take the cheap stroked path", () => {
  assert.equal(hasVariableWidth(flat), false);
  const rendered = renderStroke(flat, 6);
  assert.equal(rendered.fill, false);
});

test("points with widths are filled as an outline", () => {
  assert.equal(hasVariableWidth(tapered), true);
  const rendered = renderStroke(tapered, 6);
  assert.equal(rendered.fill, true);
  assert.ok(rendered.d.endsWith("Z"), "a filled outline has to be a closed ring");
});

test("one width anywhere is enough to switch to an outline", () => {
  assert.equal(hasVariableWidth([{ x: 0, y: 0 }, { x: 5, y: 5, w: 3 }]), true);
});

test("the outline is as wide as the widths it was given", () => {
  const box = bounds(ribbonOutline(tapered, 6));
  // The waist is 20 wide, so the ring reaches 10 either side of the spine.
  assert.ok(Math.abs(box.maxY - 10) < 0.5, `expected +10, got ${box.maxY}`);
  assert.ok(Math.abs(box.minY + 10) < 0.5, `expected -10, got ${box.minY}`);
});

test("end caps bulge past the last point rather than cutting it off", () => {
  const box = bounds(ribbonOutline(tapered, 6));
  assert.ok(box.maxX > 100, "the trailing cap did not round past the final point");
  assert.ok(box.minX < 0, "the leading cap did not round past the first point");
});

test("a wider stroke encloses more area", () => {
  const thin = area(ribbonOutline([{ x: 0, y: 0, w: 2 }, { x: 100, y: 0, w: 2 }], 6));
  const thick = area(ribbonOutline([{ x: 0, y: 0, w: 20 }, { x: 100, y: 0, w: 20 }], 6));
  assert.ok(thick > thin * 5, `expected area to track width: ${thick} vs ${thin}`);
});

test("a constant-width ribbon has about the area of the swept rectangle", () => {
  const ring = ribbonOutline([{ x: 0, y: 0, w: 10 }, { x: 100, y: 0, w: 10 }], 6);
  const expected = 100 * 10 + Math.PI * 25; // body plus two half-caps
  assert.ok(Math.abs(area(ring) - expected) / expected < 0.05, `got ${area(ring)}, wanted ~${expected}`);
});

test("a lone point becomes a disc, not an empty ring", () => {
  const ring = ribbonOutline([{ x: 10, y: 10, w: 8 }], 6);
  assert.ok(ring.length > 6);
  assert.ok(Math.abs(area(ring) - Math.PI * 16) / (Math.PI * 16) < 0.15);
});

test("missing widths fall back to the nominal brush width", () => {
  const box = bounds(ribbonOutline([{ x: 0, y: 0 }, { x: 100, y: 0 }], 12));
  assert.ok(Math.abs(box.maxY - 6) < 0.5, `expected the 12-wide fallback, got ${box.maxY}`);
});

test("a repeated point does not collapse the outline", () => {
  const ring = ribbonOutline(
    [{ x: 0, y: 0, w: 8 }, { x: 50, y: 0, w: 8 }, { x: 50, y: 0, w: 8 }, { x: 100, y: 0, w: 8 }],
    6
  );
  assert.ok(ring.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
  assert.ok(area(ring) > 700, `a degenerate segment flattened the ribbon: ${area(ring)}`);
});

test("a corner keeps both arms at full width", () => {
  const ring = ribbonOutline(
    [{ x: 0, y: 0, w: 10 }, { x: 50, y: 0, w: 10 }, { x: 50, y: 50, w: 10 }],
    6
  );
  const box = bounds(ring);
  assert.ok(box.maxX > 54 && box.maxY > 54, `the corner pinched: ${JSON.stringify(box)}`);
});

test("scale is applied to the emitted path data", () => {
  const one = outlinePathData([{ x: 10, y: 20 }, { x: 30, y: 40 }], 1);
  const two = outlinePathData([{ x: 10, y: 20 }, { x: 30, y: 40 }], 2);
  assert.ok(one.includes("M10.00 20.00"));
  assert.ok(two.includes("M20.00 40.00"));
});

test("a stroked path scales its width along with its geometry", () => {
  const rendered = renderStroke(flat, 6, 3);
  assert.equal(rendered.fill, false);
  if (!rendered.fill) assert.equal(rendered.width, 18);
});

test("a single flat point still renders as a visible dot", () => {
  const d = polylinePathData([{ x: 5, y: 5 }]);
  assert.ok(d.includes("M5.00 5.00"));
  assert.ok(d.includes("L"), "a lone point needs length to render under a round cap");
});

test("an empty stroke produces no path", () => {
  assert.equal(polylinePathData([]), "");
  assert.equal(outlinePathData([]), "");
  assert.deepEqual(ribbonOutline([], 6), []);
});
