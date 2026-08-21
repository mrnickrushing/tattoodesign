// What the linework actually looks like on the person wearing it.
//
// Every preview in the app draws black on `theme.stock` — warm flash paper —
// and paper is the one surface the design will never end up on. Black on paper
// is a 19:1 contrast; the same black on deep skin is closer to 3:1, and a
// 0.25mm fine line that reads beautifully on the sheet is invisible at arm's
// length on the arm.
//
// Pure colour maths over the sRGB numbers. Sits beside spacing.ts, which asks
// the same kind of question about gaps rather than weights.

import { parseHex, type Rgb } from "./icingRecipe";

export type SkinTone = {
  id: string;
  label: string;
  hex: string;
  /**
   * CIE L*, 0 (black) to 100 (white). Derived from `hex` rather than typed in,
   * so the two can never drift apart.
   */
  l: number;
};

/**
 * Skin as it photographs, not as a swatch book prints it.
 *
 * Six entries after the Fitzpatrick scale, which is a classification of how
 * skin responds to UV rather than a palette — these are representative mid
 * tones for each type, and real skin on a real arm varies by more than the gap
 * between two of them. They exist so the preview is approximately right
 * instead of exactly wrong, and so the "will this line hold" question below has
 * something to be asked against. A photograph of the actual limb beats all six.
 */
const TONE_SOURCE: { id: string; label: string; hex: string }[] = [
  { id: "i", label: "Type I — very fair", hex: "#F6D7C4" },
  { id: "ii", label: "Type II — fair", hex: "#EFC1A2" },
  { id: "iii", label: "Type III — light olive", hex: "#D9A278" },
  { id: "iv", label: "Type IV — olive", hex: "#B57B52" },
  { id: "v", label: "Type V — brown", hex: "#8A5636" },
  { id: "vi", label: "Type VI — deep brown", hex: "#4E3020" },
];

/** sRGB channel to its linear-light value. */
function linearise(channel: number): number {
  const v = channel / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance, 0..1, as WCAG defines it. */
export function relativeLuminance(colour: Rgb): number {
  return (
    0.2126 * linearise(colour.r) + 0.7152 * linearise(colour.g) + 0.0722 * linearise(colour.b)
  );
}

/**
 * CIE L*, 0..100. Perceptual lightness rather than raw luminance: the midpoint
 * of L* looks like a mid grey, where the midpoint of luminance looks pale.
 */
export function lightness(hex: string): number {
  const colour = parseHex(hex);
  if (!colour) return 0;
  const y = relativeLuminance(colour);
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : y * (24389 / 27);
}

export const SKIN_TONES: SkinTone[] = TONE_SOURCE.map((tone) => ({ ...tone, l: lightness(tone.hex) }));

export function findSkinTone(id: string): SkinTone | undefined {
  return SKIN_TONES.find((tone) => tone.id === id);
}

/**
 * WCAG contrast ratio between ink and skin, 1 (invisible) to 21 (black on
 * white). Unparseable colours come back as 1, which reads as "cannot tell them
 * apart" and is the safe way to be wrong.
 */
export function lineContrast(inkHex: string, skinHex: string): number {
  const ink = parseHex(inkHex);
  const skin = parseHex(skinHex);
  if (!ink || !skin) return 1;
  const a = relativeLuminance(ink);
  const b = relativeLuminance(skin);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Finest line that still reads, in millimetres, at a given ink-to-skin
 * contrast.
 *
 * Starting estimate, in the same spirit as MIN_LINE_GAP_MM in spacing.ts: an
 * 0.25mm liner holds on fair skin, and the weight has to come up as the
 * contrast falls. Square-root rather than linear — halving the contrast does
 * not double the weight a line needs, and a linear rule reaches implausible
 * widths by Type VI.
 */
export const FINEST_LINE_MM = 0.25;
const REFERENCE_CONTRAST = 12;

/**
 * The heaviest weight the rule can ask for, reached at the 1:1 contrast of ink
 * against skin the same colour. Derived rather than chosen — a contrast ratio
 * cannot go below 1, so this is where the curve ends on its own.
 */
export const HEAVIEST_LINE_MM = Math.round(FINEST_LINE_MM * Math.sqrt(REFERENCE_CONTRAST) * 100) / 100;

export function minLineWidthMm(contrast: number): number {
  if (!(contrast > 0)) return HEAVIEST_LINE_MM;
  const needed = FINEST_LINE_MM * Math.sqrt(REFERENCE_CONTRAST / contrast);
  return Math.min(HEAVIEST_LINE_MM, Math.max(FINEST_LINE_MM, Math.round(needed * 100) / 100));
}

export type ContrastAdvice = {
  /** WCAG ratio between the ink and the skin. */
  contrast: number;
  /** Finest weight that will hold on this tone. */
  minLineMm: number;
  /** Whether the design's own weight clears that. */
  level: "pass" | "warn";
  detail: string;
};

/**
 * Whether a design's finest line survives on a given tone.
 *
 * `lineMm` is the thinnest weight in the piece — the detail line, not the
 * contour — because that is the one that disappears first.
 */
export function contrastAdvice(inkHex: string, tone: SkinTone, lineMm: number): ContrastAdvice {
  const contrast = lineContrast(inkHex, tone.hex);
  const minLineMm = minLineWidthMm(contrast);
  if (lineMm >= minLineMm) {
    return {
      contrast,
      minLineMm,
      level: "pass",
      detail: `At ${contrast.toFixed(1)}:1 against ${tone.label.toLowerCase()}, ${lineMm.toFixed(2)}mm linework holds.`,
    };
  }
  return {
    contrast,
    minLineMm,
    level: "warn",
    detail: `${lineMm.toFixed(2)}mm is finer than the ${minLineMm.toFixed(2)}mm this tone holds at ${contrast.toFixed(1)}:1. Take the detail lines up, or the piece reads as a smudge from arm's length.`,
  };
}
