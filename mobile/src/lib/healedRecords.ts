// How the work actually healed, as opposed to how the model says it will.
//
// The editor can already simulate a piece at two years and ten — spread,
// softening, black fading toward blue-grey. That is a model with plausible
// constants in it, and nobody has ever checked it against a real arm.
//
// This is the other half: photographs of the real thing, attached to the
// design that made them, with how long after the session each one was taken.
// Two things fall out of that. The obvious one is a portfolio of healed work
// rather than day-one photos, which is what actually shows whether the line
// weights hold. The less obvious one is that after enough of them, the
// simulation can be checked — and eventually corrected — against evidence
// instead of continuing to guess.
//
// Images reuse the design store, so they inherit the same filesystem-on-a-
// phone / IndexedDB-in-a-browser split as everything else.

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { BrandId } from "./brands";
import { generateId } from "./id";
import { deleteDesignImage, resolveDesignImage, writeDesignImage } from "./designFiles";

import type { HealedRecord } from "./healedAge";
export type { HealedRecord };

const key = (brand: BrandId) => `inkline:healed:${brand}`;

export async function getHealedRecords(brand: BrandId): Promise<HealedRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(key(brand));
    const parsed = raw ? (JSON.parse(raw) as HealedRecord[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function save(brand: BrandId, records: HealedRecord[]): Promise<void> {
  await AsyncStorage.setItem(brand ? key(brand) : key("ink"), JSON.stringify(records));
}

export async function addHealedRecord(
  brand: BrandId,
  input: { designId: string; dataUrl: string; inkedAt: number; at?: number; note?: string }
): Promise<HealedRecord> {
  const id = generateId();
  const file = `healed-${input.designId}-${id}.png`;
  await writeDesignImage(brand, file, input.dataUrl);
  const record: HealedRecord = {
    id,
    designId: input.designId,
    file,
    at: input.at ?? Date.now(),
    inkedAt: input.inkedAt,
    note: input.note,
  };
  await save(brand, [record, ...(await getHealedRecords(brand))]);
  return record;
}

export async function removeHealedRecord(brand: BrandId, id: string): Promise<void> {
  const records = await getHealedRecords(brand);
  const gone = records.find((record) => record.id === id);
  if (gone) await deleteDesignImage(brand, gone.file);
  await save(
    brand,
    records.filter((record) => record.id !== id)
  );
}

/** Photos with a usable URI, re-resolved rather than remembered. */
export async function resolveHealed(
  brand: BrandId,
  records: HealedRecord[]
): Promise<{ record: HealedRecord; uri: string }[]> {
  const out: { record: HealedRecord; uri: string }[] = [];
  for (const record of records) {
    try {
      const uri = await resolveDesignImage(brand, record.file);
      if (uri) out.push({ record, uri });
    } catch {
      // A photo the store cannot produce is skipped rather than shown broken;
      // its metadata stays, so nothing is silently deleted.
    }
  }
  return out;
}

export { healedAge, healingStage, recordsFor } from "./healedAge";
