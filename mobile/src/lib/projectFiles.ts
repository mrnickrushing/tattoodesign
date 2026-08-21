// Reading and writing a project, and what to do when that goes wrong.
//
// Every function here takes the store it works through. That is the whole
// reason the file exists: the real store is expo-file-system on a phone and
// IndexedDB in a browser, neither of which loads under the test runner, and
// this is the code that decides whether somebody's drawing comes back or is
// replaced by an empty canvas. It is not code to find out about in production.
//
// designProject.ts binds these to the real store. Tests hand them a fake one
// and can then arrange the things that actually happen to files — a manifest
// truncated mid-write, a disk with no room left, a restore point that outlived
// the manifest naming it.

import type { BrandId } from "./brands";
import type { EditableDesignProject, LegacySnapshot, ProjectSnapshot, SnapshotBody } from "./designProject";
import { generateId } from "./id";
import { applySnapshot, evictedBodies, snapshotBody, snapshotProject } from "./projectMutations";

/** The part of project storage this file needs. Both platforms provide it. */
export type ProjectStore = {
  readManifest(brand: BrandId, id: string): Promise<string | null>;
  writeManifest(brand: BrandId, id: string, json: string): Promise<void>;
  quarantineManifest(brand: BrandId, id: string, stamp: number): Promise<string | null>;
  readText(brand: BrandId, id: string, name: string): Promise<string | null>;
  writeText(brand: BrandId, id: string, name: string, text: string): Promise<void>;
  deleteText(brand: BrandId, id: string, name: string): Promise<void>;
  listNames(brand: BrandId, id: string): Promise<string[]>;
  /** Wall clock. A port rather than a global so a test can hold it still. */
  now(): number;
};

/**
 * The manifest layout this build writes.
 *
 * Lives here rather than beside the types because it is a storage fact, and
 * because designProject.ts cannot be loaded by the test runner — a version
 * constant imported from there would drag the whole filesystem module in with
 * it and take the migration tests down.
 */
export const PROJECT_SCHEMA_VERSION = 2;

/** Restore point files are found by this prefix when the manifest is gone. */
export const SNAPSHOT_PREFIX = "snapshot-";

/**
 * Why a project did not come back.
 *
 * These used to be the same answer. The loader returned null for a manifest
 * that would not parse and for one that was never written, the caller read null
 * as "new design", built an empty project, and saved it straight over the
 * damaged file — so a drawing that failed to load was replaced by a blank
 * canvas and the only copy of it was gone. Whatever else happens on a bad
 * manifest, it must not be that.
 */
export type LoadResult =
  | { kind: "ok"; project: EditableDesignProject }
  | { kind: "missing" }
  | { kind: "damaged"; kept: string | null };

/** Does this look like a project, rather than merely like valid JSON? */
function isProject(value: unknown): value is EditableDesignProject {
  const candidate = value as Partial<EditableDesignProject> | null;
  return !!candidate && Array.isArray(candidate.layers) && typeof candidate.canvas === "object";
}

export async function readProject(store: ProjectStore, brand: BrandId, id: string): Promise<LoadResult> {
  let raw: string | null = null;
  try {
    raw = await store.readManifest(brand, id);
  } catch {
    raw = null;
  }
  if (raw === null) return { kind: "missing" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "damaged", kept: await store.quarantineManifest(brand, id, store.now()) };
  }
  if (!isProject(parsed)) {
    return { kind: "damaged", kept: await store.quarantineManifest(brand, id, store.now()) };
  }

  const migrated = await migrate(store, brand, id, parsed);
  return migrated ? { kind: "ok", project: migrated } : { kind: "damaged", kept: await store.quarantineManifest(brand, id, store.now()) };
}

/**
 * Brings an older manifest up to date, or gives up honestly.
 *
 * A version this code does not know is not damage and must not be treated as
 * it: refusing it used to mean the caller built a blank project over the top.
 */
