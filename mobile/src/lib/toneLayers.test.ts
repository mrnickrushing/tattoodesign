import test from "node:test";
import assert from "node:assert/strict";
import { scalePoints, shadingLayersFrom } from "./toneLayers";
import { DEFAULT_SHADING, type ShadingOptions } from "./shading";
import type { SeparationPlan } from "./tone";

const W = 40;
const H = 24;

/**
 * Horizontal marks packed as tightly as the weight allows.
 *
 * Sweep lines are spaced from the middle of the image outward, and at the
 * default density they sit thirteen pixels apart — wide enough that a band a
 * few rows tall catches no line at all and looks, from the outside, exactly
 * like a band that was skipped. Full density puts a line in every region these
 * fixtures build, so a layer's absence means something.
 */
const HATCH = { style: "hatch", angle: 0, density: 1 } as const;

/**
 * A plan with a pass on exactly the bands named, and nothing on the rest.
 *
 * `even` banding so the cuts are known rather than sampled: four bands split
 * 0-255 at 64, 128 and 192, which lets a fixture put a pixel in a band by
 * choosing its grey.
 */
function planFor(passes: Record<number, Partial<ShadingOptions>>, bands = 4): SeparationPlan {
  return {
    bands,
    strategy: "even",
    passes: Array.from({ length: bands }, (_, band) => ({
      shading: passes[band] ? { ...DEFAULT_SHADING, ...passes[band] } : null,
    })),
  };
}

/** An image of one flat grey. */
function flat(value: number): Uint8Array {
  return new Uint8Array(W * H).fill(value);
}

/**
 * Four horizontal stripes, one per band, darkest at the top.
 *
 * Contiguous on purpose: marks are laid along swept lines and a run under two
 * pixels is skipped, so a fixture speckled band-by-band produces no marks at
 * all and tests nothing about which band they came from.
 */
function stripes(): Uint8Array {
  const gray = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const value = [10, 74, 138, 202][Math.min(3, Math.floor(y / (H / 4)))];
    for (let x = 0; x < W; x++) gray[y * W + x] = value;
  }
  return gray;
}

/** Dark on the left, one band lighter on the right. */
function split(left: number, right: number): Uint8Array {
  const gray = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) gray[y * W + x] = x < W / 2 ? left : right;
  }
  return gray;
}

test("a stroke scales onto the canvas whole — width along with position", () => {
  const scaled = scalePoints([{ x: 3, y: 4, w: 2 }], 2.5);
  assert.deepEqual(scaled, [{ x: 7.5, y: 10, w: 5 }]);
});

test("a point with no width of its own does not acquire one", () => {
  // The per-point width is optional, and multiplying an absent one gives NaN —
  // which reaches the renderer as a stroke of no width at all. The point has to
  // come back without the key, not with a broken one.
  const scaled = scalePoints([{ x: 1, y: 1 }], 3);
  assert.equal("w" in scaled[0], false, `picked up w=${(scaled[0] as { w?: number }).w}`);
  assert.deepEqual(scaled, [{ x: 3, y: 3 }]);
});

test("only the bands the plan asks for become layers", () => {
  // A four-band plan over an image with pixels in every band, but marks asked
  // for on one: one layer out, named for that band.
  const result = shadingLayersFrom(stripes(), W, H, planFor({ 1: HATCH }), W, H);
  assert.equal(result.layers.length, 1);
  assert.match(result.layers[0].name, /^Shadow · hatch$/);
});

test("the darkest band ends up on top of the stack", () => {
  // Layers paint in array order, so the last one is the topmost — see
  // projectToSvg. Ink goes down lightest first, and the core black has to end
  // up over the mid tone rather than under it.
  const plan = planFor({ 0: HATCH, 1: HATCH, 2: HATCH });
  const names = shadingLayersFrom(stripes(), W, H, plan, W, H).layers.map((layer) => layer.name);
  assert.deepEqual(names, ["Mid tone · hatch", "Shadow · hatch", "Core black · hatch"]);
});

test("a band's pass covers everything at least that dark", () => {
  // Dark on the left, a band lighter on the right, and marks asked for on the
  // lighter band only. Ink accumulates: whatever is dark enough for the mid
  // tone got the mid-tone pass too, so a horizontal mark spans the whole row.
  // Masking each band alone would leave the left half bare and read lighter
  // than the shadow beside it, which is backwards.
  const plan = planFor({ 1: HATCH });
  const result = shadingLayersFrom(split(10, 100), W, H, plan, W, H);
  assert.equal(result.layers.length, 1);

  let leftmost = Infinity;
  let rightmost = -Infinity;
  for (const stroke of result.layers[0].strokes) {
    for (const point of stroke.points) {
      leftmost = Math.min(leftmost, point.x);
      rightmost = Math.max(rightmost, point.x);
    }
  }
  assert.ok(leftmost < W / 2 - 1, `marks start at x=${leftmost} — the darker half was left bare`);
  assert.ok(rightmost > W / 2, `marks stop at x=${rightmost}`);
});

