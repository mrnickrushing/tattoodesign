import { findSurface } from "./curveWarp";
// The thing the design is actually going onto, drawn so you can look at it.
//
// A design judged on white paper tells you almost nothing about how it will
// look on a cake pop. A cake pop is a 1.5-inch ball: a design that reads
// beautifully flat wraps away at the edges, and the amount it wraps away
// depends on how big you print it. A cookie is flatter but not flat, and its
// frosting is a smaller circle than the cookie itself, so a design sized to
// the cookie overruns the surface it can actually be printed on.
//
// So the mockup is not decoration. Two things it is for:
//
//   - How much of it survives. The design is warped through the surface map in
//     curveWarp.ts, so what you see is the foreshortening the real object
//     produces, not a flat sticker pasted on a circle.
//   - Whether it fits. Each substrate knows its own printable area, which is
//     smaller than its outline for anything with frosting.
//
// The shapes are deliberately plain — a coloured ball, a coloured disc. This
// is a placement check, not a photorealistic render, and a plain shape is
// easier to judge a design against than a rendered one.
//
// Pure data and geometry, no Skia and no React, so the sizes and fits can be
// verified off-device.

export type SubstrateShape = "round" | "scalloped" | "square" | "heart";

export type Substrate = {
  id: string;
  label: string;
  caption: string;
  /** Which surface in curveWarp.ts this behaves as. */
  surfaceId: string;
  shape: SubstrateShape;
  /** Widest dimension of the object, in inches. */
  widthIn: number;
  /** Tall objects differ; for a round one this matches the width. */
  heightIn: number;
  /** A cake pop sits on one. */
  stick: boolean;
  /**
   * Fraction of the object covered by frosting, or null for a bare surface.
   * A design goes onto the frosting, which is inset from the edge.
   */
  frostingInset: number | null;
};

export const SUBSTRATES: Substrate[] = [
  {
    id: "cakepop",
    label: "Cake pop",
    caption: "A 1.5in ball on a stick",
    surfaceId: "cakepop",
    shape: "round",
    widthIn: 1.5,
    heightIn: 1.5,
    stick: true,
    frostingInset: null,
  },
  {
    id: "truffle",
    label: "Truffle",
    caption: "A 1.1in ball, no stick",
    surfaceId: "truffle",
    shape: "round",
    widthIn: 1.1,
    heightIn: 1.1,
    stick: false,
    frostingInset: null,
  },
  {
    id: "roundcookie",
    label: "Round cookie",
    caption: "A 3in sugar cookie, frosted to the edge",
    surfaceId: "domecookie",
    shape: "round",
    widthIn: 3,
    heightIn: 3,
    stick: false,
    frostingInset: 0.08,
  },
  {
    id: "scallopcookie",
    label: "Scalloped",
    caption: "A 3in scalloped cookie",
    surfaceId: "domecookie",
    shape: "scalloped",
    widthIn: 3,
    heightIn: 3,
    stick: false,
    frostingInset: 0.14,
  },
  {
    id: "squarecookie",
    label: "Square",
    caption: "A 3in square cookie",
    surfaceId: "flat",
    shape: "square",
    widthIn: 3,
    heightIn: 3,
    stick: false,
    frostingInset: 0.1,
  },
  {
    id: "heartcookie",
    label: "Heart",
    caption: "A 3in heart cookie",
    surfaceId: "flat",
    shape: "heart",
    widthIn: 3,
    heightIn: 2.8,
    stick: false,
    frostingInset: 0.12,
  },
];

/**
 * Whether a substrate is a whole ball, rather than something merely curved.
 *
 * The surface kind is not enough on its own: a domed cookie is a sphere too —
 * a very large one that the cookie is a small cap of. What tells a ball apart
 * is that the sphere *is* the sweet, so the way round it matches its own width.
 * A cake pop is 1.5in across and 4.7in round; a 3in domed cookie is 28in round.
 */
export function isBall(substrate: Substrate): boolean {
  const surface = findSurface(substrate.surfaceId);
  if (!surface || surface.kind !== "sphere") return false;
  return Math.abs(surface.circumferenceIn - Math.PI * substrate.widthIn) < substrate.widthIn * 0.15;
}

/** The ball drawn on this surface, if the surface is one. */
export function ballFor(surfaceId: string): Substrate | undefined {
  return SUBSTRATES.find((substrate) => substrate.surfaceId === surfaceId && isBall(substrate));
}

export function findSubstrate(id: string): Substrate | undefined {
  return SUBSTRATES.find((item) => item.id === id);
}

/** Baked colours: what the cookie or cake pop itself is. */
export const BAKE_COLORS: { id: string; label: string; color: string }[] = [
  { id: "vanilla", label: "Vanilla", color: "#f3e2c0" },
  { id: "golden", label: "Golden", color: "#e3c489" },
  { id: "chocolate", label: "Chocolate", color: "#6b4429" },
  { id: "redvelvet", label: "Red velvet", color: "#8e2f2a" },
  { id: "matcha", label: "Matcha", color: "#8aa663" },
];

