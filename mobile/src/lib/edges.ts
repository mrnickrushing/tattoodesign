// Pulling clean lines out of a picture that has tone in it.
//
// The pipeline used to threshold the gradient and then dilate the result. On a
// photograph with a plain background that is survivable. On a fully rendered
// illustration — smooth grey shading, texture in every surface — it fails
// completely: the gradient clears the threshold nearly everywhere there is
// detail, dilation then welds neighbouring edge pixels together, and the
// stencil comes back as solid black masses with a few white holes in it.
//
// Thickening an edge map is exactly backwards. What a stencil needs is the
// opposite: find the ridge of each edge, keep only the ridge, and keep only
// the ridges that belong to something structural.
//
// Three steps, which together are the Canny construction:
//
//   1. Non-maximum suppression — an edge detector reports a band of high
//      gradient several pixels wide. Only the crest of that band is the line;
//      everything else is the slope leading up to it.
//   2. Hysteresis — one threshold either admits noise or breaks real lines
//      into dashes. Two thresholds let a line be admitted on its strongest
//      point and then followed through its weaker stretches.
//   3. Speck removal — shading and texture survive as small disconnected
//      fragments. Anything too short to be a line an artist would draw is not
//      one.
//
// Pure array math, no Skia, so the difference between a stencil and a black
// smear can be verified off-device.

export type Gradient = {
  /** Magnitude, normalised to 0..255. */
  magnitude: Float32Array;
  gx: Float32Array;
  gy: Float32Array;
};

/** What the kernel returns for a black-to-white step: 4 x 255. */
const STEP_EDGE = 1020;

const SOBEL_X = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
const SOBEL_Y = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

/**
 * Sobel, keeping the components as well as the magnitude. The direction is
 * what non-maximum suppression needs in order to know which way is "across"
 * the edge.
 */
export function gradient(gray: Float32Array, width: number, height: number): Gradient {
  const magnitude = new Float32Array(width * height);
  const gx = new Float32Array(width * height);
  const gy = new Float32Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let sx = 0;
      let sy = 0;
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const value = gray[(y + dy) * width + (x + dx)];
          sx += value * SOBEL_X[k];
          sy += value * SOBEL_Y[k];
          k++;
        }
      }
      const i = y * width + x;
      gx[i] = sx;
      gy[i] = sy;
      // Scaled against what a hard black-to-white step actually produces, not
      // against the strongest edge in this particular picture. Normalising by
      // the image's own maximum makes the threshold mean something different
      // for every image — and in the case that matters, a picture made mostly
      // of smooth shading, it rescales that shading up to full strength and
      // every gentle gradient reads as an edge.
      magnitude[i] = Math.min(255, (Math.hypot(sx, sy) / STEP_EDGE) * 255);
    }
  }
  return { magnitude, gx, gy };
}

/**
 * Keeps only the crest of each gradient ridge, leaving lines one pixel wide.
 *
 * The gradient direction is quantised to the four that a pixel grid can
 * actually express; comparing against the two neighbours along that direction
 * answers "is this the top of the ridge, or the side of it?".
 */
export function nonMaxSuppress(edges: Gradient, width: number, height: number): Float32Array {
  const { magnitude, gx, gy } = edges;
  const out = new Float32Array(magnitude.length);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const mag = magnitude[i];
      if (mag <= 0) continue;

      // Angle of the gradient, folded into 0..180 — an edge and its reverse
      // are the same edge.
      let angle = (Math.atan2(gy[i], gx[i]) * 180) / Math.PI;
      if (angle < 0) angle += 180;

      let a: number;
      let b: number;
      if (angle < 22.5 || angle >= 157.5) {
        a = magnitude[i - 1];
        b = magnitude[i + 1];
      } else if (angle < 67.5) {
        a = magnitude[i - width + 1];
        b = magnitude[i + width - 1];
      } else if (angle < 112.5) {
        a = magnitude[i - width];
        b = magnitude[i + width];
      } else {
        a = magnitude[i - width - 1];
        b = magnitude[i + width + 1];
      }

      // Strict on one side, permissive on the other. Comparing >= against both
      // neighbours keeps plateaus, and a region of smooth shading is exactly a
      // plateau — every pixel ties with the one next to it, so none is
      // suppressed and the whole gradient survives to be flood-filled through
      // by any real edge that touches it. Breaking the tie removes it.
      if (mag > a && mag >= b) out[i] = mag;
    }
  }
  return out;
}

