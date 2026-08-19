// Point-level editing for stroke layers.
//
// Everything the app produces — traces, lettering, symmetry strokes — lands
// in StrokeLayer point arrays. This module is the geometry for touching those
// points directly: hit-testing a tap to a node, moving it, deleting it,
// splitting a segment. Pure functions over the layer, so every rule is
// testable; the editor owns gestures and commits.
//
// Coordinates: strokes store layer-local points, but fingers land in canvas
// space. canvasToLayer/layerToCanvas invert the same transform the renderer
// and strokePathsInCanvasSpace use — rotate/scale about the layer centre.

import type { Point, StrokeLayer } from "./designProject";

export type NodeRef = { strokeIndex: number; pointIndex: number };

export function layerToCanvas(layer: StrokeLayer, point: Point): Point {
  const t = layer.transform;
  const radians = (t.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const sx = (point.x - t.width / 2) * t.scaleX;
  const sy = (point.y - t.height / 2) * t.scaleY;
  return {
    x: t.x + t.width / 2 + sx * cos - sy * sin,
    y: t.y + t.height / 2 + sx * sin + sy * cos,
  };
}

export function canvasToLayer(layer: StrokeLayer, point: Point): Point {
  const t = layer.transform;
  const radians = (t.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - (t.x + t.width / 2);
  const dy = point.y - (t.y + t.height / 2);
  // Undo rotation, then scale. Degenerate scale falls back to 1 so a broken
  // transform degrades to "wrong position", never NaN geometry.
  const rx = dx * cos + dy * sin;
  const ry = -dx * sin + dy * cos;
  return {
    x: rx / (t.scaleX || 1) + t.width / 2,
    y: ry / (t.scaleY || 1) + t.height / 2,
  };
}

/**
 * The node nearest a canvas-space touch, within `radiusPx` (canvas px).
 * Draw strokes only — erase strokes have no visible nodes to grab.
 */
export function nearestNode(
  layer: StrokeLayer,
  canvasPoint: Point,
  radiusPx: number
): NodeRef | null {
  let best: NodeRef | null = null;
  let bestDistance = radiusPx;
  layer.strokes.forEach((stroke, strokeIndex) => {
    if (stroke.mode === "erase") return;
    stroke.points.forEach((point, pointIndex) => {
      const mapped = layerToCanvas(layer, point);
      const distance = Math.hypot(mapped.x - canvasPoint.x, mapped.y - canvasPoint.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { strokeIndex, pointIndex };
      }
    });
  });
  return best;
}

/**
 * The segment nearest a canvas-space touch, for midpoint insertion. Returns
 * the stroke and the index of the segment's first point.
 */
export function nearestSegment(
  layer: StrokeLayer,
  canvasPoint: Point,
  radiusPx: number
): NodeRef | null {
  let best: NodeRef | null = null;
  let bestDistance = radiusPx;
  layer.strokes.forEach((stroke, strokeIndex) => {
    if (stroke.mode === "erase") return;
    for (let pointIndex = 0; pointIndex < stroke.points.length - 1; pointIndex++) {
      const a = layerToCanvas(layer, stroke.points[pointIndex]);
      const b = layerToCanvas(layer, stroke.points[pointIndex + 1]);
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const lengthSquared = abx * abx + aby * aby;
      let tParam = lengthSquared
        ? ((canvasPoint.x - a.x) * abx + (canvasPoint.y - a.y) * aby) / lengthSquared
        : 0;
      tParam = Math.max(0, Math.min(1, tParam));
      const distance = Math.hypot(canvasPoint.x - (a.x + tParam * abx), canvasPoint.y - (a.y + tParam * aby));
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { strokeIndex, pointIndex };
      }
    }
  });
  return best;
}

function withStroke(
  layer: StrokeLayer,
  strokeIndex: number,
  mutate: (points: Point[]) => Point[] | null
): StrokeLayer {
  const stroke = layer.strokes[strokeIndex];
  if (!stroke) return layer;
  const points = mutate([...stroke.points]);
  const strokes = [...layer.strokes];
  if (points === null) strokes.splice(strokeIndex, 1);
  else strokes[strokeIndex] = { ...stroke, points };
  return { ...layer, strokes };
}

/** Moves one node to a canvas-space position. */
export function moveNode(layer: StrokeLayer, node: NodeRef, canvasPoint: Point): StrokeLayer {
  const local = canvasToLayer(layer, canvasPoint);
  return withStroke(layer, node.strokeIndex, (points) => {
    if (node.pointIndex < 0 || node.pointIndex >= points.length) return points;
    points[node.pointIndex] = local;
    return points;
  });
}

/**
 * Deletes one node. A stroke that would drop below two points is removed
 * whole — a one-point stroke draws nothing and can never be grabbed again.
 */
export function deleteNode(layer: StrokeLayer, node: NodeRef): StrokeLayer {
  return withStroke(layer, node.strokeIndex, (points) => {
    if (node.pointIndex < 0 || node.pointIndex >= points.length) return points;
    if (points.length <= 2) return null;
    points.splice(node.pointIndex, 1);
    return points;
  });
}

/** Splits the segment after `node.pointIndex` at its midpoint. */
export function insertMidpoint(layer: StrokeLayer, segment: NodeRef): StrokeLayer {
  return withStroke(layer, segment.strokeIndex, (points) => {
    const a = points[segment.pointIndex];
    const b = points[segment.pointIndex + 1];
    if (!a || !b) return points;
    points.splice(segment.pointIndex + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    return points;
  });
}
