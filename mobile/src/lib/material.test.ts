import test from "node:test";
import assert from "node:assert/strict";
import {
  ICING_TIPS,
  NEEDLE_GROUPINGS,
  findTool,
  layDown,
  scaleToTool,
  strokeProfile,
  toolWidthPx,
  toolsFor,
} from "./material";
import { hasVariableWidth } from "./ribbon";
import type { Point } from "./designProject";

// 254 DPI is exactly 10 pixels per millimetre.
const PX_PER_MM = 10;

/** A straight run of points, evenly spaced — a hand moving at a steady pace. */
function steady(count: number, step = 4): Point[] {
  return Array.from({ length: count }, (_, i) => ({ x: i * step, y: 0 }));
}

test("needle groupings run fine to heavy and each says what it's for", () => {
  const liners = NEEDLE_GROUPINGS.filter((grouping) => grouping.id.endsWith("rl"));
  for (let i = 1; i < liners.length; i++) {
    assert.ok(liners[i].widthMm > liners[i - 1].widthMm, `${liners[i].label} is not wider than ${liners[i - 1].label}`);
  }
  assert.equal(NEEDLE_GROUPINGS[0].widthMm, 0.35, "a single #12 needle");
  NEEDLE_GROUPINGS.forEach((grouping) => {
    assert.ok(grouping.widthMm > 0 && grouping.widthMm < 10, `${grouping.label} is not a real grouping`);
    assert.ok(grouping.note.length > 0);
  });
  const ids = NEEDLE_GROUPINGS.map((grouping) => grouping.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("a bead is wider than the tip that piped it, by a fixed spread", () => {
  ICING_TIPS.forEach((tip) => {
    assert.ok(tip.beadMm > tip.openingMm, `${tip.label} pipes narrower than its own hole`);
    // Derived from the opening rather than typed beside it, so the two can't drift.
    assert.equal(tip.beadMm, Math.round(tip.openingMm * 1.25 * 100) / 100);
  });
  for (let i = 1; i < ICING_TIPS.length; i++) {
    assert.ok(ICING_TIPS[i].beadMm > ICING_TIPS[i - 1].beadMm);
  }
});

test("each studio is offered its own tools under one shape", () => {
  assert.equal(toolsFor("ink").length, NEEDLE_GROUPINGS.length);
  assert.equal(toolsFor("sugar").length, ICING_TIPS.length);
  assert.equal(findTool("ink", "5rl")?.widthMm, 1.05);
  assert.equal(findTool("sugar", "pme2")?.widthMm, ICING_TIPS.find((tip) => tip.id === "pme2")!.beadMm);
  assert.equal(findTool("ink", "pme2"), undefined, "a piping tip is not a needle");
  assert.equal(findTool("sugar", "5rl"), undefined);
});

test("tool widths convert correctly across DPI", () => {
  const tip = findTool("sugar", "pme3")!;
  assert.equal(tip.widthMm, 2.5, "#3 pipes a 2.5mm bead");

  // 254 DPI is 10px/mm, 508 is 20px/mm, 25.4 is 1px/mm.
  assert.ok(Math.abs(toolWidthPx(tip.widthMm, 254) - 25) < 1e-9);
  assert.ok(Math.abs(toolWidthPx(tip.widthMm, 508) - 50) < 1e-9);
  assert.ok(Math.abs(toolWidthPx(tip.widthMm, 25.4) - 2.5) < 1e-9);

  // Doubling the DPI doubles the pixels, for every tool in both studios.
  for (const brand of ["ink", "sugar"] as const) {
    for (const tool of toolsFor(brand)) {
      assert.ok(
        Math.abs(toolWidthPx(tool.widthMm, 600) - 2 * toolWidthPx(tool.widthMm, 300)) < 1e-9,
        `${tool.label} does not scale with DPI`
      );
    }
  }
});

test("the profile has one width per point, always", () => {
  for (const count of [0, 1, 2, 3, 10, 97]) {
    assert.equal(strokeProfile(steady(count), 1, PX_PER_MM).length, count, `${count} points in`);
  }
});

test("width scales linearly with the grouping", () => {
  // A wandering stroke, so the profile is genuinely varying rather than flat.
  const wandering: Point[] = [
    { x: 0, y: 0 },
    { x: 2, y: 1 },
    { x: 12, y: 3 },
    { x: 14, y: 9 },
    { x: 30, y: 11 },
    { x: 31, y: 12 },
  ];
  const single = strokeProfile(wandering, 0.35, PX_PER_MM);
  const double = strokeProfile(wandering, 0.7, PX_PER_MM);
  const tenfold = strokeProfile(wandering, 3.5, PX_PER_MM);
  assert.ok(new Set(single.map((w) => w.toFixed(4))).size > 1, "the test stroke has to vary at all");
  single.forEach((width, i) => {
    assert.ok(Math.abs(double[i] - width * 2) < 1e-9, `point ${i}: ${double[i]} is not twice ${width}`);
    assert.ok(Math.abs(tenfold[i] - width * 10) < 1e-9, `point ${i}: ${tenfold[i]} is not ten times ${width}`);
  });
});

test("width scales linearly with resolution too", () => {
  const points = steady(8);
  const coarse = strokeProfile(points, 1, 5);
  const fine = strokeProfile(points, 1, 10);
  coarse.forEach((width, i) => assert.ok(Math.abs(fine[i] - width * 2) < 1e-9));
});

test("a steady hand lays a steady line", () => {
  const widths = strokeProfile(steady(12), 1, PX_PER_MM);
  widths.forEach((width) => assert.ok(Math.abs(width - 10) < 1e-9, `expected the nominal 10px, got ${width}`));
});

test("slowing down lays a wider line and speeding up a finer one", () => {
  // Sample spacing is the only speed signal there is: tight samples mean the
  // hand crawled, wide ones mean it swept.
  const points: Point[] = [];
  for (let i = 0; i < 6; i++) points.push({ x: i * 20, y: 0 }); // sweeping
  const sweptEnd = points[points.length - 1].x;
  for (let i = 1; i <= 6; i++) points.push({ x: sweptEnd + i * 2, y: 0 }); // crawling

  const widths = strokeProfile(points, 1, PX_PER_MM);
  const swept = widths[2];
  const crawled = widths[widths.length - 3];
  assert.ok(crawled > swept, `crawling ${crawled.toFixed(2)} should be fatter than sweeping ${swept.toFixed(2)}`);
});

test("width never runs away, however extreme the stroke", () => {
  const points: Point[] = [
    { x: 0, y: 0 },
    { x: 0, y: 0 }, // the needle stopped dead
    { x: 0, y: 0 },
    { x: 4000, y: 0 }, // and then jumped
    { x: 4001, y: 0 },
  ];
  const widths = strokeProfile(points, 1, PX_PER_MM);
  widths.forEach((width) => {
    assert.ok(Number.isFinite(width), "no infinities from a zero-length step");
    assert.ok(width >= 10 * 0.8 - 1e-9 && width <= 10 * 1.3 + 1e-9, `${width} is outside the swing`);
  });
});

test("a tool with no width lays nothing down", () => {
  assert.deepEqual(strokeProfile(steady(4), 0, PX_PER_MM), [0, 0, 0, 0]);
  assert.deepEqual(strokeProfile(steady(4), 1, 0), [0, 0, 0, 0]);
  assert.deepEqual(strokeProfile(steady(4), -2, PX_PER_MM), [0, 0, 0, 0]);
});

test("laying a stroke down gives it widths the ribbon renderer can use", () => {
  const plain = steady(6);
  assert.equal(hasVariableWidth(plain), false, "traced geometry starts with no widths");
  const laid = layDown(plain, 1, PX_PER_MM);
  assert.equal(hasVariableWidth(laid), true);
  assert.equal(laid.length, plain.length);
  laid.forEach((point, i) => {
    assert.equal(point.x, plain[i].x, "the path itself is untouched");
    assert.ok(point.w! > 0);
  });
});

test("changing the tool keeps how the stroke was drawn", () => {
  // A pen stroke: pressure rising then falling, independent of the tool.
  const drawn: Point[] = steady(7).map((point, i) => ({ ...point, w: 2 + i }));
  const fine = layDown(drawn, 0.35, PX_PER_MM);
  const heavy = layDown(drawn, 1.6, PX_PER_MM);

  const ratios = fine.map((point, i) => heavy[i].w! / point.w!);
  ratios.forEach((ratio) => assert.ok(Math.abs(ratio - 1.6 / 0.35) < 1e-9, "the tool sets the size"));

  // And the shape of the pressure is still there, not flattened out.
  for (let i = 1; i < heavy.length; i++) {
    assert.ok(heavy[i].w! > heavy[i - 1].w!, "the pressure ramp survived the tool change");
  }
});

test("partial pen data is treated as none", () => {
  const half: Point[] = steady(4).map((point, i) => (i < 2 ? { ...point, w: 5 } : point));
  const laid = layDown(half, 1, PX_PER_MM);
  const widths = strokeProfile(half, 1, PX_PER_MM);
  laid.forEach((point, i) => assert.equal(point.w, widths[i], "an ambiguous mix is not guessed at"));
});

test("a design finer than the tool reports what it has to grow by", () => {
  const heavy = findTool("ink", "9rl")!;
  assert.equal(scaleToTool(1.6, heavy), 1, "a design already at the tool's width fits");
  assert.equal(scaleToTool(0.8, heavy), 2, "half the width means twice the size");
  assert.equal(scaleToTool(3.2, heavy), 1, "a design coarser than the tool never shrinks");
  assert.equal(scaleToTool(0, heavy), 1, "no measurable line, no advice");
  assert.equal(scaleToTool(-1, heavy), 1);
});
