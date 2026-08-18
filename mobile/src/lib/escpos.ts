import { Skia, ColorType, AlphaType } from "@shopify/react-native-skia";

function stripPrefix(value: string) {
  const comma = value.indexOf(",");
  return comma >= 0 ? value.slice(comma + 1) : value;
}

/** Converts a PNG sheet into an ESC/POS GS v 0 monochrome raster command. */
export function dataUrlToEscPos(dataUrl: string, targetWidth: number, density = 5, mirrored = false): Uint8Array {
  const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(stripPrefix(dataUrl)));
  if (!image) throw new Error("The print proof could not be decoded.");
  const width = Math.max(8, Math.floor(targetWidth / 8) * 8);
  // Proofs are rendered at the profile's native DPI. Crop to the head width
  // instead of squeezing a Letter/A4 page onto a receipt roll and lying about size.
  const height = image.height();
  if (height > 12000) throw new Error("This BLE job is too long. Split it into smaller sheets.");

  const surface = Skia.Surface.Make(width, height);
  if (!surface) throw new Error("The BLE raster is too large for this device.");
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color("white"));
  const drawX = (width - image.width()) / 2;
  canvas.drawImage(image, drawX, 0, Skia.Paint());
  const pixels = surface.makeImageSnapshot().readPixels(0, 0, {
    width,
    height,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  }) as Uint8Array | null;
  if (!pixels) throw new Error("The BLE raster could not be read.");

  const bytesPerRow = width / 8;
  const raster = new Uint8Array(bytesPerRow * height);
  const cutoff = 210 - Math.max(0, Math.min(10, density)) * 8;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sourceX = mirrored ? width - 1 - x : x;
      const p = (y * width + sourceX) * 4;
      const luminance = pixels[p] * 0.299 + pixels[p + 1] * 0.587 + pixels[p + 2] * 0.114;
      if (luminance < cutoff) raster[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }

  const header = new Uint8Array([0x1b, 0x40, 0x1d, 0x76, 0x30, 0x00, bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff, height & 0xff, (height >> 8) & 0xff]);
  const feed = new Uint8Array([0x0a, 0x0a, 0x0a]);
  const out = new Uint8Array(header.length + raster.length + feed.length);
  out.set(header, 0);
  out.set(raster, header.length);
  out.set(feed, header.length + raster.length);
  return out;
}
