import test from "node:test";
import assert from "node:assert/strict";
import { buildTray } from "./castingTray";
import { buildSphereMold } from "./sphereMold";
import {
  cavityPrompt,
  everyChoiceIsDistinct,
  moldPrompt,
  thicknessPrompt,
  trayPrompt,
  warningsIn,
  MOLD_DESIGNED,
  MOLD_SMOOTH,
  TRAY_CAST_FLAT,
  TRAY_EXPORT,
  TRAY_KEEP_HOLES,
} from "./exportFlow";

const W = 120;
const H = 90;

/** A plain rectangle: already its own silhouette, nothing to raise. */
function solid(): Uint8Array {
  const mask = new Uint8Array(W * H);
  for (let y = 20; y < 70; y++) for (let x = 30; x < 90; x++) mask[y * W + x] = 1;
  return mask;
}

/** An outlined box with a bar through it: filling changes it, and it has lines. */
function drawn(): Uint8Array {
  const mask = new Uint8Array(W * H);
  const box = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * W + x] = 1;
  };
  box(20, 15, 100, 21);
  box(20, 69, 100, 75);
  box(20, 15, 26, 75);
  box(94, 15, 100, 75);
  box(20, 42, 100, 48);
  return mask;
}

const SPEC = { widthIn: 3, shapeMm: 6 };

test("an alternative is only offered when it is a real question", () => {
  // A plain rectangle: filling it changes nothing and there is no interior
  // linework to raise, so both alternatives would be offers to do nothing.
  const plain = trayPrompt(buildTray(solid(), W, H, SPEC)!, 6, true);
  assert.deepEqual(
    plain.choices.map((choice) => choice.value),
    [TRAY_EXPORT],
    "a silhouette gets one way out and no false choices"
  );

  // A drawing with both: filling changed it, and the lines were raised.
  const both = trayPrompt(buildTray(drawn(), W, H, SPEC)!, 6, true);
  assert.deepEqual(both.choices.map((choice) => choice.value), [TRAY_KEEP_HOLES, TRAY_CAST_FLAT, TRAY_EXPORT]);

  // Asked for the holes already: there is no filling left to decline.
  const holes = trayPrompt(buildTray(drawn(), W, H, { ...SPEC, fillOutlines: false })!, 6, false);
  assert.equal(holes.choices.some((choice) => choice.value === TRAY_KEEP_HOLES), false);

  // Relief turned off: nothing was raised, so nothing can be cast flat.
  const flat = trayPrompt(buildTray(drawn(), W, H, { ...SPEC, reliefMm: 0 })!, 6, true);
  assert.equal(flat.choices.some((choice) => choice.value === TRAY_CAST_FLAT), false);
});

test("no two ways out of a prompt answer to the same value", () => {
  // The value dispatches the action, so a collision quietly does the wrong job
  // while looking perfectly right on screen.
  const prompts = [
    thicknessPrompt(),
    cavityPrompt([1, 2, 4, 6, 9, 12, 18, 24]),
    cavityPrompt([1, 2, 4, 6, 9, 12], "cake pop"),
    trayPrompt(buildTray(drawn(), W, H, SPEC)!, 6, true),
    trayPrompt(buildTray(solid(), W, H, SPEC)!, 6, true),
    moldPrompt(buildSphereMold(drawn(), W, H, { diameterIn: 1.5, stick: true })!, "cake pop"),
  ];
  for (const prompt of prompts) {
    assert.equal(everyChoiceIsDistinct(prompt), true, `"${prompt.title}" has two rows sharing a value`);
    assert.ok(prompt.choices.length > 0, `"${prompt.title}" offers no way out`);
    for (const choice of prompt.choices) {
      assert.ok(choice.label.trim().length > 0, `"${prompt.title}" has an unlabelled row`);
    }
  }
});

