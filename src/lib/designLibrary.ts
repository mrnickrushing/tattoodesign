// Small localStorage-backed library so designs made in the Generator or
// Converter can be sent straight into the Sheet Builder. Namespaced per
// brand so Ink Lab flash and Sugar Haus templates never mix.

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

function eventName(brand: BrandId) {
  return `inkline:design-library-changed:${brand}`;
}

export function getLibrary(brand: BrandId): LibraryDesign[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key(brand));
    return raw ? (JSON.parse(raw) as LibraryDesign[]) : [];
  } catch {
    return [];
  }
}

function save(brand: BrandId, designs: LibraryDesign[]) {
  window.localStorage.setItem(key(brand), JSON.stringify(designs));
  window.dispatchEvent(new Event(eventName(brand)));
}

export function addToLibrary(
  brand: BrandId,
  design: Omit<LibraryDesign, "id" | "createdAt">
): LibraryDesign {
  const entry: LibraryDesign = {
    ...design,
    id: generateId(),
    createdAt: Date.now(),
  };
  const designs = [entry, ...getLibrary(brand)];
  save(brand, designs);
  return entry;
}

export function removeFromLibrary(brand: BrandId, id: string) {
  save(
    brand,
    getLibrary(brand).filter((d) => d.id !== id)
  );
}

export function subscribeLibrary(brand: BrandId, cb: () => void) {
  const evt = eventName(brand);
  window.addEventListener(evt, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(evt, cb);
    window.removeEventListener("storage", cb);
  };
}
