// Flattens a placement mockup — the photo with the design sitting on it — so
// it can be saved or sent to someone.
//
// The design is drawn from its own file at the photo's resolution rather than
// captured off the screen, so the saved mockup is as sharp as the photo was.

import { Skia, ImageFormat } from "@shopify/react-native-skia";
import { stripDataUrlPrefix } from "./files";

export type Placement = {
  /** Design position and size as fractions of the photo, 0–1. */
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
};

function decode(src: string) {
  try {
    return Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(stripDataUrlPrefix(src)));
  } catch {
    return null;
  }
}

export async function composePlacement(
  photoUri: string,
  designUri: string,
  placement: Placement
): Promise<string> {
  const photo = decode(photoUri);
  const design = decode(designUri);
  if (!photo || !design) throw new Error("Couldn't read those images.");

  const width = photo.width();
  const height = photo.height();
  const surface = Skia.Surface.Make(width, height);
  if (!surface) throw new Error("Couldn't allocate the canvas.");
  const canvas = surface.getCanvas();
  const paint = Skia.Paint();

  canvas.drawImageRect(
    photo,
    Skia.XYWHRect(0, 0, width, height),
    Skia.XYWHRect(0, 0, width, height),
    paint
  );

  const w = placement.width * width;
  const h = placement.height * height;
  const overlay = Skia.Paint();
  overlay.setAlphaf(placement.opacity);

  canvas.save();
  canvas.translate(placement.x * width + w / 2, placement.y * height + h / 2);
  if (placement.rotation) canvas.rotate(placement.rotation, 0, 0);
  canvas.drawImageRect(
    design,
    Skia.XYWHRect(0, 0, design.width(), design.height()),
    Skia.XYWHRect(-w / 2, -h / 2, w, h),
    overlay
  );
  canvas.restore();

  return `data:image/png;base64,${surface.makeImageSnapshot().encodeToBase64(ImageFormat.PNG)}`;
}
