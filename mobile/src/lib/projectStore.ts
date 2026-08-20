// Where an editable project lives.
//
// A project is a JSON manifest plus one image per raster layer. On a phone
// that is a directory; in a browser there is no directory, so the same shapes
// go to localStorage for the manifest and IndexedDB for the layer images —
// the manifest is small and structured, the images are not.
//
// Everything above this file works the same on both, which is the point: the
// editor is the most involved screen in the app and forking it per platform
// would be the fastest way to make the two drift apart.

import { Directory, File, Paths } from "expo-file-system";
import type { BrandId } from "./brands";

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
    const file = new File(projectRoot(brand, id), "project.json");
    return file.exists ? await file.text() : null;
  } catch {
    return null;
  }
}

export async function writeManifest(brand: BrandId, id: string, json: string): Promise<void> {
  new File(projectRoot(brand, id), "project.json").write(json);
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
