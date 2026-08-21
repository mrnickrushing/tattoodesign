import {
  AlphaType,
  BlendMode,
  ColorType,
  FilterMode,
  ImageFormat,
  MipmapMode,
  Skia,
  TileMode,
  VertexMode,
} from "@shopify/react-native-skia";
import { warpMesh, type Surface } from "./curveWarp";
import { stripDataUrlPrefix } from "./files";
import { agePixels, healingProfile, type HealAge } from "./healing";
import { coverageGaps, coverupFinding, coverupThreshold, edgeStrength, inkDensityMap, type Region } from "./coverup";
import { finestStrokeWidth } from "./lineWidth";
import { otsuThreshold } from "./sketch";

export type ProductionFinding = { level: "pass" | "warn"; title: string; detail: string };

function decode(dataUrl: string) {
  const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(stripDataUrlPrefix(dataUrl)));
  if (!image) throw new Error("The artwork could not be decoded.");
  return image;
}

export function inspectProduction(dataUrl: string, dpi = 203, brand: "ink" | "sugar" = "ink"): ProductionFinding[] {
  const image = decode(dataUrl);
  const width = Math.min(700, image.width());
  const scale = width / image.width();
  const height = Math.max(1, Math.round(image.height() * scale));
  const surface = Skia.Surface.Make(width, height);
  if (!surface) throw new Error("The production proof is too large for this device.");
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color("white"));
  canvas.drawImageRect(image, Skia.XYWHRect(0, 0, image.width(), image.height()), Skia.XYWHRect(0, 0, width, height), Skia.Paint());
  const pixels = surface.makeImageSnapshot().readPixels(0, 0, { width, height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul }) as Uint8Array | null;
  if (!pixels) throw new Error("The production proof could not be inspected.");
  let dark = 0, gray = 0, contrast = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const lum = pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114;
    if (lum < 90) dark++; else if (lum < 220) gray++;
    if (x && Math.abs(lum - (pixels[i - 4] * 0.299 + pixels[i - 3] * 0.587 + pixels[i - 2] * 0.114)) > 55) contrast++;
  }
  const total = width * height;
  const darkRatio = dark / total, grayRatio = gray / total, edgeRatio = contrast / total;
  return [
    { level: image.width() >= dpi * 4 ? "pass" : "warn", title: "Resolution", detail: `${image.width()} × ${image.height()} px · ${(image.width() / dpi).toFixed(1)} in wide at ${dpi} DPI` },
    { level: darkRatio > 0.015 && darkRatio < 0.55 ? "pass" : "warn", title: "Ink coverage", detail: `${Math.round(darkRatio * 100)}% solid dark area${darkRatio >= 0.55 ? " may overwork a thermal head" : ""}` },
    { level: grayRatio < 0.28 ? "pass" : "warn", title: "Transfer clarity", detail: `${Math.round(grayRatio * 100)}% midtone content${grayRatio >= 0.28 ? " may reproduce unpredictably" : ""}` },
    { level: edgeRatio > 0.012 ? "pass" : "warn", title: "Line definition", detail: edgeRatio > 0.012 ? "Edges are distinct enough for a transfer proof." : "Very low edge contrast; refine linework before printing." },
    brand === "sugar"
      ? { level: darkRatio < 0.36 ? "pass" : "warn", title: "Piping feasibility", detail: darkRatio < 0.36 ? "Contour density leaves practical spacing for piping and transfers." : "Dense filled regions may need simplification for edible transfer work." }
      : { level: edgeRatio < 0.22 ? "pass" : "warn", title: "Stencil separation", detail: edgeRatio < 0.22 ? "Line density leaves enough negative space for a readable thermal transfer." : "Very dense edge detail may close up on skin or thermal paper." },
  ];
}

/**
 * Both pieces reduced to the same grid, so the two can be compared at all.
 *
 * The ink cutoff is Otsu's, found per image, rather than a fixed luminance.
 * A fixed one is wrong in exactly the case this feature exists for: Type V
 * skin photographs at luminance 98 and Type VI at 55, both under any cutoff
 * chosen for ink-on-paper, so a whole dark-skinned arm reads as solid ink and
 * the check demands the new design cover every inch of it. Otsu splits each
 * photograph into its own two populations and does not care how dark the skin
 * behind the tattoo is.
 *
 * It does assume there are two populations. A photograph of unmarked skin has
 * only one, and will come back with its darker half called ink — but the
 * caller is being handed a photo of an existing tattoo, which is the whole
 * premise of the comparison.
 */
