import { Directory, File, Paths } from "expo-file-system";
import type { BrandId } from "./brands";
import type { LibraryDesign } from "./designLibrary";
import { generateId } from "./id";
import { renderStroke } from "./ribbon";

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

export function fullCanvasTransform(width: number, height: number): LayerTransform {
  return { x: 0, y: 0, width, height, rotation: 0, scaleX: 1, scaleY: 1 };
}

export function makeStrokeLayer(width: number, height: number, name = "Linework"): StrokeLayer {
  return {
    id: generateId(),
    kind: "stroke",
    name,
    visible: true,
    locked: false,
    opacity: 1,
    transform: fullCanvasTransform(width, height),
    strokes: [],
  };
}

export function makeShapeLayer(
  width: number,
  height: number,
  shape: ShapeLayer["shape"] = "ellipse"
): ShapeLayer {
  const layerWidth = Math.max(80, width * 0.35);
  const layerHeight = Math.max(80, height * 0.35);
  return {
    id: generateId(),
    kind: "shape",
    name: shape === "ellipse" ? "Ellipse" : shape === "rectangle" ? "Rectangle" : "Rule",
    visible: true,
    locked: false,
    opacity: 1,
    transform: {
      x: (width - layerWidth) / 2,
      y: (height - layerHeight) / 2,
      width: layerWidth,
      height: layerHeight,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    },
    shape,
    fill: null,
    stroke: "#111111",
    strokeWidth: Math.max(2, width / 320),
  };
}

export function makeTextLayer(width: number, height: number, text = "New label"): TextLayer {
  return {
    id: generateId(),
    kind: "text",
    name: "Text",
    visible: true,
    locked: false,
    opacity: 1,
    transform: {
      x: width * 0.15,
      y: height * 0.45,
      width: width * 0.7,
      height: height * 0.15,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    },
    text,
    color: "#111111",
    fontSize: Math.max(24, width / 12),
    align: "center",
  };
}

