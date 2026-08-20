// Per-brand design library. Ink Lab flash and Sugar Haus templates never mix.
//
// Images live as PNG files on disk; AsyncStorage holds only metadata pointing
// at them. Storing base64 images directly in AsyncStorage — which is what this
// did originally — puts whole PNGs inside one JSON blob in a key/value store
// meant for small values, with a low size ceiling on Android. Enough designs
// and writes start failing, usually silently, taking the whole library with
// them. Entries saved under the old scheme are migrated on first read.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { generateId } from "./id";
import { hashImage } from "./syncPlan";
import { stripDataUrlPrefix } from "./files";
import type { BrandId } from "./brands";
import { Skia } from "@shopify/react-native-skia";
import {
  deleteDesignImage,
  readDesignBase64,
  resolveDesignImage,
  writeDesignImage,
} from "./designFiles";

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
  /** Lowercase labels for search — client names, motifs, collections. */
  tags?: string[];
  favorite?: boolean;
  /**
   * When this design last changed. Sync orders every decision by it, so any
   * mutation that does not bump it is a change the other devices never see.
   * Absent on entries written before sync existed; they fall back to
   * createdAt, which is the correct "as old as it looks".
   */
  updatedAt?: number;
  /**
   * A tombstone. Deleting keeps the record so the deletion can travel — a
   * design merely absent from a device is almost always one it has not seen
   * yet, and treating that as a deletion is how a sync eats a library.
   */
  deleted?: boolean;
  /** Fingerprint of the image bytes, so unchanged pixels are never re-sent. */
  imageHash?: string;
};

/** Last-changed time, tolerating entries that predate sync. */
export function changedAt(design: LibraryDesign): number {
  return design.updatedAt ?? design.createdAt;
}

/** Shape written by the original base64-in-AsyncStorage version. */
type LegacyDesign = Omit<LibraryDesign, "uri"> & { dataUrl?: string; uri?: string };

function key(brand: BrandId) {
  return `inkline:design-library:${brand}`;
}

/**
 * Everything worth showing. Tombstones are records of a deletion, not designs,
 * so they never reach a screen — getLibraryWithTombstones is for sync.
 */
export async function getLibrary(brand: BrandId): Promise<LibraryDesign[]> {
  return (await getLibraryWithTombstones(brand)).filter((design) => !design.deleted);
}

export async function getLibraryWithTombstones(brand: BrandId): Promise<LibraryDesign[]> {
  try {
    const raw = await AsyncStorage.getItem(key(brand));
    if (!raw) return [];
    const entries = JSON.parse(raw) as LegacyDesign[];

    let migrated = false;
    const result: LibraryDesign[] = [];
    for (const entry of entries) {
      if (entry.uri) {
        // Ask the store where the image is rather than trusting the stored
        // path. On a phone an app update re-creates the container under a new
        // UUID and invalidates every absolute file:// URI ever written; in a
        // browser an object URL is only valid for the document that made it.
        // Either way a remembered URI is a dead link and the library would go
        // blank for no reason at all.
        const name = entry.file ?? `${entry.id}.png`;
        let found: string | null;
        try {
          found = await resolveDesignImage(brand, name);
        } catch {
          // Storage is unreachable, not empty. Keep the entry as it is rather
          // than concluding the design is gone — deleting a library because a
          // read failed is unrecoverable, showing a stale one is not.
          result.push(entry as LibraryDesign);
          continue;
        }
        if (!found) {
          // The image really is gone. Dropping the record is the honest
          // outcome: a design whose pixels no longer exist is a blank tile
          // that stays blank and does nothing when tapped.
          migrated = true;
          continue;
        }
        let normalized = { ...(entry as LibraryDesign), uri: found };
        if (!normalized.width || !normalized.height) {
          try {
            const base64 = await readDesignBase64(brand, name);
            const decoded = base64
              ? Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(base64))
              : null;
            if (decoded) {
              normalized = { ...normalized, width: decoded.width(), height: decoded.height() };
              migrated = true;
            }
          } catch {
            // Keep the design available even when optional metadata can't be recovered.
          }
        }
        if (found !== entry.uri) migrated = true;
        result.push(normalized);
        continue;
      }
      if (entry.dataUrl) {
        // Old base64 entry — move the bytes to a file, keep the metadata.
        try {
          const name = `${entry.id}.png`;
          const uri = await writeDesignImage(brand, name, entry.dataUrl);
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
    uri: await writeDesignImage(brand, name, design.dataUrl),
    title: design.title,
    source: design.source,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    imageHash: hashImage(design.dataUrl),
    width: decoded?.width(),
    height: decoded?.height(),
  };
  await save(brand, [entry, ...(await getLibrary(brand))]);
  return entry;
}

export async function removeFromLibrary(brand: BrandId, id: string): Promise<void> {
  const designs = await getLibraryWithTombstones(brand);
  const gone = designs.find((d) => d.id === id);
  if (gone) await deleteDesignImage(brand, gone.file ?? `${gone.id}.png`);
  // The record stays, marked and timestamped, so the deletion can reach the
  // other devices. The pixels go immediately — a tombstone is metadata.
  await save(
    brand,
    designs.map((d) =>
      d.id === id ? { ...d, deleted: true, updatedAt: Date.now(), file: undefined, uri: "" } : d
    )
  );
}

/** Drops a tombstone for good, once every device has seen the deletion. */
export async function forgetTombstone(brand: BrandId, id: string): Promise<void> {
  const designs = await getLibraryWithTombstones(brand);
  await save(brand, designs.filter((d) => !(d.id === id && d.deleted)));
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
  const uri = await writeDesignImage(brand, name, dataUrl);
  const updated: LibraryDesign = {
    ...existing,
    file: name,
    uri,
    updatedAt: Date.now(),
    imageHash: hashImage(dataUrl),
  };
  await save(
    brand,
    designs.map((d) => (d.id === id ? updated : d))
  );
  // Only once the new one is safely written and recorded.
  await deleteDesignImage(brand, existing.file ?? `${existing.id}.png`);
  return updated;
}

export async function setDesignTags(
  brand: BrandId,
  id: string,
  tags: string[]
): Promise<void> {
  const designs = await getLibrary(brand);
  await save(
    brand,
    designs.map((d) => (d.id === id ? { ...d, tags, updatedAt: Date.now() } : d))
  );
}

export async function setDesignFavorite(
  brand: BrandId,
  id: string,
  favorite: boolean
): Promise<void> {
  const designs = await getLibrary(brand);
  await save(
    brand,
    designs.map((d) => (d.id === id ? { ...d, favorite, updatedAt: Date.now() } : d))
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
    designs.map((d) => (d.id === id ? { ...d, title, updatedAt: Date.now() } : d))
  );
}
