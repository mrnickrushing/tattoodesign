import test from "node:test";
import assert from "node:assert/strict";
import {
  PROJECT_SCHEMA_VERSION,
  commitSnapshot,
  dropBodies,
  openProject,
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

/**
 * The editor's own order: take the restore point, write the manifest, and only
 * then delete what fell off the end.
 */
async function commitAndSave(store: Parameters<typeof dropBodies>[0], value: EditableDesignProject, label: string) {
  const { project: next, evicted } = await commitSnapshot(store, value, label);
  await saveProject(store, next);
  await dropBodies(store, next, evicted);
  return next;
}

/** The same project with its one stroke moved — no change to the layer count. */
function withX(value: EditableDesignProject, x: number): EditableDesignProject {
  const layer = { ...(value.layers[0] as StrokeLayer) };
  layer.strokes = [{ ...layer.strokes[0], points: [{ x, y: 10 }, { x: 20, y: 20 }] }];
  return { ...value, layers: [layer, ...value.layers.slice(1)] };
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
  const value = await commitAndSave(disk.store, project(), "First");

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
  for (let i = 0; i < 8; i++) value = await commitAndSave(disk.store, value, `Edit ${i}`);

  const withHistory = JSON.stringify(value).length;
  const perSnapshot = (withHistory - alone) / 8;
  assert.ok(perSnapshot < 120, `each restore point still adds ${perSnapshot.toFixed(0)} bytes to the manifest`);
});

test("restore points that fall off the end take their files with them", async () => {
  const disk = fake();
  let value = project();
  for (let i = 0; i < 12; i++) value = await commitAndSave(disk.store, value, `Edit ${i}`);

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
  const { project: value, evicted } = await commitSnapshot(disk.store, project(), "First");
  assert.deepEqual(value.snapshots, []);
  assert.deepEqual(evicted, [], "a restore point that was never written was scheduled for deletion");
  assert.equal(value.revision, 2, "the edit itself was not counted");
  assert.equal(firstX(value), 10, "the edit's own geometry was disturbed");
});

test("a restore point whose file is gone restores nothing rather than something wrong", async () => {
  const disk = fake();
  const value = await commitAndSave(disk.store, project(), "First");
  disk.texts.clear();
  assert.equal(await restoreSnapshot(disk.store, value, 0), null);
  assert.equal(await restoreSnapshot(disk.store, value, 7), null, "an index past the end found something");
});

