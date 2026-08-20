import { strict as assert } from "node:assert";
import { test } from "node:test";
import { findSurface } from "./curveWarp";
import {
  BAKE_COLORS,
  COATING_COLORS,
  SUBSTRATES,
  fitCheck,
  findSubstrate,
  outlinePath,
  printableAreaIn,
} from "./substrate";

const pop = findSubstrate("cakepop")!;
const cookie = findSubstrate("roundcookie")!;
const square = findSubstrate("squarecookie")!;

test("every substrate is complete and uniquely identified", () => {
  const ids = SUBSTRATES.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of SUBSTRATES) {
    assert.ok(s.label.trim().length > 0, `${s.id} label`);
    assert.ok(s.caption.trim().length > 0, `${s.id} caption`);
    assert.ok(s.widthIn > 0 && s.heightIn > 0, `${s.id} size`);
  }
});

test("every substrate names a surface the warp actually knows", () => {
  // A typo here would silently fall back to no curve at all, and the mockup
  // would show a flat sticker on a ball.
  for (const s of SUBSTRATES) {
    assert.ok(findSurface(s.surfaceId), `${s.id} points at unknown surface "${s.surfaceId}"`);
  }
});

test("a cake pop is a ball on a stick and a cookie is not", () => {
  assert.equal(pop.stick, true);
  assert.equal(cookie.stick, false);
  assert.equal(pop.frostingInset, null, "a coated ball has no separate frosting disc");
  assert.ok(cookie.frostingInset && cookie.frostingInset > 0);
});

test("frosting is smaller than the cookie it sits on", () => {
  const area = printableAreaIn(cookie);
  assert.ok(area.widthIn < cookie.widthIn, "a design sized to the cookie would overrun the icing");
  assert.ok(area.widthIn > cookie.widthIn * 0.5, "the inset should be a border, not a bullseye");
});

test("a bare surface is printable edge to edge", () => {
  assert.equal(printableAreaIn(pop).widthIn, pop.widthIn);
});

test("a design that fits says so and reports the room left", () => {
  const check = fitCheck(cookie, 1.5, 1);
  assert.equal(check.fits, true);
  assert.equal(check.reason, null);
  assert.ok(check.maxWidthIn > 1.5);
});

test("a design wider than the frosting is refused with a reason", () => {
  const check = fitCheck(cookie, 5, 1);
  assert.equal(check.fits, false);
  assert.ok(check.reason && check.reason.length > 0);
  assert.ok(check.maxWidthIn < 5);
});

test("a tall design is limited by height, not width", () => {
  // Aspect 3 means three times as tall as it is wide.
  const check = fitCheck(square, 2, 3);
  assert.equal(check.fits, false);
  assert.match(check.reason ?? "", /tall/i);
});

test("a ball refuses a design that wraps too far to apply in one piece", () => {
  const check = fitCheck(pop, 1.45, 1);
  assert.equal(check.fits, false);
  assert.match(check.reason ?? "", /wraps/i);
  assert.ok(check.maxWidthIn < pop.widthIn, "the limit has to be inside the diameter");
});

test("a flat cookie is not subject to the wrap limit", () => {
  assert.equal(fitCheck(square, printableAreaIn(square).widthIn, 1).fits, true);
});

test("the reported maximum actually fits", () => {
  for (const s of SUBSTRATES) {
    for (const aspect of [0.5, 1, 1.6]) {
      const max = fitCheck(s, 0.1, aspect).maxWidthIn;
      assert.equal(fitCheck(s, max, aspect).fits, true, `${s.id} at aspect ${aspect} rejects its own maximum`);
    }
  }
});

test("colour palettes are distinct and usable", () => {
  for (const palette of [BAKE_COLORS, COATING_COLORS]) {
    const ids = palette.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const entry of palette) {
      assert.match(entry.color, /^#[0-9a-f]{6}$/i, `${entry.id} is not a hex colour`);
      assert.ok(entry.label.trim().length > 0);
    }
  }
  assert.ok(COATING_COLORS.length >= 6, "she should have real colour choices");
});

test("every shape produces a closed path inside its box", () => {
  for (const shape of ["round", "square", "scalloped", "heart"] as const) {
    const d = outlinePath(shape, 100);
    assert.ok(d.length > 10, `${shape} produced nothing`);
    assert.ok(d.trim().endsWith("Z"), `${shape} is not closed`);
    const numbers = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    assert.ok(
      numbers.every((n) => n >= -30 && n <= 130),
      `${shape} strays well outside its box`
    );
  }
});

test("shapes scale with the box they are given", () => {
  assert.notEqual(outlinePath("round", 50), outlinePath("round", 100));
});
