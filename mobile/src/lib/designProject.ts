import type { BrandId } from "./brands";
import type { LibraryDesign } from "./designLibrary";
import { generateId } from "./id";
import { readAsset, readManifest, writeAsset, writeManifest } from "./projectStore";
import { readImageBase64 } from "./imageSource";
import { addLayer, fullCanvasTransform } from "./projectMutations";

export const PROJECT_SCHEMA_VERSION = 1;

export type Point = {
  x: number;
  y: number;
  /**
   * Width of the mark at this point, in layer units. Written by the pen
   * pipeline from pressure, tilt and speed; absent on points that came from
   * anywhere else (traced masks, imported paths, generated geometry), which
   * fall back to the stroke's nominal width. See lib/penInput.ts.
   */
  w?: number;
};

export type LayerTransform = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
};

type LayerBase = {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  transform: LayerTransform;
};

export type RasterLayer = LayerBase & {
  kind: "raster";
  asset: string;
};

export type Stroke = {
  points: Point[];
  width: number;
  color: string;
  mode: "draw" | "erase";
  opacity: number;
};

export type StrokeLayer = LayerBase & {
  kind: "stroke";
  strokes: Stroke[];
};

export type ShapeLayer = LayerBase & {
  kind: "shape";
  shape: "rectangle" | "ellipse" | "line";
  fill: string | null;
  stroke: string;
  strokeWidth: number;
};

export type TextLayer = LayerBase & {
  kind: "text";
  text: string;
  color: string;
  fontSize: number;
  align: "left" | "center" | "right";
};

export type DesignLayer = RasterLayer | StrokeLayer | ShapeLayer | TextLayer;

export type ProjectSnapshot = {
  label: string;
  createdAt: number;
  layers: DesignLayer[];
  canvas: EditableDesignProject["canvas"];
};

export type EditableDesignProject = {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  id: string;
  brand: BrandId;
  title: string;
  source: LibraryDesign["source"];
  canvas: {
    width: number;
    height: number;
    background: string;
    transparent: boolean;
  };
  layers: DesignLayer[];
  selectedLayerId: string | null;
  createdAt: number;
  updatedAt: number;
  revision: number;
  snapshots: ProjectSnapshot[];
};

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Base64 for one of a project's layer images, or null if it is missing. */
export async function projectAssetBase64(
  brand: BrandId,
  id: string,
  asset: string
): Promise<string | null> {
  return readAsset(brand, id, asset);
}

export async function loadProject(brand: BrandId, id: string): Promise<EditableDesignProject | null> {
  try {
    const raw = await readManifest(brand, id);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EditableDesignProject;
    if (parsed.schemaVersion !== PROJECT_SCHEMA_VERSION || !Array.isArray(parsed.layers)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Writing is the one place `updatedAt` is set.
 *
 * The layer helpers in projectMutations.ts deliberately leave it alone: a
 * mutation is not a save, and plenty of edits never reach disk. This file used
 * to carry its own copies of those helpers that stamped it on every call, and
 * ten of the twelve had quietly drifted from the live ones by the time they
 * were removed — nothing outside this file had imported them in a long while.
 * Layer construction and mutation live in projectMutations.ts; this file
 * loads, saves and clones. Neither half wants a second copy of the other.
 */
export async function saveProject(project: EditableDesignProject): Promise<void> {
  await writeManifest(project.brand, project.id, JSON.stringify({ ...project, updatedAt: Date.now() }));
}

export async function addRasterAsset(
  project: EditableDesignProject,
  dataUrl: string,
  name: string
): Promise<{ project: EditableDesignProject; layer: RasterLayer }> {
  const asset = `layer-${Date.now().toString(36)}-${generateId()}.png`;
  await writeAsset(project.brand, project.id, asset, dataUrl.slice(dataUrl.indexOf(",") + 1));
  const layer: RasterLayer = {
    id: generateId(),
    kind: "raster",
    name,
    visible: true,
    locked: false,
    opacity: 1,
    asset,
    transform: fullCanvasTransform(project.canvas.width, project.canvas.height),
  };
  return { project: addLayer(project, layer), layer };
}

export async function loadOrCreateProject(
  brand: BrandId,
  design: LibraryDesign
): Promise<EditableDesignProject> {
  const stored = await loadProject(brand, design.id);
  if (stored) return stored;

  // The design's own bytes, whatever kind of reference it arrived as — a
  // file:// path on a phone, a blob: URL in a browser, or already inline.
  const asset = "source.png";
  await writeAsset(brand, design.id, asset, await readImageBase64(design.uri));
  const width = Math.max(1, design.width ?? 1024);
  const height = Math.max(1, design.height ?? 1024);
  const now = Date.now();
  const base: RasterLayer = {
    id: generateId(),
    kind: "raster",
    name: "Original",
    visible: true,
    locked: false,
    opacity: 1,
    asset,
    transform: fullCanvasTransform(width, height),
  };
  const project: EditableDesignProject = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: design.id,
    brand,
    title: design.title,
    source: design.source,
    canvas: { width, height, background: "#ffffff", transparent: false },
    layers: [base],
    selectedLayerId: base.id,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    snapshots: [],
  };
  await saveProject(project);
  return project;
}

export async function cloneProject(
  project: EditableDesignProject,
  nextId: string,
  nextTitle: string
): Promise<EditableDesignProject> {
  const next = clone(project);
  next.id = nextId;
  next.title = nextTitle;
  next.createdAt = Date.now();
  next.updatedAt = next.createdAt;
  next.revision = 1;
  next.snapshots = [];
  for (const layer of next.layers) {
    if (layer.kind !== "raster") continue;
    const bytes = await readAsset(project.brand, project.id, layer.asset);
    if (bytes) await writeAsset(project.brand, nextId, layer.asset, bytes);
  }
  await saveProject(next);
  return next;
}

