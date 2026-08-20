// Translating a region of tone into the marks a tattoo artist would make in it.
//
// The pipeline already had "modes" — halftone, crosshatch — but they were
// image filters applied to the whole picture at once. That is not how shading
// works. An artist picks a technique per region and a density per value:
// whip shading through a mid-tone, pepper in a soft transition, solid black in
// the core. This module does that: given a mask of one tone band, it emits the
// marks that fill it.
//
// The marks come out as geometry, not pixels, which is the whole point. The
// project model already stores strokes with per-point widths, which means
// shading arrives as layers you can node-edit, restyle, thin out, or delete —
// and which print crisply at any density instead of being resampled. Whip
// shading in particular is exactly a tapered stroke, which the pen pipeline
// already knows how to draw.
//
// Pure geometry over a 0/1 mask. No Skia, no image decoding, deterministic
// given a seed — so density, spacing and direction are all verifiable
// off-device rather than by eye.

import type { Point } from "./designProject";

export type ShadingStyle = "whip" | "pepper" | "hatch" | "crosshatch" | "solid";

export const SHADING_STYLES: { id: ShadingStyle; label: string; caption: string }[] = [
  { id: "whip", label: "Whip", caption: "Tapered flicks that fade out of the shadow" },
  { id: "pepper", label: "Pepper", caption: "Stippled dots — soft, grainy transitions" },
  { id: "hatch", label: "Hatch", caption: "Parallel lines at one angle" },
  { id: "crosshatch", label: "Crosshatch", caption: "Two crossing sets, for depth" },
  { id: "solid", label: "Solid", caption: "Packed fill for the black core" },
];

export type ShadingOptions = {
  style: ShadingStyle;
  /** 0..1. Drives spacing and, for pepper, how many dots land. */
  density: number;
  /** Direction the marks run, in degrees. */
  angle: number;
  /** Nominal mark width, in mask pixels. */
  weight: number;
  /** Anything the caller wants reproducible runs keyed on. */
  seed: number;
};

export const DEFAULT_SHADING: ShadingOptions = {
  style: "whip",
  density: 0.5,
  angle: 45,
  weight: 2,
  seed: 1,
};

export type Mask = {
  data: Uint8Array;
  width: number;
  height: number;
};

/**
 * Deterministic PRNG. Shading that reshuffles every time it is previewed is
 * unusable — you would never be able to tell whether a change you made was an
 * improvement or just a different roll.
 */
function rng(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function inside(mask: Mask, x: number, y: number): boolean {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= mask.width || py >= mask.height) return false;
  return mask.data[py * mask.width + px] === 1;
}

/** Spacing between marks, in pixels. Denser means closer. */
function spacingFor(options: ShadingOptions): number {
  const density = Math.max(0, Math.min(1, options.density));
  // Never below the mark weight, or the marks merge into a flat fill and the
  // value stops reading as shading at all.
  return Math.max(options.weight * 1.15, options.weight + 22 * (1 - density));
}

/**
 * The runs where one infinite line crosses the mask, as start/end distances
 * along that line. Walking a step at a time is slower than a scanline
 * intersection test but works for any mask shape, including the ragged ones
 * a posterized photo actually produces.
 */
function runsAlongLine(
  mask: Mask,
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  length: number
): { start: number; end: number }[] {
  const runs: { start: number; end: number }[] = [];
  let open = -1;
  for (let t = 0; t <= length; t++) {
    const hit = inside(mask, ox + dx * t, oy + dy * t);
    if (hit && open < 0) open = t;
    if (!hit && open >= 0) {
      runs.push({ start: open, end: t - 1 });
      open = -1;
    }
  }
  if (open >= 0) runs.push({ start: open, end: length });
  return runs;
}

/** Every parallel line across the mask at the given angle, as clipped runs. */
function sweep(
  mask: Mask,
  angleDegrees: number,
  spacing: number
): { ox: number; oy: number; dx: number; dy: number; start: number; end: number }[] {
  const radians = (angleDegrees * Math.PI) / 180;
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);
  // Perpendicular, to step from one line to the next.
  const nx = -dy;
  const ny = dx;
  const diagonal = Math.hypot(mask.width, mask.height);
  const cx = mask.width / 2;
  const cy = mask.height / 2;

  const out: ReturnType<typeof sweep> = [];
  const lines = Math.ceil(diagonal / spacing);
  for (let i = -lines; i <= lines; i++) {
    const offset = i * spacing;
    // Start the walk far enough back that the line covers the whole mask.
    const ox = cx + nx * offset - dx * (diagonal / 2);
    const oy = cy + ny * offset - dy * (diagonal / 2);
    for (const run of runsAlongLine(mask, ox, oy, dx, dy, Math.ceil(diagonal))) {
      out.push({ ox, oy, dx, dy, start: run.start, end: run.end });
    }
  }
  return out;
}

export type ShadingStroke = { points: Point[]; width: number };

