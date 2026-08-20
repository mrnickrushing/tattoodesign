// Making a stencil out of something that is already a drawing.
//
// stencil.ts runs Sobel edge detection, which answers "where does brightness
// change?". For a photograph that is exactly the right question. For an image
// that is *already* black line art on white — which is what the generator
// produces — it is the wrong question, and the output shows it:
//
//   - Every line comes back doubled. A 3px black stroke has two edges, so the
//     tracer returns two thin lines with a gap down the middle where the ink
//     actually was. On skin you would trace both.
//   - Solid black areas come back as blobs. A filled beard or a raven's wing
//     has no internal gradient, so it survives as a mass of black that tells
//     you nothing about where to put the needle.
//   - Fine texture becomes speckle, because every little tonal wobble clears
//     the gradient threshold somewhere.
//
// The right question for a drawing is "where is the ink, and what is its
// centre?". So: threshold the ink directly, thin it to a single-pixel spine,
// and re-stroke that spine at one chosen weight. Solid regions are handled
// separately — an artist wants the *outline* of a black shape so they know
// what to fill, not a spidery skeleton through the middle of it.
//
// Pure array math over a grayscale buffer. No Skia, so the decision that
// determines whether a stencil is usable can be verified off-device.

export type SourceKind = "lineart" | "photo";

export type SourceProfile = {
  kind: SourceKind;
  /** Fraction of pixels that are essentially paper. */
  paper: number;
  /** Fraction that are essentially ink. */
  ink: number;
  /** Fraction in between — the tones a photograph is mostly made of. */
  mid: number;
};

/** Above this is paper, below the ink cutoff is ink; the rest is tone. */
const PAPER_LEVEL = 235;
const INK_LEVEL = 60;

/**
 * Line art is bimodal: nearly all paper and ink, with very little in between.
 * A photograph — even a high-contrast one — lives in the middle. The cutoff is
 * deliberately generous, because misreading a drawing as a photo produces the
 * doubled-line output this module exists to avoid, while misreading a photo as
 * a drawing merely produces a flat threshold, which is a recoverable mistake.
 */
export function classifySource(gray: Uint8Array): SourceProfile {
  if (!gray.length) return { kind: "photo", paper: 0, ink: 0, mid: 0 };
  let paper = 0;
  let ink = 0;
  for (let i = 0; i < gray.length; i++) {
    if (gray[i] >= PAPER_LEVEL) paper++;
    else if (gray[i] <= INK_LEVEL) ink++;
  }
  const total = gray.length;
  const mid = (total - paper - ink) / total;
  return {
    kind: mid < 0.12 && paper / total > 0.4 && ink / total > 0.002 ? "lineart" : "photo",
    paper: paper / total,
    ink: ink / total,
    mid,
  };
}

/** Everything darker than the cutoff. */
export function inkMask(gray: Uint8Array, threshold = 160): Uint8Array {
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = gray[i] < threshold ? 1 : 0;
  return out;
}

const ORTHOGONAL = 1;
const DIAGONAL = Math.SQRT2;

/** Distance from each set pixel to the nearest clear one, by two-pass chamfer. */
export function distanceInside(mask: Uint8Array, width: number, height: number): Float32Array {
  const dist = new Float32Array(mask.length);
  const BIG = width + height;
  for (let i = 0; i < mask.length; i++) dist[i] = mask[i] ? BIG : 0;

  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : dist[y * width + x]);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      dist[i] = Math.min(
        dist[i],
        at(x - 1, y) + ORTHOGONAL,
        at(x, y - 1) + ORTHOGONAL,
        at(x - 1, y - 1) + DIAGONAL,
        at(x + 1, y - 1) + DIAGONAL
      );
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (!mask[i]) continue;
      dist[i] = Math.min(
        dist[i],
        at(x + 1, y) + ORTHOGONAL,
        at(x, y + 1) + ORTHOGONAL,
        at(x + 1, y + 1) + DIAGONAL,
        at(x - 1, y + 1) + DIAGONAL
      );
    }
  }
  return dist;
}

export function dilate(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return Uint8Array.from(mask);
  const out = new Uint8Array(mask.length);
  const r2 = radius * radius;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width || dx * dx + dy * dy > r2) continue;
          out[yy * width + xx] = 1;
        }
      }
    }
  }
  return out;
}

/** The one-pixel rim of a region: set pixels that touch a clear one. */
export function boundary(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      const edge =
        x === 0 ||
        y === 0 ||
        x === width - 1 ||
        y === height - 1 ||
        !mask[i - 1] ||
        !mask[i + 1] ||
        !mask[i - width] ||
        !mask[i + width];
      if (edge) out[i] = 1;
    }
  }
  return out;
}

export type CenterlineOptions = {
  /** Below this grey a pixel counts as ink. */
  threshold: number;
  /**
   * Half-width, in pixels, above which a region stops being a stroke and
   * starts being a filled shape. A drawn line is a few pixels across; a filled
   * beard is tens.
   */
  fillRadius: number;
  /** Final line weight, in pixels. 1 is a hairline. */
  weight: number;
};

export const DEFAULT_CENTERLINE: CenterlineOptions = {
  threshold: 170,
  fillRadius: 4,
  weight: 1,
};

export type CenterlineResult = {
  mask: Uint8Array;
  /** Fraction of the ink that was treated as a filled shape rather than a line. */
  filled: number;
};

/**
 * A stencil from a drawing: one clean line per drawn line.
 *
 * Strokes are thinned to their spine and re-stroked at a single weight, so
 * nothing comes back doubled and the whole piece reads at one line weight.
 * Anything too thick to be a stroke is replaced by its outline, which is what
 * an artist needs in order to know what to pack solid.
 */
export function centerlineStencil(
  gray: Uint8Array,
  width: number,
  height: number,
  thin: (mask: Uint8Array, width: number, height: number) => Uint8Array,
  options: CenterlineOptions = DEFAULT_CENTERLINE
): CenterlineResult {
  const ink = inkMask(gray, options.threshold);
  const total = ink.reduce<number>((sum, value) => sum + value, 0);
  if (!total) return { mask: ink, filled: 0 };

  // Deep interior: only a shape much thicker than a line reaches this far from
  // its own edge. Growing it back out recovers roughly the whole shape.
  const dist = distanceInside(ink, width, height);
  const core = new Uint8Array(ink.length);
  let coreCount = 0;
  for (let i = 0; i < ink.length; i++) {
    if (dist[i] > options.fillRadius) {
      core[i] = 1;
      coreCount++;
    }
  }

  let solid = new Uint8Array(ink.length);
  if (coreCount) {
    const grown = dilate(core, width, height, Math.ceil(options.fillRadius) + 1);
    for (let i = 0; i < ink.length; i++) solid[i] = grown[i] && ink[i] ? 1 : 0;
  }

  const strokes = new Uint8Array(ink.length);
  let filled = 0;
  for (let i = 0; i < ink.length; i++) {
    if (!ink[i]) continue;
    if (solid[i]) filled++;
    else strokes[i] = 1;
  }

  const spine = thin(strokes, width, height);
  const rim = coreCount ? boundary(solid, width, height) : solid;

  const combined = new Uint8Array(ink.length);
  for (let i = 0; i < combined.length; i++) combined[i] = spine[i] || rim[i] ? 1 : 0;

  return {
    mask: options.weight > 1 ? dilate(combined, width, height, Math.round(options.weight) - 1) : combined,
    filled: filled / total,
  };
}
