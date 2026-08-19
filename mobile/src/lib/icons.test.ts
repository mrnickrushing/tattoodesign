import test from "node:test";
import assert from "node:assert/strict";
import { ICONS, iconFor, type IconName } from "./icons";

const iconNames = Object.keys(ICONS) as IconName[];

test("every semantic icon name is present in the icon table", () => {
  assert.ok(iconNames.length > 0);
  for (const name of iconNames) assert.ok(ICONS[name]);
});

test("every icon definition has non-empty symbol names", () => {
  for (const [name, icon] of Object.entries(ICONS)) {
    assert.ok(icon.sf.length > 0, `${name} has an empty SF Symbol`);
    assert.ok(icon.ion.length > 0, `${name} has an empty Ionicon name`);
  }
});

test("semantic icon definitions do not reuse SF Symbols", () => {
  const symbols = Object.values(ICONS).map((icon) => icon.sf);
  assert.equal(new Set(symbols).size, symbols.length);
});

test("Ionicon fallback names use plausible kebab-case names", () => {
  for (const icon of Object.values(ICONS)) {
    assert.match(icon.ion, /^[a-z]+(?:-[a-z]+)*$/);
  }
});

test("iconFor round-trips every table entry", () => {
  for (const name of iconNames) assert.equal(iconFor(name), ICONS[name]);
});
