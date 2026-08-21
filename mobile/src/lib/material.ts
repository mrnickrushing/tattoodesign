// How the design lays down, not how it ages.
//
// healing.ts already answers what a piece looks like in two years. This is the
// question before it: what the piece looks like the moment it exists, in the
// material it is actually made of. A design on screen is a flat vector at one
// weight. A tattoo is a needle grouping of a particular width dragged at a
// particular speed, and a cookie is a bead of icing squeezed out of a tip —
// neither lays down a constant line, and the difference between the two is
// most of why work looks different on the body than on the screen.
//
// Pure geometry: the widths this produces go into Point.w, and ribbon.ts
// already knows how to turn a variable-width polyline into a shape. No Skia
// here and no new dependency, so it stays OTA-safe.

import type { BrandId } from "./brands";
import type { Point } from "./designProject";
import { pxPerMmFromDpi } from "./spacing";

export type NeedleGrouping = {
  id: string;
  label: string;
  /** Width of the grouping at the skin, in millimetres. */
  widthMm: number;
  note: string;
};

/**
 * Nominal grouping widths for #12 needles — 0.35mm each, the standard taper.
 *
 * A round liner packs its needles into a circle, so the width grows with the
 * square root of the count rather than with the count: 9RL is not nine times
 * 1RL, it is about four and a half times. Magnums lay theirs in a row and grow
 * roughly linearly. Both are nominal — cartridge brands vary by a tenth of a
 * millimetre either way.
 */
export const NEEDLE_GROUPINGS: NeedleGrouping[] = [
  { id: "1rl", label: "1RL", widthMm: 0.35, note: "Single needle. Finest line that heals." },
  { id: "3rl", label: "3RL", widthMm: 0.75, note: "Fine line and detail work." },
  { id: "5rl", label: "5RL", widthMm: 1.05, note: "Everyday liner." },
  { id: "7rl", label: "7RL", widthMm: 1.35, note: "Bold outline." },
  { id: "9rl", label: "9RL", widthMm: 1.6, note: "Heavy traditional contour." },
  { id: "5rs", label: "5RS", widthMm: 1.15, note: "Round shader — looser, softer edge." },
  { id: "7m1", label: "7M1", widthMm: 2.45, note: "Magnum. Shading and small fills." },
  { id: "13m1", label: "13M1", widthMm: 4.55, note: "Wide magnum. Packing black." },
];

export type IcingTip = {
  id: string;
  label: string;
  /** Diameter of the hole in the tip. */
  openingMm: number;
  /** Width of the bead it actually leaves, once the icing has settled. */
  beadMm: number;
  note: string;
};

/**
 * Royal icing spreads past the tip that piped it.
 *
 * Piping consistency holds its shape but still relaxes, so a bead is about a
 * quarter wider than the hole it came out of. Stiffer icing spreads less and
 * flood consistency spreads far more, which is why flooding is a separate step
 * rather than a wider tip.
 */
const BEAD_SPREAD = 1.25;

const TIP_SOURCE: { id: string; label: string; openingMm: number; note: string }[] = [
  { id: "pme1", label: "#1", openingMm: 1, note: "Hairline detail and lettering." },
  { id: "pme15", label: "#1.5", openingMm: 1.3, note: "Fine outline." },
  { id: "pme2", label: "#2", openingMm: 1.6, note: "Everyday outline and flood." },
  { id: "pme3", label: "#3", openingMm: 2, note: "Bold outline, faster flood." },
  { id: "pme4", label: "#4", openingMm: 2.5, note: "Heavy border, big pieces." },
  { id: "pme5", label: "#5", openingMm: 3.2, note: "Widest useful bead before it slumps." },
];

export const ICING_TIPS: IcingTip[] = TIP_SOURCE.map((tip) => ({
  ...tip,
  beadMm: Math.round(tip.openingMm * BEAD_SPREAD * 100) / 100,
}));

/** A tool of either studio, so a screen does not have to know which it is in. */
export type Tool = { id: string; label: string; widthMm: number; note: string };

export function toolsFor(brand: BrandId): Tool[] {
  if (brand === "sugar") {
    return ICING_TIPS.map((tip) => ({ id: tip.id, label: tip.label, widthMm: tip.beadMm, note: tip.note }));
  }
  return NEEDLE_GROUPINGS.map((grouping) => ({ ...grouping }));
}