function inkGrid(dataUrl: string, width: number, height: number) {
  const image = decode(dataUrl);
  const surface = Skia.Surface.Make(width, height);
  if (!surface) throw new Error("The cover-up comparison is too large for this device.");
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color("white"));
  canvas.drawImageRect(
    image,
    Skia.XYWHRect(0, 0, image.width(), image.height()),
    Skia.XYWHRect(0, 0, width, height),
    Skia.Paint()
  );
  const pixels = surface.makeImageSnapshot().readPixels(0, 0, {
    width,
    height,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  }) as Uint8Array | null;
  if (!pixels) throw new Error("The cover-up comparison could not read pixel data.");

  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const p = i * 4;
    gray[i] = Math.round(pixels[p] * 0.299 + pixels[p + 1] * 0.587 + pixels[p + 2] * 0.114);
  }

  const cutoff = otsuThreshold(gray);
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) mask[i] = gray[i] < cutoff ? 1 : 0;
  return { gray, mask };
}

/**
 * Resolution the linework is measured at.
 *
 * High enough that a hairline still spans a pixel, low enough that thinning the
 * mask to a skeleton is not a visible pause. It also sets the floor on what can
 * be distinguished: a line finer than one nine-hundredth of the piece's width
 * measures at the floor rather than at its true width. That is the right place
 * for the floor to sit — a design that fine is one worth warning about anyway,
 * so the measurement and the verdict fail in the same direction.
 */
const MEASURE_WIDTH = 900;

/**
 * The finest line in the artwork, as a fraction of the artwork's own width.
 *
 * A fraction rather than pixels or millimetres, because the caller knows how
 * many inches wide the piece is printed but not what resolution it was
 * exported at — and a fraction converts to real units with the printed size
 * alone. Zero when there is no linework to measure.
 */
export function measureFinestLine(dataUrl: string): number {
  const image = decode(dataUrl);
  const width = Math.min(MEASURE_WIDTH, image.width());
  const height = Math.max(1, Math.round((image.height() * width) / image.width()));
  const { mask } = inkGrid(dataUrl, width, height);
  const finest = finestStrokeWidth(mask, width, height);
  return finest > 0 ? finest / width : 0;
}

/** Working resolution for the comparison. Coverage is an area question, not a detail one. */
const COVERUP_WIDTH = 480;
/** Patch size, in pixels of the above. A few millimetres of skin at print size. */
const COVERUP_CELL = 16;

export type CoverupAssessment = {
  /** How crisp the old piece still is, 0 (a faded blur) to 1 (a fresh hard edge). */
  edgeStrength: number;
  /** Ink the new design needs, as a multiple of the old piece's. */
  threshold: number;
  /** Patches the design leaves too open, worst first, in the comparison's own pixels. */
  gaps: Region[];
  finding: ProductionFinding;
};

/**
 * Whether this design will actually cover the tattoo already there.
 *
 * Both images are resampled onto one grid — they are photographs of different
 * things at different sizes, and nothing can be compared until they are not.
 * That resampling is also the assumption: the caller has to have framed the
 * existing piece the way the new design will sit over it, because nothing here
 * can register one to the other.
 */
export function assessCoverup(designUrl: string, existingUrl: string): CoverupAssessment {
  const existingImage = decode(existingUrl);
  const width = Math.min(COVERUP_WIDTH, existingImage.width());
  const height = Math.max(1, Math.round((existingImage.height() * width) / existingImage.width()));

  const existing = inkGrid(existingUrl, width, height);
  const design = inkGrid(designUrl, width, height);

  const edge = edgeStrength(existing.gray, width, height);
  const threshold = coverupThreshold(edge);
  const gaps = coverageGaps(
    inkDensityMap(design.mask, width, height, COVERUP_CELL),
    inkDensityMap(existing.mask, width, height, COVERUP_CELL),
    threshold
  );
  return { edgeStrength: edge, threshold, gaps, finding: coverupFinding(gaps, threshold) };
}

/**
 * Redraws the artwork through a surface map.
 *
 * The previous version stretched vertical strips by a hand-tuned polynomial,
 * which could only ever squeeze one axis and had no relationship to any actual
 * measurement — a "35% curvature" that meant nothing you could hold a tape
 * measure against. This resamples through a triangle mesh instead, so a cake
 * pop can move pixels in both axes at once and the amount of correction comes
 * from a real circumference.
 */
export function wrapForSurface(
  dataUrl: string,
  surface: Surface,
  apparentWidthIn: number,
  apparentHeightIn: number,
  direction: "compensate" | "foreshorten" = "compensate",
  /**
   * White is right for something being printed — that is what the paper is.
   * It is wrong for a preview laid over a coloured cake pop, where the ground
   * has to stay clear or the design arrives as a white rectangle sitting on
   * the icing.
   */
  ground: "paper" | "clear" = "paper"
): string {
  const image = decode(dataUrl);
  const width = image.width();
  const height = image.height();
  if (surface.kind === "flat" || surface.circumferenceIn <= 0) return dataUrl;

  const surfaceOut = Skia.Surface.Make(width, height);
  if (!surfaceOut) throw new Error("The surface wrap is too large for this device.");
  const canvas = surfaceOut.getCanvas();
  canvas.clear(ground === "paper" ? Skia.Color("white") : Skia.Color("transparent"));

  const mesh = warpMesh(width, height, surface, apparentWidthIn, apparentHeightIn, direction);
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  // The image is the texture the mesh samples, so it has to be a shader rather
  // than something drawn — drawVertices paints with whatever the paint holds.
  paint.setShader(
    image.makeShaderOptions(
      TileMode.Decal,
      TileMode.Decal,
      FilterMode.Linear,
      MipmapMode.None
    )
  );

  const vertices = Skia.MakeVertices(
    VertexMode.Triangles,
    mesh.positions,
    mesh.uvs,
    undefined,
    mesh.indices
  );
  canvas.drawVertices(vertices, BlendMode.Src, paint);

  return `data:image/png;base64,${surfaceOut.makeImageSnapshot().encodeToBase64(ImageFormat.PNG)}`;
}

