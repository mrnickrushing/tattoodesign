import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ImageProvider, ImageQuality } from "./api";

const USAGE_KEY = "inkline:ai-usage:v1";
const LIMIT_KEY = "inkline:ai-spend-limit:v1";

export type GenerationUsage = {
  id: string;
  provider: ImageProvider;
  quality: ImageQuality;
  estimatedCost: number;
  createdAt: number;
};

export const DEFAULT_SPEND_LIMIT = 10;

function monthStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
}

export async function getGenerationUsage(): Promise<GenerationUsage[]> {
  try {
    const raw = await AsyncStorage.getItem(USAGE_KEY);
    const rows = raw ? (JSON.parse(raw) as GenerationUsage[]) : [];
    return Array.isArray(rows) ? rows.filter((row) => row.createdAt >= monthStart()) : [];
  } catch {
    return [];
  }
}

export async function recordGeneration(entry: Omit<GenerationUsage, "id" | "createdAt">) {
  const rows = await getGenerationUsage();
  const next = [{ ...entry, id: `${Date.now()}`, createdAt: Date.now() }, ...rows].slice(0, 100);
  await AsyncStorage.setItem(USAGE_KEY, JSON.stringify(next));
  return next;
}

export async function getSpendLimit(): Promise<number> {
  const raw = await AsyncStorage.getItem(LIMIT_KEY);
  const value = raw ? Number(raw) : DEFAULT_SPEND_LIMIT;
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_SPEND_LIMIT;
}

export async function setSpendLimit(value: number) {
  await AsyncStorage.setItem(LIMIT_KEY, String(Math.max(0, value)));
}

export function totalEstimatedSpend(rows: GenerationUsage[]) {
  return rows.reduce((sum, row) => sum + row.estimatedCost, 0);
}
