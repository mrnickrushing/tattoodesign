// Lettering as geometry, not as a text layer.
//
// Names, dates, and script are half of walk-in work, and a one-font text
// layer doesn't cover it. This module lays glyphs along a straight or curved
// baseline; letteringRender.ts draws that layout with Skia and the existing
// stencil → skeleton → trace pipeline turns the result into editable vector
// strokes, the same as everything else in the editor.
//
// The layout math lives here, Skia-free, so arcs are unit-testable.

export type LetteringStyleId = "script" | "serif" | "display";

export type LetteringStyle = {
  id: LetteringStyleId;
  label: string;
  /** Font module key registered in app/_layout.tsx. */
  fontFamily: string;
  /** Path of the bundled TTF inside node_modules, for imperative Skia use. */
  asset: string;
  /** Trace tolerance differs: script wants gentler simplification. */
  simplifyTolerance: number;
};

export const LETTERING_STYLES: LetteringStyle[] = [
  {
    id: "script",
    label: "Script",
    fontFamily: "Caveat_600SemiBold",
    asset: "caveat-600",
    simplifyTolerance: 0.9,
  },
  {
    id: "serif",
    label: "Serif",
    fontFamily: "PlayfairDisplay_700Bold",
    asset: "playfair-700",
    simplifyTolerance: 1.2,
  },
  {
    id: "display",
    label: "Display",
    fontFamily: "BebasNeue_400Regular",
    asset: "bebas-400",
    simplifyTolerance: 1.2,
  },
];

export function letteringStyle(id: LetteringStyleId): LetteringStyle {
  return LETTERING_STYLES.find((style) => style.id === id) ?? LETTERING_STYLES[0];
}

export type GlyphPlacement = {
  /** Pen position for the glyph's left edge, canvas coordinates. */
  x: number;
  y: number;
  /** Rotation in radians — tangent to the baseline at this glyph. */
  rotation: number;
};

/**
 * Lays glyph widths along a baseline bent by `curve` ∈ [-1, 1].
 *
 * 0 is a straight line at the origin. Positive arches the text upward
 * (an arch over a shoulder), negative bows it downward (a valley). The arc
 * always spans the same total advance as the straight line, so changing the
 * curve never changes letter spacing — only where the letters sit.
 *
 * Returned positions are relative to the text's left edge at the baseline;
 * the renderer centres the block afterwards.
 */
export function arcLayout(widths: number[], curve: number): GlyphPlacement[] {
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (!widths.length) return [];
  const bend = Math.max(-1, Math.min(1, curve));

  if (bend === 0 || total === 0) {
    let x = 0;
    return widths.map((width) => {
      const placement = { x, y: 0, rotation: 0 };
      x += width;
      return placement;
    });
  }

  // The text occupies an arc subtending up to a half circle at |curve| = 1.
  // Radius follows from arc length: s = r·θ.
  const theta = Math.abs(bend) * Math.PI;
  const radius = total / theta;
  const sign = bend > 0 ? 1 : -1;

  // Circle centre sits below the baseline for an arch, above for a valley,
  // placed so the arc's midpoint touches y = 0.
  const cy = sign * radius;

  let arc = 0;
  return widths.map((width) => {
    const mid = arc + width / 2;
    // Angle of this glyph's midpoint, measured from the arc's own midpoint.
    const angle = (mid - total / 2) / radius;
    const cx = total / 2;
    const x = cx + Math.sin(angle) * radius - width / 2;
    const y = cy - Math.cos(angle) * radius * sign;
    arc += width;
    return { x, y, rotation: sign * angle };
  });
}

/** Bounding box of a laid-out block, for sizing the render surface. */
export function layoutBounds(
  placements: GlyphPlacement[],
  widths: number[],
  glyphHeight: number
): { minX: number; minY: number; maxX: number; maxY: number } {
  if (!placements.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  placements.forEach((placement, index) => {
    // A rotated glyph can poke past its advance box; pad by the diagonal.
    const reach = Math.hypot(widths[index], glyphHeight);
    minX = Math.min(minX, placement.x - reach / 4);
    maxX = Math.max(maxX, placement.x + widths[index] + reach / 4);
    minY = Math.min(minY, placement.y - glyphHeight);
    maxY = Math.max(maxY, placement.y + glyphHeight / 2);
  });
  return { minX, minY, maxX, maxY };
}
