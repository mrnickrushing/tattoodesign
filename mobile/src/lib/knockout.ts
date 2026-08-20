// Making the paper disappear.
//
// A traced stencil is black on white, and white is what "no ink" looks like on
// paper. Put that PNG on a pink cake pop and the paper comes with it: the
// design arrives as a white rectangle floating on the icing, which tells you
// nothing about how the piece will actually look once it is piped or printed
// onto the surface itself.
//
// So for previewing on a real object the paper is turned back into nothing.
// What counts as paper is measured from the border rather than assumed to be
// pure white — a scan is on cream, a JPEG is on a thousand shades of
// nearly-white — and the cutoff is soft, because a hard one leaves every
// antialiased edge ringed with half-paper pixels, which reads as a grubby halo
// at exactly the size this is meant to be judged at. See paperMask.ts.

import { AlphaType, ColorType, ImageFormat, Skia } from "@shopify/react-native-skia";
import { stripDataUrlPrefix } from "./files";
import { paperAlpha, profilePaper } from "./paperMask";

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

  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const o = i * 4;
    gray[i] = Math.round(pixels[o] * 0.299 + pixels[o + 1] * 0.587 + pixels[o + 2] * 0.114);
  }
  // Measured from the border rather than assumed to be #ffffff, so a scan on
  // cream or a JPEG full of nearly-white ringing loses its ground too.
  const profile = profilePaper(gray, width, height);

  const out = new Uint8Array(pixels.length);
  out.set(pixels);
  for (let i = 0; i < gray.length; i++) {
    const o = i * 4;
    out[o + 3] = Math.round(out[o + 3] * paperAlpha(gray[i], profile));
  }

  const result = Skia.Image.MakeImage(
    { width, height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
    Skia.Data.fromBytes(out),
    width * 4
  );
  if (!result) throw new Error("That artwork could not be prepared.");
  return `data:image/png;base64,${result.encodeToBase64(ImageFormat.PNG)}`;
}
