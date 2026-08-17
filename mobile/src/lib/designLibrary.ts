// Small AsyncStorage-backed library so designs made in the Generator or
// Converter can be sent straight into the Sheet Builder. Namespaced per
// brand so Ink Lab flash and Sugar Haus templates never mix. Mirrors the
// web app's src/lib/designLibrary.ts (localStorage there, AsyncStorage
// here — same shape, same brand-scoped key).

import AsyncStorage from "@react-native-async-storage/async-storage";
import { generateId } from "./id";
import type { BrandId } from "./brands";

export type LibraryDesign = {
  id: string;
  dataUrl: string;
  title: string;
  source: "generated" | "converted" | "uploaded";
  createdAt: number;
};

function key(brand: BrandId) {
  return `inkline:design-library:${brand}`;
}

export async function getLibrary(brand: BrandId): Promise<LibraryDesign[]> {
  try {
    const raw = await AsyncStorage.getItem(key(brand));
    return raw ? (JSON.parse(raw) as LibraryDesign[]) : [];
  } catch {
    return [];
  }
}

async function save(brand: BrandId, designs: LibraryDesign[]) {
  await AsyncStorage.setItem(key(brand), JSON.stringify(designs));
}

export async function addToLibrary(
  brand: BrandId,
  design: Omit<LibraryDesign, "id" | "createdAt">
): Promise<LibraryDesign> {
  const entry: LibraryDesign = {
    ...design,
    id: generateId(),
    createdAt: Date.now(),
  };
  const designs = [entry, ...(await getLibrary(brand))];
  await save(brand, designs);
  return entry;
}

export async function removeFromLibrary(brand: BrandId, id: string): Promise<void> {
  const designs = (await getLibrary(brand)).filter((d) => d.id !== id);
  await save(brand, designs);
}
