// Turning banded greys into the layers an artist actually shades from.
//
// The half of `toneSeparate.ts` that has no picture in it. Once the pixels are
// decoded and reduced to greys, everything left is arithmetic: which band each
// pixel fell into, what marks cover that band, and where those marks land once
// scaled back onto the canvas. None of it needs a graphics library, and all of
// it decides what somebody transfers onto skin.
//
// Split for the reason `stencilPixels.ts` sits apart from `stencil.ts`: Skia
// binds its whole API at import time and cannot load under the test runner, so
// a pure function sharing a file with it is untestable however plain it is.

import type { Point, StrokeLayer } from "./designProject";
import { makeStrokeLayer } from "./projectMutations";
import { bandMask, posterize, thresholds, type SeparationPlan } from "./tone";
import { shadeRegion, type Mask } from "./shading";

/** What one band's marks became, for reporting back to the caller. */
export type ShadingResult = {
  layers: StrokeLayer[];
  /** Marks laid down, per band that had a pass. */
  marks: number;
};

/**
 * Moves a stroke from analysis resolution back onto the canvas.
 *
 * The width rides along with the coordinates. A stroke traced at 900px and
 * dropped onto a 1800px canvas has to get twice as wide as well as twice as
 * far apart, or the shading arrives at half the weight it was drawn at.
 */
export function scalePoints(points: Point[], factor: number): Point[] {
  return points.map((point) => ({
    x: point.x * factor,
    y: point.y * factor,
    ...(typeof point.w === "number" ? { w: point.w * factor } : {}),
  }));
}

const BAND_NAMES = ["Core black", "Shadow", "Mid tone", "Light", "Highlight", "Paper"];

/**
 * One shading layer per band the plan asks for, darkest first.
 *
 * Bands are masked cumulatively — a mid-tone pass covers everything at least
 * that dark — because that is how ink accumulates on skin. A shadow that only
 * received the shadow pass would read lighter than the mid-tone beside it,
 * which is backwards.
 */
export function shadingLayersFrom(
  gray: Uint8Array,
  width: number,
  height: number,
  plan: SeparationPlan,
  canvasWidth: number,
  canvasHeight: number
): ShadingResult {
  const cuts = thresholds(gray, plan.bands, plan.strategy);
  const banded = posterize(gray, cuts);
  const toCanvas = canvasWidth / width;

  const layers: StrokeLayer[] = [];
  let marks = 0;

  // Lightest first so the darkest band ends up on top of the layer stack,
  // matching the order the marks would actually be laid down.
  for (let band = plan.passes.length - 1; band >= 0; band--) {
    const pass = plan.passes[band]?.shading;
    if (!pass) continue;

    const mask: Mask = { data: bandMask(banded, band, true), width, height };
    const strokes = shadeRegion(mask, pass);
    if (!strokes.length) continue;
    marks += strokes.length;

    const base = makeStrokeLayer(
      canvasWidth,
      canvasHeight,
      `${BAND_NAMES[band] ?? `Band ${band + 1}`} · ${pass.style}`
    );
    layers.push({
      ...base,
      strokes: strokes.map((stroke) => ({
        points: scalePoints(stroke.points, toCanvas),
        width: Math.max(0.5, stroke.width * toCanvas),
        color: "#111111",
        mode: "draw" as const,
        opacity: 1,
      })),
    });
  }

  return { layers, marks };
}
