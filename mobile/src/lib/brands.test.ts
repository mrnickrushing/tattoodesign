import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BRANDS, BRAND_IDS, LINE_WEIGHT_DIRECTION, SHADING_VOCABULARY } from "./brands";

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

test("shading ids are unique and line-only comes first", () => {
  const ids = SHADING_VOCABULARY.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate shading ids");
  // The server resolves an unknown id to entry zero, so entry zero has to be
  // the safe answer: a plain stencil, not a technique nobody asked for.
  assert.equal(SHADING_VOCABULARY[0].id, "none");
  assert.equal(SHADING_VOCABULARY[0].render, "", "line-only must add no render direction");
});

test("every shading option carries a label, a caption and direction", () => {
  for (const item of SHADING_VOCABULARY) {
    assert.ok(item.label.trim().length > 0, `${item.id} label`);
    assert.ok(item.caption.trim().length > 0, `${item.id} caption`);
    if (item.id === "none") continue;
    assert.ok(item.render.trim().length > 20, `${item.id} render direction`);
    assert.ok(item.constraint, `${item.id} needs an ink rule that permits its own tone`);
  }
});

test("no shading option forbids the tone it exists to produce", () => {
  // "no shading, no gray" alongside "whip shading" is a contradiction, and the
  // model resolves it by drawing flat line art. That was the original bug.
  for (const item of SHADING_VOCABULARY) {
    if (item.id === "none" || !item.constraint) continue;
    assert.doesNotMatch(item.constraint, /no shading/i, `${item.id} forbids shading`);
  }
});

// Same contract as the style ids: the phone sends an id, the server resolves
// it against the web app's own copy and falls back to entry zero when it does
// not recognise it. A chip that silently generates line art is worse than a
// missing chip.
test("every mobile shading id exists in the web app's brand contract", () => {
  const webBrands = readFileSync(join(__dirname, "../../../src/lib/brands.ts"), "utf8");
  for (const item of SHADING_VOCABULARY) {
    assert.ok(
      webBrands.includes(`id: "${item.id}"`),
      `shading "${item.id}" is missing from src/lib/brands.ts — the server would fall back to line only`
    );
  }
});

test("the line weight direction asks for a hierarchy, not a uniform weight", () => {
  assert.ok(LINE_WEIGHT_DIRECTION.length > 40);
  assert.match(LINE_WEIGHT_DIRECTION, /never draw every line at the same weight/i);
});
