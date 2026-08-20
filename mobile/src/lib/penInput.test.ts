import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  DEFAULT_PEN,
  NO_SENSOR_PRESSURE,
  createStabilizer,
  hasPressureData,
  stabilize,
  strokeWidths,
  toPoints,
  type PenSample,
  type PenSettings,
} from "./penInput";

function sample(x: number, y: number, pressure = NO_SENSOR_PRESSURE, tilt = 0): PenSample {
  return { x, y, pressure, tilt, pen: true };
}

function line(count: number, step = 5, pressure = NO_SENSOR_PRESSURE): PenSample[] {
  return Array.from({ length: count }, (_, i) => sample(i * step, 0, pressure));
}

const RIGID: PenSettings = {
  ...DEFAULT_PEN,
  stabilization: 0,
  velocityTaper: 0,
  taperLength: 0,
  tiltGain: 0,
};

test("a sensorless pointer is not mistaken for pressure data", () => {
  assert.equal(hasPressureData(line(10)), false);
});

test("a varying pressure reading is recognised", () => {
  const samples = line(10).map((s, i) => ({ ...s, pressure: i / 10 }));
  assert.equal(hasPressureData(samples), true);
});

test("a single sample carries no pressure information", () => {
  assert.equal(hasPressureData([sample(0, 0, 0.3)]), false);
});

test("stabilization pulls a jagged line toward straight", () => {
  const jagged = Array.from({ length: 40 }, (_, i) => sample(i * 4, i % 2 ? 6 : -6));
  const deviation = (points: { y: number }[]) =>
    points.reduce((sum, point) => sum + Math.abs(point.y), 0) / points.length;

  const raw = deviation(stabilize(jagged, 0));
  const smoothed = deviation(stabilize(jagged, 0.8));
  assert.ok(smoothed < raw * 0.5, `expected heavy smoothing, got ${smoothed} vs ${raw}`);
});

test("zero stabilization returns the input untouched", () => {
  const input = line(12);
  const out = stabilize(input, 0);
  for (let i = 0; i < input.length; i++) {
    assert.ok(Math.abs(out[i].x - input[i].x) < 1e-9);
    assert.ok(Math.abs(out[i].y - input[i].y) < 1e-9);
  }
});

test("a stabilized stroke still ends where the pen lifted", () => {
  const input = line(30, 8);
  const out = stabilize(input, 0.9);
  const end = out[out.length - 1];
  const target = input[input.length - 1];
  assert.ok(
    Math.hypot(end.x - target.x, end.y - target.y) < 1,
    `stroke ended ${Math.hypot(end.x - target.x, end.y - target.y)}px short of the lift point`
  );
});

test("flush does nothing when the filter already caught up", () => {
  const filter = createStabilizer(0.5);
  const only = sample(4, 4);
  filter.push(only);
  assert.deepEqual(filter.flush(only), []);
});

test("harder pressure draws a wider mark", () => {
  // Both strokes have to vary, or the constant one reads as a sensorless
  // pointer and pressure is skipped entirely.
  const soft = strokeWidths(line(8, 5).map((s, i) => ({ ...s, pressure: i ? 0.1 : 0.12 })), 10, RIGID);
  const hard = strokeWidths(line(8, 5).map((s, i) => ({ ...s, pressure: i ? 0.95 : 0.9 })), 10, RIGID);
  assert.ok(hard[5] > soft[5] * 1.5, `expected pressure to widen the stroke: ${hard[5]} vs ${soft[5]}`);
});

test("pressure never widens past the nominal brush width", () => {
  const samples = line(8).map((s, i) => ({ ...s, pressure: i ? 1 : 0 }));
  for (const width of strokeWidths(samples, 10, RIGID)) {
    assert.ok(width <= 10 + 1e-9, `width ${width} exceeded the nominal 10`);
  }
});

test("pressure is ignored when the setting is off", () => {
  const samples = line(8).map((s, i) => ({ ...s, pressure: i / 8 }));
  const widths = strokeWidths(samples, 10, { ...RIGID, pressure: false });
  assert.ok(widths.every((width) => Math.abs(width - 10) < 1e-9));
});

test("laying the pen over broadens the mark", () => {
  const upright = strokeWidths(line(8), 10, { ...RIGID, tiltGain: 0.7 });
  const laid = strokeWidths(
    line(8).map((s) => ({ ...s, tilt: 85 })),
    10,
    { ...RIGID, tiltGain: 0.7 }
  );
  assert.ok(laid[4] > upright[4] * 1.5, `expected tilt to broaden: ${laid[4]} vs ${upright[4]}`);
});

test("a small tilt is still a liner", () => {
  const barely = strokeWidths(
    line(8).map((s) => ({ ...s, tilt: 20 })),
    10,
    { ...RIGID, tiltGain: 0.7 }
  );
  assert.ok(Math.abs(barely[4] - 10) < 1e-9);
});

test("a fast stroke is thinner than a slow one", () => {
  const settings = { ...RIGID, velocityTaper: 0.5 };
  const slow = strokeWidths(line(20, 2), 10, settings);
  const fast = strokeWidths(line(20, 30), 10, settings);
  assert.ok(fast[10] < slow[10] * 0.8, `expected speed to thin the stroke: ${fast[10]} vs ${slow[10]}`);
});

test("both ends of a stroke taper to a point", () => {
  const widths = strokeWidths(line(40, 5), 10, { ...RIGID, taperLength: 40 });
  const middle = widths[20];
  assert.ok(widths[0] < middle * 0.5, "the stroke did not enter from a point");
  assert.ok(widths[widths.length - 1] < middle * 0.5, "the stroke did not leave to a point");
});

test("a short flick still tapers rather than becoming a stub", () => {
  const widths = strokeWidths(line(6, 2), 10, { ...RIGID, taperLength: 200 });
  assert.ok(widths[0] < widths[3], "the entry did not taper");
  assert.ok(widths[5] < widths[3], "the exit did not taper");
});

test("no width ever collapses to nothing", () => {
  const widths = strokeWidths(line(30, 40, 0), 1, {
    ...DEFAULT_PEN,
    pressureDepth: 1,
    velocityTaper: 1,
    taperLength: 500,
  });
  assert.ok(widths.every((width) => width > 0));
});

test("points are emitted with a width each", () => {
  const points = toPoints(line(6), 8, RIGID);
  assert.equal(points.length, 6);
  assert.ok(points.every((point) => typeof point.w === "number"));
});

test("repeated samples collapse to one point and keep the wider width", () => {
  const held: PenSample[] = [sample(0, 0, 0.2), sample(0, 0, 0.9), sample(10, 0, 0.9)];
  const points = toPoints(held, 10, RIGID);
  assert.equal(points.length, 2);
  assert.ok((points[0].w ?? 0) > 5, "the harder of two stacked samples should survive");
});

test("an empty stroke produces nothing", () => {
  assert.deepEqual(toPoints([], 10, DEFAULT_PEN), []);
  assert.deepEqual(strokeWidths([], 10, DEFAULT_PEN), []);
  assert.deepEqual(stabilize([], 0.5), []);
});
