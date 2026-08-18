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

export type LibraryDesign = {
  id: string;
  /** file:// URI of the PNG on disk. Renders directly in <Image>. */
  uri: string;
  title: string;
  source: "generated" | "converted" | "uploaded";
  createdAt: number;
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

function writePng(brand: BrandId, id: string, dataUrl: string): string {
  const file = new File(designsDir(brand), `${id}.png`);
  if (file.exists) file.delete();
  file.write(stripDataUrlPrefix(dataUrl), { encoding: "base64" });
  return file.uri;
}

export async function getLibrary(brand: BrandId): Promise<LibraryDesign[]> {
  try {
    const raw = await AsyncStorage.getItem(key(brand));
    if (!raw) return [];
    const entries = JSON.parse(raw) as LegacyDesign[];

    let migrated = false;
    const result: LibraryDesign[] = [];
    for (const entry of entries) {
      if (entry.uri) {
        result.push(entry as LibraryDesign);
        continue;
      }
      if (entry.dataUrl) {
        // Old base64 entry — move the bytes to a file, keep the metadata.
        try {
          const uri = writePng(brand, entry.id, entry.dataUrl);
          const { dataUrl: _drop, ...rest } = entry;
          result.push({ ...(rest as Omit<LibraryDesign, "uri">), uri });
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
  const entry: LibraryDesign = {
    id,
    uri: writePng(brand, id, design.dataUrl),
    title: design.title,
    source: design.source,
    createdAt: Date.now(),
  };
  await save(brand, [entry, ...(await getLibrary(brand))]);
  return entry;
}

export async function removeFromLibrary(brand: BrandId, id: string): Promise<void> {
  const designs = await getLibrary(brand);
  const gone = designs.find((d) => d.id === id);
  if (gone) {
    try {
      const file = new File(gone.uri);
      if (file.exists) file.delete();
    } catch {
      // Metadata removal still proceeds if the file is already missing.
    }
  }
  await save(
    brand,
    designs.filter((d) => d.id !== id)
  );
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
