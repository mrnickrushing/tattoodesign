import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BRANDS, BRAND_IDS } from "./brands";

test("style ids are unique within each brand", () => {
  for (const id of BRAND_IDS) {
    const ids = BRANDS[id].generate.styles.map((style) => style.id);
    assert.equal(new Set(ids).size, ids.length, `${id} has duplicate style ids`);
    assert.ok(ids.length > 0, `${id} has no styles`);
  }
});

test("every style carries a label and prompt language", () => {
  for (const id of BRAND_IDS) {
    for (const style of BRANDS[id].generate.styles) {
      assert.ok(style.label.trim().length > 0, `${style.id} label`);
      assert.ok(style.promptDescription.trim().length > 10, `${style.id} promptDescription`);
      if (style.inkConstraint !== undefined) {
        assert.ok(style.inkConstraint.trim().length > 10, `${style.id} inkConstraint`);
      }
    }
  }
});

// The phone sends only the style id; the server resolves it against the web
// app's own brands.ts and silently falls back to the first style when the id
// is unknown. A style added here but not there would ship a chip that quietly
// generates Traditional. This guard fails the build instead.
test("every mobile style id exists in the web app's brand contract", () => {
  const webBrands = readFileSync(join(__dirname, "../../../src/lib/brands.ts"), "utf8");
  for (const id of BRAND_IDS) {
    for (const style of BRANDS[id].generate.styles) {
      assert.ok(
        webBrands.includes(`id: "${style.id}"`),
        `style "${style.id}" is missing from src/lib/brands.ts — the server would silently fall back to ${BRANDS[id].generate.styles[0].id}`
      );
    }
  }
});
