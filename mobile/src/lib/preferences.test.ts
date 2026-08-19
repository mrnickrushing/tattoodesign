import test from "node:test";
import assert from "node:assert/strict";
import { createPreferenceStore, isFiniteNumber, type PreferenceBackend } from "./preferences";

function memoryBackend(seed: Record<string, string> = {}): PreferenceBackend & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    async getItem(key) {
      return data.get(key) ?? null;
    },
    async setItem(key, value) {
      data.set(key, value);
    },
    async removeItem(key) {
      data.delete(key);
    },
  };
}

test("preferences round-trip", async () => {
  const store = createPreferenceStore(memoryBackend());
  await store.set("ink", "editor.brushSize", 24);
  assert.equal(await store.get("ink", "editor.brushSize", 16), 24);
  await store.set("ink", "editor.brushSize", 8);
  assert.equal(await store.get("ink", "editor.brushSize", 16), 8);
});

test("absent keys fall back", async () => {
  const store = createPreferenceStore(memoryBackend());
  assert.equal(await store.get("ink", "nope", "default"), "default");
});

test("brands are isolated", async () => {
  const store = createPreferenceStore(memoryBackend());
  await store.set("ink", "editor.brushSize", 24);
  assert.equal(await store.get("sugar", "editor.brushSize", 16), 16);
  await store.clear("ink");
  assert.equal(await store.get("ink", "editor.brushSize", 16), 16);
});

test("objects survive as values", async () => {
  const store = createPreferenceStore(memoryBackend());
  await store.set("ink", "convert.options", { threshold: 85, lineWeight: 2 });
  const value = await store.get<Record<string, unknown>>("ink", "convert.options", {});
  assert.deepEqual(value, { threshold: 85, lineWeight: 2 });
});

test("a corrupt blob behaves like an empty one", async () => {
  const backend = memoryBackend({ "inkline:preferences:ink": "{not json" });
  const store = createPreferenceStore(backend);
  assert.equal(await store.get("ink", "editor.brushSize", 16), 16);
  // And writing afterwards recovers cleanly.
  await store.set("ink", "editor.brushSize", 24);
  assert.equal(await store.get("ink", "editor.brushSize", 16), 24);
});

test("a future schema version is ignored rather than misread", async () => {
  const backend = memoryBackend({
    "inkline:preferences:ink": JSON.stringify({ v: 99, values: { "editor.brushSize": 40 } }),
  });
  const store = createPreferenceStore(backend);
  assert.equal(await store.get("ink", "editor.brushSize", 16), 16);
});

test("type drift falls back: a string where a number lived", async () => {
  const store = createPreferenceStore(memoryBackend());
  await store.set("ink", "editor.brushSize", "huge");
  assert.equal(await store.get("ink", "editor.brushSize", 16), 16, "typeof mismatch");
  assert.equal(await store.get("ink", "editor.brushSize", 16, isFiniteNumber), 16, "validator rejects");
});

test("validators accept what they claim", async () => {
  const store = createPreferenceStore(memoryBackend());
  await store.set("ink", "placement.widthIn", 4.5);
  assert.equal(await store.get("ink", "placement.widthIn", 3, isFiniteNumber), 4.5);
  assert.equal(isFiniteNumber(Number.NaN), false);
  assert.equal(isFiniteNumber("4"), false);
});

test("all() lists a brand's stored values", async () => {
  const store = createPreferenceStore(memoryBackend());
  await store.set("ink", "a", 1);
  await store.set("ink", "b", "two");
  assert.deepEqual(await store.all("ink"), { a: 1, b: "two" });
  assert.deepEqual(await store.all("sugar"), {});
});

test("a failing backend never throws through the store", async () => {
  const store = createPreferenceStore({
    async getItem() {
      throw new Error("disk on fire");
    },
    async setItem() {
      throw new Error("disk on fire");
    },
    async removeItem() {
      throw new Error("disk on fire");
    },
  });
  assert.equal(await store.get("ink", "editor.brushSize", 16), 16);
  await store.set("ink", "editor.brushSize", 24); // must not throw
  await store.clear("ink"); // must not throw
});
