// Talks to the same /api/generate endpoint the web app exposes (see
// ../../../src/app/api/generate/route.ts). The backend is the Next.js app
// deployed on Railway — set EXPO_PUBLIC_API_BASE_URL to point elsewhere
// (e.g. a local `next dev` for on-device testing against your machine).

import type { BrandId } from "./brands";

const DEFAULT_BASE_URL = "https://web-production-523e7.up.railway.app";

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL || DEFAULT_BASE_URL;

export type GenerateResult =
  | { ok: true; dataUrl: string }
  | { ok: false; disabled: boolean; error: string };

export async function generateDesign(
  brand: BrandId,
  prompt: string,
  style: string
): Promise<GenerateResult> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brand, prompt, style }),
    });
    const data = await res.json();

    if (res.status === 501) {
      return { ok: false, disabled: true, error: data.error as string };
    }
    if (!res.ok) {
      return { ok: false, disabled: false, error: data.error || "Something went wrong." };
    }

    return {
      ok: true,
      dataUrl: `data:${data.mimeType};base64,${data.imageBase64}`,
    };
  } catch {
    return {
      ok: false,
      disabled: false,
      error: "Couldn't reach the server. Check your connection and try again.",
    };
  }
}

/** Cheap way to surface the "not connected" state before the user types anything. */
export async function checkGeneratorAvailable(): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (res.status === 501) {
      const data = await res.json();
      return data.error as string;
    }
    return null;
  } catch {
    return null;
  }
}