test("a band with nothing at or below it produces no layer at all", () => {
  // Every pixel in the lightest band, and passes asked for on two darker ones.
  // Because bands are cumulative, "empty" means nothing that dark *or darker* —
  // so both come back with nothing to mark. An empty layer in the stack is a
  // row in the layers panel that does nothing and cannot be told apart from one
  // that failed.
  const plan = planFor({ 0: HATCH, 2: HATCH });
  assert.deepEqual(shadingLayersFrom(flat(200), W, H, plan, W, H), { layers: [], marks: 0 });

  // And the same plan over an image that *is* that dark marks both.
  assert.equal(shadingLayersFrom(flat(10), W, H, plan, W, H).layers.length, 2);
});

test("the marks reported are the marks laid down", () => {
  const plan = planFor({ 0: HATCH, 1: { style: "whip", seed: 5, density: 1 } });
  const result = shadingLayersFrom(split(10, 100), W, H, plan, W, H);
  const counted = result.layers.reduce((sum, layer) => sum + layer.strokes.length, 0);
  assert.ok(counted > 0, "the fixture produced no marks to count");
  assert.equal(result.marks, counted);
});

test("analysis resolution does not leak into the result", () => {
  // The whole point of analysing small: the same marks, scaled. A canvas twice
  // as wide gets everything at exactly twice the size — positions and widths
  // alike — and never a hint of the resolution they were found at.
  const gray = split(10, 100);
  const plan = planFor({ 0: HATCH, 1: { style: "whip", seed: 5, density: 1 } });

  const once = shadingLayersFrom(gray, W, H, plan, W, H);
  const twice = shadingLayersFrom(gray, W, H, plan, W * 2, H * 2);

  assert.equal(twice.layers.length, once.layers.length);
  for (let i = 0; i < once.layers.length; i++) {
    const a = once.layers[i];
    const b = twice.layers[i];
    assert.equal(b.strokes.length, a.strokes.length, `layer ${a.name} found different marks at a different canvas size`);
    assert.deepEqual({ width: b.transform.width, height: b.transform.height }, { width: W * 2, height: H * 2 });
    for (let s = 0; s < a.strokes.length; s++) {
      assert.equal(b.strokes[s].width, a.strokes[s].width * 2, `mark ${s} of ${a.name} did not scale its width`);
      assert.deepEqual(
        b.strokes[s].points,
        a.strokes[s].points.map((point) => ({ x: point.x * 2, y: point.y * 2, ...(typeof point.w === "number" ? { w: point.w * 2 } : {}) })),
        `mark ${s} of ${a.name} did not scale its path`
      );
    }
  }
});

test("a mark never scales down to nothing", () => {
  // A canvas far smaller than the analysis takes every width below a printable
  // hairline. It gets held at one, because a mark that renders as zero pixels
  // is a mark the artist drew and cannot see.
  const plan = planFor({ 0: HATCH });
  const result = shadingLayersFrom(flat(10), W, H, plan, 2, 2);
  assert.ok(result.layers.length > 0);
  for (const stroke of result.layers[0].strokes) {
    assert.ok(stroke.width >= 0.5, `a mark came out ${stroke.width} wide`);
  }
});

test("what comes back is a stroke layer the editor can take", () => {
  const plan = planFor({ 0: HATCH, 1: { style: "whip", seed: 5, density: 1 } });
  const result = shadingLayersFrom(split(10, 100), W, H, plan, 800, 600);

  const ids = new Set<string>();
  for (const layer of result.layers) {
    assert.equal(layer.kind, "stroke");
    assert.equal(layer.visible, true);
    assert.equal(layer.locked, false);
    assert.deepEqual(layer.transform, { x: 0, y: 0, width: 800, height: 600, rotation: 0, scaleX: 1, scaleY: 1 });
    assert.equal(ids.has(layer.id), false, "two layers share an id");
    ids.add(layer.id);
    for (const stroke of layer.strokes) {
      assert.equal(stroke.mode, "draw", "shading laid down as an eraser");
      assert.equal(stroke.opacity, 1);
      assert.ok(stroke.points.length > 0);
    }
  }
});

test("a plan with more bands than names still names its layers", () => {
  // BAND_NAMES runs out at six. A seventh band is a band, not a layer called
  // "undefined".
  const plan = planFor({ 6: HATCH }, 7);
  const result = shadingLayersFrom(flat(10), W, H, plan, W, H);
  assert.equal(result.layers.length, 1);
  assert.equal(result.layers[0].name, "Band 7 · hatch");
});
