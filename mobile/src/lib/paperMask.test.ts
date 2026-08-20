import { strict as assert } from "node:assert";
import { test } from "node:test";
import { paperAlpha, profilePaper } from "./paperMask";

const W = 60;
const H = 60;

/** A dark blob centred on a field of `ground`. */
function art(ground: number, ink = 10, inset = 18): Uint8Array {
  const g = new Uint8Array(W * H).fill(ground);
  for (let y = inset; y < H - inset; y++) {
    for (let x = inset; x < W - inset; x++) g[y * W + x] = ink;
  }
  return g;
}

test("pure white paper is found", () => {
  const profile = profilePaper(art(255), W, H);
  assert.ok(profile.paper > 240, `got ${profile.paper}`);
  assert.equal(paperAlpha(255, profile), 0, "white must vanish");
  assert.equal(paperAlpha(10, profile), 1, "ink must stay");
});

test("cream paper is found too", () => {
  // The case a hardcoded #ffffff cutoff misses entirely.
  const profile = profilePaper(art(226), W, H);
  assert.equal(paperAlpha(226, profile), 0, "the cream ground must vanish");
  assert.equal(paperAlpha(10, profile), 1);
});

test("the edge between them fades rather than stopping dead", () => {
  const profile = profilePaper(art(255), W, H);
  const midway = (profile.paper + profile.solid) / 2;
  const alpha = paperAlpha(midway, profile);
  assert.ok(alpha > 0.2 && alpha < 0.8, `expected a ramp, got ${alpha}`);
});

test("alpha never leaves the 0..1 range", () => {
  const profile = profilePaper(art(255), W, H);
  for (const value of [0, 60, 128, 200, 246, 255]) {
    const alpha = paperAlpha(value, profile);
    assert.ok(alpha >= 0 && alpha <= 1, `${value} gave ${alpha}`);
  }
});

test("alpha falls as the pixel gets lighter", () => {
  const profile = profilePaper(art(255), W, H);
  let previous = 1;
  for (let value = 0; value <= 255; value += 5) {
    const alpha = paperAlpha(value, profile);
    assert.ok(alpha <= previous + 1e-9, `alpha rose at ${value}`);
    previous = alpha;
  }
});

test("ink touching one edge does not get mistaken for the background", () => {
  // A median shrugs off a design that runs off one side; a mean would not.
  const g = art(255);
  for (let y = 0; y < H; y++) for (let x = 0; x < 4; x++) g[y * W + x] = 5;
  const profile = profilePaper(g, W, H);
  assert.ok(profile.paper > 200, `the ink dragged the paper level to ${profile.paper}`);
  assert.equal(paperAlpha(5, profile), 1, "that ink must survive");
});

test("a dark image is never read as dark paper", () => {
  // Otherwise a design on a black ground would erase its own linework.
  const profile = profilePaper(art(20, 250), W, H);
  assert.ok(profile.paper >= 170, `paper level collapsed to ${profile.paper}`);
  assert.equal(paperAlpha(20, profile), 1, "dark pixels must stay opaque");
});

test("an empty image produces a usable profile rather than NaN", () => {
  const profile = profilePaper(new Uint8Array(0), 0, 0);
  assert.ok(Number.isFinite(profile.paper) && Number.isFinite(profile.solid));
  assert.ok(profile.solid < profile.paper);
});

test("the fade scales with the distance from ink to paper", () => {
  // An antialiased edge spreads across that whole distance, so the ramp has to
  // track it. On cream the span is shorter and the ramp narrows with it — a
  // fixed ramp would be too wide there and would eat real ink.
  const white = profilePaper(art(255), W, H);
  const cream = profilePaper(art(210), W, H);
  assert.ok(
    cream.paper - cream.solid < white.paper - white.solid,
    "a shorter span should give a narrower ramp"
  );
  // ...but never so narrow that it becomes a hard cutoff again.
  assert.ok(cream.paper - cream.solid >= 40, "the ramp collapsed to a threshold");
});
