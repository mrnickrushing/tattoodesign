// Client-side image -> tattoo stencil pipeline. Runs entirely in the
// browser on <canvas>, no server round-trip: grayscale -> blur -> Sobel
// edge detection -> threshold -> optional line-weight dilation.

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
};

export const DEFAULT_STENCIL_OPTIONS: Required<StencilOptions> = {
  maxDimension: 1400,
  threshold: 60,
  lineWeight: 1,
  denoise: 1,
  invert: false,
};

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = src;
  });
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function drawScaled(img: HTMLImageElement, maxDimension: number): HTMLCanvasElement {
  const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function toGrayscale(data: Uint8ClampedArray): Float32Array {
  const out = new Float32Array(data.length / 4);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    out[j] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
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

export type StencilResult = {
  canvas: HTMLCanvasElement;
  dataUrl: string;
};

/** Runs the full photo -> stencil pipeline and returns a canvas + PNG data URL. */
export async function stencilize(
  src: string,
  options: StencilOptions = {}
): Promise<StencilResult> {
  const opts = { ...DEFAULT_STENCIL_OPTIONS, ...options };
  const img = await loadImage(src);
  const canvas = drawScaled(img, opts.maxDimension);
  const ctx = canvas.getContext("2d")!;
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);

  let gray = toGrayscale(imageData.data);
  gray = boxBlur(gray, width, height, opts.denoise);
  const magnitude = sobelMagnitude(gray, width, height);

  const rawMask = new Uint8Array(width * height);
  for (let i = 0; i < rawMask.length; i++) {
    rawMask[i] = magnitude[i] > opts.threshold ? 1 : 0;
  }
  const mask = dilate(rawMask, width, height, opts.lineWeight);

  const out = ctx.createImageData(width, height);
  const lineColor = opts.invert ? 255 : 0;
  const bgColor = opts.invert ? 0 : 255;
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ? lineColor : bgColor;
    const o = i * 4;
    out.data[o] = v;
    out.data[o + 1] = v;
    out.data[o + 2] = v;
    out.data[o + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);

  return { canvas, dataUrl: canvas.toDataURL("image/png") };
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
