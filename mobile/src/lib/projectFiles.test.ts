import test from "node:test";
import assert from "node:assert/strict";
import {
  PROJECT_SCHEMA_VERSION,
  commitSnapshot,
  readProject,
  restoreSnapshot,
  salvageLatestSnapshot,
  saveProject,
  type ProjectStore,
} from "./projectFiles";
import { makeStrokeLayer } from "./projectMutations";
import type { EditableDesignProject, StrokeLayer } from "./designProject";

const BRAND = "ink" as const;
const ID = "design-1";

/**
 * A store that can also do the things real ones do when they go wrong.
 *
 * The point of taking the store as an argument is to be able to arrange these:
 * a write that stops half way because the app was killed, a disk with no room
 * on it, a restore point that outlived the manifest naming it. None of that is
 * reachable through expo-file-system or IndexedDB from a test.
 */
function fake() {
  const manifests = new Map<string, string>();
  const texts = new Map<string, string>();
  let clock = 1000;
  let refuseWrites = false;

  const store: ProjectStore = {
    readManifest: async (b, i) => manifests.get(`${b}/${i}`) ?? null,
    writeManifest: async (b, i, json) => {
      if (refuseWrites) throw new Error("No space left on device");
      manifests.set(`${b}/${i}`, json);
    },
    quarantineManifest: async (b, i, stamp) => {
      const key = `${b}/${i}`;
      const raw = manifests.get(key);
      if (raw === undefined) return null;
      manifests.set(`${key}:damaged-${stamp}`, raw);
      manifests.delete(key);
      return `project.json.damaged-${stamp}`;
    },
    readText: async (b, i, name) => texts.get(`${b}/${i}/${name}`) ?? null,
    writeText: async (b, i, name, text) => {
      if (refuseWrites) throw new Error("No space left on device");
      texts.set(`${b}/${i}/${name}`, text);
    },
    deleteText: async (b, i, name) => void texts.delete(`${b}/${i}/${name}`),
    listNames: async (b, i) =>
      [...texts.keys()].filter((k) => k.startsWith(`${b}/${i}/`)).map((k) => k.slice(`${b}/${i}/`.length)),
    now: () => ++clock,
  };

  return {
    store,
    manifests,
    texts,
    /** What an interrupted write leaves behind: a manifest cut off part way. */
    truncate(at = 0.4) {
      const key = `${BRAND}/${ID}`;
      const raw = manifests.get(key)!;
      manifests.set(key, raw.slice(0, Math.floor(raw.length * at)));
    },
    fill(value = true) {
      refuseWrites = value;
    },
    damagedCopies: () => [...manifests.keys()].filter((k) => k.includes(":damaged-")),
  };
}

function project(): EditableDesignProject {
  const base = makeStrokeLayer(1000, 800, "Base");
  base.strokes = [{ points: [{ x: 10, y: 10 }, { x: 20, y: 20 }], width: 3, color: "#000000", mode: "draw", opacity: 1 }];
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: ID,
    brand: BRAND,
    title: "Rose",
    source: "generated",
    canvas: { width: 1000, height: 800, background: "#ffffff", transparent: false },
    layers: [base],
    selectedLayerId: base.id,
    createdAt: 1,
    updatedAt: 1,
    revision: 1,
    snapshots: [],
  };
}

const firstX = (value: EditableDesignProject) => (value.layers[0] as StrokeLayer).strokes[0].points[0].x;

test("a project written is a project read back", async () => {
  const disk = fake();
  await saveProject(disk.store, project());
  const result = await readProject(disk.store, BRAND, ID);
  assert.equal(result.kind, "ok");
  assert.equal(result.kind === "ok" && result.project.title, "Rose");
});

test("a design never saved reads as missing, not as damaged", async () => {
  // The difference decides whether the caller starts a new project or refuses
  // to touch what is there, so it cannot be a guess.
  const disk = fake();
  const result = await readProject(disk.store, BRAND, "never-saved");
  assert.deepEqual(result, { kind: "missing" });
  assert.deepEqual(disk.damagedCopies(), [], "nothing was written for a design that does not exist");
});

test("a manifest cut off mid-write reads as damaged, and the bytes are kept", async () => {
  // The failure this whole change is about. A save interrupted by the app
  // being killed leaves a partial file; it used to parse-fail, read as "no
  // project", and be replaced by an empty one on the spot.
  const disk = fake();
  await saveProject(disk.store, project());
  disk.truncate();

  const result = await readProject(disk.store, BRAND, ID);
  assert.equal(result.kind, "damaged");
  assert.match(result.kind === "damaged" ? (result.kept ?? "") : "", /damaged-/);
  assert.equal(disk.damagedCopies().length, 1, "the unreadable bytes were not kept");
});

