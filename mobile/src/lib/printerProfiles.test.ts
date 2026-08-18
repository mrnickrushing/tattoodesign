import assert from "node:assert/strict";
import test from "node:test";
import { calibrationCorrection, PRINTER_PRESETS, profileWarnings } from "./printerProfiles";

test("calibration correction expands short output and clamps unsafe values", () => {
  assert.equal(calibrationCorrection(6, 6), 1);
  assert.equal(Number(calibrationCorrection(6, 5.9).toFixed(4)), 1.0169);
  assert.equal(calibrationCorrection(6, 2), 1.1);
  assert.equal(calibrationCorrection(6, 20), 0.9);
});

test("thermal proof warns before a sheet is clipped", () => {
  const profile = PRINTER_PRESETS.find((item) => item.id === "ble-escpos-203")!;
  const warnings = profileWarnings(profile, 8.5);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /clip/);
});

test("every printer preset has internally valid output geometry", () => {
  for (const profile of PRINTER_PRESETS) {
    assert.ok(profile.printableWidthIn <= profile.paperWidthIn);
    assert.ok(profile.dpi === 203 || profile.dpi === 300);
    assert.ok(profile.density >= 1 && profile.density <= 10);
  }
});