/**
 * Two thresholds instead of one: anything above `high` starts a line, and
 * anything above `low` continues one that has already started.
 *
 * A single threshold has to choose between admitting shading noise and
 * chopping real lines into dashes wherever they pass through a low-contrast
 * stretch. This is what keeps a contour whole as it crosses a shadow.
 */
export function hysteresis(
  thinned: Float32Array,
  width: number,
  height: number,
  low: number,
  high: number
): Uint8Array {
  const out = new Uint8Array(thinned.length);
  const stack: number[] = [];

  for (let i = 0; i < thinned.length; i++) {
    if (thinned[i] >= high) {
      out[i] = 1;
      stack.push(i);
    }
  }

  while (stack.length) {
    const i = stack.pop()!;
    const x = i % width;
    const y = (i / width) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= width) continue;
        const j = yy * width + xx;
        if (out[j] || thinned[j] < low) continue;
        out[j] = 1;
        stack.push(j);
      }
    }
  }
  return out;
}

/**
 * Drops connected fragments smaller than `minPixels`.
 *
 * Rendered shading and surface texture survive hysteresis as short, isolated
 * scraps. They are not lines anyone would draw, and on a stencil they read as
 * dirt — which is what makes a dense piece look like a smear rather than a
 * drawing.
 */
export function removeSpecks(
  mask: Uint8Array,
  width: number,
  height: number,
  minPixels: number
): Uint8Array {
  if (minPixels <= 1) return Uint8Array.from(mask);
  const out = new Uint8Array(mask.length);
  const seen = new Uint8Array(mask.length);
  const stack: number[] = [];

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    const component: number[] = [];

    while (stack.length) {
      const i = stack.pop()!;
      component.push(i);
      const x = i % width;
      const y = (i / width) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const j = yy * width + xx;
          if (!mask[j] || seen[j]) continue;
          seen[j] = 1;
          stack.push(j);
        }
      }
    }

    if (component.length >= minPixels) {
      for (const i of component) out[i] = 1;
    }
  }
  return out;
}

export type EdgeOptions = {
  /** Gradient strength that starts a line, 0..255. */
  high: number;
  /** Gradient strength that continues one. Below about half of `high` this
   *  starts letting shading in through the back door. */
  low: number;
  /** Shortest run of pixels that counts as a line rather than as dirt. */
  minRun: number;
};

/**
 * The whole chain: structural lines, one pixel wide, with the texture dropped.
 */
export function structuralEdges(
  gray: Float32Array,
  width: number,
  height: number,
  options: EdgeOptions
): Uint8Array {
  const thinned = nonMaxSuppress(gradient(gray, width, height), width, height);
  const linked = hysteresis(thinned, width, height, options.low, options.high);
  return removeSpecks(linked, width, height, options.minRun);
}

/**
 * Sensible thresholds for a given gradient threshold setting.
 *
 * A rendered illustration and a photograph of a plain subject need opposite
 * treatment, which is the reverse of what I first assumed. A render's
 * *internal* edges — the line between a helmet and the hair behind it — are
 * soft, because the artist blended them, so a strict threshold throws the
 * drawing away and keeps only the outer silhouette. It therefore needs a more
 * permissive threshold; and having been permissive, it must not then also
 * demand long unbroken runs, or everything it just admitted gets deleted as
 * dirt. Measured against real generated artwork, not reasoned about.
 *
 * A photograph of a plain subject has the opposite problem — strong edges,
 * plus sensor noise that a permissive threshold would happily admit.
 */
export function thresholdsFrom(threshold: number, denseSource: boolean): EdgeOptions {
  if (denseSource) {
    const high = Math.max(8, threshold * 0.4);
    return { high, low: high * 0.25, minRun: 6 };
  }
  const high = Math.max(8, threshold);
  return { high, low: high * 0.4, minRun: 8 };
}