test("the summary describes the tray that was actually built", () => {
  const raised = buildTray(drawn(), W, H, SPEC)!;
  const prompt = trayPrompt(raised, 6, true);
  assert.ok(raised.reliefAppliedMm > 0, "this drawing has lines to raise");
  // Thickness has to include the relief, because that is what she will measure.
  assert.match(prompt.subtitle, new RegExp(`${(6 + raised.reliefAppliedMm).toFixed(1)}mm thick`));

  // And says nothing about raised lines when there are none.
  const flat = trayPrompt(buildTray(solid(), W, H, SPEC)!, 6, true);
  assert.equal(/thick, lines and all/.test(flat.subtitle), false);

  // One cavity reads as one cavity, not "1 cavities, 1 x 1".
  assert.match(trayPrompt(buildTray(solid(), W, H, SPEC)!, 6, true).subtitle, /^One cavity on a /);
  assert.match(trayPrompt(buildTray(solid(), W, H, { ...SPEC, copies: 4 })!, 6, true).subtitle, /^4 cavities, /);
});

test("warnings open the prompt and rename the way out", () => {
  const clean = buildTray(solid(), W, H, { ...SPEC, nozzleMm: 0.4, bedMm: 250 })!;
  assert.equal(warningsIn(clean.findings).length, 0, "this tray has nothing wrong with it");
  const calm = trayPrompt(clean, 6, true);
  assert.equal(calm.title, "Ready to export");
  assert.equal(calm.choices.at(-1)!.label, "Export");

  // A tray over the bed has something worth reading before printing.
  const over = buildTray(solid(), W, H, { ...SPEC, copies: 24, bedMm: 100, nozzleMm: 0.4 })!;
  assert.ok(warningsIn(over.findings).length > 0);
  const alarmed = trayPrompt(over, 6, true);
  assert.equal(alarmed.title, "Worth checking before you print");
  assert.equal(alarmed.choices.at(-1)!.label, "Export anyway");
  // The warning itself is in the body, above the numbers.
  const bedWarning = warningsIn(over.findings).find((finding) => finding.title === "Bed")!;
  assert.ok(alarmed.subtitle.startsWith(bedWarning.detail), "the warning comes first");
  assert.ok(alarmed.subtitle.includes("cm³ of filament"), "and the numbers still follow it");
});

test("a ball mold offers its two halves, and totals both", () => {
  const mold = buildSphereMold(drawn(), W, H, { diameterIn: 1.5, stick: true, copies: 4 })!;
  const prompt = moldPrompt(mold, "cake pop");

  assert.deepEqual(prompt.choices.map((choice) => choice.value), [MOLD_DESIGNED, MOLD_SMOOTH]);
  // Never one row: a half on its own is not a mold, and there is nothing to
  // tell two files apart afterwards but which was asked for.
  assert.equal(prompt.choices.length, 2);

  const plastic = mold.designed.plasticCm3 + mold.plain.plasticCm3;
  assert.match(prompt.subtitle, new RegExp(`${plastic.toFixed(0)}cm³ of filament for the pair`));
  assert.match(prompt.subtitle, /4 cake pops a pour/);

  // One reads as one.
  const single = moldPrompt(buildSphereMold(drawn(), W, H, { diameterIn: 1.1, stick: false })!, "truffle");
  assert.match(single.subtitle, /1 truffle a pour/);
});

test("the questions asked before anything is built are answerable", () => {
  // Thickness and count are the two a drawing cannot supply. Each row has to
  // carry a number the caller can use, not just a label.
  for (const choice of thicknessPrompt().choices) {
    assert.ok(choice.value > 0, `"${choice.label}" gives no thickness`);
    assert.match(choice.label, new RegExp(`${choice.value}mm`), "the label names the number it returns");
  }
  const counts = cavityPrompt([1, 2, 4, 6], "truffle");
  assert.deepEqual(counts.choices.map((choice) => choice.value), [1, 2, 4, 6]);
  assert.equal(counts.choices[0].detail, "One truffle per pour.");
  assert.match(counts.title, /How many truffles at a time\?/);
});
