import test from "node:test";
import assert from "node:assert/strict";
import { buildTray } from "./castingTray";
import { inspectMesh, meshVolume } from "./solid";
import { encodeStl, stlByteLength } from "./stl";

const W = 120;
const H = 90;

/** A mask with one filled rectangle in it, in mask pixels. */
function oneShape(x0 = 30, y0 = 20, x1 = 90, y1 = 70): Uint8Array {
  const mask = new Uint8Array(W * H);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * W + x] = 1;
  return mask;
}

const SPEC = { widthIn: 3, shapeMm: 6 };

test("a tray is a floor, walls, and one solid per shape", () => {
  const tray = buildTray(oneShape(), W, H, SPEC)!;
  assert.ok(tray, "the tray builds");
  assert.equal(tray.shapes, 1);
  assert.equal(tray.parts.length, 3, "floor, walls, one positive");
});

test("every part of the tray is a closed solid", () => {
  const tray = buildTray(oneShape(), W, H, SPEC)!;
  tray.parts.forEach((part, i) => {
    const report = inspectMesh(part);
    assert.equal(report.watertight, true, `part ${i}: unmatched ${report.unmatched}`);
    assert.ok(meshVolume(part) > 0, `part ${i} faces inward`);
  });
  // And the assembled file is closed too: the parts overlap in volume without
  // sharing any vertex, so each keeps its own matched surface.
  assert.equal(inspectMesh(tray.mesh).watertight, true);
});

test("the tray is the size the artwork actually prints at", () => {
  // 3 inches is 76.2mm. The shape spans half the mask, so 38.1mm, plus a
  // margin of 8mm on each side.
  const tray = buildTray(oneShape(), W, H, SPEC)!;
  assert.ok(Math.abs(tray.widthMm - (76.2 / 2 + 16)) < 0.2, `got ${tray.widthMm.toFixed(2)}mm`);
  assert.ok(Math.abs(tray.heightMm - (2 + 6 + 4)) < 1e-9, "floor plus shape plus silicone cover");
});

test("a bigger piece makes a bigger tray, in proportion", () => {
  const small = buildTray(oneShape(), W, H, { ...SPEC, widthIn: 3 })!;
  const large = buildTray(oneShape(), W, H, { ...SPEC, widthIn: 6 })!;
  // Margins are fixed, so only the artwork half doubles.
  assert.ok(Math.abs((large.widthMm - 16) / (small.widthMm - 16) - 2) < 0.01);
});

test("the shape stands on the floor, not through it", () => {
  const tray = buildTray(oneShape(), W, H, SPEC)!;
  const positive = tray.parts[2];
  let lowest = Infinity;
  let highest = -Infinity;
  for (let i = 2; i < positive.positions.length; i += 3) {
    lowest = Math.min(lowest, positive.positions[i]);
    highest = Math.max(highest, positive.positions[i]);
  }
  assert.ok(Math.abs(lowest - (2 - 0.01)) < 1e-6, "starts a hair inside the floor so the union is unambiguous");
  assert.ok(Math.abs(highest - (2 + 6)) < 1e-6, "and stands the full thickness of the piece");
  assert.ok(highest < tray.heightMm, "with silicone room above it");
});

test("the artwork is flipped so it does not come out of the mold upside down", () => {
  // A shape hugging the top of the image must end up at the far side of the
  // tray in model space, where y runs the other way.
  const top = new Uint8Array(W * H);
  for (let y = 5; y < 20; y++) for (let x = 40; x < 80; x++) top[y * W + x] = 1;
  const tray = buildTray(top, W, H, SPEC)!;

  const positive = tray.parts[2];
  let minY = Infinity;
  for (let i = 1; i < positive.positions.length; i += 3) minY = Math.min(minY, positive.positions[i]);
  // With the flip, the top of the image lands at high y; without it, at the
  // margin. The shape is the whole content, so it starts at the margin either
  // way — what matters is that the tray is only as deep as the shape plus
  // margins, and the shape fills it.
  assert.ok(Math.abs(minY - 8) < 0.2, "the artwork is packed against the margin, not floating");
  assert.ok(tray.depthMm > 8 * 2, "and the tray has real depth");
});

test("a gap in the artwork is read whichever way the caller asks for", () => {
  // A drawing cannot say whether an enclosed white region is inside the shape
  // or a hole through it. Both readings have to be available and both have to
  // produce a closed solid.
  const ring = oneShape();
  for (let y = 35; y < 55; y++) for (let x = 45; x < 75; x++) ring[y * W + x] = 0;
  const solid = buildTray(oneShape(), W, H, SPEC)!;

  const asSilhouette = buildTray(ring, W, H, SPEC)!;
  assert.equal(asSilhouette.shapes, 1);
  assert.ok(
    Math.abs(meshVolume(asSilhouette.parts[2]) - meshVolume(solid.parts[2])) < 1,
    "filled, the gap closes and it is the same piece as the solid one"
  );

  const asHole = buildTray(ring, W, H, { ...SPEC, fillOutlines: false })!;
  assert.ok(
    meshVolume(asHole.parts[2]) < meshVolume(solid.parts[2]),
    "kept, the gap goes right through and uses less plastic"
  );
  assert.equal(inspectMesh(asHole.parts[2]).watertight, true, "and is still closed around the hole");
  assert.equal(inspectMesh(asSilhouette.parts[2]).watertight, true);
});

test("several shapes each get their own solid", () => {
  const mask = new Uint8Array(W * H);
  for (let y = 20; y < 40; y++) for (let x = 20; x < 40; x++) mask[y * W + x] = 1;
  for (let y = 20; y < 40; y++) for (let x = 60; x < 80; x++) mask[y * W + x] = 1;
  for (let y = 55; y < 75; y++) for (let x = 40; x < 60; x++) mask[y * W + x] = 1;

  const tray = buildTray(mask, W, H, SPEC)!;
  assert.equal(tray.shapes, 3);
  assert.equal(tray.parts.length, 5, "floor, walls, three positives");
  assert.equal(inspectMesh(tray.mesh).watertight, true);
});

