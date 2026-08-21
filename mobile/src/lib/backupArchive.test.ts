import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isSafeFilePath, isSafeStorageKey, parseBackupEnvelope, validateBackupPayload } from "./backupArchive";

// The actual AES-256-GCM seal/open goes through expo-crypto's native module,
// which only resolves inside the Expo runtime — there is no plain-Node path
// to exercise it, the same gap productionTools.ts leaves for its Skia calls.
// What is testable, and matters just as much for a malformed or hostile
// archive, is everything this file checks before and after decryption.

test("a well-formed envelope parses", () => {
  const raw = JSON.stringify({ format: "inkline-backup", version: 1, cipher: "AES-256-GCM", data: "c2VhbGVk" });
  const envelope = parseBackupEnvelope(raw);
  assert.equal(envelope.format, "inkline-backup");
  assert.equal(envelope.data, "c2VhbGVk");
});

test("unreadable JSON is rejected before anything is decrypted", () => {
  assert.throws(() => parseBackupEnvelope("not json"), /not a readable backup archive/);
});

test("a file that isn't an Inkline backup is rejected", () => {
  assert.throws(
    () => parseBackupEnvelope(JSON.stringify({ format: "some-other-app", data: "x" })),
    /not an Inkline encrypted backup/
  );
});

test("an envelope missing its sealed data is rejected", () => {
  assert.throws(
    () => parseBackupEnvelope(JSON.stringify({ format: "inkline-backup", version: 1 })),
    /not an Inkline encrypted backup/
  );
});

test("a valid payload passes through unchanged", () => {
  const payload = {
    version: 1 as const,
    createdAt: 1000,
    storage: [["inkline:client-projects:ink", "[]"]] as [string, string][],
    files: [{ path: "designs/ink/rose.png", data: "AA==" }],
  };
  assert.deepEqual(validateBackupPayload(payload), payload);
});

test("a payload from a future or foreign schema is rejected", () => {
  assert.throws(() => validateBackupPayload({ version: 2, storage: [], files: [] }), /version is not supported/);
  assert.throws(() => validateBackupPayload(null), /version is not supported/);
  assert.throws(() => validateBackupPayload("garbage"), /version is not supported/);
  assert.throws(() => validateBackupPayload({ version: 1, storage: "nope", files: [] }), /version is not supported/);
});

test("a storage key outside the app's own namespace is rejected", () => {
  assert.ok(isSafeStorageKey("inkline:client-projects:ink"));
  assert.ok(!isSafeStorageKey("other-app:secret"));
  assert.throws(
    () =>
      validateBackupPayload({
        version: 1,
        createdAt: 1,
        storage: [["not-inkline:token", "steal-me"]],
        files: [],
      }),
    /unsafe storage key/
  );
});

test("a file path is confined to the known roots, with no traversal", () => {
  assert.ok(isSafeFilePath("designs/ink/rose.png"));
  assert.ok(isSafeFilePath("editable-projects/sugar/cake-1/project.json"));
  assert.ok(!isSafeFilePath("../../etc/passwd"));
  assert.ok(!isSafeFilePath("designs/../../../etc/passwd"));
  assert.ok(!isSafeFilePath("caches/anything"));
  assert.ok(!isSafeFilePath("designs//rose.png"));
});

test("a path-traversal attempt inside a payload is rejected before any file is written", () => {
  assert.throws(
    () =>
      validateBackupPayload({
        version: 1,
        createdAt: 1,
        storage: [],
        files: [{ path: "designs/../../../etc/passwd", data: "AA==" }],
      }),
    /unsafe file path/
  );
});

test("validation is eager: the first bad file still fails before any writes, even with good items around it", () => {
  assert.throws(
    () =>
      validateBackupPayload({
        version: 1,
        createdAt: 1,
        storage: [["inkline:ok", "1"]],
        files: [
          { path: "designs/ink/good.png", data: "AA==" },
          { path: "../escape", data: "AA==" },
          { path: "designs/ink/also-good.png", data: "AA==" },
        ],
      }),
    /unsafe file path/
  );
});
