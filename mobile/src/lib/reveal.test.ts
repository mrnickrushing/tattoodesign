import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_REVEAL, orderForReveal, revealTimings } from "./reveal";
import type { Point } from "./designProject";

function close(actual: number, expected: number, label: string) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: expected ${expected}, got ${actual}`);
}

function line(length: number): Point[] {
  return [{ x: 0, y: 0 }, { x: length, y: 0 }];
}

test("reveal ordering puts the longest path first", () => {
  assert.deepEqual(orderForReveal([line(5), line(20), line(10)]), [1, 2, 0]);
});

test("reveal ordering preserves input order for tied paths", () => {
  assert.deepEqual(orderForReveal([line(10), line(10), line(5), line(10)]), [0, 1, 3, 2]);
});

test("the scheduled reveal ends exactly at its total budget", () => {
  const timings = revealTimings([line(3), line(20), line(9)]);
  const end = Math.max(...timings.map((timing) => timing.delayMs + timing.durationMs));
  close(end, DEFAULT_REVEAL.totalMs, "schedule end");
});

test("tiny paths retain the minimum reveal duration when the budget permits it", () => {
  const timings = revealTimings([line(0.001), line(0.002), line(0.003), line(0.004), line(0.005), line(0.006)]);
  for (const timing of timings) {
    assert.ok(timing.durationMs >= DEFAULT_REVEAL.minPathMs, `duration ${timing.durationMs} fell below the minimum`);
  }
});

test("an empty reveal has no timings", () => {
  assert.deepEqual(revealTimings([]), []);
});

test("a single path fills the requested budget without a delay", () => {
  const [timing] = revealTimings([line(12)]);
  assert.equal(timing.index, 0);
  assert.equal(timing.delayMs, 0);
  assert.equal(timing.durationMs, DEFAULT_REVEAL.totalMs);
});

test("a degenerate path receives a finite minimum duration", () => {
  const [timing] = revealTimings([[], line(5)]);
  assert.ok(Number.isFinite(timing.durationMs));
  assert.ok(Number.isFinite(timing.delayMs));
  assert.equal(timing.length, 0);
  assert.ok(timing.durationMs >= DEFAULT_REVEAL.minPathMs);
});

test("a custom total duration is respected exactly", () => {
  const totalMs = 640;
  const timings = revealTimings([line(8), line(2), line(12)], totalMs);
  const end = Math.max(...timings.map((timing) => timing.delayMs + timing.durationMs));
  close(end, totalMs, "custom schedule end");
});
