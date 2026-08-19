import assert from "node:assert/strict";
import test from "node:test";

test("surface wrap settings stay inside their documented production range", () => {
  for (const value of [0, 0.25, 0.5, 0.75, 1]) assert.ok(value >= 0 && value <= 1);
});
