// Getting work between two phones without a backend.
//
// Two people use this app, usually in the same room. A design or a whole
// sheet exports as one .inkline file — a JSON envelope carrying the artwork
// as base64 — that AirDrops across and imports on the other side with tags
// intact. No accounts, no server, no sync conflicts: a file either arrives or
// it doesn't.
//
// Pure encode/decode/validate. Junk-tolerant by contract: decodeHandoff never
// throws — a bad file produces a named error the screen can show.

import type { BrandId } from "./brands";
import type { LibraryDesign } from "./designLibrary";
import type { SavedSheet, SavedSheetItem } from "./sheetLibrary";

export const HANDOFF_FORMAT = "inkline-handoff";
export const HANDOFF_VERSION = 1;
export const HANDOFF_EXTENSION = ".inkline";

export type DesignPayload = {
  title: string;
  source: LibraryDesign["source"];
  tags: string[];
  favorite: boolean;
  width?: number;
  height?: number;
  /** Bare base64 PNG bytes. */
  png: string;
};

export type SheetItemPayload = Omit<SavedSheetItem, "uri" | "designId"> & {
  /** Key into the envelope's designs map. */
  designKey: string | null;
};

export type SheetPayload = {
  name: string;
  templateId: string;
  items: SheetItemPayload[];
  /** Every design the sheet references, keyed by fingerprint. */
  designs: Record<string, DesignPayload>;
};

export type HandoffEnvelope =
  | { format: typeof HANDOFF_FORMAT; version: number; brand: BrandId; kind: "design"; payload: DesignPayload }
  | { format: typeof HANDOFF_FORMAT; version: number; brand: BrandId; kind: "sheet"; payload: SheetPayload };

export type DecodeResult =
  | { ok: true; envelope: HandoffEnvelope }
  | { ok: false; error: string };

/**
 * Content fingerprint over the PNG base64 (djb2, hex). Import compares
 * fingerprints against the existing library so re-importing the same file —
 * or both people importing the same handoff — doesn't double designs up.
 */
export function contentFingerprint(base64: string): string {
  let hash = 5381;
  for (let index = 0; index < base64.length; index++) {
    hash = ((hash << 5) + hash + base64.charCodeAt(index)) >>> 0;
  }
  return `${hash.toString(16)}-${base64.length.toString(16)}`;
}

export function designPayload(design: Pick<LibraryDesign, "title" | "source" | "tags" | "favorite" | "width" | "height">, pngBase64: string): DesignPayload {
  return {
    title: design.title,
    source: design.source,
    tags: design.tags ?? [],
    favorite: design.favorite ?? false,
    width: design.width,
    height: design.height,
    png: pngBase64,
  };
}

export function encodeDesignHandoff(brand: BrandId, payload: DesignPayload): string {
  const envelope: HandoffEnvelope = { format: HANDOFF_FORMAT, version: HANDOFF_VERSION, brand, kind: "design", payload };
  return JSON.stringify(envelope);
}

/**
 * A sheet travels with every design it references, so it arrives whole even
 * on a phone that has none of them. Items point at designs by fingerprint;
 * the importer re-points them at whatever library ids the designs land under.
 */
export function encodeSheetHandoff(
  brand: BrandId,
  sheet: Pick<SavedSheet, "name" | "templateId" | "items">,
  designPngByDesignId: Record<string, DesignPayload>
): string {
  const keyByDesignId = new Map<string, string>();
  const designs: Record<string, DesignPayload> = {};
  for (const [designId, payload] of Object.entries(designPngByDesignId)) {
    const key = contentFingerprint(payload.png);
    keyByDesignId.set(designId, key);
    designs[key] = payload;
  }
  const items: SheetItemPayload[] = sheet.items.map(({ uri: _uri, designId, ...rest }) => ({
    ...rest,
    designKey: designId ? (keyByDesignId.get(designId) ?? null) : null,
  }));
  const envelope: HandoffEnvelope = {
    format: HANDOFF_FORMAT,
    version: HANDOFF_VERSION,
    brand,
    kind: "sheet",
    payload: { name: sheet.name, templateId: sheet.templateId, items, designs },
  };
  return JSON.stringify(envelope);
}

const SOURCES = new Set(["generated", "converted", "uploaded"]);

function validDesignPayload(value: unknown): value is DesignPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.title === "string" &&
    SOURCES.has(payload.source as string) &&
    Array.isArray(payload.tags) &&
    payload.tags.every((tag) => typeof tag === "string") &&
    typeof payload.favorite === "boolean" &&
    typeof payload.png === "string" &&
    payload.png.length > 0
  );
}

function validSheetItem(value: unknown): value is SheetItemPayload {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    [item.xIn, item.yIn, item.wIn, item.hIn, item.rotation].every(
      (field) => typeof field === "number" && Number.isFinite(field)
    ) &&
    typeof item.mirrored === "boolean" &&
    (item.designKey === null || typeof item.designKey === "string")
  );
}

export function decodeHandoff(raw: string): DecodeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "That file isn't an Inkline handoff." };
  }
  if (!parsed || typeof parsed !== "object") return { ok: false, error: "That file isn't an Inkline handoff." };
  const envelope = parsed as Record<string, unknown>;
  if (envelope.format !== HANDOFF_FORMAT) return { ok: false, error: "That file isn't an Inkline handoff." };
  if (typeof envelope.version !== "number" || envelope.version > HANDOFF_VERSION) {
    return { ok: false, error: "This handoff was made by a newer Inkline. Update the app and try again." };
  }
  if (envelope.brand !== "ink" && envelope.brand !== "sugar") {
    return { ok: false, error: "This handoff names an unknown studio." };
  }

  if (envelope.kind === "design") {
    if (!validDesignPayload(envelope.payload)) return { ok: false, error: "The design in this handoff is incomplete." };
    return { ok: true, envelope: envelope as unknown as HandoffEnvelope };
  }

  if (envelope.kind === "sheet") {
    const payload = envelope.payload as Record<string, unknown> | null;
    if (
      !payload ||
      typeof payload.name !== "string" ||
      typeof payload.templateId !== "string" ||
      !Array.isArray(payload.items) ||
      !payload.items.every(validSheetItem) ||
      !payload.designs ||
      typeof payload.designs !== "object" ||
      !Object.values(payload.designs).every(validDesignPayload)
    ) {
      return { ok: false, error: "The sheet in this handoff is incomplete." };
    }
    // Every referenced design must travel with the sheet.
    const designs = payload.designs as Record<string, DesignPayload>;
    for (const item of payload.items as SheetItemPayload[]) {
      if (item.designKey && !designs[item.designKey]) {
        return { ok: false, error: "The sheet references artwork this handoff doesn't carry." };
      }
    }
    return { ok: true, envelope: envelope as unknown as HandoffEnvelope };
  }

  return { ok: false, error: "That file isn't an Inkline handoff." };
}

/** Safe filename for the exported handoff. */
export function handoffFilename(title: string): string {
  const slug = title.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "inkline";
  return `${slug}${HANDOFF_EXTENSION}`;
}
