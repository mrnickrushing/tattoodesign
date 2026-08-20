import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  GELS,
  colourDistance,
  describeRecipe,
  parseHex,
  recipeFor,
  tintStrength,
} from "./icingRecipe";

test("hex parses in both lengths and rejects nonsense", () => {
  assert.deepEqual(parseHex("#ff0000"), { r: 255, g: 0, b: 0 });
  assert.deepEqual(parseHex("f0a"), { r: 255, g: 0, b: 170 });
  assert.deepEqual(parseHex("  #00FF00 "), { r: 0, g: 255, b: 0 });
  assert.equal(parseHex("nope"), null);
  assert.equal(parseHex("#12345"), null);
});

test("every gel in the shelf is a valid colour", () => {
  const ids = GELS.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate gel ids");
  for (const gel of GELS) {
    assert.ok(parseHex(gel.hex), `${gel.id} has an unparseable hex`);
    assert.ok(gel.name.trim().length > 0);
  }
});

test("distance is zero for a colour against itself", () => {
  const red = parseHex("#ed2939")!;
  assert.equal(colourDistance(red, red), 0);
});

test("tint strength runs from white to black", () => {
  assert.equal(tintStrength({ r: 255, g: 255, b: 255 }), 0);
  assert.ok(Math.abs(tintStrength({ r: 0, g: 0, b: 0 }) - 1) < 1e-9);
  const mid = tintStrength({ r: 128, g: 128, b: 128 });
  assert.ok(mid > 0.2 && mid < 0.8, `mid grey landed at ${mid}`);
});

test("a colour near white is left untinted rather than given a token drop", () => {
  const recipe = recipeFor("#fdfdfd")!;
  assert.deepEqual(recipe.parts, []);
  assert.match(describeRecipe(recipe), /no tint/i);
});

test("each gel resolves to itself", () => {
  // The most basic sanity check there is: asking for the colour on the bottle
  // should name that bottle.
  for (const gel of GELS) {
    const recipe = recipeFor(gel.hex);
    assert.ok(recipe, `${gel.id} produced no recipe`);
    const named = recipe.parts.map((p) => p.gel.id);
    assert.ok(named.includes(gel.id), `${gel.name} suggested ${named.join("+")} instead`);
  }
});

test("a deep colour needs more gel than a pale one", () => {
  const pale = recipeFor("#f7d4de")!;
  const deep = recipeFor("#c2185b")!;
  const total = (r: typeof pale) => r.parts.reduce((sum, p) => sum + p.drops, 0);
  assert.ok(total(deep) > total(pale), `${total(deep)} should exceed ${total(pale)}`);
});

test("drop counts scale with the amount of icing", () => {
  const one = recipeFor("#c2185b", 1)!;
  const four = recipeFor("#c2185b", 4)!;
  const total = (r: typeof one) => r.parts.reduce((sum, p) => sum + p.drops, 0);
  assert.ok(total(four) > total(one) * 2, "four cups should need substantially more");
});

test("never more than two bottles", () => {
  // A third bottle is where colour mixing stops being repeatable.
  for (const hex of ["#c2185b", "#7e57c2", "#00897b", "#5d4037", "#37474f", "#ffab40"]) {
    assert.ok(recipeFor(hex)!.parts.length <= 2, `${hex} asked for three or more`);
  }
});

test("drops are always a usable quantity", () => {
  for (const hex of ["#c2185b", "#f4a6c0", "#1a1a1a", "#6ec6e8"]) {
    for (const part of recipeFor(hex)!.parts) {
      assert.ok(part.drops >= 0.5, `${hex} suggested ${part.drops} drops`);
      assert.equal(part.drops * 2, Math.round(part.drops * 2), "drops should land on a half");
    }
  }
});

test("a close match reads as more confident than a far one", () => {
  const exact = recipeFor("#ed2939")!;
  const odd = recipeFor("#7a8b3c")!;
  assert.ok(exact.closeness > odd.closeness, `${exact.closeness} vs ${odd.closeness}`);
  for (const r of [exact, odd]) assert.ok(r.closeness >= 0 && r.closeness <= 1);
});

test("deep shades are told to wait rather than to add more", () => {
  assert.match(recipeFor("#1a1a1a")!.note, /hour|develop/i);
  assert.match(recipeFor("#f4a6c0")!.note, /sit|rest|darken/i);
});

test("the summary reads like something you could follow", () => {
  const text = describeRecipe(recipeFor("#c2185b", 2)!);
  assert.match(text, /drops/);
  assert.match(text, /per 2 cups/);
});

test("an unparseable colour returns nothing rather than guessing", () => {
  assert.equal(recipeFor("not a colour"), null);
});