/** Icing colours, for the coated surface a design sits on. */
export const COATING_COLORS: { id: string; label: string; color: string }[] = [
  { id: "white", label: "White", color: "#fbfaf7" },
  { id: "pink", label: "Pink", color: "#f2b8c6" },
  { id: "mint", label: "Mint", color: "#b7ded0" },
  { id: "lemon", label: "Lemon", color: "#f6e6a8" },
  { id: "lilac", label: "Lilac", color: "#cdbde4" },
  { id: "sky", label: "Sky", color: "#b9d4ee" },
  { id: "choc", label: "Chocolate", color: "#7a5236" },
  { id: "black", label: "Black", color: "#2b2724" },
];

/**
 * The area a design can actually go on, in inches.
 *
 * Not the same as the object: frosting stops short of the edge, and on a ball
 * only the part facing you can be printed onto in one piece. Both matter — a
 * design sized to the cookie rather than to its frosting comes back with its
 * border cropped off.
 */
export function printableAreaIn(substrate: Substrate): { widthIn: number; heightIn: number } {
  const inset = substrate.frostingInset ?? 0;
  return {
    widthIn: substrate.widthIn * (1 - inset * 2),
    heightIn: substrate.heightIn * (1 - inset * 2),
  };
}

/**
 * Whether a design of a given width fits, and what would fit instead.
 *
 * `fits` is deliberately a little conservative on a ball: a design that runs
 * to the exact edge of what one flat transfer can cover is one that has to be
 * applied perfectly, and nobody applies anything perfectly.
 */
export function fitCheck(
  substrate: Substrate,
  designWidthIn: number,
  designAspect: number
): { fits: boolean; maxWidthIn: number; reason: string | null } {
  const area = printableAreaIn(substrate);
  const byWidth = area.widthIn;
  const byHeight = designAspect > 0 ? area.heightIn / designAspect : area.heightIn;
  // A ball is only comfortably printable across the middle of the face.
  const curveLimit = substrate.surfaceId === "flat" ? Infinity : substrate.widthIn * 0.8;
  const maxWidthIn = Math.min(byWidth, byHeight, curveLimit);

  if (designWidthIn <= maxWidthIn) return { fits: true, maxWidthIn, reason: null };
  const reason =
    maxWidthIn === curveLimit
      ? "It wraps too far around to apply in one piece."
      : byHeight < byWidth
        ? "It is too tall for the frosting."
        : "It is wider than the frosting.";
  return { fits: false, maxWidthIn, reason };
}

/**
 * SVG path for a substrate outline in a unit box, so the shape and the
 * renderer stay independent of each other.
 */
export function outlinePath(shape: SubstrateShape, size: number): string {
  const r = size / 2;
  switch (shape) {
    case "round":
      return `M ${r} 0 A ${r} ${r} 0 1 1 ${r - 0.01} 0 Z`;
    case "square": {
      const corner = size * 0.12;
      return `M ${corner} 0 H ${size - corner} A ${corner} ${corner} 0 0 1 ${size} ${corner} V ${size - corner} A ${corner} ${corner} 0 0 1 ${size - corner} ${size} H ${corner} A ${corner} ${corner} 0 0 1 0 ${size - corner} V ${corner} A ${corner} ${corner} 0 0 1 ${corner} 0 Z`;
    }
    case "scalloped": {
      // Twelve bumps around the rim. Drawn as arcs between points on a circle
      // slightly inside the box, so the bumps stay within the given size.
      const bumps = 12;
      const inner = r * 0.88;
      const bump = (Math.PI * 2 * inner) / bumps / 2;
      let d = "";
      for (let i = 0; i < bumps; i++) {
        const a1 = (i / bumps) * Math.PI * 2 - Math.PI / 2;
        const a2 = ((i + 1) / bumps) * Math.PI * 2 - Math.PI / 2;
        const x1 = r + Math.cos(a1) * inner;
        const y1 = r + Math.sin(a1) * inner;
        const x2 = r + Math.cos(a2) * inner;
        const y2 = r + Math.sin(a2) * inner;
        d += i === 0 ? `M ${x1.toFixed(2)} ${y1.toFixed(2)} ` : "";
        d += `A ${bump.toFixed(2)} ${bump.toFixed(2)} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)} `;
      }
      return `${d}Z`;
    }
    case "heart": {
      const w = size;
      const h = size;
      return `M ${w / 2} ${h} C ${-w * 0.15} ${h * 0.62} ${w * 0.1} ${-h * 0.08} ${w / 2} ${h * 0.26} C ${w * 0.9} ${-h * 0.08} ${w * 1.15} ${h * 0.62} ${w / 2} ${h} Z`;
    }
    default:
      return "";
  }
}
