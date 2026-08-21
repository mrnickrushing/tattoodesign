import test from "node:test";
import assert from "node:assert/strict";
import {
  addLayer,
  duplicateLayer,
  fullCanvasTransform,
  makeShapeLayer,
  makeStrokeLayer,
  makeTextLayer,
  moveLayer,
  projectToSvg,
  rasterLayerAssets,
  removeLayer,
  applySnapshot,
  evictedBodies,
  snapshotBody,
  snapshotProject,
  SNAPSHOT_LIMIT,
  strokePathsInCanvasSpace,
  updateLayer,
} from "./projectMutations";
import type { EditableDesignProject, StrokeLayer } from "./designProject";

function project(): EditableDesignProject {
  const base = makeStrokeLayer(1000, 800, "Base");
  return {
    schemaVersion: 2,
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
  const disk = store();
  let value = disk.save(project(), "Before move");
  const id = value.layers[0].id;
  value = updateLayer(value, id, (layer) => ({
    ...layer,
    transform: { ...layer.transform, x: 300 },
  }));
  assert.equal(value.layers[0].transform.x, 300);
  value = disk.load(value, 0)!;
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

// ---------------------------------------------------------------------------
// The invariants undo rests on.
//
// Every mutation here returns a new project rather than editing one, and the
// editor's undo stack keeps the old ones. That only holds if no two of them
// share a layer object: one in-place edit reaching a stored state rewrites
// history, and the artist's undo quietly stops going back to what they saw.
// ---------------------------------------------------------------------------

/** A project whose one layer carries geometry deep enough to alias. */
/**
 * A stand-in for the store restore points are written to.
 *
 * The pure half never touches storage — it records a name and the caller
 * writes the geometry under it — so a test needs only somewhere to put it.
 */
function store() {
  const files = new Map<string, string>();
  return {
    files,
    save(project: EditableDesignProject, label: string, at = 1) {
      const body = `snapshot-${files.size}.json`;
      files.set(body, JSON.stringify(snapshotBody(project)));
      const next = snapshotProject(project, label, body, at);
      for (const dropped of evictedBodies(project.snapshots, next.snapshots)) files.delete(dropped);
      return next;
    },
    load(project: EditableDesignProject, index: number) {
      const snapshot = project.snapshots[index];
      const raw = snapshot && files.get(snapshot.body);
      return raw ? applySnapshot(project, JSON.parse(raw)) : null;
    },
  };
}

function drawn(): EditableDesignProject {
  const value = project();
  return updateLayer(value, value.layers[0].id, (layer) => ({
    ...layer,
    strokes: [{ points: [{ x: 10, y: 10 }, { x: 20, y: 20 }], width: 3, color: "#000000", mode: "draw", opacity: 1 }],
  }));
}

const strokeXs = (value: EditableDesignProject) =>
  (value.layers[0] as StrokeLayer).strokes.flatMap((stroke) => stroke.points.map((point) => point.x));

test("an updater is handed a copy, so editing in place cannot reach the old state", () => {
  // Updaters that mutate and return the same object are the natural way to
  // write one, and the reason this function clones first.
  const before = drawn();
  const after = updateLayer(before, before.layers[0].id, (layer) => {
    (layer as StrokeLayer).strokes[0].points[0].x = 999;
    return layer;
  });

  assert.deepEqual(strokeXs(after), [999, 20]);
  assert.deepEqual(strokeXs(before), [10, 20], "the edit reached back into the project it started from");
});

/**
 * Edits a project's geometry in place, the way a caller holding a reference to
 * a layer does.
 *
 * Deliberately not through `updateLayer`, which clones on the way in: routing
 * an aliasing test through it proves only that *it* copies, and a snapshot
 * sharing its geometry with the live project sails through. The editor
 * shallow-spreads layers in several places, which keeps the nested strokes
 * shared — so this is the shape the aliasing really takes.
 */
function poke(value: EditableDesignProject, x: number): void {
  (value.layers[0] as StrokeLayer).strokes[0].points[0].x = x;
}

test("a snapshot is a copy of the geometry, not a view onto it", () => {
  // Serialising to the store is what makes the copy now, rather than a deep
  // clone in memory — so the claim is the same and the mechanism is not.
  const disk = store();
  const value = disk.save(drawn(), "Before");
  poke(value, 999);
  assert.deepEqual(strokeXs(value), [999, 20]);
  assert.deepEqual(strokeXs(disk.load(value, 0)!), [10, 20], "the snapshot moved with the edit");
});

test("restoring hands back a copy, so a snapshot survives being restored twice", () => {
  const disk = store();
  const value = disk.save(drawn(), "Before");
  const first = disk.load(value, 0)!;
  poke(first, -1);
  assert.deepEqual(strokeXs(disk.load(value, 0)!), [10, 20], "restoring twice gave different answers");
});

test("a duplicate shares nothing with what it was copied from", () => {
  const before = drawn();
  const value = duplicateLayer(before, before.layers[0].id);
  const copy = value.layers[1] as StrokeLayer;

  assert.notEqual(copy.id, value.layers[0].id, "the copy kept the original's id");
  copy.strokes[0].points[0].x = 999;
  assert.deepEqual(strokeXs(value), [10, 20], "editing the copy moved the original");
});

test("a duplicate sits directly above its original and offset from it", () => {
  // Above, because that is where the eye looks for it; offset, because a copy
  // exactly on top of the original is indistinguishable from nothing happening.
  let value = project();
  value = addLayer(value, makeShapeLayer(1000, 800, "ellipse"));
  const target = value.layers[0];
  value = duplicateLayer(value, target.id);

  assert.deepEqual(value.layers.map((layer) => layer.name), ["Base", "Base copy", "Ellipse"]);
  assert.equal(value.layers[1].transform.x, target.transform.x + 1000 * 0.03);
  assert.equal(value.layers[1].transform.y, target.transform.y + 800 * 0.03);
});

test("version history keeps the last eight restore points", () => {
  const disk = store();
  let value = project();
  for (let i = 1; i <= 12; i++) value = disk.save(value, `Edit ${i}`, i);

  assert.equal(value.snapshots.length, SNAPSHOT_LIMIT);
  assert.equal(value.snapshots.length, 8);
  assert.deepEqual(
    value.snapshots.map((snapshot) => snapshot.label),
    ["Edit 5", "Edit 6", "Edit 7", "Edit 8", "Edit 9", "Edit 10", "Edit 11", "Edit 12"],
    "the oldest went first, in order"
  );
  assert.equal(value.revision, 13, "twelve edits off revision 1");
});

test("restoring a snapshot that is not there gives nothing back", () => {
  // The history panel indexes into this list, and a stale index has to be
  // survivable rather than clearing the canvas.
  const disk = store();
  const value = disk.save(project(), "Only one");
  for (const index of [-1, 1, 99, Number.NaN]) {
    assert.equal(disk.load(value, index), null, `index ${index} came back with something`);
  }
});

test("a layer cannot be moved off either end of the stack", () => {
  let value = project();
  value = addLayer(value, makeShapeLayer(1000, 800, "ellipse"));
  const order = value.layers.map((layer) => layer.id);

  assert.deepEqual(moveLayer(value, order[0], -1).layers.map((l) => l.id), order, "the bottom layer moved below itself");
  assert.deepEqual(moveLayer(value, order[1], 1).layers.map((l) => l.id), order, "the top layer moved above itself");
  assert.deepEqual(moveLayer(value, "no-such-layer", 1).layers.map((l) => l.id), order, "an unknown id reordered the stack");
});

test("the last layer cannot be deleted", () => {
  // A project with no layers has nothing to draw on and no way back to one.
  const value = project();
  assert.equal(removeLayer(value, value.layers[0].id), value);
});

test("what a mutation does not touch, it leaves identical", () => {
  // Every one of these returns a fresh object, and anything it did not set has
  // to come through untouched — a mutation that quietly resets the canvas size
  // or the title is a data-loss bug wearing a spread operator.
  const before = drawn();
  const shape = makeShapeLayer(1000, 800, "ellipse");
  const cases: [string, EditableDesignProject][] = [
    ["addLayer", addLayer(before, shape)],
    ["removeLayer", removeLayer(addLayer(before, shape), shape.id)],
    ["moveLayer", moveLayer(addLayer(before, shape), shape.id, -1)],
    ["duplicateLayer", duplicateLayer(before, before.layers[0].id)],
    ["updateLayer", updateLayer(before, before.layers[0].id, (layer) => layer)],
    ["snapshotProject", snapshotProject(before, "x", "snapshot-x.json", 1)],
  ];
  for (const [name, after] of cases) {
    assert.notEqual(after, before, `${name} returned the same object`);
    for (const key of ["schemaVersion", "id", "brand", "title", "source", "canvas", "createdAt"] as const) {
      assert.deepEqual(after[key], before[key], `${name} changed ${key}`);
    }
  }
});

test("a text layer arrives ready to type into", () => {
  const layer = makeTextLayer(1000, 800, "Placement note");
  assert.equal(layer.kind, "text");
  assert.equal(layer.text, "Placement note");
  assert.equal(layer.visible, true);
  assert.ok(layer.fontSize > 0, `font size came out ${layer.fontSize}`);
  // Inside the canvas, or it opens off-screen with no handle to drag.
  assert.ok(layer.transform.x >= 0 && layer.transform.x + layer.transform.width <= 1000);
  assert.ok(layer.transform.y >= 0 && layer.transform.y + layer.transform.height <= 800);
});
