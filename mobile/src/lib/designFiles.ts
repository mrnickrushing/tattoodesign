// Where a design's pixels live.
//
// Metadata is small and goes in AsyncStorage, which works everywhere. The
// images do not: a library of PNGs inside one JSON blob in a key/value store
// hits a size ceiling and starts failing writes, usually silently, taking the
// whole library with it. So the bytes are stored separately, and *where*
// separately means is the one thing that genuinely differs between a phone and
// a browser — a phone has a documents directory, a browser has IndexedDB.
//
// Everything above this file works the same on both.

import { Directory, File, Paths } from "expo-file-system";
import type { BrandId } from "./brands";
import { stripDataUrlPrefix } from "./files";

function designsDir(brand: BrandId): Directory {
  const dir = new Directory(Paths.document, "designs", brand);
  // Idempotent as well as the exists check: create() throws on an existing
  // directory otherwise, and two saves can race here.
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export async function writeDesignImage(brand: BrandId, name: string, dataUrl: string): Promise<string> {
  const file = new File(designsDir(brand), name);
  if (file.exists) file.delete();
  file.write(stripDataUrlPrefix(dataUrl), { encoding: "base64" });
  return file.uri;
}

export async function deleteDesignImage(brand: BrandId, name: string): Promise<void> {
  try {
    const file = new File(designsDir(brand), name);
    if (file.exists) file.delete();
  } catch {
    // Already gone is the outcome we wanted anyway.
  }
}

/**
 * A usable URI for a stored image, or null if it is missing.
 *
 * Re-derived rather than trusting a stored path: an app update re-creates the
 * iOS container under a new UUID, which invalidates every absolute file:// URI
 * ever written. The PNG is still there under the same name, so a library that
 * trusted its stored paths would go blank for no reason at all.
 */
export async function resolveDesignImage(brand: BrandId, name: string): Promise<string | null> {
  try {
    const file = new File(designsDir(brand), name);
    return file.exists ? file.uri : null;
  } catch {
    return null;
  }
}

export async function readDesignBase64(brand: BrandId, name: string): Promise<string | null> {
  try {
    const file = new File(designsDir(brand), name);
    return file.exists ? await file.base64() : null;
  } catch {
    return null;
  }
}
