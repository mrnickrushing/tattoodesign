// Saved sheet layouts, per brand.
//
// A layout is cheap to describe (a few numbers per design) but expensive to
// rebuild by hand, so it's worth keeping. Two things live here: named sheets
// the user saved deliberately, and a single unnamed draft of whatever is on
// the canvas right now — the draft is what stops a layout from evaporating
// when you switch tabs or the app is backgrounded out of memory.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { generateId } from "./id";
import type { BrandId } from "./brands";

export type SavedSheetItem = {
  id: string;
  /** Points back at the design library rather than trusting the stored path:
   *  an app update re-creates the iOS container under a new UUID, so absolute
   *  file:// URIs go stale while the design itself is still there. */
  designId?: string;
  uri: string;
  title: string;
  xIn: number;
  yIn: number;
  wIn: number;
  hIn: number;
  rotation: number;
  mirrored: boolean;
  locked?: boolean;
};

export type SavedSheet = {
  id: string;
  name: string;
  templateId: string;
  items: SavedSheetItem[];
  createdAt: number;
  updatedAt: number;
};

export type SheetDraft = {
  templateId: string;
  items: SavedSheetItem[];
  /** Set when the draft is an edit of a saved sheet, so "Save" updates it. */
  sheetId: string | null;
  sheetName: string | null;
};

const listKey = (brand: BrandId) => `inkline:sheets:${brand}`;
const draftKey = (brand: BrandId) => `inkline:sheet-draft:${brand}`;

export async function listSheets(brand: BrandId): Promise<SavedSheet[]> {
  try {
    const raw = await AsyncStorage.getItem(listKey(brand));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as SavedSheet[]).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

async function write(brand: BrandId, sheets: SavedSheet[]) {
  await AsyncStorage.setItem(listKey(brand), JSON.stringify(sheets));
}

/** Updates the sheet at `id` when given one, otherwise creates a new sheet. */
export async function saveSheet(
  brand: BrandId,
  sheet: { id?: string | null; name: string; templateId: string; items: SavedSheetItem[] }
): Promise<SavedSheet> {
  const sheets = await listSheets(brand);
  const existing = sheet.id ? sheets.find((s) => s.id === sheet.id) : undefined;
  const now = Date.now();
  const entry: SavedSheet = {
    id: existing?.id ?? generateId(),
    name: sheet.name.trim() || "Untitled sheet",
    templateId: sheet.templateId,
    items: sheet.items,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await write(
    brand,
    existing ? sheets.map((s) => (s.id === entry.id ? entry : s)) : [entry, ...sheets]
  );
  return entry;
}

export async function deleteSheet(brand: BrandId, id: string): Promise<void> {
  const sheets = await listSheets(brand);
  await write(
    brand,
    sheets.filter((s) => s.id !== id)
  );
}

export async function renameSheet(brand: BrandId, id: string, name: string): Promise<void> {
  const sheets = await listSheets(brand);
  await write(
    brand,
    sheets.map((s) =>
      s.id === id ? { ...s, name: name.trim() || s.name, updatedAt: Date.now() } : s
    )
  );
}

export async function getDraft(brand: BrandId): Promise<SheetDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(draftKey(brand));
    if (!raw) return null;
    const draft = JSON.parse(raw) as SheetDraft;
    return Array.isArray(draft?.items) ? draft : null;
  } catch {
    return null;
  }
}

export async function saveDraft(brand: BrandId, draft: SheetDraft): Promise<void> {
  try {
    await AsyncStorage.setItem(draftKey(brand), JSON.stringify(draft));
  } catch {
    // A failed autosave shouldn't interrupt what the user is doing; the
    // canvas is still intact in memory.
  }
}
