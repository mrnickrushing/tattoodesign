// Session defaults that stop resetting.
//
// Every session re-dialing the same trace threshold, brush, and placement
// width is friction with no upside for a two-person shop. One JSON blob per
// brand in AsyncStorage; each screen reads its key on mount and writes on
// change. Junk-tolerant: a corrupt blob or a stale value falls back to the
// caller's default instead of propagating.
//
// The storage backend is injected so the merge/validation logic tests run
// under node without the native AsyncStorage module.

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { BrandId } from "./brands";

export type PreferenceBackend = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

const SCHEMA_VERSION = 1;

type Blob = { v: number; values: Record<string, unknown> };

const storageKey = (brand: BrandId) => `inkline:preferences:${brand}`;

export function createPreferenceStore(backend: PreferenceBackend) {
  async function read(brand: BrandId): Promise<Record<string, unknown>> {
    try {
      const raw = await backend.getItem(storageKey(brand));
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Blob;
      if (parsed.v !== SCHEMA_VERSION || typeof parsed.values !== "object" || !parsed.values) return {};
      return parsed.values;
    } catch {
      return {};
    }
  }

  return {
    /**
     * Reads one preference. `validate` guards against stale shapes — a value
     * that fails it behaves exactly like an absent one.
     */
    async get<T>(brand: BrandId, key: string, fallback: T, validate?: (value: unknown) => value is T): Promise<T> {
      const values = await read(brand);
      if (!(key in values)) return fallback;
      const value = values[key];
      if (validate) return validate(value) ? value : fallback;
      // Without a validator, only accept a value of the fallback's own type.
      return typeof value === typeof fallback && value !== null ? (value as T) : fallback;
    },

    async set(brand: BrandId, key: string, value: unknown): Promise<void> {
      try {
        const values = await read(brand);
        const blob: Blob = { v: SCHEMA_VERSION, values: { ...values, [key]: value } };
        await backend.setItem(storageKey(brand), JSON.stringify(blob));
      } catch {
        // Preferences are convenience, never worth an error surface.
      }
    },

    async clear(brand: BrandId): Promise<void> {
      try {
        await backend.removeItem(storageKey(brand));
      } catch {
        // Same policy as set.
      }
    },

    /** Everything stored for a brand — drives the Settings readout. */
    async all(brand: BrandId): Promise<Record<string, unknown>> {
      return read(brand);
    },
  };
}

export const preferences = createPreferenceStore(AsyncStorage);

// Shared keys, so screens can't drift apart on spelling.
export const PREF_KEYS = {
  convertOptions: "convert.options",
  brushSize: "editor.brushSize",
  brushColor: "editor.brushColor",
  pen: "editor.pen",
  placementWidthIn: "placement.widthIn",
  hourlyRate: "quote.hourlyRate",
} as const;

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
