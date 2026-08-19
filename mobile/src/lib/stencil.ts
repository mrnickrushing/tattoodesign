// On-device photo -> stencil pipeline, powered by react-native-skia.
// Mirrors the web app's canvas-based src/lib/stencil.ts pixel-for-pixel:
// grayscale -> blur -> Sobel edge detection -> threshold -> optional
// line-weight dilation. No network call — same as the web version, this
// runs entirely on the device.

import { Skia, ColorType, AlphaType, ImageFormat } from "@shopify/react-native-skia";

export type StencilOptions = {
  /** Longest side the source image is downscaled to before processing. */
  maxDimension?: number;
  /** Gradient magnitude (0-255) above which a pixel becomes a line. Lower = more lines. */
  threshold?: number;
  /** Radius (px) used to thicken detected lines. 0 = hairline. */
  lineWeight?: number;
  /** Box-blur radius applied before edge detection to suppress noise. */
  denoise?: number;
  /** Invert to white-on-black instead of the default black-on-white. */
  invert?: boolean;
  /** Rendering strategy. Each mode is tuned for a different transfer style. */
  mode?: StencilMode;
  /** Suppress a flat background sampled from the image corners before tracing. */
  isolateBackground?: boolean;
};

export type StencilMode = "outline" | "fine" | "photocopy" | "halftone" | "crosshatch";

export const DEFAULT_STENCIL_OPTIONS: Required<StencilOptions> = {
  maxDimension: 1200,
  threshold: 60,
  lineWeight: 1,
  denoise: 1,
  invert: false,
  mode: "outline",
  isolateBackground: false,
};

function stripDataUrlPrefix(dataUrl: string): string {
  const idx = dataUrl.indexOf(",");
  return idx >= 0 && dataUrl.slice(0, idx).includes("base64") ? dataUrl.slice(idx + 1) : dataUrl;
}

function toGrayscale(pixels: Uint8Array): Float32Array {
  const out = new Float32Array(pixels.length / 4);
  for (let i = 0, j = 0; i < pixels.length; i += 4, j++) {
    out[j] = pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114;
  }
  return out;
}

function suppressBackground(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(pixels);
  const sample = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return [pixels[i], pixels[i + 1], pixels[i + 2]] as const;
  };
  const corners = [sample(0, 0), sample(width - 1, 0), sample(0, height - 1), sample(width - 1, height - 1)];
  const bg = [0, 1, 2].map((channel) => corners.reduce((sum, color) => sum + color[channel], 0) / corners.length);
  // A deliberately conservative cutoff: this removes paper/wall fields while
  // preserving skin texture and pale artwork that aggressive segmentation loses.
  const tolerance = 42;
  for (let i = 0; i < out.length; i += 4) {
    const distance = Math.sqrt(
      (out[i] - bg[0]) ** 2 + (out[i + 1] - bg[1]) ** 2 + (out[i + 2] - bg[2]) ** 2
    );
    if (distance < tolerance) out[i] = out[i + 1] = out[i + 2] = 255;
  }
  return out;
}

function boxBlur(
  src: Float32Array,
  width: number,
  height: number,
  radius: number
): Float32Array {
  if (radius <= 0) return src;
  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          sum += src[yy * width + xx];
          count++;
        }
      }
      out[y * width + x] = sum / count;
    }
  }
  return out;
}

const SOBEL_X = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
const SOBEL_Y = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

function sobelMagnitude(
  gray: Float32Array,
  width: number,
  height: number
): Float32Array {
  const out = new Float32Array(width * height);
  let max = 1;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let gx = 0;
      let gy = 0;
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const v = gray[(y + dy) * width + (x + dx)];
          gx += v * SOBEL_X[k];
          gy += v * SOBEL_Y[k];
          k++;
        }
      }
      const mag = Math.sqrt(gx * gx + gy * gy);
      out[y * width + x] = mag;
      if (mag > max) max = mag;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] / max) * 255;
  return out;
}

function dilate(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number
): Uint8Array {
  if (radius <= 0) return mask;
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let on = false;
      for (let dy = -radius; dy <= radius && !on; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          if (mask[yy * width + xx]) {
            on = true;
            break;
          }
        }
      }
      out[y * width + x] = on ? 1 : 0;
    }
  }
  return out;
}