test("valid JSON that is not a project is damage, not a project", async () => {
  // JSON.parse succeeding proves nothing about what came back.
  for (const raw of ["null", "[]", '"a string"', "{}", '{"layers":"not an array"}']) {
    const disk = fake();
    disk.manifests.set(`${BRAND}/${ID}`, raw);
    const result = await readProject(disk.store, BRAND, ID);
    assert.equal(result.kind, "damaged", `${raw} was accepted as a project`);
  }
});

test("a manifest from a newer build is refused rather than overwritten", async () => {
  // Older code meeting a newer file used to hand back null, which the caller
  // read as "new design". Two devices and one sync is all it takes.
  const disk = fake();
  disk.manifests.set(`${BRAND}/${ID}`, JSON.stringify({ ...project(), schemaVersion: 99 }));
  const result = await readProject(disk.store, BRAND, ID);
  assert.equal(result.kind, "damaged");
  assert.equal(disk.damagedCopies().length, 1, "the newer file was not kept");
});

test("restore points move out of an older manifest and still restore", async () => {
  // Version 1 carried the geometry inline. Migration writes each one out and
  // leaves a reference — and the restore point has to still work afterwards.
  const disk = fake();
  const old = project();
  const moved = { ...old.layers[0], strokes: [{ points: [{ x: 99, y: 99 }], width: 3, color: "#000", mode: "draw" as const, opacity: 1 }] };
  disk.manifests.set(`${BRAND}/${ID}`, JSON.stringify({
    ...old,
    schemaVersion: 1,
    snapshots: [{ label: "Before", createdAt: 5, layers: [moved], canvas: old.canvas }],
  }));

  const result = await readProject(disk.store, BRAND, ID);
  assert.equal(result.kind, "ok");
  const migrated = result.kind === "ok" ? result.project : project();
  assert.equal(migrated.schemaVersion, PROJECT_SCHEMA_VERSION);
  assert.equal(migrated.snapshots.length, 1);
  assert.equal(migrated.snapshots[0].label, "Before");
  assert.equal("layers" in migrated.snapshots[0], false, "the geometry stayed in the manifest");

  const restored = await restoreSnapshot(disk.store, migrated, 0);
  assert.equal(firstX(restored!), 99, "the migrated restore point did not restore");

  // And it is written back, so the migration is not redone on every open.
  const again = await readProject(disk.store, BRAND, ID);
  assert.equal(again.kind === "ok" && again.project.schemaVersion, PROJECT_SCHEMA_VERSION);
});

test("a restore point that cannot be moved is dropped, not fatal", async () => {
  // Losing one entry from version history is survivable. Failing the load —
  // which is what throwing here would mean — costs the whole drawing.
  const disk = fake();
  const old = project();
  disk.manifests.set(`${BRAND}/${ID}`, JSON.stringify({
    ...old,
    schemaVersion: 1,
    snapshots: [{ label: "Before", createdAt: 5, layers: old.layers, canvas: old.canvas }],
  }));
  disk.fill();

  const result = await readProject(disk.store, BRAND, ID);
  assert.equal(result.kind, "ok", "a full disk lost the whole project");
  assert.deepEqual(result.kind === "ok" ? result.project.snapshots : null, []);
});

test("a restore point's geometry is written beside the manifest, not into it", async () => {
  const disk = fake();
  const value = await commitSnapshot(disk.store, project(), "First");

  assert.equal(value.snapshots.length, 1);
  assert.match(value.snapshots[0].body, /^snapshot-/);
  assert.equal(disk.texts.size, 1, "the geometry did not reach the store");

  await saveProject(disk.store, value);
  const manifest = disk.manifests.get(`${BRAND}/${ID}`)!;
  assert.equal(manifest.includes(value.snapshots[0].body), true, "the manifest lost the reference");
  assert.equal(manifest.includes('"points"'), true, "the sanity check itself is wrong — there is no geometry here at all");
});

test("the manifest stops growing with the version history", async () => {
  // The measurement that started this. Eight restore points used to mean nine
  // copies of the drawing in one file, rewritten on every stroke.
  const disk = fake();
  let value = project();
  const alone = JSON.stringify(value).length;
  for (let i = 0; i < 8; i++) value = await commitSnapshot(disk.store, value, `Edit ${i}`);

  const withHistory = JSON.stringify(value).length;
  const perSnapshot = (withHistory - alone) / 8;
  assert.ok(perSnapshot < 120, `each restore point still adds ${perSnapshot.toFixed(0)} bytes to the manifest`);
});

test("restore points that fall off the end take their files with them", async () => {
  const disk = fake();
  let value = project();
  for (let i = 0; i < 12; i++) value = await commitSnapshot(disk.store, value, `Edit ${i}`);

  assert.equal(value.snapshots.length, 8);
  assert.equal(disk.texts.size, 8, `${disk.texts.size} files left for 8 restore points`);
  // The ones still listed are the ones still on disk.
  for (const snapshot of value.snapshots) {
    assert.ok(await restoreSnapshot(disk.store, value, value.snapshots.indexOf(snapshot)), `${snapshot.label} lost its file`);
  }
});

