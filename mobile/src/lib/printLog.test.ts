import { strict as assert } from "node:assert";
import { test } from "node:test";
import { describeAge, printsOf, summarisePrints, type PrintRecord } from "./printLog";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const entry = (patch: Partial<PrintRecord> = {}): PrintRecord => ({
  id: Math.random().toString(36),
  label: "Sheet",
  at: 1_000_000,
  ...patch,
});

test("prints are filtered to one design", () => {
  const log = [entry({ designId: "a" }), entry({ designId: "b" }), entry({ designId: "a" })];
  assert.equal(printsOf(log, "a").length, 2);
  assert.equal(printsOf(log, "missing").length, 0);
});

test("a sheet print belongs to no single design", () => {
  assert.equal(printsOf([entry()], "a").length, 0);
});

test("a design never printed has no history to show", () => {
  assert.equal(summarisePrints([], "a"), null);
  assert.equal(summarisePrints([entry({ designId: "b" })], "a"), null);
});

test("the summary leads with the size, which is the thing being reproduced", () => {
  const now = 1_000_000 + 2 * HOUR;
  const text = summarisePrints([entry({ designId: "a", widthIn: 3.25, at: 1_000_000 })], "a", now)!;
  assert.match(text, /3\.25in/);
  assert.match(text, /2h ago/);
  assert.match(text, /Printed once/);
});

test("repeat prints are counted", () => {
  const log = [
    entry({ designId: "a", widthIn: 4, at: 2_000_000 }),
    entry({ designId: "a", widthIn: 3, at: 1_000_000 }),
  ];
  const text = summarisePrints(log, "a", 2_000_000)!;
  assert.match(text, /Printed 2×/);
  // The newest is the one worth reproducing.
  assert.match(text, /4\.00in/);
});

test("a print with no recorded size says so rather than inventing one", () => {
  const text = summarisePrints([entry({ designId: "a", at: 1_000_000 })], "a", 1_000_000)!;
  assert.match(text, /unrecorded/);
});

test("ages read the way people say them", () => {
  assert.equal(describeAge(5_000), "just now");
  assert.equal(describeAge(5 * 60_000), "5m ago");
  assert.equal(describeAge(3 * HOUR), "3h ago");
  assert.equal(describeAge(5 * DAY), "5d ago");
  assert.equal(describeAge(90 * DAY), "3mo ago");
  assert.equal(describeAge(800 * DAY), "2y ago");
});

test("age never runs backwards or reads oddly at the boundaries", () => {
  assert.equal(describeAge(0), "just now");
  assert.equal(describeAge(59_999), "just now");
  assert.equal(describeAge(60_000), "1m ago");
  assert.equal(describeAge(59 * 60_000), "59m ago");
  assert.equal(describeAge(60 * 60_000), "1h ago");
});
