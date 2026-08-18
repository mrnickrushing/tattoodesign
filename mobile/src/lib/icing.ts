// Recolors line art the way icing sits on a cookie: flat flood color inside,
// piped outline on top.
//
// A traced design is black on white, which tells you the shape but nothing
// about whether the color you mixed will read against the outline. This
// blends between two colors along the original's luminance, so antialiased
// line edges stay smooth instead of turning into a hard two-tone stencil.

import { Skia, ColorType, AlphaType, ImageFormat } from "@shopify/react-native-skia";
import { stripDataUrlPrefix } from "./files";

export type IcingColors = {
  /** Flood color — what fills the shape. */
  flood: string;
  /** Piping color — the outline drawn over the flood. */
  line: string;
};

export const DEFAULT_ICING: IcingColors = { flood: "#f8c8d4", line: "#3b3335" };

/** Royal icing mixes, roughly what a gel color set gives you. */
export const FLOOD_COLORS = [
  { name: "White", hex: "#ffffff" },
  { name: "Buttercream", hex: "#fdf1d6" },
  { name: "Blush", hex: "#f8c8d4" },
  { name: "Rose", hex: "#e8608c" },
  { name: "Cherry", hex: "#d62f45" },
  { name: "Tangerine", hex: "#f79a3e" },
  { name: "Lemon", hex: "#f7dc5a" },
  { name: "Mint", hex: "#a8dcc6" },
  { name: "Sky", hex: "#9ecbe8" },
  { name: "Lavender", hex: "#c3a7dd" },
  { name: "Cocoa", hex: "#8a5a3b" },
  { name: "Charcoal", hex: "#3b3335" },
];

export const LINE_COLORS = [
  { name: "Charcoal", hex: "#3b3335" },
  { name: "Cocoa", hex: "#8a5a3b" },
  { name: "White", hex: "#ffffff" },
  { name: "Cherry", hex: "#d62f45" },
  { name: "Gold", hex: "#c9a227" },
];

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** Keeps the preview fast; it's judged by eye, not printed. */
const MAX_DIMENSION = 900;

/** Skia throws its own low-level errors; they're no use to anyone reading a
 *  message on screen, so decoding failures get one sentence instead. */
function decode(src: string) {
  let image = null;
  try {
    image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(stripDataUrlPrefix(src)));
  } catch {
    image = null;
  }
  if (!image) throw new Error("Couldn't read that design.");
  return image;
}

export async function recolor(src: string, colors: IcingColors): Promise<string> {
  const decoded = decode(src);

  const scale = Math.min(1, MAX_DIMENSION / Math.max(decoded.width(), decoded.height()));
  const width = Math.max(1, Math.round(decoded.width() * scale));
  const height = Math.max(1, Math.round(decoded.height() * scale));

  const surface = Skia.Surface.Make(width, height);
  if (!surface) throw new Error("Couldn't allocate the preview canvas.");
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color("white"));
  canvas.drawImageRect(
    decoded,
    Skia.XYWHRect(0, 0, decoded.width(), decoded.height()),
    Skia.XYWHRect(0, 0, width, height),
    Skia.Paint()
  );

  const pixels = surface.makeImageSnapshot().readPixels(0, 0, {
    width,
    height,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  }) as Uint8Array | null;
  if (!pixels) throw new Error("Couldn't read the design's pixels.");

  const [fr, fg, fb] = rgb(colors.flood);
  const [lr, lg, lb] = rgb(colors.line);
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < out.length; i += 4) {
    // Luminance is the mix: white background becomes flood, black line
    // becomes piping, and everything between them lands in proportion.
    const t =
      (pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114) / 255;
    out[i] = lr + (fr - lr) * t;
    out[i + 1] = lg + (fg - lg) * t;
    out[i + 2] = lb + (fb - lb) * t;
    out[i + 3] = 255;
  }

  const image = Skia.Image.MakeImage(
    { width, height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
    Skia.Data.fromBytes(out),
    width * 4
  );
  if (!image) throw new Error("Couldn't build the preview image.");
  return `data:image/png;base64,${image.encodeToBase64(ImageFormat.PNG)}`;
}
