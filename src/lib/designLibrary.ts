// Small localStorage-backed library so designs made in the Generator or
// Converter can be sent straight into the Flash Sheet Builder.

import { generateId } from "./id";

export type LibraryDesign = {
  id: string;
  dataUrl: string;
  title: string;
  source: "generated" | "converted" | "uploaded";
  createdAt: number;
};

const KEY = "inkline:design-library";
const EVENT = "inkline:design-library-changed";

export function getLibrary(): LibraryDesign[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LibraryDesign[]) : [];
  } catch {
    return [];
  }
}

function save(designs: LibraryDesign[]) {
  window.localStorage.setItem(KEY, JSON.stringify(designs));
  window.dispatchEvent(new Event(EVENT));
}

export function addToLibrary(
  design: Omit<LibraryDesign, "id" | "createdAt">
): LibraryDesign {
  const entry: LibraryDesign = {
    ...design,
    id: generateId(),
    createdAt: Date.now(),
  };
  const designs = [entry, ...getLibrary()];
  save(designs);
  return entry;
}

export function removeFromLibrary(id: string) {
  save(getLibrary().filter((d) => d.id !== id));
}

export function subscribeLibrary(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}
