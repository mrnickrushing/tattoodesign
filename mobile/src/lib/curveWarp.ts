// Artwork that has to sit on something that is not flat.
//
// A forearm is a cylinder. A cake pop is a sphere. A tapered cake tier is a
// cone. Artwork drawn flat and applied to any of them does not read the way it
// did on the screen, and the two brands hit the problem from opposite ends: a
// stencil goes onto skin that curves away from the viewer, and a transfer goes
// onto a cake pop that curves away in every direction at once.
//
// Two different questions, and they are inverses of each other:
//
//   Compensate — pre-distort the flat artwork so that once it is on the
//                surface it looks like the original. This is what you print.
//   Foreshorten — show what the flat artwork will look like once it is on the
//                surface. This is what you check before printing.
//
// The maths is the same in both directions. Paper measures arc length along
// the surface; an eye measures the chord. For a cylinder of radius R, a point
// at arc distance s appears at R·sin(s/R), so compensating means going the
// other way: a point that should appear at v gets printed at R·asin(v/R). A
// sphere is that same relation applied radially — the azimuthal equidistant
// projection, which is exactly "a decal centred on a ball". A cone is a
// cylinder whose radius changes with height.
//
// One thing worth being honest about: a cylinder and a cone are developable,
// so flat paper really does lie on them without wrinkling and compensation is
// the whole story. A sphere is not. No flat sheet wraps a ball without
// distortion, so the sphere map is the best single-piece answer, correct at
// the centre and increasingly approximate toward the edge — which is why the
// presets cap how much of a sphere one piece is allowed to cover.

import type { BrandId } from "./brands";

export type SurfaceKind = "flat" | "cylinder" | "sphere" | "cone";

export type Surface = {
  id: string;
  label: string;
  caption: string;
  kind: SurfaceKind;
  /** Circumference at the widest point, in inches. */
  circumferenceIn: number;
  /** The far end of a cone. Ignored for every other kind. */
  farCircumferenceIn?: number;
  brand: BrandId | "both";
};

export const SURFACES: Surface[] = [
  { id: "flat", label: "Flat", caption: "Paper, a cookie, a sheet — no curve at all", kind: "flat", circumferenceIn: 0, brand: "both" },

  // Ink: circumferences measured around the limb, not across it.
  { id: "wrist", label: "Wrist", caption: "About 6.5in around — curves away fast", kind: "cylinder", circumferenceIn: 6.5, brand: "ink" },
  { id: "forearm", label: "Forearm", caption: "About 10in around, tapering toward the wrist", kind: "cone", circumferenceIn: 11, farCircumferenceIn: 7.5, brand: "ink" },
  { id: "bicep", label: "Bicep", caption: "About 13in around", kind: "cylinder", circumferenceIn: 13, brand: "ink" },
  { id: "calf", label: "Calf", caption: "About 15in around", kind: "cone", circumferenceIn: 15, farCircumferenceIn: 10, brand: "ink" },
  { id: "thigh", label: "Thigh", caption: "About 22in around — nearly flat over a small piece", kind: "cylinder", circumferenceIn: 22, brand: "ink" },
  { id: "ribs", label: "Ribs", caption: "A gentle 30in barrel", kind: "cylinder", circumferenceIn: 30, brand: "ink" },

  // Sugar: measured the same way, around the thing.
  { id: "cakepop", label: "Cake pop", caption: "A 1.5in ball — curves away in every direction", kind: "sphere", circumferenceIn: 4.7, brand: "sugar" },
  { id: "truffle", label: "Truffle", caption: "A 1.1in ball", kind: "sphere", circumferenceIn: 3.5, brand: "sugar" },
  { id: "domecookie", label: "Domed cookie", caption: "A shallow 4in dome", kind: "sphere", circumferenceIn: 12.6, brand: "sugar" },
  { id: "tier6", label: "6in cake tier", caption: "About 18.8in around", kind: "cylinder", circumferenceIn: 18.8, brand: "sugar" },
  { id: "tier8", label: "8in cake tier", caption: "About 25.1in around", kind: "cylinder", circumferenceIn: 25.1, brand: "sugar" },
  { id: "tumbler", label: "Tumbler", caption: "A tapered 9.4in cup", kind: "cone", circumferenceIn: 9.4, farCircumferenceIn: 7, brand: "sugar" },
];

export function surfacesFor(brand: BrandId): Surface[] {
  return SURFACES.filter((surface) => surface.brand === "both" || surface.brand === brand);
}

export function findSurface(id: string): Surface | undefined {
  return SURFACES.find((surface) => surface.id === id);
}

/** Radius, in inches, from a circumference. */
export function radiusOf(circumferenceIn: number): number {
  return circumferenceIn / (2 * Math.PI);
}

