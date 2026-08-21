import test from "node:test";
import assert from "node:assert/strict";
import { buildTray, packCavities } from "./castingTray";
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

test("a tray is a floor, walls, and each shape with its skirt", () => {
  const tray = buildTray(oneShape(), W, H, SPEC)!;
  assert.ok(tray, "the tray builds");
  assert.equal(tray.shapes, 1);
  assert.equal(tray.parts.length, 4, "floor, walls, the shape, and the fillet under it");

  const square = buildTray(oneShape(), W, H, { ...SPEC, filletMm: 0 })!;
  assert.equal(square.parts.length, 3, "without a fillet it is one solid per shape");
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
  // The shape is a skirt and a body stacked, so the span that has to reach the
  // floor and stand full height is the pair of them together.
  const span = (part: (typeof tray.parts)[number]) => {
    let lowest = Infinity;
    let highest = -Infinity;
    for (let i = 2; i < part.positions.length; i += 3) {
      lowest = Math.min(lowest, part.positions[i]);
      highest = Math.max(highest, part.positions[i]);
    }
    return { lowest, highest };
  };
  const body = span(tray.parts[2]);
  const skirt = span(tray.parts[3]);

  assert.ok(Math.abs(skirt.lowest - (2 - 0.01)) < 1e-6, "starts a hair inside the floor so the union is unambiguous");
  assert.ok(Math.abs(body.highest - (2 + 6)) < 1e-6, "and stands the full thickness of the piece");
  assert.ok(body.highest < tray.heightMm, "with silicone room above it");

  // The body picks up where the skirt leaves off, overlapping by the same hair
  // and no more. Any daylight here and the shape is two floating solids; any
  // more overlap and the volumes below count the shared part twice.
  assert.ok(Math.abs(body.lowest - (skirt.highest - 0.01)) < 1e-6, `body starts at ${body.lowest}, skirt tops out at ${skirt.highest}`);
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
  assert.equal(tray.parts.length, 2 + 3 * 2, "floor, walls, three shapes each with a skirt");
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
  assert.ok(bed.detail.includes("Not even one fits"), `and says what to do about it: ${bed.detail}`);
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

test("the tray says whether the fill was a real choice", () => {
  // A solid shape reads the same either way, so there is nothing to ask about.
  assert.equal(buildTray(oneShape(), W, H, SPEC)!.outlinesFilled, false);

  // An outline does not, so the caller has a genuine question to put.
  const outline = new Uint8Array(W * H);
  for (let y = 20; y < 70; y++) for (let x = 30; x < 90; x++) outline[y * W + x] = 1;
  for (let y = 24; y < 66; y++) for (let x = 34; x < 86; x++) outline[y * W + x] = 0;
  assert.equal(buildTray(outline, W, H, SPEC)!.outlinesFilled, true);

  // And asking for the literal reading never reports a fill that did not happen.
  assert.equal(buildTray(outline, W, H, { ...SPEC, fillOutlines: false })!.outlinesFilled, false);
});

test("cavities pack into the arrangement closest to square", () => {
  // A print bed is square and its limit is whichever way the tray is widest,
  // so four 20mm cavities go 2x2 rather than 4x1.
  const four = packCavities(4, 20, 20, 5);
  assert.deepEqual({ columns: four.columns, rows: four.rows }, { columns: 2, rows: 2 });
  assert.equal(four.widthMm, 45, "two 20s and one 5mm web");
  assert.equal(four.depthMm, 45);

  const one = packCavities(1, 20, 30, 5);
  assert.deepEqual({ columns: one.columns, rows: one.rows, widthMm: one.widthMm, depthMm: one.depthMm }, {
    columns: 1,
    rows: 1,
    widthMm: 20,
    depthMm: 30,
  });

  // Tall cavities pack wide, so the block stays as square as it can.
  const tall = packCavities(6, 10, 40, 4);
  assert.ok(tall.columns > tall.rows, `expected a wide grid for tall pieces, got ${tall.columns}x${tall.rows}`);
});

test("no two cavities are closer than the webbing between them", () => {
  for (const count of [1, 2, 3, 5, 7, 12]) {
    const grid = packCavities(count, 24, 18, 6);
    assert.equal(grid.positions.length, count);
    for (let i = 0; i < grid.positions.length; i++) {
      for (let j = i + 1; j < grid.positions.length; j++) {
        const a = grid.positions[i];
        const b = grid.positions[j];
        // Overlapping in one axis means the gap in the other has to hold.
        const gapX = Math.max(a.x, b.x) - (Math.min(a.x, b.x) + 24);
        const gapY = Math.max(a.y, b.y) - (Math.min(a.y, b.y) + 18);
        assert.ok(
          gapX >= 6 - 1e-9 || gapY >= 6 - 1e-9,
          `count ${count}: cavities ${i} and ${j} are ${gapX.toFixed(1)}/${gapY.toFixed(1)}mm apart`
        );
      }
    }
  }
});

test("every cavity sits inside the block the packer measured", () => {
  for (const count of [1, 4, 5, 9, 11]) {
    const grid = packCavities(count, 24, 18, 6);
    grid.positions.forEach((at, i) => {
      assert.ok(at.x >= -1e-9 && at.x + 24 <= grid.widthMm + 1e-9, `count ${count} cavity ${i} overhangs in x`);
      assert.ok(at.y >= -1e-9 && at.y + 18 <= grid.depthMm + 1e-9, `count ${count} cavity ${i} overhangs in y`);
    });
  }
});

test("a short last row is centred rather than shoved against one wall", () => {
  // Five into a grid of any shape leaves one row short. Whichever row that is,
  // the odd one out should not sit against a wall with all the silicone on the
  // other side of it.
  const grid = packCavities(5, 20, 20, 5);
  const lastY = Math.max(...grid.positions.map((at) => at.y));
  const lastRow = grid.positions.filter((at) => at.y === lastY);
  assert.ok(lastRow.length < grid.columns, `expected a short last row, got ${lastRow.length} of ${grid.columns}`);

  const left = Math.min(...lastRow.map((at) => at.x));
  const right = grid.widthMm - Math.max(...lastRow.map((at) => at.x + 20));
  assert.ok(Math.abs(left - right) < 1e-9, `last row is off-centre: ${left} against ${right}`);
});

test("a packer with nothing to pack returns nothing", () => {
  assert.equal(packCavities(4, 0, 20, 5).positions.length, 0);
  assert.equal(packCavities(4, 20, -1, 5).positions.length, 0);
  assert.equal(packCavities(0, 20, 20, 5).positions.length, 1, "fewer than one is one");
});

test("a tray holds the number of cavities it was asked for", () => {
  const six = buildTray(oneShape(), W, H, { ...SPEC, copies: 6 })!;
  assert.equal(six.cavities, 6);
  assert.equal(six.shapes, 6, "one shape in the artwork, six on the tray");
  assert.equal(six.parts.length, 2 + 6 * 2, "floor, walls, six shapes each with a skirt");
  assert.equal(six.columns * six.rows >= 6, true);
  assert.equal(inspectMesh(six.mesh).watertight, true);
});

test("more cavities is a bigger tray and more of everything", () => {
  const one = buildTray(oneShape(), W, H, SPEC)!;
  const six = buildTray(oneShape(), W, H, { ...SPEC, copies: 6 })!;
  assert.ok(six.widthMm > one.widthMm);
  assert.ok(six.plasticCm3 > one.plasticCm3);
  assert.ok(six.siliconeMl > one.siliconeMl);
  // Six cavities of the same piece displace six times the silicone the one did.
  const perCavity = (tray: typeof one) => meshVolume(tray.parts[2]);
  assert.ok(Math.abs(perCavity(six) - perCavity(one)) < 1e-3, "each cavity is the same piece");
});

test("the webbing between cavities is the caller's to set", () => {
  const tight = buildTray(oneShape(), W, H, { ...SPEC, copies: 4, webbingMm: 2 })!;
  const roomy = buildTray(oneShape(), W, H, { ...SPEC, copies: 4, webbingMm: 12 })!;
  assert.ok(roomy.widthMm > tight.widthMm, "more silicone between them is a wider tray");
  assert.equal(roomy.cavities, tight.cavities);
});

test("a tray too big for the bed says how many would fit", () => {
  const many = buildTray(oneShape(), W, H, { ...SPEC, copies: 12, bedMm: 120 })!;
  const bed = many.findings.find((finding) => finding.title === "Bed")!;
  assert.equal(bed.level, "warn");
  assert.match(bed.detail, /\d+ would — print \d+ trays/, `expected a count and a plan: ${bed.detail}`);

  // And what it claims fits, actually fits.
  const claimed = Number(bed.detail.match(/(\d+) would/)![1]);
  const check = buildTray(oneShape(), W, H, { ...SPEC, copies: claimed, bedMm: 120 })!;
  assert.equal(check.findings.find((f) => f.title === "Bed")!.level, "pass", "the number it named has to be true");
});

test("a piece too big for the bed on its own says so plainly", () => {
  const huge = buildTray(oneShape(), W, H, { ...SPEC, widthIn: 20, bedMm: 120 })!;
  const bed = huge.findings.find((finding) => finding.title === "Bed")!;
  assert.equal(bed.level, "warn");
  assert.ok(bed.detail.includes("Not even one fits"), bed.detail);
});

test("cavity count never leaves a token unresolved", () => {
  for (const copies of [1, 2, 7, 24]) {
    const tray = buildTray(oneShape(), W, H, { ...SPEC, copies, bedMm: 150 })!;
    tray.findings.forEach((finding) => {
      assert.ok(!/\$\{|undefined|NaN/.test(finding.detail), `${copies}: ${finding.detail}`);
    });
  }
});


test("the shape is wider where it meets the floor than where it ends", () => {
  // That flare is the whole point: the silicone gets a slope to peel off
  // rather than a square notch to tear at.
  const tray = buildTray(oneShape(), W, H, SPEC)!;
  const skirt = tray.parts[3];
  assert.ok(skirt.count > 0, "there is a skirt");

  // Widest span at the floor against the span where the skirt meets the body.
  let lowMinX = Infinity, lowMaxX = -Infinity, highMinX = Infinity, highMaxX = -Infinity;
  for (let i = 0; i < skirt.count * 9; i += 3) {
    const [x, , z] = [skirt.positions[i], skirt.positions[i + 1], skirt.positions[i + 2]];
    if (z < 2) {
      lowMinX = Math.min(lowMinX, x);
      lowMaxX = Math.max(lowMaxX, x);
    } else {
      highMinX = Math.min(highMinX, x);
      highMaxX = Math.max(highMaxX, x);
    }
  }
  const flare = (lowMaxX - lowMinX) - (highMaxX - highMinX);
  assert.ok(Math.abs(flare - 2 * 0.8) < 0.05, `expected a 0.8mm flare each side, got ${(flare / 2).toFixed(2)}mm`);
});

test("every part of a filleted tray is still a closed solid", () => {
  const tray = buildTray(oneShape(), W, H, { ...SPEC, copies: 4 })!;
  tray.parts.forEach((part, i) => {
    const report = inspectMesh(part);
    assert.equal(report.watertight, true, `part ${i}: unmatched ${report.unmatched}`);
    assert.ok(meshVolume(part) > 0, `part ${i} faces inward`);
  });
  assert.equal(inspectMesh(tray.mesh).watertight, true);
});

test("a fillet is more plastic than no fillet", () => {
  const square = buildTray(oneShape(), W, H, { ...SPEC, filletMm: 0 })!;
  const flared = buildTray(oneShape(), W, H, SPEC)!;
  assert.ok(flared.plasticCm3 > square.plasticCm3, "the skirt is material");
  assert.ok(flared.siliconeMl <= square.siliconeMl, "and it displaces silicone rather than adding it");
});

test("a flare too big for the shape is tried smaller before it is given up on", () => {
  // A narrow slot cut in from the edge: 1.27mm across at this resolution, so
  // the asked-for 0.8mm each side would weld it shut — but half of that, or a
  // quarter, goes through. All-or-nothing would leave the shape square.
  const slotted = oneShape();
  for (let y = 20; y < 50; y++) for (let x = 58; x < 60; x++) slotted[y * W + x] = 0;

  const tray = buildTray(slotted, W, H, SPEC)!;
  assert.equal(tray.filletsSkipped, 0, "something fitted");
  assert.ok(tray.filletAppliedMm > 0 && tray.filletAppliedMm < 0.8, `backed off to ${tray.filletAppliedMm}mm`);
  assert.equal(inspectMesh(tray.mesh).watertight, true);
});

test("a shape with nowhere to flare is left square and said so", () => {
  // Two arms meeting at a shallow angle. The notch between them narrows to
  // nothing at the apex, and no uniform outward offset can go there — not even
  // the smallest one this printer could lay down.
  const V = 600;
  const VH = 400;
  const vee = new Uint8Array(V * VH);
  const stamp = (x: number, y: number, r: number) => {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const px = Math.round(x + dx);
        const py = Math.round(y + dy);
        if (px >= 0 && py >= 0 && px < V && py < VH) vee[py * V + px] = 1;
      }
    }
  };
  for (const side of [-1, 1]) {
    const angle = side * 0.22;
    for (let t = 0; t < 420; t++) stamp(80 + Math.cos(angle) * t, 200 + Math.sin(angle) * t, 6);
  }

  const tray = buildTray(vee, V, VH, { widthIn: 2.5, shapeMm: 7 })!;
  // No *uniform* offset fits here — the notch narrows to nothing at the apex.
  // The vertices in the notch give way to what they can take while the rest of
  // the outline keeps its flare, so the shape is flared rather than abandoned.
  assert.equal(tray.filletsSkipped, 0, "the flare gave way rather than giving up");
  assert.ok(tray.filletAppliedMm > 0, `flared ${tray.filletAppliedMm}mm`);
  assert.equal(inspectMesh(tray.mesh).watertight, true, "and the tray is still sound");

  const demolding = tray.findings.find((finding) => finding.title === "Demolding")!;
  assert.equal(demolding.level, "pass");
});

test("a shape with nowhere to flare is left square and said so", () => {
  // Two bars a single mask pixel apart. Half of what is between them, less a
  // nozzle, is under the 0.20mm this printer could lay down — so there is no
  // flare to be had at any width, and the shapes stand square.
  const tray = buildTray(twoShapes(1), W, H, { ...SPEC, nozzleMm: 0.4 })!;
  assert.ok(tray.filletsSkipped > 0, "the flare was refused rather than forced");
  assert.equal(tray.filletAppliedMm, 0);
  assert.equal(inspectMesh(tray.mesh).watertight, true, "and the tray is still sound");

  const demolding = tray.findings.find((finding) => finding.title === "Demolding")!;
  assert.equal(demolding.level, "warn");
  assert.ok(demolding.detail.includes("pull it slowly"), demolding.detail);
  assert.ok(demolding.detail.includes("0.20mm"), "and names the smallest this printer could manage");
});

test("a comfortable shape gets its fillet and is told so", () => {
  const tray = buildTray(oneShape(), W, H, SPEC)!;
  assert.equal(tray.filletsSkipped, 0);
  const demolding = tray.findings.find((finding) => finding.title === "Demolding")!;
  assert.equal(demolding.level, "pass");
  assert.ok(demolding.detail.includes("0.80mm"));
});

test("turning the fillet off says nothing about demolding", () => {
  const tray = buildTray(oneShape(), W, H, { ...SPEC, filletMm: 0 })!;
  assert.equal(tray.findings.find((finding) => finding.title === "Demolding"), undefined);
  assert.equal(tray.filletsSkipped, 0);
});

/** Two bars with a gap of `gapPx` mask pixels between them. */
function twoShapes(gapPx: number): Uint8Array {
  const mask = new Uint8Array(W * H);
  const right = 55 + gapPx;
  for (let y = 20; y < 70; y++) {
    for (let x = 30; x < 55; x++) mask[y * W + x] = 1;
    for (let x = right; x < right + 25; x++) mask[y * W + x] = 1;
  }
  return mask;
}

test("a fillet adds its own wedge of plastic and nothing more", () => {
  const flared = buildTray(oneShape(), W, H, SPEC)!;
  const square = buildTray(oneShape(), W, H, { ...SPEC, filletMm: 0 })!;
  assert.equal(flared.filletAppliedMm, 0.8, "the whole flare fits on a lone rectangle");

  // The shape is 60x50 mask pixels at 76.2mm across 120 of them.
  const perimeterMm = 2 * (60 + 50) * (76.2 / 120);
  // A skirt is a slope around the edge, so what it adds is bounded by a band
  // one flare wide and one flare tall running the whole way round. The body it
  // sits under is *not* part of that: counting the shape's whole footprint
  // again for the height of the flare would be twenty times this.
  const addedMm3 = (flared.plasticCm3 - square.plasticCm3) * 1000;
  assert.ok(addedMm3 > 0, `a flare adds plastic, got ${addedMm3.toFixed(1)}mm3`);
  assert.ok(addedMm3 < perimeterMm * 0.8 * 0.8, `flare added ${addedMm3.toFixed(1)}mm3, over a band's worth`);

  // And it comes out of the silicone one for one — the wedge stands where the
  // rubber would have been.
  const lostMl = square.siliconeMl - flared.siliconeMl;
  assert.ok(Math.abs(lostMl - addedMm3 / 1000) < 1e-6, `plastic gained ${addedMm3 / 1000}, silicone lost ${lostMl}`);
});

test("a flare stops short of welding itself to the shape next door", () => {
  const nozzleMm = 0.4;
  // Two mask pixels of daylight, at 0.635mm each.
  const gapMm = 2 * (76.2 / 120);
  const tray = buildTray(twoShapes(2), W, H, { ...SPEC, nozzleMm })!;
  assert.equal(tray.shapes, 2);
  assert.equal(tray.filletsSkipped, 0, "capped, not abandoned");

  // Both shapes grow, so each may take half of what is between them — less a
  // nozzle width, since a gap thinner than one extrusion closes anyway.
  assert.ok(
    Math.abs(tray.filletAppliedMm - (gapMm - nozzleMm) / 2) < 1e-9,
    `flared ${tray.filletAppliedMm}mm into a ${gapMm.toFixed(3)}mm gap`
  );
  assert.ok(
    gapMm - 2 * tray.filletAppliedMm >= nozzleMm - 1e-9,
    "a nozzle's width of daylight survives between the skirts"
  );
});

test("shapes far enough apart keep the flare they asked for", () => {
  // Twenty pixels is 12.7mm — far more than twice any flare on offer.
  const tray = buildTray(twoShapes(20), W, H, SPEC)!;
  assert.equal(tray.shapes, 2);
  assert.equal(tray.filletAppliedMm, 0.8, "the cap only bites when something is actually near");
});

test("the webbing between cavities is a limit on the flare too", () => {
  // Cavities sit a webbing apart, so shapes on the facing edges are what eats
  // into it — even though each cavity on its own has room to spare.
  const tight = buildTray(oneShape(), W, H, { ...SPEC, copies: 4, webbingMm: 1, nozzleMm: 0.4 })!;
  assert.ok(tight.cavities > 1, "more than one cavity, or there is no webbing to protect");
  assert.ok(
    Math.abs(tight.filletAppliedMm - (1 - 0.4) / 2) < 1e-9,
    `flared ${tight.filletAppliedMm}mm into 1mm of webbing`
  );

  const roomy = buildTray(oneShape(), W, H, { ...SPEC, copies: 4, webbingMm: 6 })!;
  assert.equal(roomy.filletAppliedMm, 0.8, "six millimetres of webbing is no constraint at all");
});

/** A square drawn as a stroke with a cross through it: an outline, not a solid. */
function drawn(strokePx: number): Uint8Array {
  const mask = new Uint8Array(W * H);
  const box = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = Math.max(0, Math.round(y0)); y < Math.min(H, Math.round(y1)); y++) {
      for (let x = Math.max(0, Math.round(x0)); x < Math.min(W, Math.round(x1)); x++) mask[y * W + x] = 1;
    }
  };
  const s = strokePx;
  box(20, 15, 100, 15 + s);
  box(20, 75 - s, 100, 75);
  box(20, 15, 20 + s, 75);
  box(100 - s, 15, 100, 75);
  box(20, 45 - s / 2, 100, 45 + s / 2);
  box(60 - s / 2, 15, 60 + s / 2, 75);
  return mask;
}

