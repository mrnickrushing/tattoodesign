import test from "node:test";
import assert from "node:assert/strict";
import {
  BATCH_LIMIT,
  batchTag,
  completeItem,
  createBatch,
  failItem,
  keepers,
  nextPending,
  retryItem,
  startItem,
  summarize,
  toggleKeep,
  type BatchState,
} from "./batch";

function uris(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `file:///photo-${index}.jpg`);
}

/** Drives the queue the way the screen's runner loop does. */
function runAll(state: BatchState, outcome: (uri: string) => "ok" | "fail"): BatchState {
  for (;;) {
    const next = nextPending(state);
    if (!next) return state;
    state = startItem(state, next.id);
    state =
      outcome(next.uri) === "ok"
        ? completeItem(state, next.id, `data:image/png;base64,${next.id}`)
        : failItem(state, next.id, "decode error");
  }
}

test("a batch seeds pending, deduped, and capped", () => {
  const state = createBatch([...uris(3), "file:///photo-0.jpg"]);
  assert.equal(state.items.length, 3, "duplicate dropped");
  assert.ok(state.items.every((item) => item.status === "pending" && !item.keep));

  const oversized = createBatch(uris(30));
  assert.equal(oversized.items.length, BATCH_LIMIT);
});

test("the queue runs one item at a time", () => {
  let state = createBatch(uris(3));
  const first = nextPending(state)!;
  state = startItem(state, first.id);
  assert.equal(nextPending(state), null, "nothing else while one is processing");
  state = completeItem(state, first.id, "data:done");
  assert.ok(nextPending(state), "the next pending frees up");
  assert.notEqual(nextPending(state)!.id, first.id);
});

test("completion keeps by default; failure does not", () => {
  let state = createBatch(uris(2));
  state = runAll(state, (uri) => (uri.includes("photo-0") ? "ok" : "fail"));
  const summary = summarize(state);
  assert.equal(summary.done, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.kept, 1);
  assert.ok(summary.finished);
});

test("keep toggles only on completed items", () => {
  let state = createBatch(uris(2));
  state = runAll(state, () => "ok");
  const [first] = state.items;
  state = toggleKeep(state, first.id);
  assert.equal(state.items[0].keep, false);
  state = toggleKeep(state, first.id);
  assert.equal(state.items[0].keep, true);

  let fresh = createBatch(uris(1));
  fresh = toggleKeep(fresh, fresh.items[0].id);
  assert.equal(fresh.items[0].keep, false, "pending items cannot be kept");
});

test("retry re-queues failed items and nothing else", () => {
  let state = createBatch(uris(2));
  state = runAll(state, () => "fail");
  assert.equal(summarize(state).failed, 2);

  state = retryItem(state, state.items[0].id);
  assert.equal(state.items[0].status, "pending");
  assert.equal(state.items[0].error, undefined);

  const doneState = runAll(state, () => "ok");
  const blocked = retryItem(doneState, doneState.items[0].id);
  assert.equal(blocked.items[0].status, "done", "done items are not re-queued");
});

test("keepers returns exactly what should land in the library", () => {
  let state = createBatch(uris(3));
  state = runAll(state, (uri) => (uri.includes("photo-2") ? "fail" : "ok"));
  state = toggleKeep(state, state.items[1].id); // discard the second
  const kept = keepers(state);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].id, state.items[0].id);
  assert.ok(kept[0].resultUrl);
});

test("the summary tracks the whole lifecycle", () => {
  let state = createBatch(uris(2));
  assert.deepEqual(summarize(state), {
    total: 2, pending: 2, processing: 0, done: 0, failed: 0, kept: 0, finished: false,
  });
  const first = nextPending(state)!;
  state = startItem(state, first.id);
  assert.equal(summarize(state).processing, 1);
  assert.equal(summarize(state).finished, false);
  state = completeItem(state, first.id, "data:x");
  state = runAll(state, () => "ok");
  assert.ok(summarize(state).finished);
});

test("an empty batch is already finished", () => {
  const state = createBatch([]);
  assert.equal(nextPending(state), null);
  assert.ok(summarize(state).finished);
  assert.deepEqual(keepers(state), []);
});

test("the batch tag names the day, stably", () => {
  const timestamp = new Date(2026, 7, 19, 15, 30).getTime();
  assert.equal(batchTag(timestamp), "batch-20260819");
  assert.equal(batchTag(new Date(2026, 0, 2, 1).getTime()), "batch-20260102", "zero-padded");
});
