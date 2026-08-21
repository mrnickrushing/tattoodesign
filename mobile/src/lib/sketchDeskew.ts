// The pixel half of sketch correction.
//
// sketch.ts decides *where* the sheet is and *what* transform lays it flat;
// this decodes the photo, hands Skia that transform, and encodes the result.
// The split is on purpose — everything with a judgement in it lives next door
// where `tsx --test` can reach it, and what is left here is plumbing.

import {
  AlphaType,
  ColorType,
  FilterMode,
  ImageFormat,
  MipmapMode,
  Skia,
  type SkImage,
} from "@shopify/react-native-skia";
import { stripDataUrlPrefix } from "./files";
import { deskewMatrix, deskewSize, estimatePaperQuad, isAxisAligned, sheetMask, type Quad } from "./sketch";

/**
 * Longest edge the sheet search runs at.
 *
 * Corner detection needs shape, not detail, and a 12-megapixel phone photo is
 * a hundred times more pixels than the answer needs. The corners come back in
 * source-image coordinates regardless — the scale is undone before returning.
 */
const SEARCH_MAX_DIMENSION = 640;

function decode(dataUrl: string): SkImage {
  let image: SkImage | null = null;
  try {
    image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(stripDataUrlPrefix(dataUrl)));
  } catch {
    // Skia's own errors say nothing useful to someone holding a phone.
    image = null;
  }
  if (!image) throw new Error("Couldn't read that image.");
  return image;
}

/** Luminance of every pixel, one byte each, in the ITU-R 601 weighting. */
function toGray(pixels: Uint8Array, count: number): Uint8Array {
  const gray = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const p = i * 4;
    gray[i] = Math.round(pixels[p] * 0.299 + pixels[p + 1] * 0.587 + pixels[p + 2] * 0.114);
  }
  return gray;
}

/**
 * Locates the sheet of paper in a photograph of a sketch.
 *
 * Returns corners in the source photo's own pixels, or null when nothing in the
 * frame reads as a sheet — a rough drawn in-app, a screenshot, a photo shot so
 * close that the paper runs past every edge. Callers should treat null as "this
 * is already flat", not as a failure.
 */
export async function findSheet(dataUrl: string): Promise<Quad | null> {
  const image = decode(dataUrl);
  const sourceWidth = image.width();
  const sourceHeight = image.height();

  const scale = Math.min(1, SEARCH_MAX_DIMENSION / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const surface = Skia.Surface.Make(width, height);
  if (!surface) throw new Error("Couldn't allocate the sheet-detection canvas.");
  surface
    .getCanvas()
    .drawImageRect(
      image,
      Skia.XYWHRect(0, 0, sourceWidth, sourceHeight),
      Skia.XYWHRect(0, 0, width, height),
      Skia.Paint()
    );

  const pixels = surface.makeImageSnapshot().readPixels(0, 0, {
    width,
    height,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  }) as Uint8Array | null;
  if (!pixels) throw new Error("Couldn't read pixel data.");

  const quad = estimatePaperQuad(sheetMask(toGray(pixels, width * height), width, height), width, height);
  if (!quad) return null;

  const back = 1 / scale;
  return {
    tl: { x: quad.tl.x * back, y: quad.tl.y * back },
    tr: { x: quad.tr.x * back, y: quad.tr.y * back },
    br: { x: quad.br.x * back, y: quad.br.y * back },
    bl: { x: quad.bl.x * back, y: quad.bl.y * back },
  };
}

/**
 * Lays a photographed sheet flat.
 *
 * A sheet that is already square-on and already fills the frame is returned
 * byte-for-byte rather than resampled: running it through the homography anyway
 * would cost a generation of interpolation blur to correct nothing, and the
 * stroke consolidation downstream is sensitive to exactly the softening that
 * would add.
 */
export async function deskew(dataUrl: string, quad: Quad): Promise<string> {
  const image = decode(dataUrl);
  const { width, height } = deskewSize(quad);

  const alreadyFlat =
    isAxisAligned(quad) &&
    Math.abs(quad.tl.x) <= 1 &&
    Math.abs(quad.tl.y) <= 1 &&
    Math.abs(width - image.width()) <= 1 &&
    Math.abs(height - image.height()) <= 1;
  if (alreadyFlat) return dataUrl;

  const matrix = deskewMatrix(quad, width, height);
  if (!matrix) throw new Error("Those corners don't make a sheet.");

  const surface = Skia.Surface.Make(width, height);
  if (!surface) throw new Error("Couldn't allocate the deskew canvas.");
  const canvas = surface.getCanvas();
  // White, not transparent: a corner that reaches slightly past the photo's
  // edge should read as unmarked paper, which is what the tracer expects.
  canvas.clear(Skia.Color("white"));
  canvas.concat(matrix);
  canvas.drawImageOptions(image, 0, 0, FilterMode.Linear, MipmapMode.None, Skia.Paint());

  return `data:image/png;base64,${surface.makeImageSnapshot().encodeToBase64(ImageFormat.PNG)}`;
}

/**
 * Find the sheet and lay it flat in one call.
 *
 * The quad comes back alongside the corrected image so a screen can show what
 * it decided and offer to undo it — sheet detection is a guess, and a guess the
 * user cannot see is a guess they cannot correct.
 */
export async function flattenSketch(dataUrl: string): Promise<{ dataUrl: string; quad: Quad | null }> {
  const quad = await findSheet(dataUrl);
  if (!quad) return { dataUrl, quad: null };
  return { dataUrl: await deskew(dataUrl, quad), quad };
}
