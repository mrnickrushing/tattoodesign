import test from "node:test";
import assert from "node:assert/strict";
import { REMIX_VERBS, applyRemixVerb, hasRemixVerb, stripRemixVerbs } from "./remix";

const SIMPLER = REMIX_VERBS.find((verb) => verb.id === "simpler")!;
const BOLDER = REMIX_VERBS.find((verb) => verb.id === "bolder")!;

test("the verb table is well-formed", () => {
  assert.ok(REMIX_VERBS.length >= 4);
  const ids = REMIX_VERBS.map((verb) => verb.id);
  assert.equal(new Set(ids).size, ids.length, "ids unique");
  for (const verb of REMIX_VERBS) {
    assert.ok(verb.label.length > 0);
    assert.ok(verb.direction.length > 20, `${verb.id} direction should be a real sentence`);
    assert.ok(!verb.direction.includes("\n"), `${verb.id} direction must be one line`);
  }
});

test("a verb appends as its own line", () => {
  const prompt = applyRemixVerb("a swallow with a dagger", "simpler");
  assert.equal(prompt, `a swallow with a dagger\n${SIMPLER.direction}`);
  assert.ok(hasRemixVerb(prompt, "simpler"));
});

test("applying to an empty prompt yields just the direction", () => {
  assert.equal(applyRemixVerb("", "bolder"), BOLDER.direction);
});

test("verbs toggle: a second application removes the line", () => {
  const on = applyRemixVerb("a rose", "simpler");
  const off = applyRemixVerb(on, "simpler");
  assert.equal(off, "a rose");
  assert.ok(!hasRemixVerb(off, "simpler"));
});

test("multiple verbs compose and toggle independently", () => {
  let prompt = applyRemixVerb("a rose", "simpler");
  prompt = applyRemixVerb(prompt, "bolder");
  assert.ok(hasRemixVerb(prompt, "simpler"));
  assert.ok(hasRemixVerb(prompt, "bolder"));

  prompt = applyRemixVerb(prompt, "simpler");
  assert.ok(!hasRemixVerb(prompt, "simpler"));
  assert.ok(hasRemixVerb(prompt, "bolder"), "removing one leaves the other");
  assert.match(prompt, /^a rose\n/);
});

test("an unknown verb id changes nothing", () => {
  assert.equal(applyRemixVerb("a rose", "nope"), "a rose");
  assert.equal(hasRemixVerb("a rose", "nope"), false);
});

test("user text that merely mentions a verb's words is not mistaken for it", () => {
  const prompt = "make it simpler than the reference";
  assert.equal(hasRemixVerb(prompt, "simpler"), false);
  const toggled = applyRemixVerb(prompt, "simpler");
  assert.match(toggled, /^make it simpler than the reference\n/, "user line preserved");
});

test("stripRemixVerbs removes every verb line and nothing else", () => {
  let prompt = applyRemixVerb("a rose\nwith thorns", "simpler");
  prompt = applyRemixVerb(prompt, "pose");
  const stripped = stripRemixVerbs(prompt);
  assert.equal(stripped, "a rose\nwith thorns");
  assert.equal(stripRemixVerbs("plain prompt"), "plain prompt");
  assert.equal(stripRemixVerbs(""), "");
});
