import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  DEFAULT_SHADING,
  SHADING_STYLES,
  inkCoverage,
  shadeRegion,
  type Mask,
  type ShadingOptions,
  type ShadingStyle,
} from "./shading";

/** A solid rectangle inside a larger empty field. */
function box(width = 120, height = 120, inset = 20): Mask {
  const data = new Uint8Array(width * height);
  for (let y = inset; y < height - inset; y++) {
    for (let x = inset; x < width - inset; x++) data[y * width + x] = 1;
  }
  return { data, width, height };
}

function empty(width = 60, height = 60): Mask {
  return { data: new Uint8Array(width * height), width, height };
}

function opts(patch: Partial<ShadingOptions> = {}): ShadingOptions {
  return { ...DEFAULT_SHADING, ...patch };
}

const ALL: ShadingStyle[] = SHADING_STYLES.map((style) => style.id);

test("every style is offered with a label and a caption", () => {
  assert.equal(ALL.length, 5);
  for (const style of SHADING_STYLES) {
    assert.ok(style.label.length > 0);
    assert.ok(style.caption.length > 0);
  }
});

test("every style puts marks inside a region", () => {
  for (const style of ALL) {
    const strokes = shadeRegion(box(), opts({ style }));
    assert.ok(strokes.length > 0, `${style} produced nothing`);
  }
});

test("no style marks an empty region", () => {
  for (const style of ALL) {
    assert.deepEqual(shadeRegion(empty(), opts({ style })), [], `${style} marked nothing`);
  }
});

test("marks stay inside the region they were asked to fill", () => {
  const mask = box(120, 120, 20);
  for (const style of ALL) {
    for (const stroke of shadeRegion(mask, opts({ style }))) {
      for (const point of stroke.points) {
        assert.ok(
          point.x >= 18 && point.x <= 102 && point.y >= 18 && point.y <= 102,
          `${style} put a mark at ${point.x},${point.y}, outside the region`
        );
      }
    }
  }
});

test("higher density lays down more ink", () => {
  const mask = box();
  for (const style of ALL) {
    if (style === "solid") continue; // solid ignores density by design
    const light = inkCoverage(shadeRegion(mask, opts({ style, density: 0.15 })), mask);
    const heavy = inkCoverage(shadeRegion(mask, opts({ style, density: 0.9 })), mask);
    assert.ok(heavy > light * 1.4, `${style}: density did nothing (${light} vs ${heavy})`);
  }
});

test("solid is the darkest style at the same settings", () => {
  const mask = box();
  const solid = inkCoverage(shadeRegion(mask, opts({ style: "solid" })), mask);
  for (const style of ALL) {
    if (style === "solid") continue;
    const other = inkCoverage(shadeRegion(mask, opts({ style })), mask);
    assert.ok(solid > other, `solid (${solid}) should out-ink ${style} (${other})`);
  }
});

test("crosshatch lays down more than a single hatch", () => {
  const mask = box();
  const single = shadeRegion(mask, opts({ style: "hatch" })).length;
  const crossed = shadeRegion(mask, opts({ style: "crosshatch" })).length;
  assert.ok(crossed > single, `${crossed} should exceed ${single}`);
});

test("the same seed produces the same marks", () => {
  const mask = box();
  for (const style of ALL) {
    const a = shadeRegion(mask, opts({ style, seed: 7 }));
    const b = shadeRegion(mask, opts({ style, seed: 7 }));
    assert.deepEqual(a, b, `${style} is not reproducible`);
  }
});

test("a different seed reshuffles the styles that are random", () => {
  const mask = box();
  for (const style of ["whip", "pepper"] as ShadingStyle[]) {
    const a = shadeRegion(mask, opts({ style, seed: 1 }));
    const b = shadeRegion(mask, opts({ style, seed: 2 }));
    assert.notDeepEqual(a, b, `${style} ignored the seed`);
  }
});

test("angle rotates the hatch", () => {
  const mask = box();
  const flat = shadeRegion(mask, opts({ style: "hatch", angle: 0 }))[0];
  const steep = shadeRegion(mask, opts({ style: "hatch", angle: 90 }))[0];
  const run = (stroke: typeof flat) => Math.abs(stroke.points[1].x - stroke.points[0].x);
  const rise = (stroke: typeof flat) => Math.abs(stroke.points[1].y - stroke.points[0].y);
  assert.ok(run(flat) > rise(flat), "a 0-degree hatch should run horizontally");
  assert.ok(rise(steep) > run(steep), "a 90-degree hatch should run vertically");
});

test("whip strokes taper to nothing", () => {
  const strokes = shadeRegion(box(), opts({ style: "whip", weight: 4 }));
  const tapered = strokes.find((stroke) => stroke.points.length > 2);
  assert.ok(tapered, "whip shading should produce multi-point strokes");
  const head = tapered.points[0].w ?? 0;
  const tail = tapered.points[tapered.points.length - 1].w ?? 0;
  assert.ok(head > tail * 3, `expected a taper, got ${head} to ${tail}`);
});

test("pepper dots are single points, so they render as discs", () => {
  const strokes = shadeRegion(box(), opts({ style: "pepper" }));
  assert.ok(strokes.every((stroke) => stroke.points.length === 1));
});

test("marks are never thinner than a printable hairline", () => {
  for (const style of ALL) {
    for (const stroke of shadeRegion(box(), opts({ style, weight: 1 }))) {
      for (const point of stroke.points) assert.ok((point.w ?? stroke.width) > 0);
    }
  }
});

test("marks never pack closer than their own weight", () => {
  // Below that they merge into a flat fill and stop reading as shading.
  // Measured at 0 degrees, where each line's y IS its perpendicular offset —
  // at any other angle the y values are a diagonal walk, not the spacing.
  const mask = box(200, 200, 10);
  const strokes = shadeRegion(mask, opts({ style: "hatch", angle: 0, weight: 6, density: 1 }));
  const rows = [...new Set(strokes.map((stroke) => Math.round(stroke.points[0].y * 100) / 100))].sort(
    (a, b) => a - b
  );
  const gaps = rows.slice(1).map((value, i) => value - rows[i]);
  assert.ok(gaps.length > 4, "not enough lines to judge spacing");
  assert.ok(Math.min(...gaps) >= 6, `lines packed to ${Math.min(...gaps)} at weight 6`);
});

test("a malformed mask is refused rather than read out of bounds", () => {
  assert.deepEqual(shadeRegion({ data: new Uint8Array(10), width: 7, height: 7 }, opts()), []);
  assert.deepEqual(shadeRegion({ data: new Uint8Array(0), width: 0, height: 0 }, opts()), []);
});

test("ink coverage of nothing is zero, not NaN", () => {
  assert.equal(inkCoverage([], box()), 0);
  assert.equal(inkCoverage(shadeRegion(box(), opts()), empty()), 0);
});