function buildMask(
  mode: StencilMode,
  gray: Float32Array,
  magnitude: Float32Array,
  width: number,
  height: number,
  threshold: number
): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const tone = gray[i];
      if (mode === "photocopy") {
        mask[i] = tone < Math.min(245, threshold + 95) ? 1 : 0;
      } else if (mode === "halftone") {
        const cell = 7;
        const radius = Math.max(0, Math.round(((255 - tone) / 255) * 3));
        const dx = (x % cell) - Math.floor(cell / 2);
        const dy = (y % cell) - Math.floor(cell / 2);
        mask[i] = radius > 0 && dx * dx + dy * dy <= radius * radius ? 1 : 0;
      } else if (mode === "crosshatch") {
        const darkness = 255 - tone;
        const hatch = (x + y) % 9 === 0 || (darkness > 95 && (x - y + height) % 11 === 0) || (darkness > 165 && y % 7 === 0);
        mask[i] = darkness > 45 && hatch ? 1 : 0;
      } else {
        const cutoff = mode === "fine" ? threshold * 1.18 : threshold;
        mask[i] = magnitude[i] > cutoff ? 1 : 0;
      }
    }
  }
  return mask;
}

export type StencilMask = {
  /** One byte per pixel: 1 where a line was detected, 0 elsewhere. */
  mask: Uint8Array;
  width: number;
  height: number;
};

/**
 * Runs the photo -> stencil pipeline and stops at the binary mask, before it
 * is painted into pixels. `stencilize` renders this; the tracer in
 * src/lib/vectorize.ts turns the same mask into geometry instead.
 */
export async function stencilMask(
  src: string,
  options: StencilOptions = {}
): Promise<StencilMask> {
  const opts = { ...DEFAULT_STENCIL_OPTIONS, ...options };
  const base64 = stripDataUrlPrefix(src);

  const encoded = Skia.Data.fromBase64(base64);
  const srcImage = Skia.Image.MakeImageFromEncoded(encoded);
  if (!srcImage) throw new Error("Could not decode image");

  const scale = Math.min(
    1,
    opts.maxDimension / Math.max(srcImage.width(), srcImage.height())
  );
  const width = Math.max(1, Math.round(srcImage.width() * scale));
  const height = Math.max(1, Math.round(srcImage.height() * scale));

  const surface = Skia.Surface.Make(width, height);
  if (!surface) throw new Error("Could not create a drawing surface");
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color("white"));
  canvas.drawImageRect(
    srcImage,
    Skia.XYWHRect(0, 0, srcImage.width(), srcImage.height()),
    Skia.XYWHRect(0, 0, width, height),
    Skia.Paint()
  );
  const scaledImage = surface.makeImageSnapshot();

  const pixels = scaledImage.readPixels(0, 0, {
    width,
    height,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  }) as Uint8Array | null;
  if (!pixels) throw new Error("Could not read pixel data");

  const prepared = opts.isolateBackground ? suppressBackground(pixels, width, height) : pixels;
  let gray = toGrayscale(prepared);
  gray = boxBlur(gray, width, height, opts.denoise);
  const magnitude = sobelMagnitude(gray, width, height);
  const rawMask = buildMask(opts.mode, gray, magnitude, width, height, opts.threshold);
  const mask = dilate(rawMask, width, height, opts.mode === "fine" ? Math.max(0, opts.lineWeight - 1) : opts.lineWeight);

  return { mask, width, height };
}

/**
 * Runs the full photo -> stencil pipeline and returns a PNG data URL.
 * Accepts either a bare base64 string or a `data:image/...;base64,...` URL.
 */
export async function stencilize(
  src: string,
  options: StencilOptions = {}
): Promise<string> {
  const opts = { ...DEFAULT_STENCIL_OPTIONS, ...options };
  const { mask, width, height } = await stencilMask(src, options);

  const out = new Uint8Array(width * height * 4);
  const lineColor = opts.invert ? 255 : 0;
  const bgColor = opts.invert ? 0 : 255;
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ? lineColor : bgColor;
    const o = i * 4;
    out[o] = v;
    out[o + 1] = v;
    out[o + 2] = v;
    out[o + 3] = 255;
  }

  const outImage = Skia.Image.MakeImage(
    { width, height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
    Skia.Data.fromBytes(out),
    width * 4
  );
  if (!outImage) throw new Error("Could not encode result image");

  return `data:image/png;base64,${outImage.encodeToBase64(ImageFormat.PNG)}`;
}
