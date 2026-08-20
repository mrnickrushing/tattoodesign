import { strict as assert } from "node:assert";
import { test } from "node:test";
import { describePlan, imagesToTransfer, planSync, type SyncRecord } from "./syncPlan";

const rec = (id: string, updatedAt: number, imageHash = "h", deleted = false): SyncRecord => ({
  id,
  updatedAt,
  imageHash,
  deleted,
});

const kinds = (local: SyncRecord[], remote: SyncRecord[]) =>
  planSync(local, remote).actions.map((a) => `${a.kind}:${a.id}`).sort();

test("a design only this device has goes up", () => {
  assert.deepEqual(kinds([rec("a", 1)], []), ["push:a"]);
});

test("a design only the server has comes down", () => {
  assert.deepEqual(kinds([], [rec("a", 1)]), ["pull:a"]);
});

test("identical timestamps mean nothing to do", () => {
  const plan = planSync([rec("a", 5)], [rec("a", 5)]);
  assert.deepEqual(plan.actions, []);
  assert.equal(plan.unchanged, 1);
});

test("the newer copy wins in each direction", () => {
  assert.deepEqual(kinds([rec("a", 9)], [rec("a", 4)]), ["push:a"]);
  assert.deepEqual(kinds([rec("a", 4)], [rec("a", 9)]), ["pull:a"]);
});

test("unchanged pixels are not re-sent", () => {
  // Renaming a design should not move a megabyte.
  const plan = planSync([rec("a", 9, "same")], [rec("a", 4, "same")]);
  assert.deepEqual(plan.actions, [{ kind: "push", id: "a", withImage: false }]);
  assert.equal(imagesToTransfer(plan), 0);
});

test("changed pixels are sent", () => {
  const plan = planSync([rec("a", 9, "new")], [rec("a", 4, "old")]);
  assert.deepEqual(plan.actions, [{ kind: "push", id: "a", withImage: true }]);
  assert.equal(imagesToTransfer(plan), 1);
});

test("a local deletion propagates when it is the newer fact", () => {
  assert.deepEqual(kinds([rec("a", 9, "h", true)], [rec("a", 4)]), ["deleteRemote:a"]);
});

test("a remote deletion propagates when it is the newer fact", () => {
  assert.deepEqual(kinds([rec("a", 4)], [rec("a", 9, "h", true)]), ["deleteLocal:a"]);
});

test("a deletion loses to a later edit, in both directions", () => {
  // Someone deleted it, then someone else edited it. The edit is the newer
  // intent, so the design survives.
  assert.deepEqual(kinds([rec("a", 9)], [rec("a", 4, "h", true)]), ["push:a"]);
  assert.deepEqual(kinds([rec("a", 4, "h", true)], [rec("a", 9)]), ["pull:a"]);
});

test("absence is never treated as deletion", () => {
  // This is how a sync eats a library: a device that has not caught up yet
  // looks identical to one where everything was deleted.
  const plan = planSync([], [rec("a", 1), rec("b", 2), rec("c", 3)]);
  assert.equal(plan.actions.every((a) => a.kind === "pull"), true);
  assert.equal(plan.actions.length, 3);
});

test("a tombstone for something the other side never had is a no-op", () => {
  assert.deepEqual(planSync([rec("a", 5, "h", true)], []).actions, []);
  assert.deepEqual(planSync([], [rec("a", 5, "h", true)]).actions, []);
});

test("a mixed library plans every case at once", () => {
  const local = [rec("same", 5), rec("mine", 9), rec("theirs", 1), rec("onlyMine", 3)];
  const remote = [rec("same", 5), rec("mine", 2), rec("theirs", 8), rec("onlyTheirs", 4)];
  assert.deepEqual(kinds(local, remote), ["pull:onlyTheirs", "pull:theirs", "push:mine", "push:onlyMine"]);
  assert.equal(planSync(local, remote).unchanged, 1);
});

test("the summary counts each direction", () => {
  const plan = planSync([rec("a", 9), rec("b", 1)], [rec("b", 5), rec("c", 2)]);
  const text = describePlan(plan);
  assert.match(text, /1 up/);
  assert.match(text, /2 down/);
});

test("nothing to do says so plainly", () => {
  assert.match(describePlan(planSync([rec("a", 1)], [rec("a", 1)])), /already in sync/i);
});

test("two empty libraries are agreed, not broken", () => {
  const plan = planSync([], []);
  assert.deepEqual(plan.actions, []);
  assert.equal(plan.unchanged, 0);
  assert.equal(imagesToTransfer(plan), 0);
});
