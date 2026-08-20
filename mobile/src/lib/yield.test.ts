import { strict as assert } from "node:assert";
import { test } from "node:test";
import { estimateYield, splitByColour } from "./yield";

const order = (patch: Partial<Parameters<typeof estimateYield>[0]> = {}) =>
  estimateYield({
    quantity: 48,
    widthIn: 3,
    heightIn: 3,
    sheetWidthIn: 8.5,
    sheetHeightIn: 11,
    ...patch,
  });

test("a real order produces usable numbers", () => {
  const est = order()!;
  assert.ok(est.perSheet > 0, "nothing fit on a sheet");
  assert.equal(est.sheets, Math.ceil(48 / est.perSheet));
  assert.ok(est.floodCups > 0);
  assert.ok(est.pipingCups > 0);
});

test("sheets round up, because you cannot print most of one", () => {
  const est = order({ quantity: 1 })!;
  assert.equal(est.sheets, 1);
});

test("the spare count explains the rounding", () => {
  const est = order()!;
  assert.equal(est.spareOnLastSheet, est.sheets * est.perSheet - 48);
  assert.ok(est.spareOnLastSheet >= 0 && est.spareOnLastSheet < est.perSheet);
});

test("you are told to buy more sheets than you print", () => {
  // A ruined transfer mid-batch otherwise means stopping to print again.
  const est = order()!;
  assert.ok(est.sheetsToBuy > est.sheets);
});

test("piping needs less than flooding", () => {
  const est = order()!;
  assert.ok(est.pipingCups < est.floodCups, "an outline is a line, not a fill");
});

test("more cookies need more icing", () => {
  assert.ok(order({ quantity: 96 })!.floodCups > order({ quantity: 48 })!.floodCups);
});

test("bigger cookies need more icing at the same count", () => {
  assert.ok(order({ widthIn: 4, heightIn: 4 })!.floodCups > order()!.floodCups);
});

test("coverage changes the icing but not the sheets", () => {
  const light = order({ floodCoverage: 0.4 })!;
  const full = order({ floodCoverage: 1 })!;
  assert.ok(full.floodCups > light.floodCups);
  assert.equal(full.sheets, light.sheets);
});

test("coverage outside 0..1 is clamped rather than trusted", () => {
  assert.equal(order({ floodCoverage: 5 })!.floodCups, order({ floodCoverage: 1 })!.floodCups);
  assert.ok(order({ floodCoverage: -2 })!.floodCups > 0);
});

test("icing lands on a quarter cup, which is what people measure", () => {
  for (const quantity of [3, 12, 48, 200]) {
    const est = order({ quantity })!;
    assert.equal(est.floodCups * 4, Math.round(est.floodCups * 4), `${quantity} gave ${est.floodCups}`);
    assert.ok(est.floodCups >= 0.25);
  }
});

test("a cookie too big for the sheet is refused, not rounded down", () => {
  assert.equal(order({ widthIn: 20, heightIn: 20 }), null);
});

test("nonsense input returns nothing rather than a fabricated number", () => {
  assert.equal(order({ quantity: 0 }), null);
  assert.equal(order({ quantity: Number.NaN }), null);
  assert.equal(order({ widthIn: -3 }), null);
  assert.equal(order({ sheetHeightIn: 0 }), null);
});

test("colour weights are relative, not fractions", () => {
  // "Mostly pink with a bit of white" is how an order is actually described.
  const split = splitByColour(4, [
    { id: "pink", label: "Pink", weight: 3 },
    { id: "white", label: "White", weight: 1 },
  ]);
  assert.ok(split[0].cups > split[1].cups);
  assert.ok(Math.abs(split[0].cups + split[1].cups - 4) <= 0.5);
});

test("weights that sum to zero give zero rather than dividing by it", () => {
  const split = splitByColour(4, [{ id: "a", label: "A", weight: 0 }]);
  assert.equal(split[0].cups, 0);
});

test("a negative weight cannot steal from the others", () => {
  const split = splitByColour(4, [
    { id: "a", label: "A", weight: 1 },
    { id: "b", label: "B", weight: -5 },
  ]);
  assert.ok(split.every((entry) => entry.cups >= 0));
});
