// Conditioning raw stylus input into something worth drawing with.
//
// A finger reports a position and nothing else. An Apple Pencil reports
// position, how hard it is pressed, and how far it is tilted from vertical —
// and until this module existed all of that was thrown away, which is why
// every stroke in the editor came out as a dead-flat line of one width.
//
// Three separate effects live here, and they compose in this order:
//
//   1. Stabilization  — the raw pointer stream is jittery, and a hand that is
//      steady enough for paper is not steady enough for glass. Smoothing the
//      position lets an unremarkable hand draw a confident line. Procreate
//      calls this StreamLine; the maths is a one-pole low-pass filter.
//   2. Width          — pressure and tilt both widen the mark. Pressing harder
//      digs in; laying the pen over broadens it the way the side of a pencil
//      lead does.
//   3. Taper          — a needle leaving skin does not stop dead, so a fast
//      stroke thins out and both ends come to a point.
//
// Deliberately Skia-free and free of any React Native import: it is arithmetic
// over sample arrays, which keeps the whole feel of the brush verifiable under
// `tsx --test` instead of only in the hand.

import type { Point } from "./designProject";

/** One reading from the digitiser, before any conditioning. */
export type PenSample = {
  x: number;
  y: number;
  /**
   * 0..1 as reported by the hardware. Devices without a pressure sensor report
   * a constant — the web/pointer-events convention is 0.5 for a contacting
   * pointer with no sensor, and 0 when not in contact.
   */
  pressure: number;
  /** Degrees away from vertical: 0 is upright, 90 is flat against the glass. */
  tilt: number;
  /** True for a stylus, false for a finger. Drives palm rejection upstream. */
  pen: boolean;
};

export type PenSettings = {
  /** 0 keeps the raw input; 1 is as smooth as the filter goes. */
  stabilization: number;
  /** Let pressure drive width. Ignored when the hardware reports none. */
  pressure: boolean;
  /**
   * How much of the nominal width pressure is allowed to take away. At 0.6 a
   * feather-light touch draws at 40% width and a hard press at 100%.
   */
  pressureDepth: number;
  /** Extra width at full tilt, as a multiple of the nominal. 0 disables. */
  tiltGain: number;
  /** How much a fast stroke thins. 0 disables; 1 lets speed halve the width. */
  velocityTaper: number;
  /** Distance over which each end of a stroke comes to a point, in px. */
  taperLength: number;
};

export const DEFAULT_PEN: PenSettings = {
  stabilization: 0.45,
  pressure: true,
  pressureDepth: 0.6,
  tiltGain: 0.7,
  velocityTaper: 0.35,
  taperLength: 14,
};

/** Widths below this read as a gap rather than a hairline once printed. */
const MIN_WIDTH = 0.35;

/** Speed, in px per sample, at which velocity taper reaches full effect. */
const FAST_SPEED = 26;

/**
 * The pressure a pointer with no sensor reports. Pointer Events specifies 0.5
 * for a contacting pointer that cannot measure force, so a finger arrives as a
 * flat 0.5 for the whole stroke and must not be mistaken for a real reading.
 */
export const NO_SENSOR_PRESSURE = 0.5;

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Whether a run of samples carries real pressure data. A sensorless pointer
 * pins every sample to the same value, so constant pressure is treated as no
 * pressure — otherwise a finger-drawn stroke would silently pick up whatever
 * width that constant happens to map to.
 */
export function hasPressureData(samples: PenSample[]): boolean {
  if (samples.length < 2) return false;
  const first = samples[0].pressure;
  return samples.some((sample) => Math.abs(sample.pressure - first) > 0.01);
}

/**
 * One-pole low-pass filter over position, fed a sample at a time.
 *
 * Strength maps to the filter coefficient non-linearly: the top of the slider
 * needs to feel dramatically smoother than the middle, and a linear map spends
 * most of its travel in a range where nothing perceptible changes.
 */
export function createStabilizer(strength: number) {
  const alpha = 1 - Math.pow(clamp01(strength), 0.55) * 0.94;
  let current: PenSample | null = null;

  return {
    /** Feeds one raw sample in and returns the smoothed sample to draw. */
    push(sample: PenSample): PenSample {
      if (!current) {
        current = { ...sample };
        return { ...current };
      }
      current = {
        ...sample,
        x: current.x + (sample.x - current.x) * alpha,
        y: current.y + (sample.y - current.y) * alpha,
        // Pressure is smoothed harder than position. The sensor is noisy
        // enough that unsmoothed pressure produces a visibly lumpy edge.
        pressure: current.pressure + (sample.pressure - current.pressure) * Math.min(1, alpha * 1.5),
        tilt: current.tilt + (sample.tilt - current.tilt) * Math.min(1, alpha * 1.5),
      };
      return { ...current };
    },
    /**
     * Points that close the gap between where the filter got to and where the
     * pen actually was when it lifted. Without this the stroke ends short of
     * the lift point by an amount that grows with the stabilization strength,
     * which feels like the line is being taken away from you.
     */
    flush(target: PenSample): PenSample[] {
      if (!current) return [];
      const out: PenSample[] = [];
      let cursor = current;
      // Ease most of the way there, so the catch-up reads as the end of the
      // same curve rather than a jump...
      for (let i = 0; i < 16; i++) {
        if (Math.hypot(target.x - cursor.x, target.y - cursor.y) < 0.5) break;
        cursor = {
          ...target,
          x: cursor.x + (target.x - cursor.x) * alpha,
          y: cursor.y + (target.y - cursor.y) * alpha,
          pressure: cursor.pressure + (target.pressure - cursor.pressure) * alpha,
          tilt: cursor.tilt + (target.tilt - cursor.tilt) * alpha,
        };
        out.push({ ...cursor });
      }
      // ...then land exactly on it. Easing alone converges but never arrives,
      // and at high stabilization it is still visibly short after a bounded
      // number of steps.
      if (Math.hypot(target.x - cursor.x, target.y - cursor.y) > 0.01) out.push({ ...target });
      current = null;
      return out;
    },
  };
}

