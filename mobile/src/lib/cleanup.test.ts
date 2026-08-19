import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CLEANUP,
  applyCleanup,
  bridgeGaps,
  cleanupReport,
  findSpecks,
} from "./cleanup";
import type { Point } from "./designProject";

function line(x0: number, y0: number, x1: number, y1: number): Point[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y1 },
  ];
}

test("specks split from keepers by traced length", () => {
  const long = line(0, 0, 100, 0);
  const speck = line(0, 50, 4, 50);
  const { kept, specks } = findSpecks([long, speck], 14);
  assert.deepEqual(kept, [long]);
  assert.deepEqual(specks, [speck]);
});

test("a boundary-length path survives as a keeper only above the threshold", () => {
  const exactly = line(0, 0, 14, 0);
  assert.equal(findSpecks([exactly], 14).specks.length, 1, "<= threshold is a speck");
  const just = line(0, 0, 14.5, 0);
  assert.equal(findSpecks([just], 14).kept.length, 1);
});

test("bridging joins two fragments whose ends nearly touch", () => {
  // One stroke broken at x=100 with a 4px gap.
  const left = line(0, 0, 100, 0);
  const right = line(104, 0, 200, 0);
  const { paths, bridged } = bridgeGaps([left, right], 10);
  assert.equal(bridged, 1);
  assert.equal(paths.length, 1);
  const joined = paths[0];
  assert.equal(joined.length, 4);
  // The join runs continuously left to right (or the exact reverse).
  const xs = joined.map((point) => point.x);
  const sorted = [...xs].sort((a, b) => a - b);
  assert.ok(
    JSON.stringify(xs) === JSON.stringify(sorted) || JSON.stringify(xs) === JSON.stringify(sorted.reverse()),
    `join should be monotonic, got ${xs.join(",")}`
  );
});

test("bridging refuses gaps over the threshold", () => {
  const { paths, bridged } = bridgeGaps([line(0, 0, 100, 0), line(120, 0, 200, 0)], 10);
  assert.equal(bridged, 0);
  assert.equal(paths.length, 2);
});

test("fragments are oriented before joining, whichever ends meet", () => {
  // Right fragment recorded right-to-left: its START (200,0) is far, its
  // FINISH (104,0) is near the left fragment's finish.
  const left = line(0, 0, 100, 0);
  const rightReversed = line(200, 0, 104, 0);
  const { paths, bridged } = bridgeGaps([left, rightReversed], 10);
  assert.equal(bridged, 1);
  const xs = paths[0].map((point) => point.x);
  const gaps = xs.slice(1).map((x, index) => Math.abs(x - xs[index]));
  assert.ok(Math.max(...gaps) <= 104, "no teleporting joins across the shape");
  assert.equal(new Set(xs).size, xs.length, "no duplicated points from bad orientation");
});

test("a path never bridges to itself into an accidental loop", () => {
  // A tight U: its own two ends are 4px apart.
  const u: Point[] = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 30 },
    { x: 0, y: 30 },
    { x: 0, y: 4 },
  ];
  const { paths, bridged } = bridgeGaps([u], 10);
  assert.equal(bridged, 0);
  assert.equal(paths.length, 1);
});

test("closed loops are left alone entirely", () => {
  const loop: Point[] = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 20 },
    { x: 0, y: 0 },
  ];
  const nearby = line(1, 1, 60, 1);
  const { bridged } = bridgeGaps([loop, nearby], 10);
  assert.equal(bridged, 0, "a loop has no free ends to bridge");
});

test("a chain of three fragments bridges into one stroke", () => {
  const a = line(0, 0, 50, 0);
  const b = line(54, 0, 100, 0);
  const c = line(104, 0, 150, 0);
  const { paths, bridged } = bridgeGaps([a, b, c], 10);
  assert.equal(bridged, 2);
  assert.equal(paths.length, 1);
  assert.equal(paths[0].length, 6);
});

test("the closest pair bridges first", () => {
  // One left fragment, two right candidates: 3px away and 8px away.
  const left = line(0, 0, 100, 0);
  const near = line(103, 0, 150, 0);
  const far = line(108, 20, 150, 20);
  const { paths } = bridgeGaps([left, near, far], 10);
  const containsBoth = (path: Point[], a: Point, b: Point) =>
    path.some((point) => point.x === a.x && point.y === a.y) &&
    path.some((point) => point.x === b.x && point.y === b.y);
  const joined = paths.find((path) => containsBoth(path, { x: 100, y: 0 }, { x: 103, y: 0 }));
  assert.ok(joined, "the 3px gap should be the one joined to the left fragment");
});

test("applyCleanup composes speck removal and bridging into one result", () => {
  const broken1 = line(0, 0, 100, 0);
  const broken2 = line(104, 0, 200, 0);
  const speck = line(50, 50, 53, 50);
  const result = applyCleanup([broken1, broken2, speck], DEFAULT_CLEANUP);
  assert.equal(result.specksRemoved, 1);
  assert.equal(result.gapsBridged, 1);
  assert.equal(result.paths.length, 1);
});

test("cleanupReport counts without mutating and includes spacing", () => {
  const paths = [line(0, 0, 100, 0), line(104, 0, 200, 0), line(50, 50, 53, 50)];
  const report = cleanupReport(paths, 10, 0.8);
  assert.equal(report.specks, 1);
  assert.equal(report.bridgeableGaps, 1);
  assert.equal(report.spacing.checkedSegments, 2, "spacing runs on keepers only");
  assert.equal(paths.length, 3, "input untouched");
});

test("clean input reports nothing to do", () => {
  const report = cleanupReport([line(0, 0, 100, 0), line(0, 40, 100, 40)], 10, 0.8);
  assert.equal(report.specks, 0);
  assert.equal(report.bridgeableGaps, 0);
  assert.equal(report.spacing.violations, 0);
  const result = applyCleanup([]);
  assert.deepEqual(result, { paths: [], specksRemoved: 0, gapsBridged: 0 });
});
