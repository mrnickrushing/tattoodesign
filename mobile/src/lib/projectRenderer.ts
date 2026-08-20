import {
  ImageFormat,
  PaintStyle,
  Skia,
  type SkCanvas,
  type SkPaint,
} from "@shopify/react-native-skia";
import {
  projectAssetFile,
  type DesignLayer,
  type EditableDesignProject,
  type ShapeLayer,
  type StrokeLayer,
  type TextLayer,
} from "./designProject";
import { hasVariableWidth, ribbonOutline } from "./ribbon";

function layerPaint(layer: DesignLayer): SkPaint {
  const paint = Skia.Paint();
  paint.setAlphaf(Math.max(0, Math.min(1, layer.opacity)));
  paint.setAntiAlias(true);
  return paint;
}

function withTransform(canvas: SkCanvas, layer: DesignLayer, draw: () => void) {
  const t = layer.transform;
  canvas.save();
  canvas.translate(t.x + t.width / 2, t.y + t.height / 2);
  canvas.rotate(t.rotation, 0, 0);
  canvas.scale(t.scaleX, t.scaleY);
  canvas.translate(-t.width / 2, -t.height / 2);
  draw();
  canvas.restore();
}

function drawStrokes(canvas: SkCanvas, layer: StrokeLayer, background: string) {
  for (const stroke of layer.strokes) {
    if (!stroke.points.length) continue;
    const paint = layerPaint(layer);
    paint.setColor(Skia.Color(stroke.mode === "erase" ? background : stroke.color));
    paint.setAlphaf(stroke.opacity * layer.opacity);

    if (hasVariableWidth(stroke.points)) {
      // A pen stroke has no single width to hand the stroker, so its outline
      // is built explicitly and filled. See lib/ribbon.ts.
      const outline = ribbonOutline(stroke.points, stroke.width);
      if (outline.length < 3) continue;
      const path = Skia.Path.Make();
      path.moveTo(outline[0].x, outline[0].y);
      for (const point of outline.slice(1)) path.lineTo(point.x, point.y);
      path.close();
      paint.setStyle(PaintStyle.Fill);
      canvas.drawPath(path, paint);
      continue;
    }

    const path = Skia.Path.Make();
    path.moveTo(stroke.points[0].x, stroke.points[0].y);
    if (stroke.points.length === 1) {
      path.lineTo(stroke.points[0].x + 0.1, stroke.points[0].y + 0.1);
    } else {
      for (const point of stroke.points.slice(1)) path.lineTo(point.x, point.y);
    }
    paint.setStrokeWidth(stroke.width);
    paint.setStyle(PaintStyle.Stroke);
    paint.setStrokeCap(1);
    paint.setStrokeJoin(1);
    canvas.drawPath(path, paint);
  }
}

function drawShape(canvas: SkCanvas, layer: ShapeLayer) {
  withTransform(canvas, layer, () => {
    const t = layer.transform;
    if (layer.fill) {
      const fill = layerPaint(layer);
      fill.setColor(Skia.Color(layer.fill));
      fill.setStyle(PaintStyle.Fill);
      if (layer.shape === "ellipse") canvas.drawOval(Skia.XYWHRect(0, 0, t.width, t.height), fill);
      else if (layer.shape === "rectangle") canvas.drawRect(Skia.XYWHRect(0, 0, t.width, t.height), fill);
    }
    const paint = layerPaint(layer);
    paint.setColor(Skia.Color(layer.stroke));
    paint.setStrokeWidth(layer.strokeWidth);
    paint.setStyle(PaintStyle.Stroke);
    if (layer.shape === "ellipse") canvas.drawOval(Skia.XYWHRect(0, 0, t.width, t.height), paint);
    else if (layer.shape === "rectangle") canvas.drawRect(Skia.XYWHRect(0, 0, t.width, t.height), paint);
    else canvas.drawLine(0, t.height / 2, t.width, t.height / 2, paint);
  });
}

function drawText(canvas: SkCanvas, layer: TextLayer) {
  withTransform(canvas, layer, () => {
    const paint = layerPaint(layer);
    paint.setColor(Skia.Color(layer.color));
    const font = Skia.Font(undefined, layer.fontSize);
    const width = font.measureText(layer.text, paint).width;
    const x = layer.align === "left" ? 0 : layer.align === "right" ? layer.transform.width - width : (layer.transform.width - width) / 2;
    canvas.drawText(layer.text, x, layer.transform.height / 2 + layer.fontSize * 0.35, paint, font);
  });
}

export async function renderProject(project: EditableDesignProject): Promise<string> {
  const surface = Skia.Surface.MakeOffscreen(project.canvas.width, project.canvas.height);
  if (!surface) throw new Error("Couldn't allocate the editor canvas.");
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color(project.canvas.transparent ? "transparent" : project.canvas.background));

  for (const layer of project.layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    if (layer.kind === "raster") {
      const file = projectAssetFile(project.brand, project.id, layer.asset);
      if (!file.exists) continue;
      const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(await file.base64()));
      if (!image) continue;
      const paint = layerPaint(layer);
      withTransform(canvas, layer, () => {
        canvas.drawImageRect(
          image,
          Skia.XYWHRect(0, 0, image.width(), image.height()),
          Skia.XYWHRect(0, 0, layer.transform.width, layer.transform.height),
          paint
        );
      });
      continue;
    }
    if (layer.kind === "stroke") {
      withTransform(canvas, layer, () => drawStrokes(canvas, layer, project.canvas.background));
    }
    else if (layer.kind === "shape") drawShape(canvas, layer);
    else drawText(canvas, layer);
  }

  return `data:image/png;base64,${surface.makeImageSnapshot().encodeToBase64(ImageFormat.PNG)}`;
}
