import { strict as assert } from "node:assert";
import { test } from "node:test";
import { EXTRA_WIDE, WIDE, isWide, layoutFor } from "./breakpoints";

test("a phone is compact in either orientation", () => {
  assert.equal(layoutFor(393), "compact"); // iPhone portrait
  assert.equal(layoutFor(852), "compact"); // the same phone, landscape
});

test("a tablet and a laptop get the wide layout", () => {
  assert.equal(layoutFor(1024), "wide"); // iPad portrait
  assert.equal(layoutFor(1180), "wide"); // iPad landscape
});

test("a large desktop window earns a second column", () => {
  assert.equal(layoutFor(1440), "extraWide");
  assert.equal(layoutFor(1920), "extraWide");
});

test("the boundaries belong to the wider layout", () => {
  assert.equal(layoutFor(WIDE), "wide");
  assert.equal(layoutFor(WIDE - 1), "compact");
  assert.equal(layoutFor(EXTRA_WIDE), "extraWide");
});

test("isWide agrees with layoutFor", () => {
  for (const width of [320, 899, 900, 1279, 1280, 2000]) {
    assert.equal(isWide(width), layoutFor(width) !== "compact", `disagreed at ${width}`);
  }
});

test("a nonsense width does not crash the layout", () => {
  assert.equal(layoutFor(0), "compact");
  assert.equal(layoutFor(Number.NaN), "compact");
});
