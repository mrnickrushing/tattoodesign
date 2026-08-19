import test from "node:test";
import assert from "node:assert/strict";
import {
  HANDOFF_VERSION,
  contentFingerprint,
  decodeHandoff,
  designPayload,
  encodeDesignHandoff,
  encodeSheetHandoff,
  handoffFilename,
  type DesignPayload,
} from "./handoff";
import type { SavedSheetItem } from "./sheetLibrary";

function payload(patch: Partial<DesignPayload> = {}): DesignPayload {
  return {
    title: "Fern & dagger",
    source: "converted",
    tags: ["allison", "fern"],
    favorite: true,
    width: 1000,
    height: 800,
    png: "iVBORw0KGgoAAAANSUhEUg" + "A".repeat(64),
    ...patch,
  };
}

function sheetItem(patch: Partial<SavedSheetItem> = {}): SavedSheetItem {
  return {
    id: "item-1",
    designId: "design-1",
    uri: "file:///stale/path.png",
    title: "Fern & dagger",
    xIn: 1,
    yIn: 2,
    wIn: 3,
    hIn: 2.4,
    rotation: 15,
    mirrored: true,
    ...patch,
  };
}

test("a design round-trips with tags, favorite, and artwork intact", () => {
  const raw = encodeDesignHandoff("ink", payload());
  const result = decodeHandoff(raw);
  assert.ok(result.ok, "decode should succeed");
  if (!result.ok) return;
  assert.equal(result.envelope.kind, "design");
  assert.equal(result.envelope.brand, "ink");
  if (result.envelope.kind !== "design") return;
  assert.deepEqual(result.envelope.payload.tags, ["allison", "fern"]);
  assert.equal(result.envelope.payload.favorite, true);
  assert.equal(result.envelope.payload.png, payload().png);
});

test("a sheet travels with its designs and re-keys items by fingerprint", () => {
  const artwork = payload();
  const raw = encodeSheetHandoff(
    "sugar",
    { name: "Fall cookies", templateId: "letter", items: [sheetItem(), sheetItem({ id: "item-2", designId: undefined })] },
    { "design-1": artwork }
  );
  const result = decodeHandoff(raw);
  assert.ok(result.ok);
  if (!result.ok || result.envelope.kind !== "sheet") return assert.fail("expected sheet");
  const sheet = result.envelope.payload;
  assert.equal(sheet.name, "Fall cookies");
  const key = contentFingerprint(artwork.png);
  assert.equal(sheet.items[0].designKey, key, "item points at the design by fingerprint");
  assert.equal(sheet.items[1].designKey, null, "free-floating item stays free");
  assert.ok(sheet.designs[key], "the artwork rides along");
  assert.ok(!("uri" in sheet.items[0]), "stale file URIs never travel");
  assert.equal(sheet.items[0].rotation, 15, "placement survives");
});

test("junk is refused with a named error, never a throw", () => {
  for (const junk of [
    "not json at all",
    "{}",
    JSON.stringify({ format: "something-else", version: 1 }),
    JSON.stringify({ format: "inkline-handoff", version: 1, brand: "ink", kind: "mystery" }),
    JSON.stringify({ format: "inkline-handoff", version: 1, brand: "nope", kind: "design", payload: payload() }),
    JSON.stringify({ format: "inkline-handoff", version: 1, brand: "ink", kind: "design", payload: { title: "x" } }),
  ]) {
    const result = decodeHandoff(junk);
    assert.equal(result.ok, false, `should refuse: ${junk.slice(0, 40)}`);
    if (!result.ok) assert.ok(result.error.length > 10, "error is a sentence");
  }
});

test("a future version asks for an update instead of guessing", () => {
  const raw = JSON.stringify({
    format: "inkline-handoff",
    version: HANDOFF_VERSION + 1,
    brand: "ink",
    kind: "design",
    payload: payload(),
  });
  const result = decodeHandoff(raw);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /newer Inkline/);
});

test("a sheet referencing artwork it doesn't carry is refused", () => {
  const raw = JSON.stringify({
    format: "inkline-handoff",
    version: 1,
    brand: "ink",
    kind: "sheet",
    payload: {
      name: "Broken",
      templateId: "letter",
      items: [{ ...sheetItem(), uri: undefined, designId: undefined, designKey: "missing-key" }],
      designs: {},
    },
  });
  const result = decodeHandoff(raw);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /doesn't carry/);
});

test("fingerprints are stable and distinguish different artwork", () => {
  const a = payload().png;
  const b = payload({ png: "different" + "B".repeat(64) }).png;
  assert.equal(contentFingerprint(a), contentFingerprint(a));
  assert.notEqual(contentFingerprint(a), contentFingerprint(b));
  assert.notEqual(contentFingerprint(a), contentFingerprint(a + "A"), "length is part of the print");
});

test("designPayload defaults optional library fields", () => {
  const made = designPayload(
    { title: "Rose", source: "generated", tags: undefined, favorite: undefined, width: 500, height: 500 },
    "PNGDATA"
  );
  assert.deepEqual(made.tags, []);
  assert.equal(made.favorite, false);
});

test("filenames are safe and keep the extension", () => {
  assert.equal(handoffFilename("Fern & Dagger!"), "fern-dagger.inkline");
  assert.equal(handoffFilename("///"), "inkline.inkline");
});
