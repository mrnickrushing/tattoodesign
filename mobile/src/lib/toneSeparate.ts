// Splitting a picture into the layers a stencil is actually made of.
//
// An artist does not transfer one image. They transfer the outline, and carry
// the tonal work as a reference to shade freehand — or, for a piece that needs
// it, as its own separate transfer. A single flattened stencil cannot be used
// that way, which is why this exists: one design in, an outline layer and a
// shading layer per tone band out, each one independently visible, editable,
// printable and deletable.
//
// The tone decisions live in tone.ts and the mark-making in shading.ts, both
// pure and both tested. This module is only the bridge: decode the pixels,
// hand the greys to those two, and turn what comes back into project layers.
// The bounded working resolution mirrors what tracing already does — geometry
// scales back onto the canvas losslessly, so there is no reason to run the
// analysis at full size.

import { AlphaType, ColorType, ImageFormat, Skia } from "@shopify/react-native-skia";
import { stripDataUrlPrefix } from "./files";
import { makeStrokeLayer, type Point, type StrokeLayer } from "./designProject";
import {
  bandMask,
  bandTones,
  clampBands,
  coverage,
  posterize,
  renderStudy,
  thresholds,
  type BandStrategy,
  type SeparationPlan,
} from "./tone";
import { shadeRegion, type Mask } from "./shading";

export { defaultPlan, type SeparationPlan, type TonePass } from "./tone";

/** Working resolution for the analysis. Geometry scales back up losslessly. */
const MAX_DIMENSION = 900;

type Analysis = {
  gray: Uint8Array;
  width: number;
  height: number;
};

function decodeGray(dataUrl: string): Analysis {
  const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(stripDataUrlPrefix(dataUrl)));
  if (!image) throw new Error("That artwork could not be read.");

  const scale = Math.min(1, MAX_DIMENSION / Math.max(image.width(), image.height()));
  const width = Math.max(1, Math.round(image.width() * scale));
  const height = Math.max(1, Math.round(image.height() * scale));

  const surface = Skia.Surface.Make(width, height);
  if (!surface) throw new Error("This artwork is too large to analyse on this device.");
  const canvas = surface.getCanvas();
  // White, not transparent: a design saved with an alpha channel would
  // otherwise read as pure black everywhere it is see-through.
  canvas.clear(Skia.Color("white"));
  canvas.drawImageRect(
    image,
    Skia.XYWHRect(0, 0, image.width(), image.height()),
    Skia.XYWHRect(0, 0, width, height),
    Skia.Paint()
  );

  const pixels = surface
    .makeImageSnapshot()
    .readPixels(0, 0, { width, height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul }) as
    | Uint8Array
    | null;
  if (!pixels) throw new Error("That artwork could not be read.");

  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const offset = i * 4;
    gray[i] = Math.round(pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114);
  }
  return { gray, width, height };
}

export type ToneStudy = {
  /** The posterized image, to judge the separation before committing to it. */
  dataUrl: string;
  /** Fraction of the image in each band, darkest first. */
  coverage: number[];
  /** The grey each band previews as. */
  tones: number[];
};

/**
 * The value study: what the picture looks like reduced to a handful of values.
 *
 * This is the thing to look at before any linework exists. If the study does
 * not read as the subject, no amount of shading technique will save the
 * stencil made from it.
 */
export function toneStudy(dataUrl: string, bands: number, strategy: BandStrategy): ToneStudy {
  const { gray, width, height } = decodeGray(dataUrl);
  const cuts = thresholds(gray, bands, strategy);
  const banded = posterize(gray, cuts);
  const study = renderStudy(banded, cuts);

  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < study.length; i++) {
    const offset = i * 4;
    rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = study[i];
    rgba[offset + 3] = 255;
  }
  const image = Skia.Image.MakeImage(
    { width, height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
    Skia.Data.fromBytes(rgba),
    width * 4
  );
  if (!image) throw new Error("The value study could not be rendered.");

  return {
    dataUrl: `data:image/png;base64,${image.encodeToBase64(ImageFormat.PNG)}`,
    coverage: coverage(banded, clampBands(bands)),
    tones: bandTones(cuts),
  };
}

/** What one band's marks became, for reporting back to the caller. */
export type ShadingResult = {
  layers: StrokeLayer[];
  /** Marks laid down, per band that had a pass. */
  marks: number;
};

function scalePoints(points: Point[], factor: number): Point[] {
  return points.map((point) => ({
    x: point.x * factor,
    y: point.y * factor,
    ...(typeof point.w === "number" ? { w: point.w * factor } : {}),
  }));
}

const BAND_NAMES = ["Core black", "Shadow", "Mid tone", "Light", "Highlight", "Paper"];

/**
 * One shading layer per band the plan asks for, darkest first.
 *
 * Bands are masked cumulatively — a mid-tone pass covers everything at least
 * that dark — because that is how ink accumulates on skin. A shadow that only
 * received the shadow pass would read lighter than the mid-tone beside it,
 * which is backwards.
 */
export function shadingLayers(
  dataUrl: string,
  plan: SeparationPlan,
  canvasWidth: number,
  canvasHeight: number
): ShadingResult {
  const { gray, width, height } = decodeGray(dataUrl);
  const cuts = thresholds(gray, plan.bands, plan.strategy);
  const banded = posterize(gray, cuts);
  const toCanvas = canvasWidth / width;

  const layers: StrokeLayer[] = [];
  let marks = 0;

  // Lightest first so the darkest band ends up on top of the layer stack,
  // matching the order the marks would actually be laid down.
  for (let band = plan.passes.length - 1; band >= 0; band--) {
    const pass = plan.passes[band]?.shading;
    if (!pass) continue;

    const mask: Mask = { data: bandMask(banded, band, true), width, height };
    const strokes = shadeRegion(mask, pass);
    if (!strokes.length) continue;
    marks += strokes.length;

    const base = makeStrokeLayer(
      canvasWidth,
      canvasHeight,
      `${BAND_NAMES[band] ?? `Band ${band + 1}`} · ${pass.style}`
    );
    layers.push({
      ...base,
      strokes: strokes.map((stroke) => ({
        points: scalePoints(stroke.points, toCanvas),
        width: Math.max(0.5, stroke.width * toCanvas),
        color: "#111111",
        mode: "draw" as const,
        opacity: 1,
      })),
    });
  }

  return { layers, marks };
}
