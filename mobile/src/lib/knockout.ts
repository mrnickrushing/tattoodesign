// Making the paper disappear.
//
// A traced stencil is black on white, and white is what "no ink" looks like on
// paper. Put that PNG on a pink cake pop and the paper comes with it: the
// design arrives as a white rectangle floating on the icing, which tells you
// nothing about how the piece will actually look once it is piped or printed
// onto the surface itself.
//
// So for previewing on a real object, white is turned back into nothing. The
// cutoff is soft rather than binary — a hard threshold leaves every
// antialiased edge with a ring of half-white pixels around it, which reads as
// a grubby halo at exactly the sizes this is meant to be judged at.

import { AlphaType, ColorType, ImageFormat, Skia } from "@shopify/react-native-skia";
import { stripDataUrlPrefix } from "./files";

/** Above this the pixel is paper. Below `SOLID` it is fully ink. */
const PAPER = 246;
const SOLID = 200;

export function knockOutPaper(dataUrl: string): string {
  const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(stripDataUrlPrefix(dataUrl)));
  if (!image) throw new Error("That artwork could not be read.");

  const width = image.width();
  const height = image.height();
  const surface = Skia.Surface.Make(width, height);
  if (!surface) throw new Error("That artwork is too large to preview on this device.");
  const canvas = surface.getCanvas();
  canvas.drawImage(image, 0, 0);

  const pixels = surface
    .makeImageSnapshot()
    .readPixels(0, 0, { width, height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul }) as
    | Uint8Array
    | null;
  if (!pixels) throw new Error("That artwork could not be read.");

  const out = new Uint8Array(pixels.length);
  out.set(pixels);
  for (let i = 0; i < out.length; i += 4) {
    const luminance = out[i] * 0.299 + out[i + 1] * 0.587 + out[i + 2] * 0.114;
    if (luminance >= PAPER) {
      out[i + 3] = 0;
    } else if (luminance > SOLID) {
      // The antialiased fringe fades out instead of stopping dead, which is
      // what stops the edges reading as a grubby halo.
      const ramp = (PAPER - luminance) / (PAPER - SOLID);
      out[i + 3] = Math.round(out[i + 3] * ramp);
    }
  }

  const result = Skia.Image.MakeImage(
    { width, height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
    Skia.Data.fromBytes(out),
    width * 4
  );
  if (!result) throw new Error("That artwork could not be prepared.");
  return `data:image/png;base64,${result.encodeToBase64(ImageFormat.PNG)}`;
}
