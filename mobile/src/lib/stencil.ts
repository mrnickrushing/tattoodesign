// On-device photo -> stencil pipeline, powered by react-native-skia.
// Mirrors the web app's canvas-based src/lib/stencil.ts pixel-for-pixel:
// grayscale -> blur -> Sobel edge detection -> threshold -> optional
// line-weight dilation. No network call — same as the web version, this
// runs entirely on the device.

import { Skia, ColorType, AlphaType, ImageFormat } from "@shopify/react-native-skia";
import { DEFAULT_CENTERLINE, centerlineStencil, classifySource, inkMask } from "./lineart";
import { structuralEdges, thresholdsFrom } from "./edges";
import { stripDataUrlPrefix } from "./files";
import { skeletonize } from "./vectorize";
import {
  boxBlur,
  buildMask,
  dilate,
  isPlainSubject,
  sobelMagnitude,
  suppressBackground,
  toGrayscale,
  DEFAULT_STENCIL_OPTIONS,
} from "./stencilPixels";
import type { StencilMask, StencilOptions } from "./stencilPixels";

// The arithmetic lives in stencilPixels.ts, where it can be tested; this file
// is the half that has to talk to Skia. Re-exported so nothing that already
// imports from here has to care which side of the line a name sits on.
export {
  DEFAULT_STENCIL_OPTIONS,
  boxBlur,
  buildMask,
  dilate,
  isPlainSubject,
  sobelMagnitude,
  suppressBackground,
  toGrayscale,
} from "./stencilPixels";
export type { StencilMask, StencilMode, StencilOptions } from "./stencilPixels";

/**
 * Runs the photo -> stencil pipeline and stops at the binary mask, before it
 * is painted into pixels. `stencilize` renders this; the tracer in
 * src/lib/vectorize.ts turns the same mask into geometry instead.
 */
export async function stencilMask(
  src: string,
  options: StencilOptions = {}
): Promise<StencilMask> {
  const opts = { ...DEFAULT_STENCIL_OPTIONS, ...options };
  const base64 = stripDataUrlPrefix(src);

  const encoded = Skia.Data.fromBase64(base64);
  const srcImage = Skia.Image.MakeImageFromEncoded(encoded);
  if (!srcImage) throw new Error("Could not decode image");

  const scale = Math.min(
    1,
    opts.maxDimension / Math.max(srcImage.width(), srcImage.height())
  );
  const width = Math.max(1, Math.round(srcImage.width() * scale));
  const height = Math.max(1, Math.round(srcImage.height() * scale));

  const surface = Skia.Surface.Make(width, height);
  if (!surface) throw new Error("Could not create a drawing surface");
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color("white"));
  canvas.drawImageRect(
    srcImage,
    Skia.XYWHRect(0, 0, srcImage.width(), srcImage.height()),
    Skia.XYWHRect(0, 0, width, height),
    Skia.Paint()
  );
  const scaledImage = surface.makeImageSnapshot();

  const pixels = scaledImage.readPixels(0, 0, {
    width,
    height,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  }) as Uint8Array | null;
  if (!pixels) throw new Error("Could not read pixel data");

  const prepared = opts.isolateBackground ? suppressBackground(pixels, width, height) : pixels;
  const flat = toGrayscale(prepared);

  // Blurring is noise suppression for edge detection. A drawing has no noise
  // to suppress — blurring it only softens the very strokes we are about to
  // threshold — so the centreline path reads the unblurred pixels.
  const bytes = Uint8Array.from(flat, (value) => Math.max(0, Math.min(255, Math.round(value))));

  // Redrawing is a choice, not the default. It thins every stroke to one
  // weight, which is right for artwork whose lines are too thick or doubled to
  // transfer — and wrong for artwork that was drawn properly, because a good
  // stencil uses a heavy contour, a medium structural line and a fine detail
  // line, and flattening those to a single weight throws away the thing that
  // makes it read from across the room.
  if (opts.mode === "centerline") {
    const { mask } = centerlineStencil(bytes, width, height, skeletonize, {
      threshold: DEFAULT_CENTERLINE.threshold,
      fillRadius: DEFAULT_CENTERLINE.fillRadius,
      weight: Math.max(1, opts.lineWeight),
    });
    return { mask, width, height };
  }

  // Already a drawing: the lines are the thing we were trying to recover, so
  // the whole job is to make them crisp. Anything cleverer than a threshold
  // here can only lose what the artwork already had.
  if (opts.autoDetectSource && opts.mode === "outline" && classifySource(bytes).kind === "lineart") {
    return { mask: inkMask(bytes, DEFAULT_CENTERLINE.threshold), width, height };
  }

  const gray = boxBlur(flat, width, height, opts.denoise);

  if (opts.mode === "outline" || opts.mode === "fine") {
    // Thin to the ridge and follow it, rather than thresholding the gradient
    // and thickening what survives. On a fully rendered illustration the old
    // way welded every neighbouring edge pixel into solid black; see
    // lib/edges.ts.
    const dense = classifySource(bytes).kind === "photo" && !isPlainSubject(bytes);
    const cutoff = opts.mode === "fine" ? opts.threshold * 1.18 : opts.threshold;
    const lines = structuralEdges(gray, width, height, thresholdsFrom(cutoff, dense));
    const weight = Math.max(0, opts.lineWeight - 1);
    return { mask: weight > 0 ? dilate(lines, width, height, weight) : lines, width, height };
  }

  const magnitude = sobelMagnitude(gray, width, height);
  const rawMask = buildMask(opts.mode, gray, magnitude, width, height, opts.threshold);
  const mask = dilate(rawMask, width, height, opts.lineWeight);

  return { mask, width, height };
}

/**
 * Runs the full photo -> stencil pipeline and returns a PNG data URL.
 * Accepts either a bare base64 string or a `data:image/...;base64,...` URL.
 */
export async function stencilize(
  src: string,
  options: StencilOptions = {}
): Promise<string> {
  const opts = { ...DEFAULT_STENCIL_OPTIONS, ...options };
  const { mask, width, height } = await stencilMask(src, options);

  const out = new Uint8Array(width * height * 4);
  const lineColor = opts.invert ? 255 : 0;
  const bgColor = opts.invert ? 0 : 255;
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ? lineColor : bgColor;
    const o = i * 4;
    out[o] = v;
    out[o + 1] = v;
    out[o + 2] = v;
    out[o + 3] = 255;
  }

  const outImage = Skia.Image.MakeImage(
    { width, height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
    Skia.Data.fromBytes(out),
    width * 4
  );
  if (!outImage) throw new Error("Could not encode result image");

  return `data:image/png;base64,${outImage.encodeToBase64(ImageFormat.PNG)}`;
}
