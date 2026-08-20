// Running a sync.
//
// syncPlan.ts decides what should move; this moves it. Kept apart because the
// decisions are the part worth testing and the transfers are the part that
// needs a network.
//
// Deliberately manual rather than continuous. Two people, occasional edits,
// and a design library where a surprising background write is far worse than
// pressing a button — so it happens when asked, reports exactly what it did,
// and never runs while something is being edited.

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { BrandId } from "./brands";
import { API_BASE_URL } from "./api";
import {
  addToLibrary,
  changedAt,
  getLibraryWithTombstones,
  removeFromLibrary,
  type LibraryDesign,
} from "./designLibrary";
import { readImageDataUrl } from "./imageSource";
import { hashImage, planSync, type SyncRecord } from "./syncPlan";

const TOKEN_KEY = "inkline:sync-token";

export async function getSyncToken(): Promise<string> {
  try {
    return (await AsyncStorage.getItem(TOKEN_KEY)) ?? "";
  } catch {
    return "";
  }
}

export async function setSyncToken(token: string): Promise<void> {
  const trimmed = token.trim();
  if (trimmed) await AsyncStorage.setItem(TOKEN_KEY, trimmed);
  else await AsyncStorage.removeItem(TOKEN_KEY);
}

type RemoteDesign = {
  id: string;
  title: string;
  source: LibraryDesign["source"];
  createdAt: number;
  updatedAt: number;
  width: number | null;
  height: number | null;
  tags: string[];
  favorite: boolean;
  deleted: boolean;
  imageHash: string;
};

async function request(token: string, path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${API_BASE_URL}/api/library${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });
  if (response.status === 401) {
    throw new Error("That sync key wasn't accepted. Check it in Settings.");
  }
  if (!response.ok && response.status !== 409) {
    throw new Error(
      response.status === 503
        ? "The shared library isn't reachable right now."
        : `The shared library returned ${response.status}.`
    );
  }
  return response;
}

export type SyncResult = {
  pushed: number;
  pulled: number;
  removedHere: number;
  removedThere: number;
  unchanged: number;
};

/**
 * Brings this device and the shared library into agreement.
 *
 * Every step is ordered so that an interruption leaves the library smaller-but-
 * correct rather than corrupted: images are fetched before their metadata is
 * committed, and a failed action stops that design rather than the whole run.
 */
export async function syncLibrary(
  brand: BrandId,
  onProgress?: (done: number, total: number) => void
): Promise<SyncResult> {
  const token = await getSyncToken();
  if (!token) throw new Error("Add a sync key in Settings first.");

  const local = await getLibraryWithTombstones(brand);
  const localById = new Map(local.map((design) => [design.id, design]));

  // Hashes are computed from the bytes on demand: a tombstone has no image,
  // and a design written before sync existed has no stored hash.
  const localRecords: SyncRecord[] = [];
  for (const design of local) {
    let imageHash = design.imageHash ?? "";
    if (!imageHash && !design.deleted && design.uri) {
      try {
        imageHash = hashImage(await readImageDataUrl(design.uri));
      } catch {
        // An unreadable image still has metadata worth syncing; leaving the
        // hash empty just means the pixels get re-sent once.
      }
    }
    localRecords.push({ id: design.id, updatedAt: changedAt(design), imageHash, deleted: design.deleted });
  }

  const manifest = (await (await request(token, `?brand=${brand}`)).json()) as {
    designs: RemoteDesign[];
  };
  const remoteById = new Map(manifest.designs.map((design) => [design.id, design]));

  const plan = planSync(
    localRecords,
    manifest.designs.map((d) => ({
      id: d.id,
      updatedAt: d.updatedAt,
      imageHash: d.imageHash,
      deleted: d.deleted,
    }))
  );

  const result: SyncResult = {
    pushed: 0,
    pulled: 0,
    removedHere: 0,
    removedThere: 0,
    unchanged: plan.unchanged,
  };

  let done = 0;
  for (const action of plan.actions) {
    try {
      if (action.kind === "push" || action.kind === "deleteRemote") {
        const design = localById.get(action.id);
        if (!design) continue;
        const withImage = action.kind === "push" && action.withImage && !!design.uri;
        await request(token, "", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            brand,
            design: {
              id: design.id,
              title: design.title,
              source: design.source,
              createdAt: design.createdAt,
              updatedAt: changedAt(design),
              width: design.width ?? null,
              height: design.height ?? null,
              tags: design.tags ?? [],
              favorite: design.favorite ?? false,
              deleted: !!design.deleted,
              imageHash: design.imageHash ?? "",
              imageBase64: withImage
                ? (await readImageDataUrl(design.uri)).split(",")[1]
                : undefined,
            },
          }),
        });
        if (action.kind === "push") result.pushed++;
        else result.removedThere++;
      } else if (action.kind === "pull") {
        const remote = remoteById.get(action.id);
        if (!remote) continue;
        const response = await request(token, `?brand=${brand}&id=${remote.id}&image=1`);
        const blob = await response.arrayBuffer();
        const bytes = new Uint8Array(blob);
        let binary = "";
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        // addToLibrary writes the pixels and the metadata together, which is
        // what makes a half-finished pull leave nothing behind.
        await addToLibrary(brand, {
          dataUrl: `data:image/png;base64,${btoa(binary)}`,
          title: remote.title,
          source: remote.source,
        });
        result.pulled++;
      } else {
        await removeFromLibrary(brand, action.id);
        result.removedHere++;
      }
    } catch (error) {
      // One design failing is not a reason to abandon the rest; the next run
      // picks it up because nothing about its state was changed.
      console.error(`[sync] ${action.kind} failed for ${action.id}`, error);
    }
    done++;
    onProgress?.(done, plan.actions.length);
  }

  return result;
}
