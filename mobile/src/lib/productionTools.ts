import { AlphaType, ColorType, ImageFormat, Skia } from "@shopify/react-native-skia";
import { stripDataUrlPrefix } from "./files";

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

export function wrapForSurface(dataUrl: string, amount: number, taper: number): string {
  const image = decode(dataUrl);
  const width = image.width(), height = image.height();
  const surface = Skia.Surface.Make(width, height);
  if (!surface) throw new Error("The surface wrap is too large for this device.");
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color("white"));
  const strips = Math.min(240, width);
  for (let n = 0; n < strips; n++) {
    const sx = Math.floor((n / strips) * width), sx2 = Math.ceil(((n + 1) / strips) * width);
    const center = ((n + 0.5) / strips) * 2 - 1;
    const curveScale = 1 - amount * 0.34 * center * center;
    const dx = width / 2 + center * (width / 2) * (1 - amount * 0.16) - ((sx2 - sx) * curveScale) / 2;
    const dh = height * (1 - taper * Math.abs(center) * 0.28);
    canvas.drawImageRect(image, Skia.XYWHRect(sx, 0, sx2 - sx, height), Skia.XYWHRect(dx, (height - dh) / 2, Math.max(1, (sx2 - sx) * curveScale + 1), dh), Skia.Paint());
  }
  return `data:image/png;base64,${surface.makeImageSnapshot().encodeToBase64(ImageFormat.PNG)}`;
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
