// Recent prompts, per brand.
//
// A prompt that produced a good design is worth keeping: the next one is
// usually a variation on it ("same rose, less shading"), and retyping it from
// memory rarely reproduces the wording that worked.

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { BrandId } from "./brands";

export type PromptEntry = {
  prompt: string;
  /** Recalling a prompt without its style would only be half the recipe. */
  style: string;
  usedAt: number;
};

/** Enough to cover a working session; beyond that the list stops being
 *  scannable and starts being an archive. */
const LIMIT = 20;

const key = (brand: BrandId) => `inkline:prompts:${brand}`;

export async function getPrompts(brand: BrandId): Promise<PromptEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(key(brand));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PromptEntry[]) : [];
  } catch {
    return [];
  }
}

async function write(brand: BrandId, entries: PromptEntry[]): Promise<PromptEntry[]> {
  try {
    await AsyncStorage.setItem(key(brand), JSON.stringify(entries));
  } catch {
    // History is a convenience — losing a write shouldn't surface as an error.
  }
  return entries;
}

/** Records a prompt, moving it to the front if it's been used before. */
export async function rememberPrompt(
  brand: BrandId,
  prompt: string,
  style: string
): Promise<PromptEntry[]> {
  const text = prompt.trim();
  if (!text) return getPrompts(brand);
  const existing = await getPrompts(brand);
  const rest = existing.filter((e) => e.prompt.toLowerCase() !== text.toLowerCase());
  return write(brand, [{ prompt: text, style, usedAt: Date.now() }, ...rest].slice(0, LIMIT));
}

export async function forgetPrompt(brand: BrandId, prompt: string): Promise<PromptEntry[]> {
  const existing = await getPrompts(brand);
  return write(
    brand,
    existing.filter((e) => e.prompt !== prompt)
  );
}

export async function clearPrompts(brand: BrandId): Promise<PromptEntry[]> {
  return write(brand, []);
}
