// Draws a lettering layout with Skia and returns a PNG data URL, ready for
// the stencil → skeleton → trace pipeline. Kept apart from lettering.ts so
// the layout math stays testable off-device.

import { Asset } from "expo-asset";
import { readImageBase64 } from "./imageSource";
import { ImageFormat, Skia, type SkTypeface } from "@shopify/react-native-skia";
import { arcLayout, layoutBounds, letteringStyle, type LetteringStyleId } from "./lettering";

// Bundled TTFs, resolved through expo-asset so Skia can read the raw bytes.
// These are the same files app/_layout.tsx registers for RN <Text>.
const FONT_MODULES: Record<string, number> = {
  "caveat-600": require("@expo-google-fonts/caveat/600SemiBold/Caveat_600SemiBold.ttf"),
  "playfair-700": require("@expo-google-fonts/playfair-display/700Bold/PlayfairDisplay_700Bold.ttf"),
  "bebas-400": require("@expo-google-fonts/bebas-neue/400Regular/BebasNeue_400Regular.ttf"),
};

const typefaceCache = new Map<string, SkTypeface>();

async function loadTypeface(asset: string): Promise<SkTypeface> {
  const cached = typefaceCache.get(asset);
  if (cached) return cached;
  const module = FONT_MODULES[asset];
  if (!module) throw new Error(`Unknown lettering font "${asset}".`);
  const resolved = Asset.fromModule(module);
  if (!resolved.localUri) await resolved.downloadAsync();
  const uri = resolved.localUri ?? resolved.uri;
  const base64 = await readImageBase64(uri);
  const typeface = Skia.Typeface.MakeFreeTypeFaceFromData(Skia.Data.fromBase64(base64));
  if (!typeface) throw new Error("The lettering font could not be loaded.");
  typefaceCache.set(asset, typeface);
  return typeface;
}

export type LetteringRender = {
  dataUrl: string;
  width: number;
  height: number;
};

/**
 * Renders `text` in the chosen style along a curved baseline as black ink on
 * white — the exact input shape the tracer expects.
 *
 * Layout is per glyph using the font's own advances, so natural spacing
 * survives the arc. Glyphs rotate about their own baseline midpoint, which is
 * what keeps an arch reading as bent text instead of sheared text. Script
 * connectors won't join across a strong curve — that's true of every
 * arc-lettering tool, and the traced strokes are editable afterwards.
 */
export async function renderLettering(
  text: string,
  styleId: LetteringStyleId,
  options: { curve?: number; fontSize?: number } = {}
): Promise<LetteringRender> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Type the lettering first.");
  const style = letteringStyle(styleId);
  const fontSize = options.fontSize ?? 220;
  const curve = options.curve ?? 0;

  const typeface = await loadTypeface(style.asset);
  const font = Skia.Font(typeface, fontSize);

  const characters = [...trimmed];
  const widths = characters.map((character) => {
    const glyphs = font.getGlyphIDs(character);
    const [width] = font.getGlyphWidths(glyphs);
    // Spaces and unmapped characters still need their advance.
    return width || font.measureText(character === " " ? "i" : character).width;
  });
  const placements = arcLayout(widths, curve);
  const bounds = layoutBounds(placements, widths, fontSize);

  const pad = fontSize * 0.25;
  const width = Math.max(8, Math.ceil(bounds.maxX - bounds.minX + pad * 2));
  const height = Math.max(8, Math.ceil(bounds.maxY - bounds.minY + pad * 2));

  const surface = Skia.Surface.Make(width, height);
  if (!surface) throw new Error("The lettering is too large to render on this device.");
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color("white"));

  const paint = Skia.Paint();
  paint.setColor(Skia.Color("black"));
  paint.setAntiAlias(true);

  characters.forEach((character, index) => {
    const placement = placements[index];
    const originX = placement.x - bounds.minX + pad;
    const originY = placement.y - bounds.minY + pad;
    canvas.save();
    // Rotate about the glyph's baseline midpoint so the arc bends the word
    // rather than shearing each letter.
    canvas.translate(originX + widths[index] / 2, originY);
    canvas.rotate((placement.rotation * 180) / Math.PI, 0, 0);
    canvas.drawText(character, -widths[index] / 2, 0, paint, font);
    canvas.restore();
  });

  return {
    dataUrl: `data:image/png;base64,${surface.makeImageSnapshot().encodeToBase64(ImageFormat.PNG)}`,
    width,
    height,
  };
}
