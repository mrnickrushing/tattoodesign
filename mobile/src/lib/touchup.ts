// Painting fixes onto a design: erase specks, or draw a line back in.
//
// The edge detector always leaves crumbs — a speck of background texture that
// survived the threshold, a stray mark near the subject — and no slider
// removes one blob without thinning every line in the drawing. It also breaks
// lines that should be continuous. Both are two seconds of work by hand.
//
// Strokes are collected on screen at preview size and replayed here against
// the design's own pixels, so touching up doesn't cost resolution.

import { Skia, ImageFormat, PaintStyle, StrokeCap, StrokeJoin } from "@shopify/react-native-skia";
import { stripDataUrlPrefix } from "./files";

export type Stroke = {
  /** Points in preview coordinates; scaled to the image on replay. */
  points: { x: number; y: number }[];
  /** Preview-space brush diameter. */
  width: number;
  mode: "erase" | "draw";
};

export async function applyStrokes(
  src: string,
  strokes: Stroke[],
  previewWidth: number,
  previewHeight: number
): Promise<string> {
  let image = null;
  try {
    image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(stripDataUrlPrefix(src)));
  } catch {
    image = null;
  }
  if (!image) throw new Error("Couldn't read that design.");

  const width = image.width();
  const height = image.height();
  const surface = Skia.Surface.Make(width, height);
  if (!surface) throw new Error("Couldn't allocate the canvas.");
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color("white"));
  canvas.drawImageRect(
    image,
    Skia.XYWHRect(0, 0, width, height),
    Skia.XYWHRect(0, 0, width, height),
    Skia.Paint()
  );

  const scaleX = width / Math.max(1, previewWidth);
  const scaleY = height / Math.max(1, previewHeight);
  // A brush that looked round on screen has to stay round on a differently
  // proportioned image, so its size follows the smaller of the two scales.
  const brushScale = Math.min(scaleX, scaleY);

  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue;
    const paint = Skia.Paint();
    paint.setColor(Skia.Color(stroke.mode === "erase" ? "white" : "black"));
    paint.setStyle(PaintStyle.Stroke);
    paint.setStrokeWidth(Math.max(1, stroke.width * brushScale));
    paint.setStrokeCap(StrokeCap.Round);
    paint.setStrokeJoin(StrokeJoin.Round);
    paint.setAntiAlias(true);

    const path = Skia.Path.Make();
    const [first, ...rest] = stroke.points;
    path.moveTo(first.x * scaleX, first.y * scaleY);
    if (rest.length === 0) {
      // A tap is a dot, not a zero-length line that draws nothing.
      path.lineTo(first.x * scaleX + 0.1, first.y * scaleY + 0.1);
    }
    for (const point of rest) path.lineTo(point.x * scaleX, point.y * scaleY);
    canvas.drawPath(path, paint);
  }

  return `data:image/png;base64,${surface.makeImageSnapshot().encodeToBase64(ImageFormat.PNG)}`;
}
