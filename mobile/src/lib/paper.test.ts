import test from "node:test";
import assert from "node:assert/strict";
import { grainAt, grainField, vignetteAlpha, type GrainField } from "./paper";

function close(actual: number, expected: number, label: string) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: expected ${expected}, got ${actual}`);
}

function variance(values: Float32Array) {
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  return values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;
}

test("paper grain is byte-identical for a fixed kind and seed", () => {
  const first = grainField("flash", 42);
  const second = grainField("flash", 42);
  assert.deepEqual(first, second);
});

test("paper grain changes when its seed changes", () => {
  assert.notDeepEqual(grainField("parchment", 41).values, grainField("parchment", 42).values);
});

test("paper grain stays within its normalized range", () => {
  for (const kind of ["flash", "parchment"] as const) {
    for (const value of grainField(kind, 8).values) {
      assert.ok(value >= 0 && value <= 1, `${kind} value ${value} is outside [0, 1]`);
    }
  }
});

test("flash paper has more visible variation than parchment", () => {
  const flash = variance(grainField("flash", 27).values);
  const parchment = variance(grainField("parchment", 27).values);
  assert.ok(flash > parchment, `expected flash variance ${flash} to exceed parchment ${parchment}`);
});

test("grainAt bilinearly samples a hand-built field", () => {
  const field: GrainField = { width: 2, height: 2, values: new Float32Array([0, 0.25, 0.75, 1]) };
  close(grainAt(field, 0.5, 0.5), 0.5, "centre sample");
  close(grainAt(field, 0.25, 0), 0.0625, "horizontal sample");
});

test("grainAt clamps samples outside the field", () => {
  const field: GrainField = { width: 2, height: 2, values: new Float32Array([0.1, 0.2, 0.3, 0.4]) };
  close(grainAt(field, -100, 20), 0.3, "bottom-left clamp");
  close(grainAt(field, 20, -100), 0.2, "top-right clamp");
});

test("vignette alpha rises from the centre to a corner", () => {
  const centre = vignetteAlpha(50, 50, 100, 100, 0.8);
  const middle = vignetteAlpha(75, 75, 100, 100, 0.8);
  const corner = vignetteAlpha(100, 100, 100, 100, 0.8);
  close(centre, 0, "centre");
  assert.ok(middle > centre);
  assert.ok(corner > middle);
  close(corner, 0.8, "corner");
});

test("vignette alpha is zero when strength is zero", () => {
  assert.equal(vignetteAlpha(100, 100, 100, 100, 0), 0);
});
