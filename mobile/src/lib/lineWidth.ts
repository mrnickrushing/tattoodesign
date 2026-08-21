// How fine is the finest line in this piece, actually?
//
// Several things want to know — whether the linework holds on deep skin,
// whether it survives a needle grouping, whether a cutter can print it — and
// until now nothing could answer. The nearest thing was "one pixel of the
// artwork at its printed size", which bounds the answer from below but proves
// only the cheerful direction: if even a single pixel is wide enough, nothing
// in the piece is too fine. It says nothing at all when it fails, so a
// high-resolution export warned about linework that was never there.
//
// Measuring it properly is a distance transform plus a skeleton, both of which
// the app already had, in modules that could not be imported from a preview
// because they carry Skia. Pure array maths over a mask, so it can.

import { skeletonize } from "./vectorize";

/** Chamfer weights: 1 for orthogonal steps, ~√2 for diagonals. */
const ORTHOGONAL = 1;
const DIAGONAL = 1.4142;

/**
 * Distance from each pixel to the nearest set pixel in `mask`, in pixels.
 *
 * The standard two-pass chamfer approximation: one sweep down-right, one
 * up-left, propagating the smallest distance so far. Two passes over the
 * pixels regardless of how far the answer turns out to be, where a repeated
 * dilation would cost more for every extra pixel of reach.
 */
export function distanceTransform(mask: Uint8Array, width: number, height: number): Float32Array {
  const far = width + height;
  const dist = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) dist[i] = mask[i] ? 0 : far;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let best = dist[i];
      if (y > 0) {
        best = Math.min(best, dist[i - width] + ORTHOGONAL);
        if (x > 0) best = Math.min(best, dist[i - width - 1] + DIAGONAL);
        if (x < width - 1) best = Math.min(best, dist[i - width + 1] + DIAGONAL);
      }
      if (x > 0) best = Math.min(best, dist[i - 1] + ORTHOGONAL);
      dist[i] = best;
    }
  }

  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      let best = dist[i];
      if (y < height - 1) {
        best = Math.min(best, dist[i + width] + ORTHOGONAL);
        if (x > 0) best = Math.min(best, dist[i + width - 1] + DIAGONAL);
        if (x < width - 1) best = Math.min(best, dist[i + width + 1] + DIAGONAL);
      }
      if (x < width - 1) best = Math.min(best, dist[i + 1] + ORTHOGONAL);
      dist[i] = best;
    }
  }

  return dist;
}

/**
 * Where the low tail is read from, as a fraction of the skeleton.
 *
 * Not the strict minimum. Every stroke tapers to nothing at its two ends, and
 * a speck of noise is one pixel wide by definition, so the very bottom of the
 * distribution is made of things that are not lines. A low percentile steps
 * past those and lands on the thinnest run of actual linework.
 */
const FINE_PERCENTILE = 0.1;

/**
 * Width of the finest line in the mask, in pixels. Zero when there is no
 * linework to measure.
 *
 * The skeleton is the run of pixels equidistant from both sides of a stroke,
 * so the distance from a skeleton pixel to the nearest blank pixel is that
 * stroke's half-width where it sits. Collect those along the whole skeleton
 * and the low end of the distribution is the finest line in the piece.
 *
 * A solid silhouette has no fine linework and reports its own half-width,
 * which is large — correctly, because there is nothing in it that a coarse
 * needle or a wide bead would lose.
 */
export function finestStrokeWidth(mask: Uint8Array, width: number, height: number): number {
  if (width < 3 || height < 3 || mask.length < width * height) return 0;

  // Distance from ink to the nearest blank pixel: the transform measures
  // distance *to* set pixels, so the blanks are what has to be set.
  const blank = Uint8Array.from(mask.subarray(0, width * height), (value) => (value ? 0 : 1));
  const inward = distanceTransform(blank, width, height);
  const skeleton = skeletonize(mask, width, height);

  const widths: number[] = [];
  for (let i = 0; i < skeleton.length; i++) {
    if (skeleton[i]) widths.push(inward[i] * 2);
  }
  if (!widths.length) return 0;

  widths.sort((a, b) => a - b);
  return widths[Math.min(widths.length - 1, Math.floor(widths.length * FINE_PERCENTILE))];
}
