import test from "node:test";
import assert from "node:assert/strict";
import { allTags, filterDesigns, isFiltering, normalizeTags } from "./libraryFilter";
import type { LibraryDesign } from "./designLibrary";

let counter = 0;
function design(patch: Partial<LibraryDesign>): LibraryDesign {
  counter += 1;
  return {
    id: `d${counter}`,
    uri: `file:///d${counter}.png`,
    title: `Design ${counter}`,
    source: "generated",
    createdAt: counter,
    ...patch,
  };
}

test("normalizeTags trims, lowercases, dedupes, and drops empties", () => {
  assert.deepEqual(normalizeTags("Jake,  SLEEVE , jake,"), ["jake", "sleeve"]);
  assert.deepEqual(normalizeTags(""), []);
  assert.deepEqual(normalizeTags(" ,, , "), []);
  assert.deepEqual(normalizeTags("rose"), ["rose"]);
});

test("allTags orders by use, then alphabetically", () => {
  const designs = [
    design({ tags: ["rose", "jake"] }),
    design({ tags: ["jake"] }),
    design({ tags: ["anchor"] }),
    design({}),
  ];
  assert.deepEqual(allTags(designs), ["jake", "anchor", "rose"]);
  assert.deepEqual(allTags([]), []);
});

test("query matches title and tags case-insensitively", () => {
  const designs = [
    design({ title: "Viking warrior" }),
    design({ title: "Rose", tags: ["viking", "jake"] }),
    design({ title: "Anchor" }),
  ];
  const hits = filterDesigns(designs, { query: "VIKING" });
  assert.equal(hits.length, 2);
  assert.equal(filterDesigns(designs, { query: "  " }).length, 3, "whitespace query is no filter");
  assert.equal(filterDesigns(designs, { query: "nothing" }).length, 0);
});

test("source filter narrows, 'all' does not", () => {
  const designs = [
    design({ source: "generated" }),
    design({ source: "converted" }),
    design({ source: "uploaded" }),
  ];
  assert.equal(filterDesigns(designs, { source: "converted" }).length, 1);
  assert.equal(filterDesigns(designs, { source: "all" }).length, 3);
  assert.equal(filterDesigns(designs, {}).length, 3);
});

test("favorites filter and tag filter compose with the query", () => {
  const designs = [
    design({ title: "Rose A", favorite: true, tags: ["jake"] }),
    design({ title: "Rose B", tags: ["jake"] }),
    design({ title: "Rose C", favorite: true }),
  ];
  assert.equal(filterDesigns(designs, { favoritesOnly: true }).length, 2);
  assert.equal(filterDesigns(designs, { tag: "jake" }).length, 2);
  assert.equal(
    filterDesigns(designs, { query: "rose", favoritesOnly: true, tag: "jake" }).length,
    1
  );
});

test("favorites float to the front without disturbing order otherwise", () => {
  const designs = [
    design({ title: "first" }),
    design({ title: "second", favorite: true }),
    design({ title: "third" }),
    design({ title: "fourth", favorite: true }),
  ];
  assert.deepEqual(
    filterDesigns(designs, {}).map((d) => d.title),
    ["second", "fourth", "first", "third"]
  );
});

test("isFiltering reflects any narrowing filter", () => {
  assert.equal(isFiltering({}), false);
  assert.equal(isFiltering({ query: "  " }), false);
  assert.equal(isFiltering({ source: "all" }), false);
  assert.equal(isFiltering({ query: "x" }), true);
  assert.equal(isFiltering({ source: "converted" }), true);
  assert.equal(isFiltering({ favoritesOnly: true }), true);
  assert.equal(isFiltering({ tag: "jake" }), true);
});
