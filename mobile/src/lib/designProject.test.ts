import test from "node:test";
import assert from "node:assert/strict";
import {
  addLayer,
  duplicateLayer,
  fullCanvasTransform,
  makeShapeLayer,
  makeStrokeLayer,
  moveLayer,
  projectToSvg,
  removeLayer,
  restoreSnapshot,
  snapshotProject,
  updateLayer,
} from "./projectMutations";
import type { EditableDesignProject } from "./designProject";

function project(): EditableDesignProject {
  const base = makeStrokeLayer(1000, 800, "Base");
  return {
    schemaVersion: 1,
    id: "design-1",
    brand: "ink",
    title: "Rose",
    source: "generated",
    canvas: { width: 1000, height: 800, background: "#ffffff", transparent: false },
    layers: [base],
    selectedLayerId: base.id,
    createdAt: 1,
    updatedAt: 1,
    revision: 1,
    snapshots: [],
  };
}

test("layer mutations preserve a usable selection", () => {
  let value = project();
  const shape = makeShapeLayer(1000, 800, "ellipse");
  value = addLayer(value, shape);
  assert.equal(value.selectedLayerId, shape.id);
  value = duplicateLayer(value, shape.id);
  assert.equal(value.layers.length, 3);
  assert.match(value.layers[2].name, /copy/);
  value = moveLayer(value, value.layers[2].id, -1);
  assert.equal(value.layers[1].name.endsWith("copy"), true);
  value = removeLayer(value, value.layers[1].id);
  assert.equal(value.layers.length, 2);
});

test("snapshots restore prior editable geometry", () => {
  let value = project();
  value = snapshotProject(value, "Before move");
  const id = value.layers[0].id;
  value = updateLayer(value, id, (layer) => ({
    ...layer,
    transform: { ...layer.transform, x: 300 },
  }));
  assert.equal(value.layers[0].transform.x, 300);
  value = restoreSnapshot(value, 0);
  assert.equal(value.layers[0].transform.x, 0);
});

test("SVG export escapes text and emits vector layers", () => {
  let value = project();
  value = addLayer(value, {
    id: "text",
    kind: "text",
    name: "Label",
    visible: true,
    locked: false,
    opacity: 1,
    transform: fullCanvasTransform(500, 100),
    text: "Rose & dagger",
    color: "#111111",
    fontSize: 42,
    align: "center",
  });
  const svg = projectToSvg(value);
  assert.match(svg, /Rose &amp; dagger/);
  assert.match(svg, /<text/);
  assert.match(svg, /<svg/);
});

test("SVG export preserves stroke-layer transforms", () => {
  const value = project();
  const stroke = value.layers[0];
  if (stroke.kind !== "stroke") throw new Error("Test project must start with a stroke layer.");
  stroke.transform = {
    ...stroke.transform,
    x: 120,
    y: 80,
    rotation: 30,
    scaleX: 1.5,
    scaleY: 0.75,
  };
  stroke.strokes = [{
    points: [{ x: 100, y: 120 }, { x: 200, y: 220 }],
    width: 4,
    color: "#111111",
    mode: "draw",
    opacity: 1,
  }];

  const svg = projectToSvg(value);

  assert.match(svg, /<path[^>]+transform="translate\(620 480\) rotate\(30\) scale\(1.5 0.75\) translate\(-500 -400\)"/);
});