/** Batch form of the stabilizer, for reprocessing a stroke that already exists. */
export function stabilize(samples: PenSample[], strength: number): PenSample[] {
  if (!samples.length) return [];
  const filter = createStabilizer(strength);
  const out = samples.map((sample) => filter.push(sample));
  return [...out, ...filter.flush(samples[samples.length - 1])];
}

/** Cumulative distance along a run of samples, one entry per sample. */
function arcLengths(samples: PenSample[]): number[] {
  const out = [0];
  for (let i = 1; i < samples.length; i++) {
    out.push(out[i - 1] + Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y));
  }
  return out;
}

/**
 * The width of the mark at each sample, in the same units as the positions.
 *
 * `base` is the nominal brush width — the width a fully-pressed, upright pen
 * draws at. Every effect here can only ever take width away from that or, in
 * the case of tilt, broaden past it.
 */
export function strokeWidths(samples: PenSample[], base: number, settings: PenSettings): number[] {
  if (!samples.length) return [];
  if (samples.length === 1) return [Math.max(MIN_WIDTH, base)];

  const usePressure = settings.pressure && hasPressureData(samples);
  const lengths = arcLengths(samples);
  const total = lengths[lengths.length - 1];

  return samples.map((sample, index) => {
    let width = base;

    if (usePressure) {
      const depth = clamp01(settings.pressureDepth);
      width *= 1 - depth + depth * clamp01(sample.pressure);
    }

    if (settings.tiltGain > 0) {
      // Only the last third of the tilt range does anything: a pen held at 20
      // degrees is still being used as a liner, not as a shader.
      const laid = clamp01((sample.tilt - 30) / 55);
      width *= 1 + settings.tiltGain * laid;
    }

    if (settings.velocityTaper > 0) {
      const previous = index === 0 ? 0 : lengths[index] - lengths[index - 1];
      const next = index === samples.length - 1 ? 0 : lengths[index + 1] - lengths[index];
      const speed = index === 0 || index === samples.length - 1 ? previous + next : (previous + next) / 2;
      width *= 1 - clamp01(settings.velocityTaper) * clamp01(speed / FAST_SPEED);
    }

    if (settings.taperLength > 0 && total > 0) {
      // Both ends come to a point, but never at the cost of more than half the
      // stroke — a short flick should still taper rather than turn into a
      // uniform stub.
      const ramp = Math.min(settings.taperLength, total / 2);
      if (ramp > 0) {
        const fromStart = lengths[index];
        const fromEnd = total - lengths[index];
        const ends = Math.min(1, Math.min(fromStart, fromEnd) / ramp);
        // Square-rooted so the taper opens up quickly and then holds, which is
        // what a needle or a nib actually does. A linear ramp reads as a wedge.
        width *= 0.15 + 0.85 * Math.sqrt(ends);
      }
    }

    return Math.max(MIN_WIDTH, width);
  });
}

/**
 * Conditioned samples plus their widths, as the point array the project model
 * stores. Points that land on top of each other are dropped: they contribute
 * nothing to the shape and every downstream consumer — node editing, tracing,
 * blowout checking — has to walk past them.
 */
export function toPoints(samples: PenSample[], base: number, settings: PenSettings): Point[] {
  const widths = strokeWidths(samples, base, settings);
  const out: Point[] = [];
  for (let i = 0; i < samples.length; i++) {
    const point = { x: samples[i].x, y: samples[i].y, w: widths[i] };
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - point.x) < 0.01 && Math.abs(last.y - point.y) < 0.01) {
      // Keep the wider of the two so a pause mid-stroke still registers as
      // pressure building rather than being discarded.
      if (point.w > (last.w ?? 0)) last.w = point.w;
      continue;
    }
    out.push(point);
  }
  return out;
}

/**
 * Builds a sample from what a gesture handler reports about one touch.
 *
 * Kept here, free of any React Native import, so the mapping from raw device
 * numbers to the units the rest of this module works in is covered by tests
 * rather than only observable with a Pencil in hand.
 *
 * `altitudeAngle` arrives in radians with pi/2 meaning upright — the iOS
 * convention, which react-native-gesture-handler passes through unchanged from
 * UITouch. Tilt here is degrees away from vertical, so the two are
 * complementary, not the same number in different units.
 */
export function sampleFromStylus(
  x: number,
  y: number,
  stylus: { pressure?: number; altitudeAngle?: number } | undefined | null
): PenSample {
  if (!stylus || typeof stylus.pressure !== "number") {
    return { x, y, pressure: NO_SENSOR_PRESSURE, tilt: 0, pen: false };
  }
  const altitude = typeof stylus.altitudeAngle === "number" ? stylus.altitudeAngle : Math.PI / 2;
  return {
    x,
    y,
    pressure: clamp01(stylus.pressure),
    tilt: Math.max(0, Math.min(90, 90 - (altitude * 180) / Math.PI)),
    pen: true,
  };
}

/**
 * Raw samples in, drawable points out: stabilize, then width and taper.
 *
 * The one entry point the editor needs. Going through it means the preview
 * drawn while the pen is down and the geometry committed when it lifts are
 * produced by the same code, so a stroke cannot change shape at the moment you
 * let go of it.
 */
export function conditionStroke(
  samples: PenSample[],
  base: number,
  settings: PenSettings
): Point[] {
  return toPoints(stabilize(samples, settings.stabilization), base, settings);
}