test("a full disk costs the restore point, not the edit", async () => {
  // Refusing an edit because there was no room to file a history entry would
  // be the tail wagging the dog.
  const disk = fake();
  disk.fill();
  const value = await commitSnapshot(disk.store, project(), "First");
  assert.deepEqual(value.snapshots, []);
  assert.equal(value.revision, 2, "the edit itself was not counted");
  assert.equal(firstX(value), 10, "the edit's own geometry was disturbed");
});

test("a restore point whose file is gone restores nothing rather than something wrong", async () => {
  const disk = fake();
  const value = await commitSnapshot(disk.store, project(), "First");
  disk.texts.clear();
  assert.equal(await restoreSnapshot(disk.store, value, 0), null);
  assert.equal(await restoreSnapshot(disk.store, value, 7), null, "an index past the end found something");
});

test("a restore point outlives the manifest that named it", async () => {
  // The recovery this buys. Restore points are their own files now, so a
  // manifest lost to an interrupted write is no longer the end of the drawing.
  const disk = fake();
  let value = await commitSnapshot(disk.store, project(), "First");
  value = await commitSnapshot(disk.store, { ...value, layers: [...value.layers, makeStrokeLayer(1000, 800, "Second")] }, "Second");
  await saveProject(disk.store, value);
  disk.truncate();

  assert.equal((await readProject(disk.store, BRAND, ID)).kind, "damaged");
  const salvaged = await salvageLatestSnapshot(disk.store, BRAND, ID);
  assert.ok(salvaged, "nothing was salvaged from two surviving restore points");
  // The fullest one, since nothing records which was newest once the manifest
  // is gone — handing back the emptiest would be the wrong way to guess.
  assert.equal(salvaged!.layers.length, 2);
  assert.equal(salvaged!.canvas.width, 1000, "the canvas did not come back with it");
});

test("salvage ignores files that are not restore points", async () => {
  const disk = fake();
  const value = await commitSnapshot(disk.store, project(), "First");
  await saveProject(disk.store, value);
  disk.texts.set(`${BRAND}/${ID}/notes.txt`, "not JSON at all");
  disk.texts.set(`${BRAND}/${ID}/snapshot-broken.json`, "{ truncated");
  disk.texts.set(`${BRAND}/${ID}/snapshot-empty.json`, JSON.stringify({ layers: [], canvas: value.canvas }));

  const salvaged = await salvageLatestSnapshot(disk.store, BRAND, ID);
  assert.ok(salvaged, "the one good restore point was passed over");
  assert.equal(salvaged!.layers.length, 1);
});

test("nothing to salvage says so", async () => {
  const disk = fake();
  assert.equal(await salvageLatestSnapshot(disk.store, BRAND, ID), null);
});

test("an empty restore point is not worth salvaging", async () => {
  // Only reachable when it is the only candidate, which is exactly when it
  // matters: handing back a project with no layers in it reads as "your
  // drawing is gone" while looking like a successful recovery.
  const disk = fake();
  disk.texts.set(`${BRAND}/${ID}/snapshot-a.json`, JSON.stringify({ layers: [], canvas: project().canvas }));
  assert.equal(await salvageLatestSnapshot(disk.store, BRAND, ID), null);
});

test("salvage will not mistake another file for a restore point", async () => {
  // Layer images and quarantined manifests sit in the same place. A manifest
  // has layers and a canvas at the top level and would otherwise look like the
  // best candidate going — and it is the very thing that could not be trusted.
  const disk = fake();
  const value = await commitSnapshot(disk.store, project(), "First");
  const decoy = { layers: [...value.layers, ...value.layers, ...value.layers], canvas: value.canvas };
  disk.texts.set(`${BRAND}/${ID}/project.json.damaged-1`, JSON.stringify(decoy));

  const salvaged = await salvageLatestSnapshot(disk.store, BRAND, ID);
  assert.equal(salvaged!.layers.length, 1, "something that is not a restore point was restored from");
});

test("a restore point holding nonsense restores nothing", async () => {
  // Parsing is not validating. Layers that are not a list would reach the
  // editor as a project it cannot draw.
  const disk = fake();
  const value = await commitSnapshot(disk.store, project(), "First");
  for (const body of ['{"layers":"nope","canvas":{}}', "{}", '{"canvas":{}}', "null"]) {
    disk.texts.set(`${BRAND}/${ID}/${value.snapshots[0].body}`, body);
    assert.equal(await restoreSnapshot(disk.store, value, 0), null, `${body} was restored`);
  }
});

test("saving stamps the time it was written", async () => {
  // The one place updatedAt is set. The layer helpers deliberately leave it
  // alone, so if this stopped doing it nothing would.
  const disk = fake();
  await saveProject(disk.store, { ...project(), updatedAt: 1 });
  const written = JSON.parse(disk.manifests.get(`${BRAND}/${ID}`)!) as EditableDesignProject;
  assert.ok(written.updatedAt > 1, `updatedAt came through as ${written.updatedAt}`);
});
