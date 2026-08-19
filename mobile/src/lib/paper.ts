export type PaperKind = "flash" | "parchment";

export type GrainField = {
  width: number;
  height: number;
  values: Float32Array;
};

/** Small enough to render cheaply, while retaining visible tooth when scaled. */
export const GRAIN_RESOLUTION = 64;

type NoiseLayer = {
  width: number;
  height: number;
  values: Float32Array;
};

function mulberry32(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function safeSize(size: number | undefined) {
  if (!Number.isFinite(size)) return GRAIN_RESOLUTION;
  return Math.max(2, Math.floor(size ?? GRAIN_RESOLUTION));
}

function makeLayer(random: () => number, frequency: number): NoiseLayer {
  const width = frequency + 1;
  const height = frequency + 1;
  const values = new Float32Array(width * height);
  for (let index = 0; index < values.length; index++) values[index] = random();
  return { width, height, values };
}

function smoothstep(value: number) {
  return value * value * (3 - 2 * value);
}

function sampleLayer(layer: NoiseLayer, x: number, y: number) {
  const clampedX = clamp(x, 0, layer.width - 1);
  const clampedY = clamp(y, 0, layer.height - 1);
  const left = Math.floor(clampedX);
  const top = Math.floor(clampedY);
  const right = Math.min(left + 1, layer.width - 1);
  const bottom = Math.min(top + 1, layer.height - 1);
  const tx = smoothstep(clampedX - left);
  const ty = smoothstep(clampedY - top);
  const topValue = layer.values[top * layer.width + left] * (1 - tx) + layer.values[top * layer.width + right] * tx;
  const bottomValue = layer.values[bottom * layer.width + left] * (1 - tx) + layer.values[bottom * layer.width + right] * tx;
  return topValue * (1 - ty) + bottomValue * ty;
}

/**
 * Produces fixed paper tooth instead of changing random pixels on every
 * render. Flash carries more contrast; parchment keeps the same material cue
 * quiet enough to sit behind icing detail.
 */
export function grainField(kind: PaperKind, seed: number, size?: number): GrainField {
  const resolution = safeSize(size);
  const random = mulberry32(Number.isFinite(seed) ? seed : 0);
  const frequencies = kind === "flash" ? [5, 12, 26] : [12, 28, 56];
  const weights = [1, 0.5, 0.25];
  const contrast = kind === "flash" ? 0.82 : 0.32;
  const layers = frequencies.map((frequency) => makeLayer(random, frequency));
  const weightTotal = weights.reduce((total, weight) => total + weight, 0);
  const values = new Float32Array(resolution * resolution);

  for (let y = 0; y < resolution; y++) {
    for (let x = 0; x < resolution; x++) {
      const nx = x / (resolution - 1);
      const ny = y / (resolution - 1);
      let combined = 0;
      for (let octave = 0; octave < layers.length; octave++) {
        combined += sampleLayer(layers[octave], nx * frequencies[octave], ny * frequencies[octave]) * weights[octave];
      }
      values[y * resolution + x] = clamp(0.5 + ((combined / weightTotal) - 0.5) * contrast, 0, 1);
    }
  }

  return { width: resolution, height: resolution, values };
}

/** Samples the field between texels, letting one field cover any stock size. */
export function grainAt(field: GrainField, x: number, y: number): number {
  if (field.width <= 0 || field.height <= 0 || field.values.length === 0) return 0;
  const safeX = Number.isFinite(x) ? x : 0;
  const safeY = Number.isFinite(y) ? y : 0;
  const clampedX = clamp(safeX, 0, field.width - 1);
  const clampedY = clamp(safeY, 0, field.height - 1);
  const left = Math.floor(clampedX);
  const top = Math.floor(clampedY);
  const right = Math.min(left + 1, field.width - 1);
  const bottom = Math.min(top + 1, field.height - 1);
  const tx = clampedX - left;
  const ty = clampedY - top;
  const topValue = field.values[top * field.width + left] * (1 - tx) + field.values[top * field.width + right] * tx;
  const bottomValue = field.values[bottom * field.width + left] * (1 - tx) + field.values[bottom * field.width + right] * tx;
  return clamp(topValue * (1 - ty) + bottomValue * ty, 0, 1);
}

/** Darkens physical stock at its edges without creating a visible centre spot. */
export function vignetteAlpha(x: number, y: number, w: number, h: number, strength: number): number {
  if (!(w > 0) || !(h > 0) || !Number.isFinite(strength)) return 0;
  const nx = clamp(Math.abs(x - w / 2) / (w / 2), 0, 1);
  const ny = clamp(Math.abs(y - h / 2) / (h / 2), 0, 1);
  const distance = Math.hypot(nx, ny) / Math.SQRT2;
  return clamp(distance * strength, 0, 1);
}