function projectRoot(brand: BrandId, id: string) {
  const dir = new Directory(Paths.document, "editable-projects", brand, id);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function manifestFile(brand: BrandId, id: string) {
  return new File(projectRoot(brand, id), "project.json");
}

export function projectAssetFile(brand: BrandId, id: string, asset: string) {
  return new File(projectRoot(brand, id), asset);
}

export async function loadProject(brand: BrandId, id: string): Promise<EditableDesignProject | null> {
  try {
    const file = manifestFile(brand, id);
    if (!file.exists) return null;
    const parsed = JSON.parse(await file.text()) as EditableDesignProject;
    if (parsed.schemaVersion !== PROJECT_SCHEMA_VERSION || !Array.isArray(parsed.layers)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveProject(project: EditableDesignProject): Promise<void> {
  const file = manifestFile(project.brand, project.id);
  file.write(JSON.stringify({ ...project, updatedAt: Date.now() }));
}

export async function addRasterAsset(
  project: EditableDesignProject,
  dataUrl: string,
  name: string
): Promise<{ project: EditableDesignProject; layer: RasterLayer }> {
  const asset = `layer-${Date.now().toString(36)}-${generateId()}.png`;
  projectAssetFile(project.brand, project.id, asset).write(
    dataUrl.slice(dataUrl.indexOf(",") + 1),
    { encoding: "base64" }
  );
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

  const source = new File(design.uri);
  const asset = "source.png";
  const target = projectAssetFile(brand, design.id, asset);
  target.write(await source.bytes());
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
    const source = projectAssetFile(project.brand, project.id, layer.asset);
    const target = projectAssetFile(project.brand, nextId, layer.asset);
    if (source.exists) target.write(await source.bytes());
  }
  await saveProject(next);
  return next;
}

export function snapshotProject(project: EditableDesignProject, label: string): EditableDesignProject {
  const snapshot: ProjectSnapshot = {
    label,
    createdAt: Date.now(),
    layers: clone(project.layers),
    canvas: clone(project.canvas),
  };
  return {
    ...project,
    revision: project.revision + 1,
    updatedAt: Date.now(),
    snapshots: [...project.snapshots.slice(-7), snapshot],
  };
}

export function restoreSnapshot(project: EditableDesignProject, index: number): EditableDesignProject {
  const snapshot = project.snapshots[index];
  if (!snapshot) return project;
  return {
    ...project,
    layers: clone(snapshot.layers),
    canvas: clone(snapshot.canvas),
    selectedLayerId: snapshot.layers.at(-1)?.id ?? null,
    revision: project.revision + 1,
    updatedAt: Date.now(),
  };
}

export function updateLayer(
  project: EditableDesignProject,
  id: string,
  updater: (layer: DesignLayer) => DesignLayer
): EditableDesignProject {
  return {
    ...project,
    layers: project.layers.map((layer) => (layer.id === id ? updater(clone(layer)) : layer)),
    updatedAt: Date.now(),
  };
}

export function duplicateLayer(project: EditableDesignProject, id: string): EditableDesignProject {
  const index = project.layers.findIndex((layer) => layer.id === id);
  if (index < 0) return project;
  const copy = clone(project.layers[index]);
  copy.id = generateId();
  copy.name = `${copy.name} copy`;
  copy.transform.x += project.canvas.width * 0.03;
  copy.transform.y += project.canvas.height * 0.03;
  const layers = [...project.layers];
  layers.splice(index + 1, 0, copy);
  return { ...project, layers, selectedLayerId: copy.id, updatedAt: Date.now() };
}

export function removeLayer(project: EditableDesignProject, id: string): EditableDesignProject {
  if (project.layers.length <= 1) return project;
  const layers = project.layers.filter((layer) => layer.id !== id);
  return {
    ...project,
    layers,
    selectedLayerId: layers.at(-1)?.id ?? null,
    updatedAt: Date.now(),
  };
}

export function moveLayer(project: EditableDesignProject, id: string, delta: -1 | 1): EditableDesignProject {
  const index = project.layers.findIndex((layer) => layer.id === id);
  const nextIndex = Math.max(0, Math.min(project.layers.length - 1, index + delta));
  if (index < 0 || index === nextIndex) return project;
  const layers = [...project.layers];
  const [layer] = layers.splice(index, 1);
  layers.splice(nextIndex, 0, layer);
  return { ...project, layers, updatedAt: Date.now() };
}

export function addLayer(project: EditableDesignProject, layer: DesignLayer): EditableDesignProject {
  return {
    ...project,
    layers: [...project.layers, layer],
    selectedLayerId: layer.id,
    updatedAt: Date.now(),
  };
}

export function projectToSvg(project: EditableDesignProject): string {
  const escape = (value: string) =>
    value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
  const body = project.layers
    .filter((layer) => layer.visible && layer.kind !== "raster")
    .map((layer) => {
      if (layer.kind === "raster") return "";
      const t = layer.transform;
      const transform = `translate(${t.x + t.width / 2} ${t.y + t.height / 2}) rotate(${t.rotation}) scale(${t.scaleX} ${t.scaleY}) translate(${-t.width / 2} ${-t.height / 2})`;
      if (layer.kind === "stroke") {
        return layer.strokes
          .map((stroke) => {
            const ink = escape(stroke.mode === "erase" ? project.canvas.background : stroke.color);
            const rendered = renderStroke(stroke.points, stroke.width);
            if (!rendered.d) return "";
            const paint = rendered.fill
              ? `fill="${ink}" stroke="none"`
              : `fill="none" stroke="${ink}" stroke-width="${rendered.width}" stroke-linecap="round" stroke-linejoin="round"`;
            return `<path d="${rendered.d}" ${paint} opacity="${stroke.opacity * layer.opacity}"/>`;
          })
          .join("");
      }
      if (layer.kind === "text") {
        return `<text x="${t.width / 2}" y="${t.height / 2}" text-anchor="middle" dominant-baseline="middle" fill="${escape(layer.color)}" font-size="${layer.fontSize}" opacity="${layer.opacity}" transform="${transform}">${escape(layer.text)}</text>`;
      }
      if (layer.shape === "ellipse") {
        return `<ellipse cx="${t.width / 2}" cy="${t.height / 2}" rx="${t.width / 2}" ry="${t.height / 2}" fill="${layer.fill ?? "none"}" stroke="${escape(layer.stroke)}" stroke-width="${layer.strokeWidth}" opacity="${layer.opacity}" transform="${transform}"/>`;
      }
      const tag = layer.shape === "line" ? `<line x1="0" y1="${t.height / 2}" x2="${t.width}" y2="${t.height / 2}"` : `<rect x="0" y="0" width="${t.width}" height="${t.height}"`;
      return `${tag} fill="${layer.fill ?? "none"}" stroke="${escape(layer.stroke)}" stroke-width="${layer.strokeWidth}" opacity="${layer.opacity}" transform="${transform}"/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${project.canvas.width}" height="${project.canvas.height}" viewBox="0 0 ${project.canvas.width} ${project.canvas.height}">${body}</svg>`;
}