/**
 * Renders the design as it will look after `age` of healing.
 *
 * The buffer is worked at a bounded size for speed, so the caller's print
 * density has to be scaled to match — migration is defined in millimetres, and
 * a downscaled buffer has proportionally fewer pixels per millimetre. Getting
 * this wrong would make the simulation drift with image size, which is the one
 * thing the model is built to avoid.
 */
export function simulateHealing(dataUrl: string, age: HealAge, pxPerMm: number): string {
  const image = decode(dataUrl);
  const width = Math.min(900, image.width());
  const scale = width / image.width();
  const height = Math.max(1, Math.round(image.height() * scale));
  const surface = Skia.Surface.Make(width, height);
  if (!surface) throw new Error("The healing preview is too large for this device.");
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color("white"));
  canvas.drawImageRect(image, Skia.XYWHRect(0, 0, image.width(), image.height()), Skia.XYWHRect(0, 0, width, height), Skia.Paint());
  const pixels = surface.makeImageSnapshot().readPixels(0, 0, { width, height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul }) as Uint8Array | null;
  if (!pixels) throw new Error("The healing preview could not be rendered.");

  const gray = new Uint8Array(width * height);
  for (let index = 0; index < gray.length; index++) {
    const offset = index * 4;
    gray[index] = Math.round(pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114);
  }

  const aged = agePixels(gray, width, height, healingProfile(age, pxPerMm * scale));
  const out = new Uint8Array(width * height * 4);
  for (let index = 0; index < aged.length; index++) {
    const offset = index * 4;
    // Healed black ink reads blue-grey, not neutral: the warm channels lose
    // more than the cool one as the pigment settles.
    const value = aged[index];
    out[offset] = value;
    out[offset + 1] = value;
    out[offset + 2] = Math.min(255, Math.round(value + (255 - value) * 0.08));
    out[offset + 3] = 255;
  }
  const result = Skia.Image.MakeImage(
    { width, height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
    Skia.Data.fromBytes(out),
    width * 4
  );
  if (!result) throw new Error("The healing preview could not be encoded.");
  return `data:image/png;base64,${result.encodeToBase64(ImageFormat.PNG)}`;
}

export function compareCapture(reference: string, capture: string): ProductionFinding[] {
  const a = decode(reference), b = decode(capture);
  const framingDelta = Math.abs(a.width() / a.height() - b.width() / b.height()) / (a.width() / a.height());
  const resolutionPass = b.width() >= 1200 && b.height() >= 1200;
  const mask = (image: ReturnType<typeof decode>) => {
    const size = 192;
    const surface = Skia.Surface.Make(size, size)!;
    surface.getCanvas().clear(Skia.Color("white"));
    surface.getCanvas().drawImageRect(image, Skia.XYWHRect(0, 0, image.width(), image.height()), Skia.XYWHRect(0, 0, size, size), Skia.Paint());
    const pixels = surface.makeImageSnapshot().readPixels(0, 0, { width: size, height: size, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul }) as Uint8Array;
    const values = new Uint8Array(size * size);
    for (let index = 0; index < values.length; index++) {
      const offset = index * 4;
      values[index] = pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114 < 175 ? 1 : 0;
    }
    return values;
  };
  const approved = mask(a), photographed = mask(b);
  let expected = 0, covered = 0;
  for (let index = 0; index < approved.length; index++) if (approved[index]) { expected++; if (photographed[index]) covered++; }
  const coverage = expected ? covered / expected : 1;
  return [
    { level: resolutionPass ? "pass" : "warn", title: "Capture detail", detail: `${b.width()} × ${b.height()} px${resolutionPass ? " provides a strong review reference." : " is low for close line inspection."}` },
    { level: framingDelta < 0.35 ? "pass" : "warn", title: "Framing", detail: framingDelta < 0.35 ? "Capture proportions are close to the approved artwork." : "Capture framing differs substantially; retake straight-on." },
    { level: coverage >= 0.68 ? "pass" : "warn", title: "Visible line coverage", detail: `${Math.round(coverage * 100)}% of the approved dark-line map is visible in the capture${coverage < 0.68 ? "; inspect for missing transfer lines or retake square-on" : "."}` },
    { level: "pass", title: "Privacy", detail: "Quality checks ran locally; the capture was not uploaded." },
  ];
}
