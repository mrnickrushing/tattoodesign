// The plan — which bands get marks, in what style, in what order — decides
// what a stencil is made of, so it lives in tone.ts where no Skia import can
// keep it from being tested. toneSeparate.ts is only the pixel bridge.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { MAX_BANDS, MIN_BANDS, defaultPlan } from "./tone";

test("the default plan inks the dark end and leaves the light end as paper", () => {
  const plan = defaultPlan(4);
  assert.equal(plan.passes.length, 4);
  assert.ok(plan.passes[0].shading, "the core should always be inked");
  assert.equal(plan.passes[3].shading, null, "the lightest band should stay paper");
});

test("the core band is solid and the one above it is whipped", () => {
  const plan = defaultPlan(4);
  assert.equal(plan.passes[0].shading?.style, "solid");
  assert.equal(plan.passes[1].shading?.style, "whip");
});

test("a plan defaults to balanced bands", () => {
  // Even bands say nothing about a photo shot in flat light; see tone.ts.
  assert.equal(defaultPlan().strategy, "balanced");
});

test("band counts are clamped to what a stencil can separate", () => {
  assert.equal(defaultPlan(0).passes.length, MIN_BANDS);
  assert.equal(defaultPlan(50).passes.length, MAX_BANDS);
});

test("a two-band plan still inks something", () => {
  const plan = defaultPlan(2);
  assert.equal(plan.passes.length, 2);
  assert.ok(plan.passes.some((pass) => pass.shading), "no plan should produce a blank stencil");
});

test("a coarse plan skips the pepper pass rather than crowding three techniques in", () => {
  assert.equal(defaultPlan(3).passes[2].shading, null);
  assert.equal(defaultPlan(5).passes[2].shading?.style, "pepper");
});

test("every band that gets marks gets its own seed", () => {
  const seeds = defaultPlan(MAX_BANDS)
    .passes.map((pass) => pass.shading?.seed)
    .filter((seed): seed is number => typeof seed === "number");
  assert.equal(new Set(seeds).size, seeds.length, "shared seeds would align the marks between bands");
});