export function findTool(brand: BrandId, id: string): Tool | undefined {
  return toolsFor(brand).find((tool) => tool.id === id);
}

/** A tool's width in pixels for artwork printed or rendered at `dpi`. */
export function toolWidthPx(widthMm: number, dpi: number): number {
  return widthMm * pxPerMmFromDpi(dpi);
}

/**
 * How far the width swings with hand speed. A line drawn at half the usual
 * pace comes out about 20% fatter, not twice as fat.
 */
const SPEED_EXPONENT = 0.5;
const SLOWEST = 1.3;
const FASTEST = 0.8;

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * The width the tool lays down at each point along a stroke, in pixels.
 *
 * Speed is read from how far apart consecutive samples are, which is only
 * meaningful when they were captured at a steady rate — a live drawn stroke.
 * Geometry that came from a traced mask or a generated path has no timing in
 * it, so its "speed" is really its sampling, and the profile comes back close
 * to flat. That is the right answer for those: a traced line has no hand in it
 * to vary.
 *
 * Slower means wider, in both studios and for the same reason — a needle held
 * in one place keeps packing ink, and icing squeezed without moving keeps
 * piling up.
 *
 * One width per input point, always, so the result drops straight into Point.w.
 */
export function strokeProfile(points: Point[], groupingMm: number, pxPerMm: number): number[] {
  const nominal = Math.max(0, groupingMm) * Math.max(0, pxPerMm);
  if (points.length < 3 || nominal <= 0) return points.map(() => nominal);

  const speeds = points.map((_, i) => {
    const before = points[Math.max(0, i - 1)];
    const after = points[Math.min(points.length - 1, i + 1)];
    const span = Math.hypot(after.x - before.x, after.y - before.y);
    // The endpoints span one segment where the interior spans two.
    return i === 0 || i === points.length - 1 ? span : span / 2;
  });

  // Compared against this stroke's own pace, not an absolute one: how fast a
  // hand moves is personal, and what shows in the line is where it sped up or
  // slowed down relative to the rest of the same stroke.
  const reference = median(speeds.filter((speed) => speed > 0));
  if (!reference) return points.map(() => nominal);

  return speeds.map((speed) => {
    // A sample that did not move at all is the needle sitting still: as wide
    // as it goes, rather than infinitely wide.
    const ratio = speed > 0 ? (reference / speed) ** SPEED_EXPONENT : SLOWEST;
    return nominal * Math.min(SLOWEST, Math.max(FASTEST, ratio));
  });
}

/**
 * Rewrites a stroke's per-point widths as the chosen tool would lay them down.
 *
 * Points that already carry widths came from the pen pipeline, where the width
 * is the hand's pressure and tilt. That variation is kept — scaled about its
 * own mean — and the tool sets the absolute size, so switching from a 3RL to a
 * 9M1 makes the whole stroke heavier without flattening how it was drawn.
 */
export function layDown(points: Point[], widthMm: number, pxPerMm: number): Point[] {
  const widths = strokeProfile(points, widthMm, pxPerMm);
  const drawn = points.every((point) => typeof point.w === "number" && point.w > 0);
  if (!drawn) return points.map((point, i) => ({ ...point, w: widths[i] }));

  const mean = points.reduce((sum, point) => sum + (point.w ?? 0), 0) / points.length;
  if (!(mean > 0)) return points.map((point, i) => ({ ...point, w: widths[i] }));
  return points.map((point, i) => ({ ...point, w: widths[i] * ((point.w ?? mean) / mean) }));
}

/**
 * What the finest line in this design would need to become to be piped or
 * lined with the chosen tool.
 *
 * A design drawn at 0.2mm cannot be tattooed with a 9RL and cannot be piped
 * with a #4 — the tool is wider than the line. Rather than let that discover
 * itself on skin, this reports the factor everything would have to grow by.
 */
export function scaleToTool(finestLineMm: number, tool: Tool): number {
  if (!(finestLineMm > 0)) return 1;
  return Math.max(1, tool.widthMm / finestLineMm);
}
