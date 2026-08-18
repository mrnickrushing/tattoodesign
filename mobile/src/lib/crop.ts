// Crops an image before it's traced.
//
// Reference photos are almost never framed the way the design is: the piece
// you want is one shoulder in a full-body shot, one cookie on a tray. Tracing
// the whole frame wastes resolution on everything you're going to throw away,
// and the edge detector spends its threshold budget on background clutter.
//
// Skia does the work rather than a new dependency — the sheet compositor
// already draws sub-rectangles of decoded images the same way.

import { Skia, ImageFormat } from "@shopify/react-native-skia";
import { stripDataUrlPrefix } from "./files";

/** Fractions of the source image, 0–1, so a rect stays valid at any scale. */
export type CropRect = { x: number; y: number; width: number; height: number };

export const FULL_CROP: CropRect = { x: 0, y: 0, width: 1, height: 1 };

export function isFullCrop(rect: CropRect): boolean {
  return (
    rect.x < 0.001 && rect.y < 0.001 && rect.width > 0.999 && rect.height > 0.999
  );
}

export async function cropImage(dataUrl: string, rect: CropRect): Promise<string> {
  let image = null;
  try {
    image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(stripDataUrlPrefix(dataUrl)));
  } catch {
    // Skia's own errors say nothing useful to someone holding a phone.
    image = null;
  }
  if (!image) throw new Error("Couldn't read that image.");

  const iw = image.width();
  const ih = image.height();
  // At least one pixel each way — a zero-sized surface can't be allocated.
  const w = Math.max(1, Math.round(rect.width * iw));
  const h = Math.max(1, Math.round(rect.height * ih));
  const x = Math.min(Math.max(0, Math.round(rect.x * iw)), iw - w);
  const y = Math.min(Math.max(0, Math.round(rect.y * ih)), ih - h);

  const surface = Skia.Surface.Make(w, h);
  if (!surface) throw new Error("Couldn't allocate the crop canvas.");
  const canvas = surface.getCanvas();
  canvas.drawImageRect(
    image,
    Skia.XYWHRect(x, y, w, h),
    Skia.XYWHRect(0, 0, w, h),
    Skia.Paint()
  );
  return `data:image/png;base64,${surface.makeImageSnapshot().encodeToBase64(ImageFormat.PNG)}`;
}
