// Adds a cut line around a design, the way a sticker or a printed cake topper
// needs one.
//
// The line has to follow the artwork, not a bounding box, or a round topper
// ends up with square corners of blank card. So the ink is measured: a
// distance transform gives every pixel its distance from the nearest mark,
// and the cut line is drawn where that distance equals the gap you asked for.
// Nearby strokes merge into one outline at larger gaps, which is exactly what
// you want — you cut around the design, not around each line in it.
//
// The transform is the standard two-pass chamfer approximation: one sweep
// down-right, one up-left, propagating the smallest distance so far. Two
// passes over the pixels regardless of how wide the gap is, where a dilation
// would cost more for every extra pixel of offset.

import { Skia, ColorType, AlphaType, ImageFormat } from "@shopify/react-native-skia";
import { stripDataUrlPrefix } from "./files";
import { distanceTransform } from "./lineWidth";
import { parseHex } from "./icingRecipe";

export type CutLineOptions = {
  /** Printed width of the design, which is what turns inches into pixels. */
  widthIn: number;
  /** Distance from the artwork to the cut line. */
  gapIn: number;
  /** How thick the printed line is. */
  thicknessIn: number;
  /** Blank margin added around the whole thing, so the line isn't clipped. */
  bleedIn: number;
  color: string;
};

export const DEFAULT_CUT_LINE: CutLineOptions = {
  widthIn: 3,
  gapIn: 0.12,
  thicknessIn: 0.02,
  bleedIn: 0.15,
  color: "#9aa0a6",
};

/** Anything darker than this counts as artwork rather than background. */
const INK_THRESHOLD = 160;

export async function addCutLine(src: string, options: CutLineOptions): Promise<string> {
  let decoded = null;
  try {
    decoded = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(stripDataUrlPrefix(src)));
  } catch {
    decoded = null;
  }
  if (!decoded) throw new Error("Couldn't read that design.");

  const srcW = decoded.width();
  const srcH = decoded.height();
  const pxPerIn = srcW / Math.max(0.25, options.widthIn);
  const pad = Math.round((options.gapIn + options.thicknessIn + options.bleedIn) * pxPerIn);
  const width = srcW + pad * 2;
  const height = srcH + pad * 2;

  const surface = Skia.Surface.Make(width, height);
  if (!surface) throw new Error("Couldn't allocate the canvas.");
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color("white"));
  canvas.drawImageRect(
    decoded,
    Skia.XYWHRect(0, 0, srcW, srcH),
    Skia.XYWHRect(pad, pad, srcW, srcH),
    Skia.Paint()
  );

  const pixels = surface.makeImageSnapshot().readPixels(0, 0, {
    width,
    height,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  }) as Uint8Array | null;
  if (!pixels) throw new Error("Couldn't read the design's pixels.");

  const mask = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    const luminance = pixels[p] * 0.299 + pixels[p + 1] * 0.587 + pixels[p + 2] * 0.114;
    mask[i] = luminance < INK_THRESHOLD ? 1 : 0;
  }

  const dist = distanceTransform(mask, width, height);
  const inner = options.gapIn * pxPerIn;
  const outer = inner + Math.max(1, options.thicknessIn * pxPerIn);
  // A colour that will not parse falls back to the default rather than being
  // let through as NaN, which lands in the byte array as black — a cut line the
  // same colour as the artwork, which is the one thing it must never be.
  const { r, g, b } = parseHex(options.color) ?? parseHex(DEFAULT_CUT_LINE.color)!;

  const out = new Uint8Array(pixels.length);
  out.set(pixels);
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    if (dist[i] >= inner && dist[i] <= outer) {
      out[p] = r;
      out[p + 1] = g;
      out[p + 2] = b;
      out[p + 3] = 255;
    }
  }

  const image = Skia.Image.MakeImage(
    { width, height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
    Skia.Data.fromBytes(out),
    width * 4
  );
  if (!image) throw new Error("Couldn't build the image.");
  return `data:image/png;base64,${image.encodeToBase64(ImageFormat.PNG)}`;
}
