import test from "node:test";
import assert from "node:assert/strict";
import { buildSphereMold, type MoldHalf } from "./sphereMold";
import { inspectMesh, meshVolume } from "./solid";

const W = 96;
const H = 96;

/** A design covering the middle of the drawing, so it lands on the dome. */
function star(): Uint8Array {
  const mask = new Uint8Array(W * H);
  for (let a = 0; a < 5; a++) {
    const angle = (a * 2 * Math.PI) / 5 - Math.PI / 2;
    for (let t = 0; t < 34; t++) {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const x = Math.round(W / 2 + Math.cos(angle) * t + dx);
          const y = Math.round(H / 2 + Math.sin(angle) * t + dy);
          if (x >= 0 && x < W && y >= 0 && y < H && dx * dx + dy * dy <= 4) mask[y * W + x] = 1;
        }
      }
    }
  }
  return mask;
}

const CAKEPOP = { diameterIn: 1.5, stick: true } as const;

/** Dome centres, taken off the mesh rather than trusted from the spec. */
function domeCentres(half: MoldHalf): { x: number; y: number }[] {
  return half.parts
    .filter((part) => part.count > 2000)
    .map((part) => {
      let x = 0;
      let y = 0;
      for (let i = 0; i < part.count * 3; i++) {
        x += part.positions[i * 3];
        y += part.positions[i * 3 + 1];
      }
      return { x: x / (part.count * 3), y: y / (part.count * 3) };
    })
    .sort((a, b) => a.x - b.x || a.y - b.y);
}

test("both halves of the mold are closed solids", () => {
  const mold = buildSphereMold(star(), W, H, { ...CAKEPOP, copies: 4 })!;
  assert.ok(mold, "the mold builds");
  assert.equal(mold.shapesDropped, 0, "nothing was left out");

  for (const [name, half] of [["designed", mold.designed], ["plain", mold.plain]] as const) {
    half.parts.forEach((part, i) => {
      const report = inspectMesh(part);
      assert.equal(report.watertight, true, `${name} part ${i}: unmatched ${report.unmatched}`);
      assert.ok(meshVolume(part) > 0, `${name} part ${i} faces inward`);
    });
    assert.equal(inspectMesh(half.mesh).watertight, true, `${name}, assembled`);
  }
});

test("the two halves land on each other when one is turned over", () => {
  // The whole reason the second tray is mirrored. Turning a cured block over to
  // face its partner mirrors it, so mirroring the tray cancels that out and
  // every cavity comes back down on its opposite number — whatever the layout,
  // odd counts and short rows included.
  const mold = buildSphereMold(star(), W, H, { ...CAKEPOP, copies: 5 })!;
  const designed = domeCentres(mold.designed);
  const turned = domeCentres(mold.plain)
    .map((centre) => ({ x: centre.x, y: mold.plain.depthMm - centre.y }))
    .sort((a, b) => a.x - b.x || a.y - b.y);

  assert.equal(designed.length, 5, `found ${designed.length} domes on the designed half`);
  assert.equal(turned.length, designed.length, "the halves hold different numbers of balls");
  designed.forEach((centre, i) => {
    // A thousandth of a millimetre: float32 rounding on a hundred-millimetre
    // coordinate, not a misalignment.
    assert.ok(
      Math.abs(centre.x - turned[i].x) < 0.01 && Math.abs(centre.y - turned[i].y) < 0.01,
      `ball ${i}: designed (${centre.x.toFixed(3)}, ${centre.y.toFixed(3)}) against turned (${turned[i].x.toFixed(
        3
      )}, ${turned[i].y.toFixed(3)})`
    );
  });
});

test("one half has the pins and the other the hollows they sit in", () => {
  const mold = buildSphereMold(star(), W, H, { ...CAKEPOP, copies: 1 })!;
  // The plain half carries more solids: the floor is cut for four pockets and a
  // slab laid under each, and it holds the pour channel too.
  assert.ok(
    mold.plain.parts.length > mold.designed.parts.length,
    `plain ${mold.plain.parts.length} against designed ${mold.designed.parts.length}`
  );

  // Pins stand above the floor on the designed half; nothing does on the plain
  // one except the ball and the channel over it.
  const standing = (half: MoldHalf) => {
    let above = 0;
    for (const part of half.parts) {
      if (part.count > 2000) continue; // the ball itself
      let top = -Infinity;
      for (let i = 0; i < part.count * 3; i++) top = Math.max(top, part.positions[i * 3 + 2]);
      if (top > 2 + 0.5 && top < 2 + 19.05) above++;
    }
    return above;
  };
  assert.equal(standing(mold.designed), 4, "four pins, one to a corner");
  assert.equal(standing(mold.plain), 0, "and none on the half they push into");
});