async function migrate(store: ProjectStore, brand: BrandId, id: string, project: EditableDesignProject): Promise<EditableDesignProject | null> {
  if (project.schemaVersion === PROJECT_SCHEMA_VERSION) return project;

  // 1 -> 2: restore points carried their geometry inline. Write each one out to
  // a file of its own and leave a reference behind. Anything that fails to move
  // is dropped from the history rather than silently kept in a shape nothing
  // else understands.
  if (project.schemaVersion === 1) {
    const legacy = (project.snapshots ?? []) as unknown as LegacySnapshot[];
    const snapshots: ProjectSnapshot[] = [];
    for (const snapshot of legacy) {
      if (!Array.isArray(snapshot?.layers)) continue;
      const body = `${SNAPSHOT_PREFIX}${generateId()}.json`;
      try {
        await store.writeText(brand, id, body, JSON.stringify({ layers: snapshot.layers, canvas: snapshot.canvas }));
        snapshots.push({ label: snapshot.label, createdAt: snapshot.createdAt, body });
      } catch {
        // Out of room, most likely. Losing a restore point is survivable;
        // failing the whole load over one is not.
      }
    }
    const next = { ...project, schemaVersion: PROJECT_SCHEMA_VERSION, snapshots };
    // Writing it back is only so the migration is not redone on the next open.
    // If there is no room for that, the migrated project in hand is still
    // perfectly good — failing here would turn a full disk into a lost drawing.
    try {
      await saveProject(store, next);
    } catch {
      // Tried next time.
    }
    return next;
  }

  // Newer than this build understands. Refuse rather than guess — and the
  // caller treats that as damage, which keeps the bytes.
  return null;
}

/**
 * Writing is the one place `updatedAt` is set.
 *
 * The layer helpers in projectMutations.ts deliberately leave it alone: a
 * mutation is not a save, and plenty of edits never reach disk. This file used
 * to carry its own copies of those helpers that stamped it on every call, and
 * ten of the twelve had quietly drifted from the live ones by the time they
 * were removed — nothing outside this file had imported them in a long while.
 * Layer construction and mutation live in projectMutations.ts; this file
 * loads, saves and clones. Neither half wants a second copy of the other.
 */
export async function saveProject(store: ProjectStore, project: EditableDesignProject): Promise<void> {
  await store.writeManifest(project.brand, project.id, JSON.stringify({ ...project, updatedAt: store.now() }));
}

/**
 * Records a restore point, writing its geometry out beside the manifest.
 *
 * The geometry is serialised once, straight into the file. It is not cloned
 * first: the serialising *is* the copy, and the deep clone this used to do
 * measured 57ms on a real drawing for an object thrown away immediately after.
 */
export async function commitSnapshot(
  store: ProjectStore,
  project: EditableDesignProject,
  label: string
): Promise<EditableDesignProject> {
  const body = `${SNAPSHOT_PREFIX}${generateId()}.json`;
  try {
    await store.writeText(project.brand, project.id, body, JSON.stringify(snapshotBody(project)));
  } catch {
    // No room for a restore point. The edit itself still stands — refusing it
    // over a history entry would be the tail wagging the dog.
    return { ...project, revision: project.revision + 1 };
  }

  const next = snapshotProject(project, label, body, store.now());
  for (const dropped of evictedBodies(project.snapshots, next.snapshots)) {
    await store.deleteText(project.brand, project.id, dropped);
  }
  return next;
}

/** Reads a restore point back and puts it in place. */
export async function restoreSnapshot(
  store: ProjectStore,
  project: EditableDesignProject,
  index: number
): Promise<EditableDesignProject | null> {
  const snapshot = project.snapshots[index];
  if (!snapshot) return null;
  const raw = await store.readText(project.brand, project.id, snapshot.body);
  if (!raw) return null;
  try {
    const body = JSON.parse(raw) as SnapshotBody;
    if (!Array.isArray(body?.layers)) return null;
    return applySnapshot(project, body);
  } catch {
    return null;
  }
}

/**
 * The newest restore point still on disk, whatever the manifest says.
 *
 * Restore points are their own files now, which means they outlive the
 * manifest. When the manifest cannot be read, this is the difference between
 * losing an afternoon's work and losing the last few strokes of it.
 */
export async function salvageLatestSnapshot(store: ProjectStore, brand: BrandId, id: string): Promise<SnapshotBody | null> {
  const names = (await store.listNames(brand, id)).filter((name) => name.startsWith(SNAPSHOT_PREFIX));
  let best: { body: SnapshotBody; layers: number } | null = null;
  for (const name of names) {
    const raw = await store.readText(brand, id, name);
    if (!raw) continue;
    try {
      const body = JSON.parse(raw) as SnapshotBody;
      if (!Array.isArray(body?.layers) || !body.layers.length) continue;
      // Nothing records which is newest once the manifest is gone, so take the
      // one carrying the most work. It is a guess, and it is the right way to
      // guess: handing back the fullest drawing found beats handing back the
      // emptiest.
      if (!best || body.layers.length > best.layers) best = { body, layers: body.layers.length };
    } catch {
      continue;
    }
  }
  return best?.body ?? null;
}