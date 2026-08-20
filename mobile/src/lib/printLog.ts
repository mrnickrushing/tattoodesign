// What was actually printed, and how.
//
// Every print was fire-and-forget. A design that came out right at 3.2 inches
// on thermal paper with a particular scale correction left no record of any of
// that, so "make that one again exactly" was not a question the app could
// answer — even though the printer calibration that would make it meaningful
// already existed.
//
// This is deliberately a log, not a setting. It records what happened rather
// than what you intend, because the useful fact is "this is the one that
// worked", and you only know which one worked afterwards.
//
// Storage is metadata only, so it stays small: a few hundred bytes per print
// against a megabyte per design.

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { BrandId } from "./brands";

export type PrintRecord = {
  id: string;
  /** The design this was, when it is one design rather than a whole sheet. */
  designId?: string;
  /** What was printed, for a sheet: how many pieces and the template. */
  label: string;
  /** Printed size in inches, which is the number worth reproducing. */
  widthIn?: number;
  heightIn?: number;
  /** Printer profile in effect, and the scale it was correcting by. */
  profile?: string;
  scaleCorrection?: number;
  mirrored?: boolean;
  at: number;
};

const LIMIT = 60;

const key = (brand: BrandId) => `inkline:print-log:${brand}`;

export async function getPrintLog(brand: BrandId): Promise<PrintRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(key(brand));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PrintRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Records a print. Newest first, and bounded — a log nobody prunes eventually
 * becomes the largest thing in storage for the least reason.
 */
export async function recordPrint(
  brand: BrandId,
  record: Omit<PrintRecord, "id" | "at">
): Promise<void> {
  try {
    const existing = await getPrintLog(brand);
    const entry: PrintRecord = {
      ...record,
      id: `${Date.now().toString(36)}-${Math.trunc(performance.now()).toString(36)}`,
      at: Date.now(),
    };
    await AsyncStorage.setItem(key(brand), JSON.stringify([entry, ...existing].slice(0, LIMIT)));
  } catch {
    // A print that happened is worth more than a record of it; never let the
    // bookkeeping fail the thing it is bookkeeping for.
  }
}

/** Every print of one design, newest first. */
export function printsOf(log: PrintRecord[], designId: string): PrintRecord[] {
  return log.filter((entry) => entry.designId === designId);
}

/**
 * A one-line history for a design, or null if it has never been printed.
 *
 * Says the size, because that is the fact you are trying to reproduce, and how
 * long ago, because a print from this morning means something different from
 * one from last year.
 */
export function summarisePrints(log: PrintRecord[], designId: string, now = Date.now()): string | null {
  const mine = printsOf(log, designId);
  if (!mine.length) return null;
  const latest = mine[0];
  const size = latest.widthIn ? `${latest.widthIn.toFixed(2)}in` : "unrecorded size";
  const count = mine.length === 1 ? "Printed once" : `Printed ${mine.length}×`;
  return `${count} · last at ${size}, ${describeAge(now - latest.at)}`;
}

/** Human-scale ages. Precision stops mattering fast here. */
export function describeAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
