// What this will look like in ten years.
//
// Tattoo ink migrates through the dermis for the life of the piece: lines
// thicken, fine detail softens, and black fades toward blue-grey. Fine work
// that reads beautifully on paper can close into a blob by year five, and the
// only way most artists learn this is by seeing their own old work.
//
// The three effects map onto operations the stencil pipeline already uses —
// spread is a dilation, softening is a blur, fading is a contrast reduction.
// Spread is specified in *millimetres* and converted to pixels by the caller's
// print density, so the simulation stays honest across resolutions instead of
// drifting with image size.
//
// Skia-free so the model can be verified off-device; productionTools.ts wraps
// it for the actual image.

export type HealAge = "fresh" | "twoYear" | "tenYear";

export const HEAL_AGES: { id: HealAge; label: string; caption: string }[] = [
  { id: "fresh", label: "Fresh", caption: "The day it heals" },
  { id: "twoYear", label: "2 years", caption: "Settled, lines slightly open" },
  { id: "tenYear", label: "10 years", caption: "Spread and softened" },
];

export type HealingProfile = {
  /** How far ink migrates outward from each line, in pixels. */
  spreadPx: number;
  /** How much fine detail softens, in pixels. */
  blurPx: number;
  /** Remaining contrast against the skin. 1 keeps the original density. */
  contrast: number;
};

/**
 * Migration per age, in millimetres.
 *
 * These are a defensible starting estimate, not measured data — see the
 * owner-gated blockers in docs/wave-plan-vector-production.md. Presented to
 * the artist as an estimate for exactly that reason.
 */
const MIGRATION_MM: Record<HealAge, { spread: number; blur: number; contrast: number }> = {
  fresh: { spread: 0, blur: 0, contrast: 1 },
  twoYear: { spread: 0.12, blur: 0.1, contrast: 0.88 },
  tenYear: { spread: 0.35, blur: 0.3, contrast: 0.7 },
};

export function healingProfile(age: HealAge, pxPerMm: number): HealingProfile {
  const migration = MIGRATION_MM[age] ?? MIGRATION_MM.fresh;
  const density = Number.isFinite(pxPerMm) && pxPerMm > 0 ? pxPerMm : 0;
  return {
    spreadPx: migration.spread * density,
    blurPx: migration.blur * density,
    contrast: migration.contrast,
  };
}

/** Darkest-neighbour filter: ink bleeding outward from every line. */
function spreadInk(gray: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius < 1) return gray;
  const out = new Uint8Array(gray.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let darkest = 255;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const value = gray[yy * width + xx];
          if (value < darkest) darkest = value;
        }
      }
      out[y * width + x] = darkest;
    }
  }
  return out;
}

function soften(gray: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius < 1) return gray;
  const out = new Uint8Array(gray.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          sum += gray[yy * width + xx];
          count++;
        }
      }
      out[y * width + x] = Math.round(sum / count);
    }
  }
  return out;
}

/**
 * Ages a luminance buffer: 0 is ink, 255 is skin. Dimensions are preserved, so
 * the result can be shown side by side with the original at the same size.
 */
export function agePixels(
  gray: Uint8Array,
  width: number,
  height: number,
  profile: HealingProfile
): Uint8Array {
  const spread = spreadInk(gray, width, height, Math.round(profile.spreadPx));
  const softened = soften(spread, width, height, Math.round(profile.blurPx));
  if (profile.contrast >= 1) return softened === gray ? Uint8Array.from(gray) : softened;

  const out = new Uint8Array(softened.length);
  for (let i = 0; i < softened.length; i++) {
    // Fade toward the skin rather than toward white — old ink loses density,
    // it does not disappear.
    out[i] = Math.round(255 - (255 - softened[i]) * profile.contrast);
  }
  return out;
}

/** How much of the design is ink, for a before/after readout. */
export function inkCoverage(gray: Uint8Array): number {
  if (!gray.length) return 0;
  let dark = 0;
  for (let i = 0; i < gray.length; i++) if (gray[i] < 128) dark++;
  return dark / gray.length;
}
