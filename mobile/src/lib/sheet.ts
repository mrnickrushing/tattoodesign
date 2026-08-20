// Renders a sheet at print resolution.
//
// The screen preview is only ~46 points per inch, so screenshotting it (what
// this used to do) and stretching the result to paper size printed a blurry
// upscale of a phone screenshot — around 140 DPI at best. That is well under
// what line art needs: a soft stencil traces badly onto skin, and a soft
// cutter template is hard to cut against.
//
// Instead the sheet is re-composited from the original design files onto a
// Skia surface sized in real pixels, so each design contributes its own full
// resolution rather than whatever the screen happened to show.

import { Skia, ImageFormat } from "@shopify/react-native-skia";
import { readImageBase64 } from "./imageSource";

export type SheetItemLayout = {
  uri: string;
  xIn: number;
  yIn: number;
  wIn: number;
  hIn: number;
  /** Degrees, applied about the design's center — matching the on-screen view. */
  rotation: number;
  mirrored: boolean;
};

/** 300 DPI is the usual print standard; 150 is the floor for line work. */
export const PRINT_DPI = 300;

/**
 * Composites the sheet and returns a PNG data URL at `dpi`.
 * Throws if the surface can't be allocated so callers can fall back.
 */
export async function composeSheet(
  items: SheetItemLayout[],
  widthIn: number,
  heightIn: number,
  dpi: number = PRINT_DPI
): Promise<string> {
  const width = Math.round(widthIn * dpi);
  const height = Math.round(heightIn * dpi);

  const surface = Skia.Surface.Make(width, height);
  if (!surface) throw new Error("Couldn't allocate the print canvas.");
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color("white"));

  const paint = Skia.Paint();

  for (const item of items) {
    let image;
    try {
      const base64 = await readImageBase64(item.uri);
      const data = Skia.Data.fromBase64(base64);
      image = Skia.Image.MakeImageFromEncoded(data);
    } catch {
      throw new Error("A design on this sheet can no longer be read. Remove it or restore it before printing.");
    }
    if (!image) throw new Error("A design on this sheet is not a valid image.");

    const x = item.xIn * dpi;
    const y = item.yIn * dpi;
    const w = item.wIn * dpi;
    const h = item.hIn * dpi;

    canvas.save();
    // Rotate and mirror about the design's own center, so the result matches
    // what the on-screen transform showed.
    canvas.translate(x + w / 2, y + h / 2);
    if (item.rotation) canvas.rotate(item.rotation, 0, 0);
    if (item.mirrored) canvas.scale(-1, 1);
    const sourceRatio = image.width() / image.height();
    const boxRatio = w / h;
    const drawW = sourceRatio > boxRatio ? w : h * sourceRatio;
    const drawH = sourceRatio > boxRatio ? w / sourceRatio : h;
    canvas.drawImageRect(
      image,
      Skia.XYWHRect(0, 0, image.width(), image.height()),
      Skia.XYWHRect(-drawW / 2, -drawH / 2, drawW, drawH),
      paint
    );
    canvas.restore();
  }

  const out = surface.makeImageSnapshot();
  return `data:image/png;base64,${out.encodeToBase64(ImageFormat.PNG)}`;
}
