// The browser half of project storage. See projectStore.ts for the shape.

import type { BrandId } from "./brands";
import { STORES, withStore } from "./webdb";

const manifestKey = (brand: BrandId, id: string) => `inkline:project:${brand}:${id}`;
const assetKey = (brand: BrandId, id: string, asset: string) => `${brand}/${id}/${asset}`;

export async function readManifest(brand: BrandId, id: string): Promise<string | null> {
  try {
    return localStorage.getItem(manifestKey(brand, id));
  } catch {
    return null;
  }
}

export async function writeManifest(brand: BrandId, id: string, json: string): Promise<void> {
  localStorage.setItem(manifestKey(brand, id), json);
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
