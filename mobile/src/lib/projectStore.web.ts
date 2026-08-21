// The browser half of project storage. See projectStore.ts for the shape.
//
// Everything lives in IndexedDB. The manifest used to live in localStorage on
// the grounds that it was small and structured — it is neither. It carries the
// drawing's geometry and grows with the drawing, and localStorage is capped
// around five megabytes, so a real session would eventually throw
// QuotaExceededError on save and lose the edit. Layer images were already
// here for exactly that reason; the manifest belongs here too.

import type { BrandId } from "./brands";
import type { ProjectStore } from "./projectFiles";
import { STORES, withStore } from "./webdb";

const manifestKey = (brand: BrandId, id: string) => `inkline:project:${brand}:${id}`;
const assetKey = (brand: BrandId, id: string, asset: string) => `${brand}/${id}/${asset}`;

/**
 * Reads a manifest, moving one still in localStorage across on the way.
 *
 * Anything saved before the store moved is still where it was left, and it is
 * somebody's work. It gets copied over on the first read and removed from
 * localStorage only once the copy is safely in place.
 */
export async function readManifest(brand: BrandId, id: string): Promise<string | null> {
  const key = manifestKey(brand, id);
  try {
    const stored = await withStore<string | undefined>(STORES.projectManifests, "readonly", (store) =>
      store.get(key)
    );
    if (stored !== undefined) return stored;
  } catch {
    return null;
  }

  let legacy: string | null = null;
  try {
    legacy = localStorage.getItem(key);
  } catch {
    legacy = null;
  }
  if (legacy === null) return null;

  try {
    await writeManifest(brand, id, legacy);
    // Read back before dropping the only other copy. withStore now waits for
    // the transaction rather than the request, so this should never disagree —
    // but "should never" is a poor reason to delete somebody's only manifest.
    const stored = await withStore<string | undefined>(STORES.projectManifests, "readonly", (s) => s.get(key));
    if (stored === legacy) localStorage.removeItem(key);
  } catch {
    // Couldn't move it. Hand back what is there rather than failing the load;
    // the next save writes to the new store anyway.
  }
  return legacy;
}

/**
 * Writes the manifest.
 *
 * A single IndexedDB put is its own transaction, so a write that does not
 * finish leaves the previous value untouched. The native side has to arrange
 * that for itself — see the temp-and-move in projectStore.ts.
 */
export async function writeManifest(brand: BrandId, id: string, json: string): Promise<void> {
  await withStore(STORES.projectManifests, "readwrite", (store) =>
    store.put(json, manifestKey(brand, id)) as IDBRequest<IDBValidKey>
  );
}

/** Moves a manifest that would not parse aside, and says where it went. */
export async function quarantineManifest(brand: BrandId, id: string, stamp: number): Promise<string | null> {
  try {
    const key = manifestKey(brand, id);
    const raw = await withStore<string | undefined>(STORES.projectManifests, "readonly", (store) => store.get(key));
    if (raw === undefined) return null;
    const name = `${key}:damaged-${stamp}`;
    await withStore(STORES.projectManifests, "readwrite", (store) => store.put(raw, name) as IDBRequest<IDBValidKey>);
    await withStore(STORES.projectManifests, "readwrite", (store) => store.delete(key) as IDBRequest<undefined>);
    return name;
  } catch {
    return null;
  }
}

export async function writeAsset(
  brand: BrandId,
  id: string,
  asset: string,
  base64: string
): Promise<void> {
  await withStore(STORES.projectAssets, "readwrite", (store) => store.put(base64, assetKey(brand, id, asset)) as IDBRequest<IDBValidKey>);
}

export async function readAsset(brand: BrandId, id: string, asset: string): Promise<string | null> {
  try {
    const value = await withStore<string | undefined>(STORES.projectAssets, "readonly", (store) => store.get(assetKey(brand, id, asset)));
    return value ?? null;
  } catch {
    return null;
  }
}

/** A restore point's geometry, kept beside the manifest rather than inside it. */
export async function writeText(brand: BrandId, id: string, name: string, text: string): Promise<void> {
  await withStore(STORES.projectAssets, "readwrite", (store) => store.put(text, assetKey(brand, id, name)) as IDBRequest<IDBValidKey>);
}

export async function readText(brand: BrandId, id: string, name: string): Promise<string | null> {
  try {
    const value = await withStore<string | undefined>(STORES.projectAssets, "readonly", (store) => store.get(assetKey(brand, id, name)));
    return value ?? null;
  } catch {
    return null;
  }
}

export async function deleteText(brand: BrandId, id: string, name: string): Promise<void> {
  try {
    await withStore(STORES.projectAssets, "readwrite", (store) => store.delete(assetKey(brand, id, name)) as IDBRequest<undefined>);
  } catch {
    // Litter, not a failure worth interrupting an edit for.
  }
}

/** Every stored name in a project, so a damaged manifest can be worked around. */
export async function listNames(brand: BrandId, id: string): Promise<string[]> {
  try {
    const prefix = assetKey(brand, id, "");
    const keys = await withStore<IDBValidKey[]>(STORES.projectAssets, "readonly", (store) => store.getAllKeys());
    return keys
      .filter((key): key is string => typeof key === "string" && key.startsWith(prefix))
      .map((key) => key.slice(prefix.length));
  } catch {
    return [];
  }
}

/**
 * Compile-time proof that this half provides what projectFiles.ts asks for.
 *
 * The two halves resolve by platform at build time, so nothing else compares
 * them: TypeScript only ever sees `./projectStore` as the native file, and the
 * browser only ever runs this one. Without this, a signature added to one and
 * forgotten in the other is a runtime failure on one platform only — exactly
 * the drift the note at the top of this file is about.
 */
const port: Omit<ProjectStore, "now"> = {
  readManifest,
  writeManifest,
  quarantineManifest,
  readText,
  writeText,
  deleteText,
  listNames,
};
void port;
