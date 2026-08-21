// The file a slicer opens.
//
// Binary STL is about as simple as a file format gets: eighty bytes of anything
// at all, a triangle count, and then fifty bytes per triangle. There is no
// index, no compression, and — the part that matters — no unit. Every slicer
// ever written assumes millimetres, and this app measures everything in inches,
// so the single most likely way to waste an afternoon here is to export a
// three-inch cookie cutter that prints three millimetres across.
//
// Pure byte assembly over a mesh, no filesystem: solid.ts decides the geometry,
// castingTray.ts decides the size in millimetres, and this only writes it down.

import type { Mesh } from "./solid";

/** Millimetres in an inch. The whole reason this module insists on units. */
export const INCH_MM = 25.4;

export function inchesToMm(inches: number): number {
  return inches * INCH_MM;
}

const HEADER_BYTES = 80;
const BYTES_PER_TRIANGLE = 50;

/**
 * Encodes a mesh as binary STL. The mesh must already be in millimetres.
 *
 * The header is deliberately not allowed to begin with "solid": that word is
 * how an ASCII STL starts, and a parser that sniffs the first five bytes will
 * read this whole binary file as text and find nothing in it.
 */
export function encodeStl(mesh: Mesh, header = "Inkline casting tray"): Uint8Array {
  const bytes = new Uint8Array(HEADER_BYTES + 4 + mesh.count * BYTES_PER_TRIANGLE);
  const view = new DataView(bytes.buffer);

  const safeHeader = /^solid/i.test(header.trim()) ? `Inkline ${header}` : header;
  for (let i = 0; i < Math.min(safeHeader.length, HEADER_BYTES); i++) {
    // Anything outside ASCII would take more than the one byte budgeted for it.
    const code = safeHeader.charCodeAt(i);
    bytes[i] = code < 128 ? code : 0x3f;
  }

  view.setUint32(HEADER_BYTES, mesh.count, true);

  const p = mesh.positions;
  let at = HEADER_BYTES + 4;
  for (let t = 0; t < mesh.count; t++) {
    const i = t * 9;
    const ax = p[i], ay = p[i + 1], az = p[i + 2];
    const bx = p[i + 3], by = p[i + 4], bz = p[i + 5];
    const cx = p[i + 6], cy = p[i + 7], cz = p[i + 8];

    // Right-hand rule on the winding, which is what tells a slicer which side
    // of this triangle is outside the solid.
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    if (length > 0) {
      nx /= length;
      ny /= length;
      nz /= length;
    } else {
      // A zero-area triangle has no facing. Zeroes are the format's way of
      // saying "work it out yourself", which every slicer does anyway.
      nx = ny = nz = 0;
    }

    for (const value of [nx, ny, nz, ax, ay, az, bx, by, bz, cx, cy, cz]) {
      view.setFloat32(at, value, true);
      at += 4;
    }
    // Attribute byte count. Nothing standard lives here.
    view.setUint16(at, 0, true);
    at += 2;
  }

  return bytes;
}

/** Exact size of the file `encodeStl` will produce, without building it. */
export function stlByteLength(triangles: number): number {
  return HEADER_BYTES + 4 + triangles * BYTES_PER_TRIANGLE;
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Base64, for handing the bytes to a filesystem that only takes strings.
 *
 * Written out rather than reached for: btoa does not exist on a phone, and the
 * one dependency that does this is aimed at a different shape of input than a
 * raw byte array of a few hundred kilobytes.
 */
export function toBase64(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const triple = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      BASE64[(triple >> 18) & 63] + BASE64[(triple >> 12) & 63] + BASE64[(triple >> 6) & 63] + BASE64[triple & 63];
  }
  if (i + 1 === bytes.length) {
    const chunk = bytes[i] << 16;
    out += BASE64[(chunk >> 18) & 63] + BASE64[(chunk >> 12) & 63] + "==";
  } else if (i + 2 === bytes.length) {
    const chunk = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += BASE64[(chunk >> 18) & 63] + BASE64[(chunk >> 12) & 63] + BASE64[(chunk >> 6) & 63] + "=";
  }
  return out;
}