/**
 * The most of a curve one flat piece may span, as a fraction of the way to the
 * horizon.
 *
 * At the horizon the surface is edge-on: compensation would need infinite
 * width and nothing would be readable anyway. Backing off well short of it
 * keeps the map finite and the artwork applicable by hand.
 */
export const MAX_SPAN = 0.8;

/** The tightest radius anywhere on the surface — a cone's narrow end. */
export function minRadiusIn(surface: Surface): number {
  const near = radiusOf(surface.circumferenceIn);
  if (surface.kind !== "cone" || !surface.farCircumferenceIn) return near;
  return Math.min(near, radiusOf(surface.farCircumferenceIn));
}

/**
 * How wide a piece can appear on a surface before it reaches the limit.
 * Callers use this to tell someone their design is too big for a wrist before
 * the maths quietly shrinks it. Measured at the tightest point, since that is
 * where a piece runs out of surface first.
 */
export function maxApparentWidthIn(surface: Surface): number {
  if (surface.kind === "flat" || surface.circumferenceIn <= 0) return Infinity;
  return 2 * minRadiusIn(surface) * MAX_SPAN;
}

/**
 * The size actually used, after refusing to run past the horizon.
 *
 * Clamped once, here, rather than a point at a time inside the map. Per-point
 * clamping looks like the same safety net but is not: it stops the map being a
 * bijection, so compensating and then previewing no longer round-trip, and it
 * flattens every surface past the limit into the same shape — which quietly
 * erased the difference between a wrist and a thigh, and between the two ends
 * of a cone.
 *
 * A sphere is capped on its diagonal, because the corners of a rectangle sit
 * further from the centre than its edges do and would otherwise run off the
 * side of the ball.
 */
export function effectiveSize(
  surface: Surface,
  widthIn: number,
  heightIn: number
): { widthIn: number; heightIn: number; clamped: boolean } {
  if (surface.kind === "flat" || surface.circumferenceIn <= 0 || widthIn <= 0 || heightIn <= 0) {
    return { widthIn, heightIn, clamped: false };
  }
  const limit = minRadiusIn(surface) * MAX_SPAN;
  const reach = surface.kind === "sphere" ? Math.hypot(widthIn / 2, heightIn / 2) : widthIn / 2;
  if (reach <= limit) return { widthIn, heightIn, clamped: false };
  const shrink = limit / reach;
  return {
    widthIn: widthIn * shrink,
    heightIn: surface.kind === "sphere" ? heightIn * shrink : heightIn,
    clamped: true,
  };
}

/**
 * Compensation along one axis.
 *
 * `u` and the result are both 0..1 across the artwork. `apparentIn` is how
 * wide the piece should look once it is on the surface, already clamped by
 * effectiveSize — nothing here clamps, so the map stays invertible.
 */
function compensateAxis(u: number, radiusIn: number, apparentIn: number): number {
  if (!(radiusIn > 0) || !(apparentIn > 0)) return u;
  const half = apparentIn / 2;
  // Where this point should end up, measured across the viewer's field...
  const chord = (u - 0.5) * apparentIn;
  // ...and the arc along the surface that lands it there.
  const arc = radiusIn * Math.asin(chord / radiusIn);
  const halfArc = radiusIn * Math.asin(half / radiusIn);
  return halfArc > 0 ? 0.5 + arc / (2 * halfArc) : u;
}

/** The inverse: where a printed point ends up in the eye. */
function foreshortenAxis(p: number, radiusIn: number, apparentIn: number): number {
  if (!(radiusIn > 0) || !(apparentIn > 0)) return p;
  const half = apparentIn / 2;
  const halfArc = radiusIn * Math.asin(half / radiusIn);
  const arc = (p - 0.5) * 2 * halfArc;
  const chord = radiusIn * Math.sin(arc / radiusIn);
  return half > 0 ? 0.5 + chord / (2 * half) : p;
}

/** Radius at a given height up a surface, 0 at the top of the artwork. */
function radiusAt(surface: Surface, v: number): number {
  const near = radiusOf(surface.circumferenceIn);
  if (surface.kind !== "cone" || !surface.farCircumferenceIn) return near;
  const far = radiusOf(surface.farCircumferenceIn);
  return near + (far - near) * Math.max(0, Math.min(1, v));
}

export type UV = { u: number; v: number };

/**
 * Where a point of the artwork has to be printed for it to look right on the
 * surface. Both input and output are 0..1 across the artwork.
 */
