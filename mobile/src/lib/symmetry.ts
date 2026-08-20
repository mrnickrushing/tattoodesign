// Live symmetry for the brush. A stroke drawn with symmetry on is committed as
// several strokes at once — the original plus its reflections or rotations
// about the canvas centre. Everything here is pure geometry on point arrays so
// the editor can preview the same replication it is about to commit.

import type { Point } from "./designProject";

export type SymmetryMode = "off" | "mirror" | "radial";
export type SymmetryAxis = "vertical" | "horizontal" | "both";

export type SymmetrySettings = {
  mode: SymmetryMode;
  /** Which mirror line(s) to reflect across. Ignored when mode is not "mirror". */
  axis: SymmetryAxis;
  /** How many rotational copies (including the original). Ignored unless radial. */
  segments: number;
};

export const MIN_SEGMENTS = 2;
export const MAX_SEGMENTS = 24;

export const DEFAULT_SYMMETRY: SymmetrySettings = {
  mode: "off",
  axis: "vertical",
  segments: 8,
};

export type Canvas = { width: number; height: number };

export function clampSegments(segments: number): number {
  if (!Number.isFinite(segments)) return MIN_SEGMENTS;
  return Math.max(MIN_SEGMENTS, Math.min(MAX_SEGMENTS, Math.round(segments)));
}

function mirrorPath(points: Point[], canvas: Canvas, flipX: boolean, flipY: boolean): Point[] {
  return points.map((point) => ({
    ...point,
    x: flipX ? canvas.width - point.x : point.x,
    y: flipY ? canvas.height - point.y : point.y,
  }));
}

function rotatePath(points: Point[], canvas: Canvas, radians: number): Point[] {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return points.map((point) => {
    const dx = point.x - cx;
    const dy = point.y - cy;
    return { ...point, x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  });
}

/**
 * Expand one drawn path into every path that should be committed. The original
 * is always first so callers can treat index 0 as "what the finger actually
 * drew". An empty path expands to nothing rather than to a set of empties.
 */
export function replicateStroke(
  points: Point[],
  settings: SymmetrySettings,
  canvas: Canvas
): Point[][] {
  if (!points.length) return [];
  if (settings.mode === "off") return [points];

  if (settings.mode === "mirror") {
    if (settings.axis === "vertical") return [points, mirrorPath(points, canvas, true, false)];
    if (settings.axis === "horizontal") return [points, mirrorPath(points, canvas, false, true)];
    return [
      points,
      mirrorPath(points, canvas, true, false),
      mirrorPath(points, canvas, false, true),
      mirrorPath(points, canvas, true, true),
    ];
  }

  const segments = clampSegments(settings.segments);
  const paths: Point[][] = [points];
  for (let index = 1; index < segments; index++) {
    paths.push(rotatePath(points, canvas, (index * 2 * Math.PI) / segments));
  }
  return paths;
}

export type Guide = { x1: number; y1: number; x2: number; y2: number };

/**
 * Axis lines (mirror) or spokes (radial) to draw over the stage while symmetry
 * is active, so the person can see where the fold lands before committing.
 */
export function symmetryGuides(settings: SymmetrySettings, canvas: Canvas): Guide[] {
  if (settings.mode === "off") return [];
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  if (settings.mode === "mirror") {
    const vertical: Guide = { x1: cx, y1: 0, x2: cx, y2: canvas.height };
    const horizontal: Guide = { x1: 0, y1: cy, x2: canvas.width, y2: cy };
    if (settings.axis === "vertical") return [vertical];
    if (settings.axis === "horizontal") return [horizontal];
    return [vertical, horizontal];
  }

  // Spokes run to the corner radius so they always reach past the canvas edge.
  const reach = Math.sqrt(cx * cx + cy * cy);
  const segments = clampSegments(settings.segments);
  const guides: Guide[] = [];
  for (let index = 0; index < segments; index++) {
    const angle = (index * 2 * Math.PI) / segments - Math.PI / 2;
    guides.push({
      x1: cx,
      y1: cy,
      x2: cx + Math.cos(angle) * reach,
      y2: cy + Math.sin(angle) * reach,
    });
  }
  return guides;
}

export function describeSymmetry(settings: SymmetrySettings): string {
  if (settings.mode === "off") return "Off";
  if (settings.mode === "mirror") {
    if (settings.axis === "both") return "Mirror · quad";
    return settings.axis === "vertical" ? "Mirror · vertical" : "Mirror · horizontal";
  }
  return `Radial · ${clampSegments(settings.segments)}×`;
}