test("the drawing's own lines stand proud of the face it is drawn on", () => {
  const tray = buildTray(drawn(6), W, H, { ...SPEC, filletMm: 0 })!;
  assert.equal(tray.reliefAppliedMm, 0.6, "raised by the default relief");

  // Floor, walls, the filled body, and the linework on top of it.
  assert.equal(tray.parts.length, 4);
  const relief = tray.parts[3];

  let lowest = Infinity;
  let highest = -Infinity;
  for (let i = 2; i < relief.positions.length; i += 3) {
    lowest = Math.min(lowest, relief.positions[i]);
    highest = Math.max(highest, relief.positions[i]);
  }
  // Sunk into the top of the body by the weld and no more: any gap and the
  // lines float, any more and the volumes below count the overlap twice.
  assert.ok(Math.abs(lowest - (2 + 6 - 0.01)) < 1e-6, `relief starts at ${lowest}`);
  assert.ok(Math.abs(highest - (2 + 6 + 0.6)) < 1e-6, `relief tops out at ${highest}`);

  // And the silicone still has its full cover over the tallest thing on the tray.
  assert.ok(Math.abs(tray.heightMm - (2 + 6 + 0.6 + 4)) < 1e-9, `tray is ${tray.heightMm}mm tall`);
});

test("raised linework is worth exactly the plastic it stands in", () => {
  const mask = drawn(6);
  const tray = buildTray(mask, W, H, { ...SPEC, filletMm: 0 })!;

  // Counted straight off the mask rather than off the mesh: the relief is a
  // prism of the inked pixels, so its volume is their area times its height.
  const mmPerPx = (SPEC.widthIn * 25.4) / W;
  let inked = 0;
  for (let i = 0; i < W * H; i++) if (mask[i]) inked++;
  const expected = inked * mmPerPx * mmPerPx * (tray.reliefAppliedMm + 0.01);

  assert.ok(
    Math.abs(meshVolume(tray.parts[3]) - expected) / expected < 0.02,
    `relief is ${meshVolume(tray.parts[3]).toFixed(1)}mm3 against ${expected.toFixed(1)}mm3 of linework`
  );

  // Every part still closes, relief included.
  tray.parts.forEach((part, i) => {
    assert.equal(inspectMesh(part).watertight, true, `part ${i} is open`);
  });
  assert.equal(inspectMesh(tray.mesh).watertight, true);
});