export function compensate(point: UV, surface: Surface, apparentWidthIn: number, apparentHeightIn: number): UV {
  if (surface.kind === "flat" || surface.circumferenceIn <= 0) return point;
  const size = effectiveSize(surface, apparentWidthIn, apparentHeightIn);

  if (surface.kind === "sphere") {
    // Radial, because a sphere curves away in every direction at once: the
    // same arc-versus-chord relation applied to the distance from the centre.
    const radius = radiusOf(surface.circumferenceIn);
    const dx = (point.u - 0.5) * size.widthIn;
    const dy = (point.v - 0.5) * size.heightIn;
    const distance = Math.hypot(dx, dy);
    if (distance < 1e-9) return point;
    const stretch = (radius * Math.asin(distance / radius)) / distance;
    const halfW = radius * Math.asin(size.widthIn / 2 / radius);
    const halfH = radius * Math.asin(size.heightIn / 2 / radius);
    return {
      u: 0.5 + (dx * stretch) / (2 * halfW),
      v: 0.5 + (dy * stretch) / (2 * halfH),
    };
  }

  // Cylinder and cone bend around one axis only, so the vertical is untouched.
  return { u: compensateAxis(point.u, radiusAt(surface, point.v), size.widthIn), v: point.v };
}

/** What a printed point will look like once it is on the surface. */
export function foreshorten(point: UV, surface: Surface, apparentWidthIn: number, apparentHeightIn: number): UV {
  if (surface.kind === "flat" || surface.circumferenceIn <= 0) return point;
  const size = effectiveSize(surface, apparentWidthIn, apparentHeightIn);

  if (surface.kind === "sphere") {
    const radius = radiusOf(surface.circumferenceIn);
    const halfW = radius * Math.asin(size.widthIn / 2 / radius);
    const halfH = radius * Math.asin(size.heightIn / 2 / radius);
    const ax = (point.u - 0.5) * 2 * halfW;
    const ay = (point.v - 0.5) * 2 * halfH;
    const arc = Math.hypot(ax, ay);
    if (arc < 1e-9) return point;
    const squeeze = (radius * Math.sin(arc / radius)) / arc;
    return {
      u: 0.5 + (ax * squeeze) / size.widthIn,
      v: 0.5 + (ay * squeeze) / size.heightIn,
    };
  }

  return { u: foreshortenAxis(point.u, radiusAt(surface, point.v), size.widthIn), v: point.v };
}

export type WarpMesh = {
  /** Destination positions, in pixels. Triangle-strip friendly grid order. */
  positions: { x: number; y: number }[];
  /** Source texture coordinates, in pixels, one per position. */
  uvs: { x: number; y: number }[];
  /** Triangle indices into the arrays above. */
  indices: number[];
  columns: number;
  rows: number;
};

/**
 * A triangle mesh that resamples the artwork through one of the maps above.
 *
 * A mesh rather than a strip-wise redraw because a sphere moves pixels in both
 * axes at once, which columns of stretched image cannot express. The grid is
 * fine enough that the straight edge of each triangle is indistinguishable
 * from the curve it is approximating.
 */
export function warpMesh(
  width: number,
  height: number,
  surface: Surface,
  apparentWidthIn: number,
  apparentHeightIn: number,
  direction: "compensate" | "foreshorten",
  divisions = 24
): WarpMesh {
  const columns = Math.max(2, Math.round(divisions));
  const rows = Math.max(2, Math.round(divisions));
  // A mesh asks, for each *output* pixel, where in the source it comes from —
  // so the lookup is the inverse of the effect being produced. Building the
  // compensated print means every printed position asks what the eye will see
  // there, which is foreshorten; building the proof asks the other way round.
  // Getting this backwards applies the distortion twice in the same direction
  // instead of once, which still looks bent and is simply wrong.
  const lookup = direction === "compensate" ? foreshorten : compensate;

  const positions: { x: number; y: number }[] = [];
  const uvs: { x: number; y: number }[] = [];
  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      const u = column / columns;
      const v = row / rows;
      const from = lookup({ u, v }, surface, apparentWidthIn, apparentHeightIn);
      positions.push({ x: u * width, y: v * height });
      uvs.push({
        x: Math.max(0, Math.min(1, from.u)) * width,
        y: Math.max(0, Math.min(1, from.v)) * height,
      });
    }
  }

  const indices: number[] = [];
  const stride = columns + 1;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const topLeft = row * stride + column;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + stride;
      const bottomRight = bottomLeft + 1;
      indices.push(topLeft, topRight, bottomLeft, topRight, bottomRight, bottomLeft);
    }
  }

  return { positions, uvs, indices, columns, rows };
}

/**
 * How much wider the artwork has to be printed than it will appear.
 *
 * The number someone actually needs: "this reads as 3in on a wrist, so print
 * it 3.4in wide". 1 means the surface is flat enough to ignore.
 */
export function printScale(surface: Surface, apparentWidthIn: number): number {
  if (surface.kind === "flat" || surface.circumferenceIn <= 0 || apparentWidthIn <= 0) return 1;
  // Measured at the tightest point on the surface, since that is where the
  // artwork has to grow the most and one printed sheet has to satisfy both.
  const radius = minRadiusIn(surface);
  const half = Math.min(apparentWidthIn, maxApparentWidthIn(surface)) / 2;
  const arc = radius * Math.asin(half / radius);
  return (2 * arc) / (2 * half);
}
