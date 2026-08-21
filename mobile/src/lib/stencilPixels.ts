// The arithmetic half of the photo -> stencil pipeline.
//
// Grayscale, background suppression, blur, Sobel edge detection, thresholding
// and line thickening: every step is an array in and an array out, and none of
// it needs a graphics library. `stencil.ts` keeps the half that does — decoding
// an image, scaling it, reading its pixels back, painting the result — and
// calls in here for the rest.
//
// Split for the same reason `sketch.ts` sits apart from `sketchDeskew.ts` and
// `castingTray.ts` from `productionTools.ts`: Skia binds its whole API at
// import time and cannot load under the test runner, so anything sharing a file
// with it is untestable however plain it is. This is the pipeline that decides
// what an artist transfers onto skin. A wrong threshold or a blur that reads
// past its own edges would show up as *slightly* wrong stencils forever, which
// is exactly the sort of thing nobody notices and a test would.

export type StencilMode = "outline" | "fine" | "photocopy" | "halftone" | "crosshatch" | "centerline";

export type StencilOptions = {
  /** Longest side the source image is downscaled to before processing. */
  maxDimension?: number;
  /** Gradient magnitude (0-255) above which a pixel becomes a line. Lower = more lines. */
  threshold?: number;
  /** Radius (px) used to thicken detected lines. 0 = hairline. */
  lineWeight?: number;
  /** Box-blur radius applied before edge detection to suppress noise. */
  denoise?: number;
  /** Invert to white-on-black instead of the default black-on-white. */
  invert?: boolean;
  /** Rendering strategy. Each mode is tuned for a different transfer style. */
  mode?: StencilMode;
  /** Suppress a flat background sampled from the image corners before tracing. */
  isolateBackground?: boolean;
  /**
   * Pick the pipeline from what the source actually is.
   *
   * Edge detection is right for a photograph and wrong for a drawing: a
   * drawing's strokes have two edges each, so every line comes back doubled.
   * When this is on, an image that is already line art takes the centreline
   * path instead. See lib/lineart.ts.
   */
  autoDetectSource?: boolean;
};

export const DEFAULT_STENCIL_OPTIONS: Required<StencilOptions> = {
  maxDimension: 1200,
  threshold: 60,
  lineWeight: 1,
  denoise: 1,
  invert: false,
  mode: "outline",
  isolateBackground: false,
  autoDetectSource: true,
};

export type StencilMask = {
  /** One byte per pixel: 1 where a line was detected, 0 elsewhere. */
  mask: Uint8Array;
  width: number;
  height: number;
};

/** RGBA to luminance, at the weights the eye actually uses. */
export function toGrayscale(pixels: Uint8Array): Float32Array {
  const out = new Float32Array(pixels.length / 4);
  for (let i = 0, j = 0; i < pixels.length; i += 4, j++) {
    out[j] = pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114;
  }
  return out;
}

/**
 * Blanks out a flat field sampled from the four corners.
 *
 * For a photograph taken against paper or a wall, the background is whatever
 * the corners agree on. Anything close to it goes white and stops generating
 * edges of its own.
 */
export function suppressBackground(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(pixels);
  const sample = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return [pixels[i], pixels[i + 1], pixels[i + 2]] as const;
  };
  const corners = [sample(0, 0), sample(width - 1, 0), sample(0, height - 1), sample(width - 1, height - 1)];
  const bg = [0, 1, 2].map((channel) => corners.reduce((sum, color) => sum + color[channel], 0) / corners.length);
  // A deliberately conservative cutoff: this removes paper/wall fields while
  // preserving skin texture and pale artwork that aggressive segmentation loses.
  const tolerance = 42;
  for (let i = 0; i < out.length; i += 4) {
    const distance = Math.sqrt(
      (out[i] - bg[0]) ** 2 + (out[i + 1] - bg[1]) ** 2 + (out[i + 2] - bg[2]) ** 2
    );
    if (distance < tolerance) out[i] = out[i + 1] = out[i + 2] = 255;
  }
  return out;
}

/**
 * Averages each pixel with its neighbours, so noise stops reading as edges.
 *
 * Divided by how many neighbours were actually in bounds rather than by the
 * full window, so the edge of the picture is not darkened by the void outside
 * it — which would then be detected as an edge, which is the one thing this
 * step exists to prevent.
 *
 * Done as two one-dimensional passes over a running total, which is the same
 * arithmetic as the obvious square loop and enormously less of it. A box blur
 * separates exactly: blurring rows and then columns divides by
 * `countX * countY`, and the square loop divides by the size of the same
 * rectangle. The running total then makes each pass cost the same per pixel
 * whatever the radius — at the widest setting the app offers, the square
 * version reads eighty-one pixels for every one it writes.
 */
