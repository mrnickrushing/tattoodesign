import test from "node:test";
import assert from "node:assert/strict";
import {
  MIN_LINE_GAP_MM,
  checkLineSpacing,
  pxPerMmFromDpi,
  spacingFinding,
} from "./spacing";
import type { Point } from "./designProject";

// 254 DPI makes the arithmetic legible: exactly 10 pixels per millimetre.
const PX_PER_MM = pxPerMmFromDpi(254);

function horizontal(y: number, x0 = 0, x1 = 200): Point[] {
  return [
    { x: x0, y },
    { x: x1, y },
  ];
}

test("DPI converts to pixels per millimetre", () => {
  assert.equal(pxPerMmFromDpi(254), 10);
  assert.ok(Math.abs(pxPerMmFromDpi(203) - 7.992) < 0.001);
  assert.equal(pxPerMmFromDpi(25.4), 1);
});

test("lines further apart than the threshold pass", () => {
  // 15px apart at 10px/mm is 1.5mm, comfortably over the 0.8mm liner gap.
  const report = checkLineSpacing([horizontal(0), horizontal(15)], PX_PER_MM, MIN_LINE_GAP_MM.ink);
  assert.equal(report.violations, 0);
  assert.equal(report.worstGapMm, null);
});

test("lines tighter than the threshold are flagged with the real gap", () => {
  // 5px apart is 0.5mm — under the 0.8mm liner gap.
  const report = checkLineSpacing([horizontal(0), horizontal(5)], PX_PER_MM, MIN_LINE_GAP_MM.ink);
  assert.ok(report.violations > 0, "should flag the tight pair");
  assert.ok(report.worstGapMm !== null);
  assert.ok(Math.abs(report.worstGapMm! - 0.5) < 1e-6, `expected 0.5mm, got ${report.worstGapMm}`);
});

test("the threshold boundary behaves", () => {
  const justUnder = checkLineSpacing([horizontal(0), horizontal(7.9)], PX_PER_MM, MIN_LINE_GAP_MM.ink);
  const justOver = checkLineSpacing([horizontal(0), horizontal(8.1)], PX_PER_MM, MIN_LINE_GAP_MM.ink);
  assert.ok(justUnder.violations > 0, "7.9px = 0.79mm should fail");
  assert.equal(justOver.violations, 0, "8.1px = 0.81mm should pass");
});

test("a coarser brand threshold flags what a finer one accepts", () => {
  const lines = [horizontal(0), horizontal(12)]; // 1.2mm apart
  assert.equal(checkLineSpacing(lines, PX_PER_MM, MIN_LINE_GAP_MM.ink).violations, 0);
  assert.ok(checkLineSpacing(lines, PX_PER_MM, MIN_LINE_GAP_MM.sugar).violations > 0);
});

test("a single stroke is never reported against itself", () => {
  // A gently curving path: consecutive segments touch by construction.
  const curve: Point[] = Array.from({ length: 60 }, (_, index) => ({
    x: index * 3,
    y: Math.sin(index / 6) * 20,
  }));
  const report = checkLineSpacing([curve], PX_PER_MM, MIN_LINE_GAP_MM.ink);
  assert.equal(report.violations, 0, "a plain curve is not a blowout");
});

test("a hairpin folding back on itself is a genuine blowout", () => {
  // Out along y=0, turn, and back at y=3px (0.3mm) — far apart along the path
  // but nearly touching in space.
  const hairpin: Point[] = [];
  for (let x = 0; x <= 200; x += 5) hairpin.push({ x, y: 0 });
  for (let x = 200; x >= 0; x -= 5) hairpin.push({ x, y: 3 });
  const report = checkLineSpacing([hairpin], PX_PER_MM, MIN_LINE_GAP_MM.ink);
  assert.ok(report.violations > 0, "the fold should be caught");
  assert.ok(report.worstGapMm !== null && report.worstGapMm <= 0.3 + 1e-6);
});

test("crossing lines report a zero gap", () => {
  const cross: Point[][] = [
    [{ x: 0, y: 50 }, { x: 100, y: 50 }],
    [{ x: 50, y: 0 }, { x: 50, y: 100 }],
  ];
  const report = checkLineSpacing(cross, PX_PER_MM, MIN_LINE_GAP_MM.ink);
  assert.ok(report.violations > 0);
  assert.equal(report.worstGapMm, 0);
});

test("degenerate input is handled rather than thrown at", () => {
  assert.equal(checkLineSpacing([], PX_PER_MM, 0.8).violations, 0);
  assert.equal(checkLineSpacing([[{ x: 1, y: 1 }]], PX_PER_MM, 0.8).checkedSegments, 0);
  assert.equal(checkLineSpacing([horizontal(0), horizontal(1)], 0, 0.8).violations, 0);
  assert.equal(checkLineSpacing([horizontal(0), horizontal(1)], PX_PER_MM, 0).violations, 0);
});

test("segment counting reflects the geometry supplied", () => {
  const report = checkLineSpacing([horizontal(0), horizontal(40)], PX_PER_MM, MIN_LINE_GAP_MM.ink);
  assert.equal(report.checkedSegments, 2);
});

test("the same geometry scales with print size", () => {
  const lines = [horizontal(0), horizontal(6)];
  // At 10px/mm the gap is 0.6mm and fails; printed at half the density the
  // same pixels span twice the distance and pass.
  assert.ok(checkLineSpacing(lines, PX_PER_MM, MIN_LINE_GAP_MM.ink).violations > 0);
  assert.equal(checkLineSpacing(lines, PX_PER_MM / 2, MIN_LINE_GAP_MM.ink).violations, 0);
});

test("findings read as production advice", () => {
  const clean = spacingFinding(checkLineSpacing([horizontal(0), horizontal(40)], PX_PER_MM, 0.8), "ink", 0.8);
  assert.equal(clean.level, "pass");
  assert.match(clean.detail, /0\.8mm/);

  const tight = spacingFinding(checkLineSpacing([horizontal(0), horizontal(3)], PX_PER_MM, 0.8), "ink", 0.8);
  assert.equal(tight.level, "warn");
  assert.match(tight.detail, /0\.30mm/);
  assert.match(tight.detail, /needle/);

  const sugar = spacingFinding(checkLineSpacing([horizontal(0), horizontal(3)], PX_PER_MM, 2), "sugar", 2);
  assert.match(sugar.detail, /piping/);

  const empty = spacingFinding(checkLineSpacing([], PX_PER_MM, 0.8), "ink", 0.8);
  assert.equal(empty.level, "warn");
  assert.match(empty.detail, /Trace the design first/);
});

test("a dense trace stays tractable", () => {
  // 300 parallel lines, comfortably spaced: the grid must keep this cheap.
  const paths = Array.from({ length: 300 }, (_, index) => horizontal(index * 20));
  const started = process.hrtime.bigint();
  const report = checkLineSpacing(paths, PX_PER_MM, MIN_LINE_GAP_MM.ink);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.equal(report.violations, 0);
  assert.ok(elapsedMs < 500, `spacing check took ${elapsedMs.toFixed(0)}ms`);
});