test("the pour channel is on the smooth half, clear of the drawing", () => {
  const mold = buildSphereMold(star(), W, H, { ...CAKEPOP, copies: 4 })!;
  // Anything reaching the top of the tray that is not a wall is a channel.
  const reachingTop = (half: MoldHalf) =>
    half.parts.filter((part) => {
      let top = -Infinity;
      let lowest = Infinity;
      for (let i = 0; i < part.count * 3; i++) {
        top = Math.max(top, part.positions[i * 3 + 2]);
        lowest = Math.min(lowest, part.positions[i * 3 + 2]);
      }
      return Math.abs(top - half.heightMm) < 1e-3 && lowest > 2;
    }).length;

  assert.equal(reachingTop(mold.plain), 4, "one channel per ball, out through the back");
  assert.equal(reachingTop(mold.designed), 0, "and none through the face carrying the picture");
});

test("what the mold costs is the box less the balls standing in it", () => {
  const mold = buildSphereMold(star(), W, H, { ...CAKEPOP, copies: 4 })!;
  const inner = (mold.designed.widthMm - 8) * (mold.designed.depthMm - 8) * (mold.designed.heightMm - 2);
  // Four balls of 1.5in across, half of each standing in the box.
  const balls = 4 * (2 / 3) * Math.PI * 19.05 ** 3;
  const want = (inner - balls) / 1000;
  assert.ok(
    Math.abs(mold.designed.siliconeMl - want) / want < 0.05,
    `${mold.designed.siliconeMl.toFixed(1)}ml against ${want.toFixed(1)}ml of room`
  );
  assert.ok(mold.designed.plasticCm3 > 0 && mold.plain.plasticCm3 > 0);
});

test("a drawing too shallow to print leaves the ball smooth", () => {
  const shallow = buildSphereMold(star(), W, H, { ...CAKEPOP, reliefMm: 0.2, nozzleMm: 0.4 })!;
  assert.equal(shallow.reliefAppliedMm, 0, "refused rather than promised");
  const relief = shallow.findings.find((finding) => finding.title === "Relief")!;
  assert.equal(relief.level, "warn");
  assert.match(relief.detail, /comes out smooth/);

  const deep = buildSphereMold(star(), W, H, { ...CAKEPOP, reliefMm: 0.6, nozzleMm: 0.4 })!;
  assert.equal(deep.reliefAppliedMm, 0.6);
  assert.equal(deep.findings.find((finding) => finding.title === "Relief")!.level, "pass");
});

test("a truffle has a pour hole and a cake pop has somewhere for the stick", () => {
  const pop = buildSphereMold(star(), W, H, { diameterIn: 1.5, stick: true })!;
  const truffle = buildSphereMold(star(), W, H, { diameterIn: 1.1, stick: false })!;

  assert.ok(pop.findings.some((f) => f.title === "Stick and pour" && /lollipop stick/.test(f.detail)));
  assert.ok(truffle.findings.some((f) => f.title === "Pour hole" && /Trim the sprue/.test(f.detail)));
  // And the ball is the size the sweet actually is.
  assert.ok(Math.abs(pop.diameterMm - 38.1) < 1e-6);
  assert.ok(Math.abs(truffle.diameterMm - 27.94) < 1e-6);
});

test("a mold too big for the bed says so before it is printed", () => {
  const roomy = buildSphereMold(star(), W, H, { ...CAKEPOP, copies: 4, bedMm: 220 })!;
  assert.equal(roomy.findings.find((finding) => finding.title === "Bed")!.level, "pass");

  const crowded = buildSphereMold(star(), W, H, { ...CAKEPOP, copies: 16, bedMm: 180 })!;
  const bed = crowded.findings.find((finding) => finding.title === "Bed")!;
  assert.equal(bed.level, "warn");
  assert.match(bed.detail, /Ask for fewer/);
});

test("nothing describes a ball but a ball", () => {
  assert.equal(buildSphereMold(star(), W, H, { diameterIn: 0, stick: false }), null);
  assert.equal(buildSphereMold(star(), W, H, { diameterIn: -1, stick: false }), null);
  assert.equal(buildSphereMold(new Uint8Array(4), 0, 0, CAKEPOP), null);
  assert.equal(buildSphereMold(new Uint8Array(4), W, H, CAKEPOP), null, "a mask smaller than it claims");
});

test("an assumed printer is said out loud, and is not a fault", () => {
  // She has no printer yet, so the nozzle is a guess — and every limit here is
  // measured against it. Saying nothing would state the guess as fact.
  const guessed = buildSphereMold(star(), W, H, CAKEPOP)!;
  const printer = guessed.findings.find((finding) => finding.title === "Printer")!;
  assert.ok(printer, "the assumption is stated");
  assert.match(printer.detail, /no printer is set yet/);
  // A premise, not a defect: the file is perfectly printable. Marked as a
  // warning it would put "Export anyway" on every export until a printer is
  // bought, and that is how warnings stop being read.
  assert.equal(printer.level, "pass");

  const known = buildSphereMold(star(), W, H, { ...CAKEPOP, nozzleMm: 0.6, bedMm: 250 })!;
  assert.equal(known.findings.some((finding) => finding.title === "Printer"), false, "and drops away once one is set");
});
