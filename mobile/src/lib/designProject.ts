import type { BrandId } from "./brands";
import type { LibraryDesign } from "./designLibrary";
import { generateId } from "./id";
import * as store from "./projectStore";
import { readAsset, writeAsset } from "./projectStore";
import * as files from "./projectFiles";
import type { OpenedProject, ProjectStore } from "./projectFiles";
import { PROJECT_SCHEMA_VERSION } from "./projectFiles";
import { readImageBase64 } from "./imageSource";
import { addLayer, fullCanvasTransform } from "./projectMutations";

export { PROJECT_SCHEMA_VERSION } from "./projectFiles";

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

/** What a restore point holds. Kept beside the manifest, not inside it. */
export type SnapshotBody = {
  layers: DesignLayer[];
  canvas: EditableDesignProject["canvas"];
  /**
   * When this restore point was taken.
   *
   * Written into the body as well as the manifest, because the body is what
   * survives the manifest. Without it, recovery has no way to tell which of
   * the files on disk is the newest and has to guess — and the first version
   * of this guessed by layer count, which is the same for every restore point
   * in a session spent drawing rather than adding layers.
   */
  createdAt: number;
};

/**
 * A restore point, as the manifest records it.
 *
 * The geometry used to sit right here, and eight restore points meant the
 * manifest carried nine copies of the drawing — measured at 22.9MB for a
 * session that had 2.5MB of actual linework in it, rewritten in full on every
 * stroke. Now the manifest keeps the label and a name, and the geometry is a
 * file of its own that is written once and never rewritten.
 *
 * It buys something beyond the size: a restore point is now a separate file,
 * so it survives the manifest being damaged and can be read back on its own.
 */
export type ProjectSnapshot = {
  label: string;
  createdAt: number;
  /** Where this restore point's geometry is stored, within the project. */
  body: string;
};

/** The shape restore points had before they moved out of the manifest. */
export type LegacySnapshot = {
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
/**
 * The real store, bound once.
 *
 * projectFiles.ts holds the decisions and takes this as an argument, because
 * the platform halves of it cannot be loaded by the test runner and the code
 * deciding whether a drawing comes back is not code to leave untested.
 */
const REAL: ProjectStore = {
  readManifest: store.readManifest,
  writeManifest: store.writeManifest,
  quarantineManifest: store.quarantineManifest,
  readText: store.readText,
  writeText: store.writeText,
  deleteText: store.deleteText,
  listNames: store.listNames,
  now: () => Date.now(),
};

export type { LoadResult, OpenedProject } from "./projectFiles";

export const readProject = (brand: BrandId, id: string) => files.readProject(REAL, brand, id);
export const saveProject = (project: EditableDesignProject) => files.saveProject(REAL, project);
export const commitSnapshot = (project: EditableDesignProject, label: string) =>
  files.commitSnapshot(REAL, project, label);
export const dropBodies = (project: EditableDesignProject, bodies: string[]) =>
  files.dropBodies(REAL, project, bodies);
export const restoreSnapshot = (project: EditableDesignProject, index: number) =>
  files.restoreSnapshot(REAL, project, index);
export const salvageLatestSnapshot = (brand: BrandId, id: string) =>
  files.salvageLatestSnapshot(REAL, brand, id);

export async function projectAssetBase64(
  brand: BrandId,
  id: string,
  asset: string
): Promise<string | null> {
  return readAsset(brand, id, asset);
}








/** The old signature, for callers that only care whether it loaded. */
export async function loadProject(brand: BrandId, id: string): Promise<EditableDesignProject | null> {
  const result = await readProject(brand, id);
  return result.kind === "ok" ? result.project : null;
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







export async function openProject(
  brand: BrandId,
  design: LibraryDesign
): Promise<OpenedProject> {
  return files.openProject(REAL, brand, design.id, { title: design.title, source: design.source }, () =>
    createProject(brand, design)
  );
}

export async function loadOrCreateProject(
  brand: BrandId,
  design: LibraryDesign
): Promise<EditableDesignProject> {
  return (await openProject(brand, design)).project;
}

async function createProject(
  brand: BrandId,
  design: LibraryDesign
): Promise<EditableDesignProject> {
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

