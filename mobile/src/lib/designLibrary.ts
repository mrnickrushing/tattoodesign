// Per-brand design library. Ink Lab flash and Sugar Haus templates never mix.
//
// Images live as PNG files on disk; AsyncStorage holds only metadata pointing
// at them. Storing base64 images directly in AsyncStorage — which is what this
// did originally — puts whole PNGs inside one JSON blob in a key/value store
// meant for small values, with a low size ceiling on Android. Enough designs
// and writes start failing, usually silently, taking the whole library with
// them. Entries saved under the old scheme are migrated on first read.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";
import { generateId } from "./id";
import { stripDataUrlPrefix } from "./files";
import type { BrandId } from "./brands";
import { Skia } from "@shopify/react-native-skia";

export type LibraryDesign = {
  id: string;
  /** Basename on disk. Edits write a new one so image caches, which key off
   *  the URI, don't keep showing the version you just changed. */
  file?: string;
  /** file:// URI of the PNG on disk. Renders directly in <Image>. */
  uri: string;
  title: string;
  source: "generated" | "converted" | "uploaded";
  createdAt: number;
  width?: number;
  height?: number;
};

/** Shape written by the original base64-in-AsyncStorage version. */
type LegacyDesign = Omit<LibraryDesign, "uri"> & { dataUrl?: string; uri?: string };

function key(brand: BrandId) {
  return `inkline:design-library:${brand}`;
}

function designsDir(brand: BrandId): Directory {
  const dir = new Directory(Paths.document, "designs", brand);
  // idempotent as well as the exists check: create() throws on an existing
  // directory otherwise, and two saves can race here.
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function writePng(brand: BrandId, name: string, dataUrl: string): string {
  const file = new File(designsDir(brand), name);
  if (file.exists) file.delete();
  file.write(stripDataUrlPrefix(dataUrl), { encoding: "base64" });
  return file.uri;
}

function deleteFile(brand: BrandId, name?: string) {
  if (!name) return;
  try {
    const file = new File(designsDir(brand), name);
    if (file.exists) file.delete();
  } catch {
    // Already gone is the outcome we wanted anyway.
  }
}

export async function getLibrary(brand: BrandId): Promise<LibraryDesign[]> {
  try {
    const raw = await AsyncStorage.getItem(key(brand));
    if (!raw) return [];
    const entries = JSON.parse(raw) as LegacyDesign[];

    const dir = designsDir(brand);
    let migrated = false;
    const result: LibraryDesign[] = [];
    for (const entry of entries) {
      if (entry.uri) {
        // Re-derive the path instead of trusting the stored one. An app
        // update re-creates the iOS container under a new UUID, which
        // invalidates every absolute file:// URI we wrote — the PNG is still
        // there under the same name, so the library would go blank for no
        // reason at all.
        const file = new File(dir, entry.file ?? `${entry.id}.png`);
        const uri = file.exists ? file.uri : entry.uri;
        let normalized = { ...(entry as LibraryDesign), uri };
        if ((!normalized.width || !normalized.height) && file.exists) {
          try {
            const decoded = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(await file.base64()));
            if (decoded) {
              normalized = { ...normalized, width: decoded.width(), height: decoded.height() };
              migrated = true;
            }
          } catch {
            // Keep the design available even when optional metadata can't be recovered.
          }
        }
        if (uri !== entry.uri) migrated = true;
        result.push(normalized);
        continue;
      }
      if (entry.dataUrl) {
        // Old base64 entry — move the bytes to a file, keep the metadata.
        try {
          const name = `${entry.id}.png`;
          const uri = writePng(brand, name, entry.dataUrl);
          const { dataUrl: _drop, ...rest } = entry;
          const decoded = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(stripDataUrlPrefix(entry.dataUrl)));
          result.push({
            ...(rest as Omit<LibraryDesign, "uri">),
            file: name,
            uri,
            width: decoded?.width(),
            height: decoded?.height(),
          });
          migrated = true;
        } catch {
          // A single unreadable entry shouldn't take the library down.
        }
      }
    }
    if (migrated) await save(brand, result);
    return result;
  } catch {
    return [];
  }
}

async function save(brand: BrandId, designs: LibraryDesign[]) {
  await AsyncStorage.setItem(key(brand), JSON.stringify(designs));
}

export async function addToLibrary(
  brand: BrandId,
  design: { dataUrl: string; title: string; source: LibraryDesign["source"] }
): Promise<LibraryDesign> {
  const id = generateId();
  const name = `${id}.png`;
  const decoded = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(stripDataUrlPrefix(design.dataUrl)));
  const entry: LibraryDesign = {
    id,
    file: name,
    uri: writePng(brand, name, design.dataUrl),
    title: design.title,
    source: design.source,
    createdAt: Date.now(),
    width: decoded?.width(),
    height: decoded?.height(),
  };
  await save(brand, [entry, ...(await getLibrary(brand))]);
  return entry;
}

export async function removeFromLibrary(brand: BrandId, id: string): Promise<void> {
  const designs = await getLibrary(brand);
  const gone = designs.find((d) => d.id === id);
  if (gone) deleteFile(brand, gone.file ?? `${gone.id}.png`);
  await save(
    brand,
    designs.filter((d) => d.id !== id)
  );
}

/**
 * Swaps a design's image while keeping its identity — same entry, same id, so
 * anything already placed on a sheet follows the edit instead of vanishing.
 */
export async function replaceInLibrary(
  brand: BrandId,
  id: string,
  dataUrl: string
): Promise<LibraryDesign | null> {
  const designs = await getLibrary(brand);
  const existing = designs.find((d) => d.id === id);
  if (!existing) return null;

  const name = `${id}-${Date.now().toString(36)}.png`;
  const uri = writePng(brand, name, dataUrl);
  const updated: LibraryDesign = { ...existing, file: name, uri };
  await save(
    brand,
    designs.map((d) => (d.id === id ? updated : d))
  );
  // Only once the new one is safely written and recorded.
  deleteFile(brand, existing.file ?? `${existing.id}.png`);
  return updated;
}

export async function renameInLibrary(
  brand: BrandId,
  id: string,
  title: string
): Promise<void> {
  const designs = await getLibrary(brand);
  await save(
    brand,
    designs.map((d) => (d.id === id ? { ...d, title } : d))
  );
}