test("a restore point outlives the manifest that named it", async () => {
  // The recovery this buys. Restore points are their own files now, so a
  // manifest lost to an interrupted write is no longer the end of the drawing.
  const disk = fake();
  let value = await commitAndSave(disk.store, project(), "First");
  value = await commitAndSave(disk.store, { ...value, layers: [...value.layers, makeStrokeLayer(1000, 800, "Second")] }, "Second");
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
  const value = await commitAndSave(disk.store, project(), "First");
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

test("salvage takes the newest restore point, not the biggest", async () => {
  // The first version of this compared layer counts, reasoning that nothing
  // recorded which was newest. Nothing did, because nothing had been asked to:
  // a session spent drawing adds strokes to layers that already exist, so every
  // restore point tied and recovery returned whichever the store happened to
  // list first.
  const disk = fake();
  let value = project();
  for (const [n, x] of [[1, 11], [2, 22], [3, 33]] as const) {
    value = await commitAndSave(disk.store, withX(value, x), `Edit ${n}`);
  }
  assert.equal(disk.texts.size, 3);

  const salvaged = await salvageLatestSnapshot(disk.store, BRAND, ID);
  assert.equal(salvaged!.layers.length, 1, "the fixture did not hold the layer count still");
  assert.equal(firstX({ ...value, layers: salvaged!.layers }), 33, "an older restore point was recovered");
});

test("a restore point taken after a layer was deleted is still the newest", async () => {
  // Under the old comparison this case did not merely tie, it lost: the newest
  // restore point held fewer layers than the one before it, so recovery walked
  // backwards past the deletion.
  const disk = fake();
  let value = await commitAndSave(disk.store, { ...project(), layers: [...project().layers, makeStrokeLayer(1000, 800, "Extra")] }, "Two layers");
  value = await commitAndSave(disk.store, { ...value, layers: value.layers.slice(0, 1) }, "Deleted one");

  const salvaged = await salvageLatestSnapshot(disk.store, BRAND, ID);
  assert.equal(salvaged!.layers.length, 1, "recovery undid the layer deletion");
});

test("a salvaged drawing is handed back even when it cannot be written down", async () => {
  // Recovering the drawing is the point; writing it back only saves doing it
  // again. Throwing here would turn a full disk into the loss this prevents —
  // and worse, the damaged manifest has already been moved aside by then, so
  // the next launch would see nothing to recover from.
  const disk = fake();
  const value = await commitAndSave(disk.store, project(), "First");
  await saveProject(disk.store, value);
  disk.truncate();
  await readProject(disk.store, BRAND, ID);
  disk.fill();

  const salvaged = await salvageLatestSnapshot(disk.store, BRAND, ID);
  assert.ok(salvaged, "a full disk lost a restore point that was already written");
  assert.equal(salvaged!.layers.length, 1);
});

test("restore points are still found once the damaged manifest has been moved aside", async () => {
  // Quarantine leaves the manifest *missing*, not damaged. Looking for restore
  // points only on the damaged path meant one failed rewrite turned every
  // later launch into a blank canvas with the restore points sitting there.
  const disk = fake();
  const value = await commitAndSave(disk.store, withX(project(), 77), "First");
  await saveProject(disk.store, value);
  disk.truncate();

  assert.equal((await readProject(disk.store, BRAND, ID)).kind, "damaged");
  // Second open: the manifest is gone rather than damaged.
  assert.deepEqual(await readProject(disk.store, BRAND, ID), { kind: "missing" });
  const salvaged = await salvageLatestSnapshot(disk.store, BRAND, ID);
  assert.equal(firstX({ ...value, layers: salvaged!.layers }), 77, "the restore point was not found the second time");
});

test("a restore point is deleted only once the manifest stops naming it", async () => {
  // Deleting on the way past means an interrupted manifest write leaves the
  // previous manifest — correctly — still pointing at a file that is gone.
  const disk = fake();
  let value = project();
  for (let i = 0; i < 8; i++) value = await commitAndSave(disk.store, value, `Edit ${i}`);

  const { project: next, evicted } = await commitSnapshot(disk.store, value, "One more");
  assert.equal(evicted.length, 1, "nothing was scheduled for deletion at the ninth restore point");
  assert.equal(disk.texts.size, 9, "the evicted file was deleted before the manifest was written");

  // The manifest write fails, so the old one — still naming all eight — stands.
  disk.fill();
  await assert.rejects(() => saveProject(disk.store, next));
  disk.fill(false);

  const stored = await readProject(disk.store, BRAND, ID);
  assert.equal(stored.kind, "ok");
  for (let i = 0; i < 8; i++) {
    assert.ok(
      await restoreSnapshot(disk.store, stored.kind === "ok" ? stored.project : value, i),
      `restore point ${i} is listed but its file is gone`
    );
  }
});

test("salvage will not mistake another file for a restore point", async () => {
  // Layer images and quarantined manifests sit in the same place. A manifest
  // has layers and a canvas at the top level and would otherwise look like the
  // best candidate going — and it is the very thing that could not be trusted.
  const disk = fake();
  const value = await commitAndSave(disk.store, project(), "First");
  const decoy = { layers: [...value.layers, ...value.layers, ...value.layers], canvas: value.canvas };
  disk.texts.set(`${BRAND}/${ID}/project.json.damaged-1`, JSON.stringify(decoy));

  const salvaged = await salvageLatestSnapshot(disk.store, BRAND, ID);
  assert.equal(salvaged!.layers.length, 1, "something that is not a restore point was restored from");
});

test("a restore point holding nonsense restores nothing", async () => {
  // Parsing is not validating. Layers that are not a list would reach the
  // editor as a project it cannot draw.
  const disk = fake();
  const value = await commitAndSave(disk.store, project(), "First");
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

// ---------------------------------------------------------------------------
// Opening a design, and what it says when the stored one would not open.
// ---------------------------------------------------------------------------

const IDENTITY = { title: "Rose", source: "generated" as const };

/** Stands in for building a project from the design's original image. */
function fresh(): EditableDesignProject {
  const blank = makeStrokeLayer(1000, 800, "Original");
  return { ...project(), layers: [blank], selectedLayerId: blank.id, snapshots: [] };
}

test("a design that opens cleanly reports no damage", async () => {
  const disk = fake();
  await saveProject(disk.store, project());
  const opened = await openProject(disk.store, BRAND, ID, IDENTITY, async () => fresh());
  assert.equal(opened.damage, undefined);
  assert.equal(opened.project.title, "Rose");
});

test("a design never opened before is new, not damaged", async () => {
  const disk = fake();
  let built = false;
  const opened = await openProject(disk.store, BRAND, ID, IDENTITY, async () => { built = true; return fresh(); });
  assert.equal(built, true, "a new design was not built");
  assert.equal(opened.damage, undefined, "starting a new design was reported as damage");
});

test("a damaged design comes back from its newest restore point, and says so", async () => {
  const disk = fake();
  const value = await commitAndSave(disk.store, withX(project(), 55), "First");
  await saveProject(disk.store, value);
  disk.truncate();

  const opened = await openProject(disk.store, BRAND, ID, IDENTITY, async () => fresh());
  assert.equal(opened.damage?.salvaged, true);
  assert.match(opened.damage?.kept ?? "", /damaged-/);
  assert.equal(firstX(opened.project), 55, "the drawing was not recovered");
});

test("a damaged design with nothing to recover from is rebuilt, and still says so", async () => {
  const disk = fake();
  await saveProject(disk.store, project());
  disk.truncate();

  const opened = await openProject(disk.store, BRAND, ID, IDENTITY, async () => fresh());
  assert.equal(opened.damage?.salvaged, false);
  assert.match(opened.damage?.kept ?? "", /damaged-/);
  assert.equal(opened.project.layers[0].name, "Original");
});

test("a recovery that cannot be written down is still a recovery", async () => {
  // The bug: openProject threw when this save failed. Worse than the throw was
  // what it left behind — the damaged manifest was already quarantined, so the
  // next launch found nothing to recover and built a blank project over the top
  // while the restore points sat there untouched.
  const disk = fake();
  const value = await commitAndSave(disk.store, withX(project(), 55), "First");
  await saveProject(disk.store, value);
  disk.truncate();
  disk.fill();

  const opened = await openProject(disk.store, BRAND, ID, IDENTITY, async () => fresh());
  assert.equal(opened.damage?.salvaged, true, "a full disk lost the recovery");
  assert.equal(firstX(opened.project), 55);
});

test("recovery still works on every launch after a failed one", async () => {
  // The second half of the same bug. Quarantine leaves the manifest missing
  // rather than damaged, so a loader that only searched the damaged path
  // recovered once and never again.
  const disk = fake();
  const value = await commitAndSave(disk.store, withX(project(), 55), "First");
  await saveProject(disk.store, value);
  disk.truncate();
  disk.fill();
  await openProject(disk.store, BRAND, ID, IDENTITY, async () => fresh());

  // Second launch: the manifest is gone, not damaged, and the disk is still full.
  const again = await openProject(disk.store, BRAND, ID, IDENTITY, async () => fresh());
  assert.equal(again.damage?.salvaged, true, "the second launch gave up on the restore points");
  assert.equal(firstX(again.project), 55);

  // Third launch, with room again: it writes itself back and opens cleanly after.
  disk.fill(false);
  assert.equal((await openProject(disk.store, BRAND, ID, IDENTITY, async () => fresh())).damage?.salvaged, true);
  assert.equal((await openProject(disk.store, BRAND, ID, IDENTITY, async () => fresh())).damage, undefined);
});