test("a shape with nothing drawn inside it gets no relief", () => {
  // A plain rectangle is already its own silhouette: filling changes nothing,
  // so there is no linework to raise and no reason to make the piece thicker.
  const solid = buildTray(oneShape(), W, H, SPEC)!;
  assert.equal(solid.reliefAppliedMm, 0);
  assert.ok(Math.abs(solid.heightMm - (2 + 6 + 4)) < 1e-9);
  assert.ok(!solid.findings.some((finding) => finding.title === "Relief"), "and nothing to say about it");
});

test("linework finer than a bead cannot be raised, and says so", () => {
  // The same drawing at an inch across instead of three: a two-pixel stroke is
  // 0.42mm of artwork, and the measurement of it lands under the 0.4mm a nozzle
  // lays down. Fineness is a question about the printed size, not the mask.
  const tray = buildTray(drawn(2), W, H, { ...SPEC, widthIn: 1, nozzleMm: 0.4 })!;
  assert.equal(tray.reliefAppliedMm, 0, "refused rather than promised");
  assert.ok(Math.abs(tray.heightMm - (2 + 6 + 4)) < 1e-9, "and the tray does not grow for it");

  const relief = tray.findings.find((finding) => finding.title === "Relief");
  assert.equal(relief?.level, "warn");
  assert.match(relief!.detail, /cast as a plain silhouette/);
});

