// Where an editable project lives.
//
// A project is a JSON manifest, one image per raster layer, and one JSON body
// per restore point. On a phone that is a directory; in a browser there are no
// directories, so the same shapes go to IndexedDB. See projectStore.web.ts.
//
// Everything above this file works the same on both, which is the point: the
// editor is the most involved screen in the app and forking it per platform
// would be the fastest way to make the two drift apart.

import { Directory, File, Paths } from "expo-file-system";
import type { BrandId } from "./brands";
import type { ProjectStore } from "./projectFiles";

const MANIFEST = "project.json";

function projectRoot(brand: BrandId, id: string): Directory {
  const dir = new Directory(Paths.document, "editable-projects", brand, id);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function assetFile(brand: BrandId, id: string, asset: string): File {
  return new File(projectRoot(brand, id), asset);
}

export async function readManifest(brand: BrandId, id: string): Promise<string | null> {
  try {
    const file = new File(projectRoot(brand, id), MANIFEST);
    return file.exists ? await file.text() : null;
  } catch {
    return null;
  }
}

/**
 * Writes the manifest so that an interrupted write cannot destroy the old one.
 *
 * Straight over the top was the obvious way to do this and the wrong one. The
 * manifest carries the drawing's geometry, so it is not small, and it is
 * rewritten on every edit; a write cut short by the app being killed or the
 * disk filling leaves a truncated file, which will not parse, which used to
 * read as "no project here" and get replaced with an empty one.
 *
 * Writing beside it and moving into place means the old manifest is whole
 * right up until the new one is, and the move is the filesystem's own atomic
 * operation. A temp file left behind by a failed write is overwritten by the
 * next attempt rather than accumulating.
 */
export async function writeManifest(brand: BrandId, id: string, json: string): Promise<void> {
  const root = projectRoot(brand, id);
  const temp = new File(root, `${MANIFEST}.writing`);
  if (temp.exists) temp.delete();
  temp.write(json);
  await temp.move(new File(root, MANIFEST), { overwrite: true });
}

/**
 * Moves a manifest that would not parse aside, and says where it went.
 *
 * Keeping the bytes matters more than it looks: they are the only remaining
 * copy of whatever was in there, and overwriting them — which is what happened
 * before — ends any chance of getting the work back by hand.
 */
export async function quarantineManifest(brand: BrandId, id: string, stamp: number): Promise<string | null> {
  try {
    const root = projectRoot(brand, id);
    const file = new File(root, MANIFEST);
    if (!file.exists) return null;
    const name = `${MANIFEST}.damaged-${stamp}`;
    await file.move(new File(root, name), { overwrite: true });
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
  assetFile(brand, id, asset).write(base64, { encoding: "base64" });
}

export async function readAsset(brand: BrandId, id: string, asset: string): Promise<string | null> {
  try {
    const file = assetFile(brand, id, asset);
    return file.exists ? await file.base64() : null;
  } catch {
    return null;
  }
}

/** A restore point's geometry, kept beside the manifest rather than inside it. */
export async function writeText(brand: BrandId, id: string, name: string, text: string): Promise<void> {
  assetFile(brand, id, name).write(text);
}

export async function readText(brand: BrandId, id: string, name: string): Promise<string | null> {
  try {
    const file = assetFile(brand, id, name);
    return file.exists ? await file.text() : null;
  } catch {
    return null;
  }
}

export async function deleteText(brand: BrandId, id: string, name: string): Promise<void> {
  try {
    const file = assetFile(brand, id, name);
    if (file.exists) file.delete();
  } catch {
    // A restore point that will not delete is litter, not a failure worth
    // interrupting an edit for.
  }
}

/** Every stored name in a project, so a damaged manifest can be worked around. */
export async function listNames(brand: BrandId, id: string): Promise<string[]> {
  try {
    return projectRoot(brand, id)
      .list()
      .flatMap((entry) => {
        const uri = entry.uri.replace(/\/$/, "");
        const name = uri.slice(uri.lastIndexOf("/") + 1);
        return entry instanceof File && name ? [name] : [];
      });
  } catch {
    return [];
  }
}

/**
 * Compile-time proof that this half provides what projectFiles.ts asks for.
 *
 * The two halves resolve by platform at build time, so nothing else compares
 * them: TypeScript only ever sees `./projectStore` as the native file, and the
 * browser only ever runs the other one. Without this, a signature added to one
 * and forgotten in the other is a runtime failure on one platform only —
 * exactly the drift the note at the top of this file is about.
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