export function boxBlur(src: Float32Array, width: number, height: number, radius: number): Float32Array {
  if (radius <= 0) return src;

  const rows = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let total = 0;
    let lo = 0;
    let hi = -1;
    for (let x = 0; x < width; x++) {
      const wantLo = Math.max(0, x - radius);
      const wantHi = Math.min(width - 1, x + radius);
      while (hi < wantHi) total += src[row + ++hi];
      while (lo < wantLo) total -= src[row + lo++];
      rows[row + x] = total / (wantHi - wantLo + 1);
    }
  }

  const out = new Float32Array(src.length);
  for (let x = 0; x < width; x++) {
    let total = 0;
    let lo = 0;
    let hi = -1;
    for (let y = 0; y < height; y++) {
      const wantLo = Math.max(0, y - radius);
      const wantHi = Math.min(height - 1, y + radius);
      while (hi < wantHi) total += rows[++hi * width + x];
      while (lo < wantLo) total -= rows[lo++ * width + x];
      out[y * width + x] = total / (wantHi - wantLo + 1);
    }
  }
  return out;
}

const SOBEL_X = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
const SOBEL_Y = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

/**
 * How sharply the picture changes at each pixel, normalised to 0-255.
 *
 * Normalised against the strongest gradient *in this image*, so the threshold
 * means the same thing whatever the contrast of the source. The one-pixel
 * border is left at zero: a 3x3 kernel has nothing to read there.
 */
export function sobelMagnitude(gray: Float32Array, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  let max = 1;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let gx = 0;
      let gy = 0;
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const v = gray[(y + dy) * width + (x + dx)];
          gx += v * SOBEL_X[k];
          gy += v * SOBEL_Y[k];
          k++;
        }
      }
      const mag = Math.sqrt(gx * gx + gy * gy);
      out[y * width + x] = mag;
      if (mag > max) max = mag;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] / max) * 255;
  return out;
}

/** Thickens a mask by a radius, so a hairline survives being transferred. */
export function dilate(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return mask;
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let on = false;
      for (let dy = -radius; dy <= radius && !on; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          if (mask[yy * width + xx]) {
            on = true;
            break;
          }
        }
      }
      out[y * width + x] = on ? 1 : 0;
    }
  }
  return out;
}

/**
 * Which pixels become line, by the strategy asked for.
 *
 * `outline` and `fine` are edge detection — a line where the picture changes
 * sharply. The rest are tone: `photocopy` cuts everything darker than a level,
 * `halftone` grows a dot per cell as the tone darkens, `crosshatch` lays down
 * more sets of strokes the darker it gets. Different transfers want different
 * things, and none of them is a filter over the others.
 */
export function buildMask(
  mode: StencilMode,
  gray: Float32Array,
  magnitude: Float32Array,
  width: number,
  height: number,
  threshold: number
): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const tone = gray[i];
      if (mode === "photocopy") {
        mask[i] = tone < Math.min(245, threshold + 95) ? 1 : 0;
      } else if (mode === "halftone") {
        const cell = 7;
        const radius = Math.max(0, Math.round(((255 - tone) / 255) * 3));
        const dx = (x % cell) - Math.floor(cell / 2);
        const dy = (y % cell) - Math.floor(cell / 2);
        mask[i] = radius > 0 && dx * dx + dy * dy <= radius * radius ? 1 : 0;
      } else if (mode === "crosshatch") {
        const darkness = 255 - tone;
        const hatch = (x + y) % 9 === 0 || (darkness > 95 && (x - y + height) % 11 === 0) || (darkness > 165 && y % 7 === 0);
        mask[i] = darkness > 45 && hatch ? 1 : 0;
      } else {
        const cutoff = mode === "fine" ? threshold * 1.18 : threshold;
        mask[i] = magnitude[i] > cutoff ? 1 : 0;
      }
    }
  }
  return mask;
}

/**
 * Whether the picture is a subject on a plain field or rendered edge to edge.
 *
 * A photo of a rose on a wall has large flat areas; a fully shaded
 * illustration has texture everywhere. The second needs a much longer run
 * before a fragment is believed to be a line, or its shading arrives as dirt.
 */
export function isPlainSubject(gray: Uint8Array): boolean {
  if (!gray.length) return true;
  let flatRuns = 0;
  for (let i = 1; i < gray.length; i++) {
    if (Math.abs(gray[i] - gray[i - 1]) <= 2) flatRuns++;
  }
  return flatRuns / gray.length > 0.7;
}
