import test from "node:test";
import assert from "node:assert/strict";
import { INCH_MM, encodeStl, inchesToMm, stlByteLength, toBase64 } from "./stl";
import { extrudePrism, meshVolume, type Mesh } from "./solid";
import type { Point } from "./designProject";

function square(size: number): Point[] {
  return [
    { x: 0, y: 0 },
    { x: size, y: 0 },
    { x: size, y: size },
    { x: 0, y: size },
  ];
}

/** Reads back what encodeStl wrote, so the file can be checked rather than assumed. */
function decodeStl(bytes: Uint8Array): { header: string; mesh: Mesh; normals: number[][] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = String.fromCharCode(...bytes.subarray(0, 80)).replace(/\0+$/, "");
  const count = view.getUint32(80, true);
  const positions = new Float32Array(count * 9);
  const normals: number[][] = [];
  let at = 84;
  for (let t = 0; t < count; t++) {
    normals.push([view.getFloat32(at, true), view.getFloat32(at + 4, true), view.getFloat32(at + 8, true)]);
    at += 12;
    for (let v = 0; v < 9; v++) {
      positions[t * 9 + v] = view.getFloat32(at, true);
      at += 4;
    }
    at += 2;
  }
  return { header, mesh: { positions, count }, normals };
}

test("an inch is millimetres, and that is the whole point", () => {
  assert.equal(INCH_MM, 25.4);
  assert.ok(Math.abs(inchesToMm(3) - 76.2) < 1e-9, "a three-inch cookie is 76mm, not 3");
  assert.equal(inchesToMm(0), 0);
});

test("the file is exactly as long as the format says", () => {
  const mesh = extrudePrism(square(10), [], 0, 2);
  const bytes = encodeStl(mesh);
  assert.equal(bytes.length, 84 + mesh.count * 50);
  assert.equal(bytes.length, stlByteLength(mesh.count));
  assert.equal(stlByteLength(0), 84, "a header and a zero count is still a valid file");
});

test("what was written reads back as what went in", () => {
  const mesh = extrudePrism(square(10), [], 0, 3);
  const { mesh: readBack } = decodeStl(encodeStl(mesh));
  assert.equal(readBack.count, mesh.count);
  mesh.positions.forEach((value, i) => {
    assert.ok(Math.abs(readBack.positions[i] - value) < 1e-4, `vertex ${i} did not survive the round trip`);
  });
  assert.ok(Math.abs(meshVolume(readBack) - 300) < 1e-2, "and it is still the same solid");
});

test("the header never starts with the word that means ASCII", () => {
  // A parser sniffing the first five bytes for "solid" reads the whole binary
  // file as text and finds nothing in it.
  const mesh = extrudePrism(square(4), [], 0, 1);
  assert.ok(!decodeStl(encodeStl(mesh)).header.toLowerCase().startsWith("solid"));
  assert.ok(!decodeStl(encodeStl(mesh, "solid snowflake")).header.toLowerCase().startsWith("solid"));
  assert.ok(decodeStl(encodeStl(mesh, "solid snowflake")).header.includes("snowflake"), "the name survives");
});

test("a header longer than the format allows is cut, not spilled", () => {
  const mesh = extrudePrism(square(4), [], 0, 1);
  const bytes = encodeStl(mesh, "x".repeat(500));
  assert.equal(bytes.length, 84 + mesh.count * 50, "the triangles start where they should");
  assert.equal(decodeStl(bytes).header.length, 80);
});

test("a name with accents in it does not shift every byte after it", () => {
  const mesh = extrudePrism(square(4), [], 0, 1);
  const bytes = encodeStl(mesh, "Améliés flocon ✨");
  assert.equal(bytes.length, 84 + mesh.count * 50);
  assert.equal(decodeStl(bytes).mesh.count, mesh.count, "the count is still where it was");
});

test("normals are unit length and face out", () => {
  const { normals, mesh } = decodeStl(encodeStl(extrudePrism(square(10), [], 0, 2)));
  assert.equal(normals.length, mesh.count);
  normals.forEach((n, i) => {
    assert.ok(Math.abs(Math.hypot(n[0], n[1], n[2]) - 1) < 1e-4, `normal ${i} is not a unit vector`);
  });
  // A box has faces pointing six ways; the top must point straight up and the
  // bottom straight down, or the solid is inside out.
  assert.ok(normals.some((n) => n[2] > 0.99), "something faces up");
  assert.ok(normals.some((n) => n[2] < -0.99), "something faces down");
  assert.ok(normals.some((n) => Math.abs(n[2]) < 0.01), "and the walls face sideways");
});

test("an empty mesh is a valid, empty file", () => {
  const bytes = encodeStl({ positions: new Float32Array(0), count: 0 });
  assert.equal(bytes.length, 84);
  assert.equal(decodeStl(bytes).mesh.count, 0);
});

test("base64 round-trips whatever length the bytes are", () => {
  for (const length of [0, 1, 2, 3, 4, 5, 6, 7, 100, 257]) {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 11) & 0xff);
    const encoded = toBase64(bytes);
    const decoded = Buffer.from(encoded, "base64");
    assert.equal(decoded.length, length, `length ${length} did not survive`);
    bytes.forEach((value, i) => assert.equal(decoded[i], value, `byte ${i} of ${length}`));
  }
});

test("a real file base64s to something a filesystem will take", () => {
  const encoded = toBase64(encodeStl(extrudePrism(square(10), [], 0, 2)));
  assert.ok(/^[A-Za-z0-9+/]+={0,2}$/.test(encoded), "no stray characters");
  assert.equal(encoded.length % 4, 0, "padded to a whole number of quads");
});
