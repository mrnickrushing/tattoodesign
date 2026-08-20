// The browser half of design storage. See designFiles.ts for the shape.
//
// IndexedDB rather than localStorage, for the same reason the phone writes
// files rather than stuffing base64 into AsyncStorage: localStorage holds a
// few megabytes of strings and a design library outgrows that immediately.
// IndexedDB stores blobs, has no practical ceiling, and survives a reload.
//
// Images are handed back as object URLs, minted fresh each time the library is
// read. They are deliberately not persisted: an object URL is only valid for
// the document that created it, so a stored one would be a dead link after
// exactly one refresh.

import type { BrandId } from "./brands";
import { stripDataUrlPrefix } from "./files";
import { STORES, withStore } from "./webdb";

const key = (brand: BrandId, name: string) => `${brand}/${name}`;

function toBlob(dataUrl: string): Blob {
  const base64 = stripDataUrlPrefix(dataUrl);
  const comma = dataUrl.indexOf(",");
  const declared = comma > 0 ? dataUrl.slice(5, dataUrl.indexOf(";")) : "image/png";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: declared || "image/png" });
}

export async function writeDesignImage(brand: BrandId, name: string, dataUrl: string): Promise<string> {
  const blob = toBlob(dataUrl);
  await withStore(STORES.designs, "readwrite", (store) => store.put(blob, key(brand, name)) as IDBRequest<IDBValidKey>);
  return URL.createObjectURL(blob);
}

export async function deleteDesignImage(brand: BrandId, name: string): Promise<void> {
  try {
    await withStore(STORES.designs, "readwrite", (store) => store.delete(key(brand, name)) as IDBRequest<undefined>);
  } catch {
    // Already gone is the outcome we wanted anyway.
  }
}

export async function resolveDesignImage(brand: BrandId, name: string): Promise<string | null> {
  try {
    const blob = await withStore<Blob | undefined>(STORES.designs, "readonly", (store) => store.get(key(brand, name)));
    return blob ? URL.createObjectURL(blob) : null;
  } catch {
    return null;
  }
}

export async function readDesignBase64(brand: BrandId, name: string): Promise<string | null> {
  try {
    const blob = await withStore<Blob | undefined>(STORES.designs, "readonly", (store) => store.get(key(brand, name)));
    if (!blob) return null;
    const buffer = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    // Chunked: spreading a whole image into String.fromCharCode blows the
    // argument limit on anything but a thumbnail.
    for (let i = 0; i < buffer.length; i += 0x8000) {
      binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  } catch {
    return null;
  }
}
