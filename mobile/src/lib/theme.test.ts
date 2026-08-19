import test from "node:test";
import assert from "node:assert/strict";
import { SUGAR_DARK, THEMES, TYPE, resolveTheme, type Theme } from "./theme";

function close(actual: number, expected: number, label: string) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: expected ${expected}, got ${actual}`);
}

function luminance(hex: string) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

test("resolveTheme only selects dark Sugar for Sugar’s dark appearance", () => {
  assert.equal(resolveTheme("ink", "light"), THEMES.ink);
  assert.equal(resolveTheme("ink", "dark"), THEMES.ink);
  assert.equal(resolveTheme("sugar", "light"), THEMES.sugar);
  assert.equal(resolveTheme("sugar", "dark"), SUGAR_DARK);
  assert.equal(resolveTheme("sugar", null), THEMES.sugar);
  assert.equal(resolveTheme("sugar", undefined), THEMES.sugar);
});

test("the dark Sugar theme implements every theme token", () => {
  const required = Object.keys(THEMES.sugar).sort();
  const present = Object.keys(SUGAR_DARK).sort();
  assert.deepEqual(present, required);
  const typedTheme: Theme = SUGAR_DARK;
  assert.equal(typedTheme.fontDisplay, SUGAR_DARK.fontDisplay);
});

test("dark Sugar keeps physical stock light while its workspace stays dark", () => {
  assert.ok(luminance(SUGAR_DARK.background) < 0.05);
  for (const token of [SUGAR_DARK.stock, SUGAR_DARK.stockMark, SUGAR_DARK.stockGrid]) {
    assert.ok(luminance(token) > 0.65, `${token} should remain light physical paper`);
  }
});

test("the type scale decreases from hero through micro", () => {
  const sizes = Object.values(TYPE).map((style) => style.fontSize);
  for (let index = 1; index < sizes.length; index++) {
    assert.ok(sizes[index - 1] > sizes[index]);
  }
});

test("every type style has positive leading at least as large as its font", () => {
  for (const [name, style] of Object.entries(TYPE)) {
    assert.ok(style.fontSize > 0, `${name} font size`);
    assert.ok(style.lineHeight >= style.fontSize, `${name} line height`);
    assert.ok(Number.isFinite(style.letterSpacing), `${name} letter spacing`);
  }
  close(TYPE.hero.lineHeight, 79, "hero leading");
});