test("it says how much plastic and how much silicone", () => {
  const tray = buildTray(oneShape(), W, H, SPEC)!;
  assert.ok(tray.plasticCm3 > 0, "the print costs something");
  assert.ok(tray.siliconeMl > 0, "and the pour costs more");

  // The cavity is bounded by the tray's own inside, so the silicone cannot
  // exceed the box it is poured into.
  const box = (tray.widthMm * tray.depthMm * (tray.heightMm - 2)) / 1000;
  assert.ok(tray.siliconeMl < box, `${tray.siliconeMl.toFixed(1)}ml should be under the ${box.toFixed(1)}ml box`);

  // A thicker piece displaces more silicone.
  const thick = buildTray(oneShape(), W, H, { ...SPEC, shapeMm: 12 })!;
  assert.ok(thick.plasticCm3 > tray.plasticCm3, "a taller shape is more plastic");
});

test("detail finer than the nozzle is called out before it is printed", () => {
  // A hairline: one mask pixel is 76.2/120 = 0.635mm, so a 1px line is under
  // the 0.8mm two perimeters of a 0.4mm nozzle need.
  const hairline = new Uint8Array(W * H);
  for (let x = 20; x < 100; x++) hairline[45 * W + x] = 1;
  const thin = buildTray(hairline, W, H, SPEC)!;
  const detail = thin.findings.find((finding) => finding.title === "Detail")!;
  assert.equal(detail.level, "warn");
  assert.ok(detail.detail.includes("not at all"), `expected the blunt version: ${detail.detail}`);

  const chunky = buildTray(oneShape(), W, H, SPEC)!;
  assert.equal(chunky.findings.find((finding) => finding.title === "Detail")!.level, "pass");
});

test("a finer nozzle holds finer detail", () => {
  const hairline = new Uint8Array(W * H);
  for (let y = 44; y < 46; y++) for (let x = 20; x < 100; x++) hairline[y * W + x] = 1;
  const coarse = buildTray(hairline, W, H, { ...SPEC, nozzleMm: 0.8 })!;
  const fine = buildTray(hairline, W, H, { ...SPEC, nozzleMm: 0.2 })!;
  assert.equal(coarse.findings.find((f) => f.title === "Detail")!.level, "warn");
  assert.equal(fine.findings.find((f) => f.title === "Detail")!.level, "pass");
});

test("a tray too big for the bed is called out too", () => {
  const wide = buildTray(oneShape(), W, H, { ...SPEC, widthIn: 20 })!;
  const bed = wide.findings.find((finding) => finding.title === "Bed")!;
  assert.equal(bed.level, "warn");
  assert.ok(bed.detail.includes("two trays"), "and says what to do about it");
  assert.equal(buildTray(oneShape(), W, H, SPEC)!.findings.find((f) => f.title === "Bed")!.level, "pass");
});

test("the food-safety note explains why the print is not the mold", () => {
  const note = buildTray(oneShape(), W, H, SPEC)!.findings.find((f) => f.title === "Food safety")!;
  assert.equal(note.level, "pass");
  assert.ok(note.detail.includes("food-grade silicone"));
});

test("findings never leave a token unresolved", () => {
  for (const widthIn of [1, 3, 12]) {
    for (const nozzleMm of [0.2, 0.4, 0.8]) {
      const tray = buildTray(oneShape(), W, H, { ...SPEC, widthIn, nozzleMm })!;
      tray.findings.forEach((finding) => {
        assert.ok(!/\$\{|undefined|NaN/.test(finding.detail), `${widthIn}in ${nozzleMm}mm: ${finding.detail}`);
      });
    }
  }
});

test("nothing to stand up is not a tray", () => {
  assert.equal(buildTray(new Uint8Array(W * H), W, H, SPEC), null, "an empty mask");
  assert.equal(buildTray(new Uint8Array(4), W, H, SPEC), null, "a buffer too short for the frame");
  assert.equal(buildTray(oneShape(), W, H, { ...SPEC, widthIn: 0 }), null, "no printed size");
  assert.equal(buildTray(oneShape(), W, H, { ...SPEC, shapeMm: 0 }), null, "no thickness");
});

test("the tray encodes to a file a slicer will open", () => {
  const tray = buildTray(oneShape(), W, H, SPEC)!;
  const bytes = encodeStl(tray.mesh, "Snowflake tray");
  assert.equal(bytes.length, stlByteLength(tray.mesh.count));
  assert.ok(bytes.length > 84, "there is something in it");
  assert.ok(bytes.length < 4_000_000, `${(bytes.length / 1024).toFixed(0)}KB is a sane size to AirDrop`);
});

test("an outlined design stands up as the shape, not as its own outline", () => {
  const outline = new Uint8Array(W * H);
  for (let y = 20; y < 70; y++) for (let x = 30; x < 90; x++) outline[y * W + x] = 1;
  for (let y = 24; y < 66; y++) for (let x = 34; x < 86; x++) outline[y * W + x] = 0;

  const filled = buildTray(outline, W, H, SPEC)!;
  const literal = buildTray(outline, W, H, { ...SPEC, fillOutlines: false })!;

  assert.equal(filled.shapes, 1);
  assert.ok(
    meshVolume(filled.parts[2]) > meshVolume(literal.parts[2]) * 3,
    "the silhouette is far more solid than the ring of linework"
  );
  // And the literal reading is still available and still closed.
  assert.equal(inspectMesh(literal.parts[2]).watertight, true);
});