function hatchStrokes(mask: Mask, options: ShadingOptions, angle: number): ShadingStroke[] {
  const spacing = spacingFor(options);
  const out: ShadingStroke[] = [];
  for (const line of sweep(mask, angle, spacing)) {
    if (line.end - line.start < 2) continue;
    out.push({
      points: [
        { x: line.ox + line.dx * line.start, y: line.oy + line.dy * line.start, w: options.weight },
        { x: line.ox + line.dx * line.end, y: line.oy + line.dy * line.end, w: options.weight },
      ],
      width: options.weight,
    });
  }
  return out;
}

/**
 * Whip shading: short strokes that enter at full weight and flick out to
 * nothing, laid along the hatch direction. The taper is the technique — a
 * needle pulled out of the skin — so it is built into the point widths rather
 * than applied afterwards.
 */
function whipStrokes(mask: Mask, options: ShadingOptions): ShadingStroke[] {
  const spacing = spacingFor(options);
  const random = rng(options.seed);
  const out: ShadingStroke[] = [];

  for (const line of sweep(mask, options.angle, spacing)) {
    let cursor = line.start;
    while (cursor < line.end) {
      // Varied lengths, or the region reads as a machine-made pattern.
      const length = 8 + random() * 26;
      const stop = Math.min(line.end, cursor + length);
      if (stop - cursor > 3) {
        const steps = Math.max(2, Math.round((stop - cursor) / 3));
        const points: Point[] = [];
        for (let i = 0; i <= steps; i++) {
          const t = cursor + ((stop - cursor) * i) / steps;
          const along = i / steps;
          points.push({
            x: line.ox + line.dx * t,
            y: line.oy + line.dy * t,
            // Full weight at the entry, nothing at the flick.
            w: Math.max(0.3, options.weight * (1 - along) ** 1.4),
          });
        }
        out.push({ points, width: options.weight });
      }
      // A gap of its own, so the flicks read as separate marks.
      cursor = stop + 4 + random() * 14;
    }
  }
  return out;
}

/**
 * Pepper shading: jittered dots. Each is a single-point stroke, which the
 * ribbon builder renders as a disc — the same thing a needle tapped in leaves.
 */
function pepperStrokes(mask: Mask, options: ShadingOptions): ShadingStroke[] {
  const random = rng(options.seed);
  const density = Math.max(0, Math.min(1, options.density));
  // Area per dot, tied to the same spacing the line styles use so switching
  // style at one density does not change how dark the region reads.
  const spacing = spacingFor(options);
  const attempts = Math.round((mask.width * mask.height) / (spacing * spacing * 0.55));
  const out: ShadingStroke[] = [];
  for (let i = 0; i < attempts; i++) {
    const x = random() * mask.width;
    const y = random() * mask.height;
    if (!inside(mask, x, y)) continue;
    const size = options.weight * (0.5 + random() * (0.5 + density));
    out.push({ points: [{ x, y, w: size }], width: size });
  }
  return out;
}

/**
 * The marks that fill one masked region.
 *
 * Crosshatch runs two sweeps 55 degrees apart rather than a right angle: a
 * perfect cross reads as graph paper, and every hatching reference from the
 * traditional flash the generator imitates uses an oblique second pass.
 */
export function shadeRegion(mask: Mask, options: ShadingOptions): ShadingStroke[] {
  if (!mask.width || !mask.height || mask.data.length !== mask.width * mask.height) return [];
  switch (options.style) {
    case "whip":
      return whipStrokes(mask, options);
    case "pepper":
      return pepperStrokes(mask, options);
    case "hatch":
      return hatchStrokes(mask, options, options.angle);
    case "crosshatch":
      return [
        ...hatchStrokes(mask, options, options.angle),
        ...hatchStrokes(mask, options, options.angle + 55),
      ];
    case "solid":
      // Spacing at the mark weight packs the lines edge to edge, which fills
      // the region without needing a separate fill primitive.
      return hatchStrokes(mask, { ...options, density: 1 }, options.angle);
    default:
      return [];
  }
}

/** How much ink a set of marks lays down, as a fraction of the mask's area. */
export function inkCoverage(strokes: ShadingStroke[], mask: Mask): number {
  const area = mask.data.reduce<number>((sum, value) => sum + value, 0);
  if (!area) return 0;
  let laid = 0;
  for (const stroke of strokes) {
    if (stroke.points.length === 1) {
      const radius = (stroke.points[0].w ?? stroke.width) / 2;
      laid += Math.PI * radius * radius;
      continue;
    }
    for (let i = 1; i < stroke.points.length; i++) {
      const a = stroke.points[i - 1];
      const b = stroke.points[i];
      const width = ((a.w ?? stroke.width) + (b.w ?? stroke.width)) / 2;
      laid += Math.hypot(b.x - a.x, b.y - a.y) * width;
    }
  }
  return laid / area;
}
