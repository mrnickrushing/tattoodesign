import { strict as assert } from "node:assert";
import { test } from "node:test";
import { healedAge, healingStage, recordsFor, type HealedRecord } from "./healedAge";

const DAY = 86_400_000;
const INKED = 1_700_000_000_000;

const shot = (daysAfter: number, designId = "a"): HealedRecord => ({
  id: `r${daysAfter}`,
  designId,
  file: "f.png",
  inkedAt: INKED,
  at: INKED + daysAfter * DAY,
});

test("records are filtered to one design", () => {
  const all = [shot(1, "a"), shot(2, "b"), shot(3, "a")];
  assert.equal(recordsFor(all, "a").length, 2);
  assert.equal(recordsFor(all, "missing").length, 0);
});

test("a timeline reads forwards", () => {
  const out = recordsFor([shot(30), shot(2), shot(400)], "a");
  assert.deepEqual(out.map((r) => r.at), [shot(2).at, shot(30).at, shot(400).at]);
});

test("the unit shifts with the age, the way healing is talked about", () => {
  assert.equal(healedAge(shot(0)), "the same day");
  assert.equal(healedAge(shot(1)), "1 day after");
  assert.equal(healedAge(shot(12)), "12 days after");
  assert.match(healedAge(shot(42)), /weeks after/);
  assert.match(healedAge(shot(180)), /months after/);
  assert.match(healedAge(shot(1100)), /years after/);
});

test("a photo taken before the session does not read as negative", () => {
  // Clocks drift and dates get typed wrong; neither should produce "-3 days".
  const backwards: HealedRecord = { ...shot(1), at: INKED - 5 * DAY };
  assert.equal(healedAge(backwards), "the same day");
});

test("stages line up with the ages the simulation offers", () => {
  assert.equal(healingStage(shot(3)), "fresh");
  assert.equal(healingStage(shot(29)), "fresh");
  assert.equal(healingStage(shot(90)), "settled");
  assert.equal(healingStage(shot(700)), "settled");
  assert.equal(healingStage(shot(800)), "aged");
});

test("every age produces a sentence rather than a number", () => {
  for (const days of [0, 1, 5, 20, 21, 89, 90, 365, 729, 730, 3000]) {
    const text = healedAge(shot(days));
    assert.ok(text.length > 3, `${days} gave "${text}"`);
    assert.doesNotMatch(text, /NaN|undefined|-/);
  }
});
