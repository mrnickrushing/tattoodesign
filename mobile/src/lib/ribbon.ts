// Turning a variable-width polyline into a shape.
//
// A constant-width stroke is drawn by handing a path to a stroking renderer
// and letting it do the work. A stroke whose width changes along its length
// has no such shortcut — no renderer we target strokes with a width function —
// so the outline has to be built explicitly and filled.
//
// The construction is the obvious one: at every point, step half that point's
// width along the normal to the local tangent, once to each side. Walking the
// left offsets forward and the right offsets backward gives a closed polygon
// that is exactly the swept disc of the pen, minus the ends, which get round
// caps so a lifted pen leaves a dome and not a chisel.
//
// Pure geometry over point arrays — no Skia, no SVG — so both renderers can
// share one definition of what a stroke looks like and the shape can be
// verified off-device.

import type { Point } from "./designProject";

/** How many segments approximate each 180-degree end cap. */
const CAP_SEGMENTS = 8;

/**
 * Whether this run of points carries per-point widths and therefore has to be
 * filled as an outline rather than stroked. Points from traced masks, imported
 * paths and generated geometry have no widths and take the cheap path.
 */
export function hasVariableWidth(points: Point[]): boolean {
  return points.some((point) => typeof point.w === "number");
}

/** Unit-length tangent at each point, averaging the segments either side. */
function tangents(points: Point[]): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const before = points[Math.max(0, i - 1)];
    const after = points[Math.min(points.length - 1, i + 1)];
    let dx = after.x - before.x;
    let dy = after.y - before.y;
    let length = Math.hypot(dx, dy);
    if (length < 1e-6) {
      // A cusp or a repeated point: borrow the previous direction rather than
      // emitting a zero vector, which would collapse the outline to a line.
      const previous = out[out.length - 1];
      if (previous) {
        out.push(previous);
        continue;
      }
      dx = 1;
      dy = 0;
      length = 1;
    }
    out.push({ x: dx / length, y: dy / length });
  }
  return out;
}

function capArc(centre: Point, tangent: Point, radius: number, outward: boolean): Point[] {
  // The ring is walked left-side forward, cap, right-side backward, cap — so
  // each cap has to start on the side the walk just left and sweep round the
  // outside to the side it is about to join. Getting that direction wrong
  // folds the ring into a bowtie whose halves cancel out to nothing.
  //
  // The left offset points along the normal (-ty, tx), whose angle is
  // atan2(tx, -ty); the trailing cap starts there and sweeps a half turn
  // clockwise. The leading cap is the same arc started half a turn round.
  const start = Math.atan2(tangent.x, -tangent.y) - (outward ? 0 : Math.PI);
  const out: Point[] = [];
  for (let i = 1; i < CAP_SEGMENTS; i++) {
    const angle = start - (Math.PI * i) / CAP_SEGMENTS;
    out.push({ x: centre.x + Math.cos(angle) * radius, y: centre.y + Math.sin(angle) * radius });
  }
  return out;
}

/**
 * The closed outline of a variable-width stroke, as a single ring of points.
 *
 * `fallback` supplies the width for any point the pen pipeline did not write
 * one to, so a stroke that mixes traced and drawn points still has a defined
 * shape everywhere.
 */
export function ribbonOutline(points: Point[], fallback: number): Point[] {
  if (!points.length) return [];
  const half = points.map((point) => Math.max(0.05, (point.w ?? fallback) / 2));

  if (points.length === 1) {
    // A tap. A single disc, which is what touching a pen down and lifting it
    // straight back off actually leaves behind.
    const radius = half[0];
    const out: Point[] = [];
    for (let i = 0; i < CAP_SEGMENTS * 2; i++) {
      const angle = (Math.PI * 2 * i) / (CAP_SEGMENTS * 2);
      out.push({ x: points[0].x + Math.cos(angle) * radius, y: points[0].y + Math.sin(angle) * radius });
    }
    return out;
  }

  const tangent = tangents(points);
  const left: Point[] = [];
  const right: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const nx = -tangent[i].y;
    const ny = tangent[i].x;
    left.push({ x: points[i].x + nx * half[i], y: points[i].y + ny * half[i] });
    right.push({ x: points[i].x - nx * half[i], y: points[i].y - ny * half[i] });
  }

  const last = points.length - 1;
  return [
    ...left,
    ...capArc(points[last], tangent[last], half[last], true),
    ...right.reverse(),
    ...capArc(points[0], tangent[0], half[0], false),
  ];
}

/** SVG path data for a closed ring, ready to fill. */
export function outlinePathData(outline: Point[], scale = 1): string {
  if (!outline.length) return "";
  const segments = outline.map(
    (point, index) => `${index ? "L" : "M"}${(point.x * scale).toFixed(2)} ${(point.y * scale).toFixed(2)}`
  );
  return `${segments.join(" ")} Z`;
}

/** SVG path data for an open polyline, to be stroked at a constant width. */
export function polylinePathData(points: Point[], scale = 1): string {
  if (!points.length) return "";
  if (points.length === 1) {
    // Give a lone point a hair of length so a round cap renders it as a dot.
    const { x, y } = points[0];
    return `M${(x * scale).toFixed(2)} ${(y * scale).toFixed(2)} L${(x * scale + 0.1).toFixed(2)} ${(y * scale + 0.1).toFixed(2)}`;
  }
  return points
    .map((point, index) => `${index ? "L" : "M"}${(point.x * scale).toFixed(2)} ${(point.y * scale).toFixed(2)}`)
    .join(" ");
}

export type RenderedStroke =
  | { fill: true; d: string }
  | { fill: false; d: string; width: number };

/**
 * How one stroke should be drawn: as a filled outline when it carries pen
 * widths, and as a plain stroked polyline when it does not. Both renderers and
 * the SVG exporter go through here so a design looks the same on screen, on
 * paper, and in an exported file.
 */
export function renderStroke(
  points: Point[],
  width: number,
  scale = 1
): RenderedStroke {
  if (hasVariableWidth(points)) {
    return { fill: true, d: outlinePathData(ribbonOutline(points, width), scale) };
  }
  return { fill: false, d: polylinePathData(points, scale), width: width * scale };
}
