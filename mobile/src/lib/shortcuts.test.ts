import { strict as assert } from "node:assert";
import { test } from "node:test";
import { SHORTCUTS, arrowDelta, isTyping, matches, nudgeStep, type KeyEventLike } from "./shortcuts";

const press = (key: string, extra: Partial<KeyEventLike> = {}): KeyEventLike => ({ key, ...extra });

test("the modifier matches Cmd and Ctrl alike", () => {
  assert.equal(matches(press("z", { metaKey: true }), SHORTCUTS.undo), true);
  assert.equal(matches(press("z", { ctrlKey: true }), SHORTCUTS.undo), true);
});

test("an unmodified key is not a modified chord", () => {
  assert.equal(matches(press("z"), SHORTCUTS.undo), false);
});

test("shift distinguishes undo from redo", () => {
  assert.equal(matches(press("z", { metaKey: true, shiftKey: true }), SHORTCUTS.undo), false);
  assert.equal(matches(press("z", { metaKey: true, shiftKey: true }), SHORTCUTS.redo), true);
  assert.equal(matches(press("z", { metaKey: true }), SHORTCUTS.redo), false);
});

test("case does not matter, since shift changes the reported key", () => {
  assert.equal(matches(press("Z", { metaKey: true, shiftKey: true }), SHORTCUTS.redo), true);
});

test("alt is left to the operating system", () => {
  assert.equal(matches(press("z", { metaKey: true, altKey: true }), SHORTCUTS.undo), false);
});

test("nothing fires while typing", () => {
  // Otherwise Delete while renaming a design deletes the design, and Cmd+Z in
  // a field undoes the canvas instead of the word.
  for (const tagName of ["INPUT", "TEXTAREA", "SELECT", "input"]) {
    assert.equal(matches(press("z", { metaKey: true, target: { tagName } }), SHORTCUTS.undo), false, tagName);
    assert.equal(arrowDelta(press("ArrowLeft", { target: { tagName } })), null, tagName);
  }
  assert.equal(isTyping(press("z", { target: { isContentEditable: true } })), true);
});

test("keystrokes outside a field still fire", () => {
  assert.equal(matches(press("z", { metaKey: true, target: { tagName: "DIV" } }), SHORTCUTS.undo), true);
  assert.equal(isTyping(press("z", { target: null })), false);
});

test("arrows resolve to a direction", () => {
  assert.deepEqual(arrowDelta(press("ArrowLeft")), { x: -1, y: 0 });
  assert.deepEqual(arrowDelta(press("ArrowRight")), { x: 1, y: 0 });
  assert.deepEqual(arrowDelta(press("ArrowUp")), { x: 0, y: -1 });
  assert.deepEqual(arrowDelta(press("ArrowDown")), { x: 0, y: 1 });
  assert.equal(arrowDelta(press("a")), null);
});

test("shift makes a nudge coarse", () => {
  assert.equal(nudgeStep(press("ArrowLeft"), 0.01, 0.1), 0.01);
  assert.equal(nudgeStep(press("ArrowLeft", { shiftKey: true }), 0.01, 0.1), 0.1);
});

test("both delete keys are bound, because both are used", () => {
  assert.equal(matches(press("Backspace"), SHORTCUTS.remove), true);
  assert.equal(matches(press("Delete"), SHORTCUTS.removeAlt), true);
});

test("escape needs no modifier", () => {
  assert.equal(matches(press("Escape"), SHORTCUTS.close), true);
  assert.equal(matches(press("Escape", { metaKey: true }), SHORTCUTS.close), false);
});
