// The value study every good artist does before touching a line.
//
// A photo has 256 levels of grey. Skin holds about four: the light the
// highlight sits in, the mid the piece mostly reads as, the shadow that gives
// it form, and solid black. Deciding which of the 256 belong to which of the
// four is the single biggest quality lever between a photo and a stencil, and
// until this module existed the pipeline went straight from pixels to edges
// and never made that decision at all.
//
// Two ways to draw the lines between bands, and the difference matters:
//
//   Even        — split the range 0..255 into equal slices. Correct when the
//                 source already uses its whole range.
//   Balanced    — split so each band holds roughly the same number of pixels.
//                 A photo shot in flat light lives inside a narrow slice of
//                 the range; even bands put almost every pixel in one of them
//                 and the study says nothing. Balanced bands always separate.
//
// Pure array math over a grayscale buffer, so the decision that shapes every
// stencil after it is verifiable off-device.

import { DEFAULT_SHADING, type ShadingOptions } from "./shading";

/** How many values a stencil can usefully separate a photo into. */
export const MIN_BANDS = 2;
export const MAX_BANDS = 6;
export const DEFAULT_BANDS = 4;

export type BandStrategy = "even" | "balanced";

export function clampBands(count: number): number {
  if (!Number.isFinite(count)) return DEFAULT_BANDS;
  return Math.max(MIN_BANDS, Math.min(MAX_BANDS, Math.round(count)));
}

/** 256-bin luminance histogram. */
export function histogram(gray: Uint8Array): Uint32Array {
  const bins = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) bins[gray[i]]++;
  return bins;
}

/**
 * The `count - 1` luminance values that separate one band from the next,
 * ascending. Band 0 is the darkest — the ink end — because that is the order
 * the shading renderers lay marks down in.
 */
export function thresholds(gray: Uint8Array, count: number, strategy: BandStrategy): number[] {
  const bands = clampBands(count);
  if (strategy === "even") {
    return Array.from({ length: bands - 1 }, (_, i) => Math.round(((i + 1) * 256) / bands));
  }

  // Equal-population split: walk the histogram handing out pixels until each
  // band has its share. Ties are pushed forward rather than split, so a photo
  // dominated by one value gets fewer usable bands instead of several
  // identical ones — which is the honest answer for that photo.
  const bins = histogram(gray);
  const target = gray.length / bands;
  const cuts: number[] = [];
  let seen = 0;
  let next = target;
  for (let value = 0; value < 256 && cuts.length < bands - 1; value++) {
    seen += bins[value];
    while (cuts.length < bands - 1 && seen >= next) {
      cuts.push(value + 1);
      next += target;
    }
  }
  // A flat image can run out of histogram before it runs out of bands.
  while (cuts.length < bands - 1) cuts.push(256);
  return cuts;
}

/** Which band each pixel falls in, 0 for the darkest. */
export function posterize(gray: Uint8Array, cuts: number[]): Uint8Array {
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    const value = gray[i];
    let band = 0;
    while (band < cuts.length && value >= cuts[band]) band++;
    out[i] = band;
  }
  return out;
}

/**
 * A 0/1 mask of one band. `andDarker` includes everything below it too, which
 * is what shading wants — a mid-tone region is covered by the mid pass *and*
 * anything the shadow pass laid down, the way ink actually accumulates.
 */
export function bandMask(bands: Uint8Array, band: number, andDarker = false): Uint8Array {
  const out = new Uint8Array(bands.length);
  for (let i = 0; i < bands.length; i++) {
    out[i] = andDarker ? (bands[i] <= band ? 1 : 0) : bands[i] === band ? 1 : 0;
  }
  return out;
}

/** Fraction of the image each band holds. Drives the "is this study useful?" read. */
export function coverage(bands: Uint8Array, count: number): number[] {
  const counts = new Array(clampBands(count)).fill(0) as number[];
  for (let i = 0; i < bands.length; i++) {
    if (bands[i] < counts.length) counts[bands[i]]++;
  }
  return counts.map((n) => (bands.length ? n / bands.length : 0));
}

/**
 * The grey each band should preview as: the midpoint of its own slice, so the
 * study reads as a poster of the photo rather than as an arbitrary ramp.
 */
export function bandTones(cuts: number[]): number[] {
  const edges = [0, ...cuts, 256];
  return edges.slice(0, -1).map((low, i) => Math.min(255, Math.round((low + edges[i + 1] - 1) / 2)));
}

/**
 * The flattened value study as an 8-bit image buffer.
 *
 * Not just a debug view: this is what the artist judges before committing, and
 * what the shading pass is a translation of.
 */
export function renderStudy(bands: Uint8Array, cuts: number[]): Uint8Array {
  const tones = bandTones(cuts);
  const out = new Uint8Array(bands.length);
  for (let i = 0; i < bands.length; i++) out[i] = tones[Math.min(tones.length - 1, bands[i])];
  return out;
}

export type TonePass = {
  /** Marks for this band, or null to leave it as bare paper. */
  shading: ShadingOptions | null;
};

export type SeparationPlan = {
  bands: number;
  strategy: BandStrategy;
  /** One entry per band, index 0 darkest. */
  passes: TonePass[];
};

/**
 * A sensible starting point: dark bands get ink, light bands stay paper.
 *
 * Lives here rather than beside the Skia bridge so the plan that decides what
 * a stencil is made of can be verified off-device — the same split spacing.ts
 * uses for the same reason.
 */
export function defaultPlan(bands = DEFAULT_BANDS): SeparationPlan {
  const count = clampBands(bands);
  return {
    bands: count,
    strategy: "balanced",
    passes: Array.from({ length: count }, (_, index) => {
      // Darkest band solid, next whipped, the one above peppered, and
      // everything lighter left alone — the order an artist works in.
      if (index === 0) return { shading: { ...DEFAULT_SHADING, style: "solid", weight: 2.5, seed: 11 } };
      if (index === 1) return { shading: { ...DEFAULT_SHADING, style: "whip", density: 0.55, seed: 23 } };
      if (index === 2 && count > 3) return { shading: { ...DEFAULT_SHADING, style: "pepper", density: 0.4, seed: 37 } };
      return { shading: null };
    }),
  };
}