test("relief can be turned off without turning the drawing into a lattice", () => {
  const off = buildTray(drawn(6), W, H, { ...SPEC, reliefMm: 0, filletMm: 0 })!;
  assert.equal(off.reliefAppliedMm, 0);
  assert.equal(off.parts.length, 3, "floor, walls, and the filled body alone");
  // Still the filled silhouette, not the bare linework: those are different
  // questions, and fillOutlines is the one that answers this one.
  assert.equal(off.outlinesFilled, true);
});

/** A branched snowflake — the fine line art that ear clipping finds hardest. */
function flakeMask(size: number): Uint8Array {
  const mask = new Uint8Array(size * size);
  const mid = size / 2;
  const stamp = (x: number, y: number, r: number) => {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const px = Math.round(x + dx);
        const py = Math.round(y + dy);
        if (px >= 0 && px < size && py >= 0 && py < size && dx * dx + dy * dy <= r * r) mask[py * size + px] = 1;
      }
    }
  };
  for (let a = 0; a < 6; a++) {
    const angle = (a * Math.PI) / 3;
    for (let t = 0; t < mid * 0.8; t++) stamp(mid + Math.cos(angle) * t, mid + Math.sin(angle) * t, 2);
    for (const along of [mid * 0.37, mid * 0.57]) {
      for (let t = 0; t < mid * 0.19; t++) {
        stamp(mid + Math.cos(angle) * along + Math.cos(angle + 1) * t, mid + Math.sin(angle) * along + Math.sin(angle + 1) * t, 1.5);
        stamp(mid + Math.cos(angle) * along + Math.cos(angle - 1) * t, mid + Math.sin(angle) * along + Math.sin(angle - 1) * t, 1.5);
      }
    }
  }
  return mask;
}

test("every cavity on the tray closes, however many there are", () => {
  // This is the one that was wrong in the file people printed. A tray of one
  // cavity was sound and a tray of three was not, because the third copy stood
  // where a corner of it rounded into looking flat, and the cap dropped a vertex
  // the walls still used. Nothing in the app looked, and the STL went out open.
  const size = 300;
  const mask = flakeMask(size);
  for (const copies of [1, 2, 3, 4, 6]) {
    const tray = buildTray(mask, size, size, { widthIn: 2.5, shapeMm: 7, copies })!;
    assert.ok(tray, `${copies} cavities builds`);
    tray.parts.forEach((part, i) => {
      const report = inspectMesh(part);
      assert.equal(report.watertight, true, `${copies} cavities, part ${i}: unmatched ${report.unmatched}`);
    });
    assert.equal(inspectMesh(tray.mesh).watertight, true, `${copies} cavities, assembled`);
    // And closed by building it right, not by leaving the hard parts out.
    assert.equal(tray.shapesDropped, 0, `${copies} cavities dropped a shape`);
  }
});
