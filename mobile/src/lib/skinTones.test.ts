import test from "node:test";
import assert from "node:assert/strict";
import {
  FINEST_LINE_MM,
  HEAVIEST_LINE_MM,
  SKIN_TONES,
  contrastAdvice,
  findSkinTone,
  lightness,
  lineContrast,
  minLineWidthMm,
  relativeLuminance,
} from "./skinTones";

test("contrast matches the ratios WCAG defines", () => {
  // The two anchors of the scale, exactly.
  assert.ok(Math.abs(lineContrast("#000000", "#FFFFFF") - 21) < 1e-9, "black on white is 21:1");
  assert.equal(lineContrast("#FFFFFF", "#FFFFFF"), 1, "a colour against itself is 1:1");

  // Mid grey #777777 against white is the published 4.48:1.
  assert.ok(Math.abs(lineContrast("#777777", "#FFFFFF") - 4.48) < 0.01);
  // #767676 on white is the canonical "just passes AA" pair at 4.54:1.
  assert.ok(Math.abs(lineContrast("#767676", "#FFFFFF") - 4.54) < 0.01);
});

test("contrast does not care which colour is the ink", () => {
  assert.equal(lineContrast("#000000", "#F6D7C4"), lineContrast("#F6D7C4", "#000000"));
});

test("a colour that cannot be read is treated as indistinguishable", () => {
  assert.equal(lineContrast("nonsense", "#FFFFFF"), 1);
  assert.equal(lineContrast("#000000", ""), 1);
});

test("relative luminance spans zero to one", () => {
  assert.equal(relativeLuminance({ r: 0, g: 0, b: 0 }), 0);
  assert.ok(Math.abs(relativeLuminance({ r: 255, g: 255, b: 255 }) - 1) < 1e-9);
});

test("lightness is CIE L*, not raw luminance", () => {
  assert.equal(lightness("#000000"), 0);
  assert.ok(Math.abs(lightness("#FFFFFF") - 100) < 1e-9);
  // Mid grey sits near the middle of L* — where raw luminance would put it at 21.
  assert.ok(Math.abs(lightness("#777777") - 50) < 2, `expected ~50, got ${lightness("#777777")}`);
  assert.equal(lightness("not a colour"), 0);
});

test("the tone set runs light to dark and carries its own lightness", () => {
  assert.equal(SKIN_TONES.length, 6, "six Fitzpatrick types");
  const lightnesses = SKIN_TONES.map((tone) => tone.l);
  for (let i = 1; i < lightnesses.length; i++) {
    assert.ok(lightnesses[i] < lightnesses[i - 1], `type ${i + 1} should be darker than type ${i}`);
  }
  // Derived, never typed in: the two can't drift.
  SKIN_TONES.forEach((tone) => assert.equal(tone.l, lightness(tone.hex)));
});

test("tones are found by id and unknown ids are not invented", () => {
  assert.equal(findSkinTone("vi")?.label, "Type VI — deep brown");
  assert.equal(findSkinTone("vii"), undefined);
});

test("black holds a finer line on fair skin than on deep skin", () => {
  const fair = lineContrast("#111111", SKIN_TONES[0].hex);
  const deep = lineContrast("#111111", SKIN_TONES[5].hex);
  assert.ok(fair > deep, `fair skin should out-contrast deep skin, got ${fair} vs ${deep}`);
  assert.ok(minLineWidthMm(deep) > minLineWidthMm(fair), "deep skin needs more weight");
});

test("the weight a line needs never falls as contrast falls", () => {
  let previous = 0;
  for (let contrast = 21; contrast >= 1; contrast -= 0.5) {
    const needed = minLineWidthMm(contrast);
    assert.ok(needed >= previous, `${contrast}:1 asked for less weight than the contrast above it`);
    previous = needed;
  }
});

test("line weight stays inside the range a machine can actually hold", () => {
  assert.equal(minLineWidthMm(1000), FINEST_LINE_MM, "no contrast buys a line finer than a liner draws");
  assert.equal(minLineWidthMm(1), HEAVIEST_LINE_MM, "1:1 is the end of the curve");
  assert.ok(HEAVIEST_LINE_MM < 1, "and the curve ends short of a millimetre on its own");
  assert.equal(minLineWidthMm(0), HEAVIEST_LINE_MM, "a nonsense contrast is treated as the worst case");
  assert.equal(minLineWidthMm(-4), HEAVIEST_LINE_MM);
});

test("advice passes a heavy line and warns on a fine one", () => {
  const deep = findSkinTone("vi")!;
  const heavy = contrastAdvice("#111111", deep, 1);
  assert.equal(heavy.level, "pass");
  assert.ok(heavy.detail.includes("holds"));

  const fine = contrastAdvice("#111111", deep, FINEST_LINE_MM);
  assert.equal(fine.level, "warn");
  assert.ok(fine.minLineMm > FINEST_LINE_MM);
  assert.ok(fine.detail.includes("0.25mm"), "should name the weight that fails");
});

test("the same fine line that fails on deep skin passes on fair skin", () => {
  const fine = 0.3;
  assert.equal(contrastAdvice("#111111", findSkinTone("i")!, fine).level, "pass");
  assert.equal(contrastAdvice("#111111", findSkinTone("vi")!, fine).level, "warn");
});

test("advice never leaves a template token unresolved", () => {
  for (const tone of SKIN_TONES) {
    for (const width of [0.1, 0.25, 0.5, 1, 2]) {
      const advice = contrastAdvice("#111111", tone, width);
      assert.ok(advice.detail.length > 0);
      assert.ok(!/\$\{|undefined|NaN/.test(advice.detail), `bad copy for ${tone.id} at ${width}: ${advice.detail}`);
    }
  }
});
