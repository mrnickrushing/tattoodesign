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
  rasterLayerAssets,
  removeLayer,
  restoreSnapshot,
  snapshotProject,
  strokePathsInCanvasSpace,
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

function withRaster(): EditableDesignProject {
  const value = project();
  return addLayer(value, {
    id: "raster",
    kind: "raster",
    name: "Traced photo",
    visible: true,
    locked: false,
    opacity: 0.8,
    transform: { ...fullCanvasTransform(1000, 800), x: 40, y: 20, rotation: 15 },
    asset: "layer-abc.png",
  });
}

test("SVG export embeds raster layers when their pixels are supplied", () => {
  const svg = projectToSvg(withRaster(), { "layer-abc.png": "data:image/png;base64,AAAA" });
  assert.match(svg, /<image /);
  assert.match(svg, /href="data:image\/png;base64,AAAA"/);
  assert.match(svg, /opacity="0\.8"/);
  assert.match(svg, /transform="translate\(540 420\) rotate\(15\)/);
});

test("a raster layer with no supplied pixels is skipped, not emitted broken", () => {
  const svg = projectToSvg(withRaster());
  assert.doesNotMatch(svg, /<image/);
  assert.match(svg, /<svg/);
});

test("hidden layers stay out of the export regardless of kind", () => {
  let value = withRaster();
  value = updateLayer(value, "raster", (layer) => ({ ...layer, visible: false }));
  const svg = projectToSvg(value, { "layer-abc.png": "data:image/png;base64,AAAA" });
  assert.doesNotMatch(svg, /<image/);
});

test("rasterLayerAssets lists what a complete export needs", () => {
  assert.deepEqual(rasterLayerAssets(withRaster()), ["layer-abc.png"]);
  assert.deepEqual(rasterLayerAssets(project()), []);
});

test("stroke paths flatten into canvas coordinates", () => {
  let value = project();
  const layer = makeStrokeLayer(1000, 800, "Lines");
  layer.transform = { ...layer.transform, x: 100, y: 50, scaleX: 2, scaleY: 2 };
  layer.strokes = [
    { points: [{ x: 500, y: 400 }, { x: 600, y: 400 }], width: 3, color: "#111111", mode: "draw", opacity: 1 },
  ];
  value = addLayer(value, layer);
  const paths = strokePathsInCanvasSpace(value);
  assert.equal(paths.length, 1);
  // The layer centre (500,400) maps to the transform origin (x + w/2, y + h/2).
  // The 3px line width is doubled along with the geometry, so blowout analysis
  // sees the thickness that will actually print.
  assert.deepEqual(paths[0][0], { x: 600, y: 450, w: 6 });
  // 100px right of centre, doubled by the layer scale.
  assert.deepEqual(paths[0][1], { x: 800, y: 450, w: 6 });
});

test("erase strokes and hidden layers are left out of canvas paths", () => {
  let value = project();
  const layer = makeStrokeLayer(1000, 800, "Lines");
  layer.strokes = [
    { points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], width: 3, color: "#111111", mode: "erase", opacity: 1 },
    { points: [{ x: 0, y: 0 }], width: 3, color: "#111111", mode: "draw", opacity: 1 },
    { points: [{ x: 0, y: 0 }, { x: 20, y: 20 }], width: 3, color: "#111111", mode: "draw", opacity: 1 },
  ];
  value = addLayer(value, layer);
  assert.equal(strokePathsInCanvasSpace(value).length, 1, "erase and single-point strokes are skipped");

  value = updateLayer(value, layer.id, (item) => ({ ...item, visible: false }));
  assert.equal(strokePathsInCanvasSpace(value).length, 0);
});

test("rotating a stroke layer rotates its canvas geometry", () => {
  let value = project();
  const layer = makeStrokeLayer(1000, 800, "Lines");
  layer.transform = { ...layer.transform, rotation: 90 };
  layer.strokes = [
    { points: [{ x: 600, y: 400 }, { x: 700, y: 400 }], width: 3, color: "#111111", mode: "draw", opacity: 1 },
  ];
  value = addLayer(value, layer);
  const [path] = strokePathsInCanvasSpace(value);
  // 100px right of centre becomes 100px below it under a quarter turn.
  assert.ok(Math.abs(path[0].x - 500) < 1e-6);
  assert.ok(Math.abs(path[0].y - 500) < 1e-6);
});
