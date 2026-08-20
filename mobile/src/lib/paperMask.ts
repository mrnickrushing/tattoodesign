// Deciding which pixels are paper.
//
// "Remove the white background" sounds like a threshold, and a threshold is
// what it is — but on what? A generated stencil is on pure white. A scan is on
// cream. A JPEG is on white that is actually a thousand shades of nearly-white
// with ringing around every line. Assuming #ffffff misses all but the first,
// and the design arrives on a cake pop still carrying a pale grey rectangle.
//
// So the paper is measured rather than assumed: sample the border, where a
// centred design has none of itself, and take the ink cutoff from what is
// actually there.
//
// Pure array maths so the thing that decides what survives can be tested.

export type PaperProfile = {
  /** Luminance at or above which a pixel is definitely paper. */
  paper: number;
  /** Below this a pixel is definitely ink. Between the two it fades. */
  solid: number;
};

/** How far in from the edge to sample, as a fraction of the smaller side. */
const BORDER = 0.04;

/**
 * Never treat anything darker than this as paper, however pale the border
 * looked. A design that runs to its own edges would otherwise sample its own
 * linework and decide the ink is the background.
 */
const DARKEST_PAPER = 170;

/**
 * The paper level, read from the border of the image.
 *
 * The median rather than the mean: a design that touches one edge drags a mean
 * down toward its ink, where a median shrugs it off unless the ink covers most
 * of the border — at which point there is no background to find anyway.
 */
export function profilePaper(gray: Uint8Array, width: number, height: number): PaperProfile {
  const inset = Math.max(1, Math.round(Math.min(width, height) * BORDER));
  const samples: number[] = [];
  for (let y = 0; y < height; y++) {
    const vertical = y < inset || y >= height - inset;
    for (let x = 0; x < width; x++) {
      if (!vertical && x >= inset && x < width - inset) continue;
      samples.push(gray[y * width + x]);
    }
  }
  if (!samples.length) return { paper: 246, solid: 200 };

  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  const paper = Math.max(DARKEST_PAPER, median - 6);
  // The fade is proportional rather than fixed. An antialiased edge spreads
  // across the whole distance from ink to paper, so that distance is what sets
  // how wide the ramp should be — on cream the span is shorter and the ramp
  // narrows with it. A fixed ramp would be too wide there and eat real ink.
  return { paper, solid: Math.max(20, paper - Math.max(46, paper * 0.22)) };
}

/**
 * How opaque a pixel should end up, 0..1.
 *
 * Soft rather than binary: a hard cutoff leaves every antialiased edge ringed
 * with half-paper pixels, which reads as a grubby halo at exactly the size
 * this is meant to be judged at.
 */
export function paperAlpha(luminance: number, profile: PaperProfile): number {
  if (luminance >= profile.paper) return 0;
  if (luminance <= profile.solid) return 1;
  return (profile.paper - luminance) / (profile.paper - profile.solid);
}
