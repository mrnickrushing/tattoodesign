import { generateId } from "./id";
import type {
  DesignLayer,
  EditableDesignProject,
  LayerTransform,
  ShapeLayer,
  StrokeLayer,
  TextLayer,
} from "./designProject";

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function fullCanvasTransform(width: number, height: number): LayerTransform {
  return { x: 0, y: 0, width, height, rotation: 0, scaleX: 1, scaleY: 1 };
}

export function makeStrokeLayer(width: number, height: number, name = "Linework"): StrokeLayer {
  return {
    id: generateId(), kind: "stroke", name, visible: true, locked: false, opacity: 1,
    transform: fullCanvasTransform(width, height), strokes: [],
  };
}

export function makeShapeLayer(width: number, height: number, shape: ShapeLayer["shape"] = "ellipse"): ShapeLayer {
  const layerWidth = Math.max(80, width * 0.35);
  const layerHeight = Math.max(80, height * 0.35);
  return {
    id: generateId(), kind: "shape",
    name: shape === "ellipse" ? "Ellipse" : shape === "rectangle" ? "Rectangle" : "Rule",
    visible: true, locked: false, opacity: 1,
    transform: { x: (width - layerWidth) / 2, y: (height - layerHeight) / 2, width: layerWidth, height: layerHeight, rotation: 0, scaleX: 1, scaleY: 1 },
    shape, fill: null, stroke: "#111111", strokeWidth: Math.max(2, width / 320),
  };
}

export function makeTextLayer(width: number, height: number, text = "New label"): TextLayer {
  return {
    id: generateId(), kind: "text", name: "Text", visible: true, locked: false, opacity: 1,
    transform: { x: width * 0.15, y: height * 0.45, width: width * 0.7, height: height * 0.15, rotation: 0, scaleX: 1, scaleY: 1 },
    text, color: "#111111", fontSize: Math.max(24, width / 12), align: "center",
  };
}

export function snapshotProject(project: EditableDesignProject, label: string): EditableDesignProject {
  return {
    ...project,
    revision: project.revision + 1,
    snapshots: [...project.snapshots.slice(-7), { label, createdAt: Date.now(), layers: clone(project.layers), canvas: clone(project.canvas) }],
  };
}

export function restoreSnapshot(project: EditableDesignProject, index: number): EditableDesignProject {
  const snapshot = project.snapshots[index];
  if (!snapshot) return project;
  return { ...project, layers: clone(snapshot.layers), canvas: clone(snapshot.canvas), selectedLayerId: snapshot.layers.at(-1)?.id ?? null, revision: project.revision + 1 };
}

export function updateLayer(project: EditableDesignProject, id: string, updater: (layer: DesignLayer) => DesignLayer): EditableDesignProject {
  return { ...project, layers: project.layers.map((layer) => layer.id === id ? updater(clone(layer)) : layer) };
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
  return { ...project, layers, selectedLayerId: copy.id };
}

export function removeLayer(project: EditableDesignProject, id: string): EditableDesignProject {
  if (project.layers.length <= 1) return project;
  const layers = project.layers.filter((layer) => layer.id !== id);
  return { ...project, layers, selectedLayerId: layers.at(-1)?.id ?? null };
}

export function moveLayer(project: EditableDesignProject, id: string, delta: -1 | 1): EditableDesignProject {
  const index = project.layers.findIndex((layer) => layer.id === id);
  const nextIndex = Math.max(0, Math.min(project.layers.length - 1, index + delta));
  if (index < 0 || index === nextIndex) return project;
  const layers = [...project.layers];
  const [layer] = layers.splice(index, 1);
  layers.splice(nextIndex, 0, layer);
  return { ...project, layers };
}

export function addLayer(project: EditableDesignProject, layer: DesignLayer): EditableDesignProject {
  return { ...project, layers: [...project.layers, layer], selectedLayerId: layer.id };
}

export function projectToSvg(project: EditableDesignProject): string {
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
  const body = project.layers.filter((layer) => layer.visible && layer.kind !== "raster").map((layer) => {
    if (layer.kind === "raster") return "";
    const t = layer.transform;
    const transform = `translate(${t.x + t.width / 2} ${t.y + t.height / 2}) rotate(${t.rotation}) scale(${t.scaleX} ${t.scaleY}) translate(${-t.width / 2} ${-t.height / 2})`;
    if (layer.kind === "stroke") return layer.strokes.map((stroke) => {
      const d = stroke.points.map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`).join(" ");
      return `<path d="${d}" fill="none" stroke="${escape(stroke.mode === "erase" ? project.canvas.background : stroke.color)}" stroke-width="${stroke.width}" stroke-linecap="round" stroke-linejoin="round" opacity="${stroke.opacity * layer.opacity}" transform="${transform}"/>`;
    }).join("");
    if (layer.kind === "text") return `<text x="${t.width / 2}" y="${t.height / 2}" text-anchor="middle" dominant-baseline="middle" fill="${escape(layer.color)}" font-size="${layer.fontSize}" opacity="${layer.opacity}" transform="${transform}">${escape(layer.text)}</text>`;
    if (layer.shape === "ellipse") return `<ellipse cx="${t.width / 2}" cy="${t.height / 2}" rx="${t.width / 2}" ry="${t.height / 2}" fill="${layer.fill ?? "none"}" stroke="${escape(layer.stroke)}" stroke-width="${layer.strokeWidth}" opacity="${layer.opacity}" transform="${transform}"/>`;
    const tag = layer.shape === "line" ? `<line x1="0" y1="${t.height / 2}" x2="${t.width}" y2="${t.height / 2}"` : `<rect x="0" y="0" width="${t.width}" height="${t.height}"`;
    return `${tag} fill="${layer.fill ?? "none"}" stroke="${escape(layer.stroke)}" stroke-width="${layer.strokeWidth}" opacity="${layer.opacity}" transform="${transform}"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${project.canvas.width}" height="${project.canvas.height}" viewBox="0 0 ${project.canvas.width} ${project.canvas.height}">${body}</svg>`;
}
