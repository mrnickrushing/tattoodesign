// Where a phone layout stops being the right layout.
//
// The whole app was designed for a screen you hold. On a laptop that same
// design reads as a phone floating in the middle of a browser window: a
// column of content with a bottom tab bar, and a few hundred pixels of empty
// ground either side. It works, but it looks like something that wandered in
// from another device.
//
// The fix is not "make everything wider" — a 1400px line of body text is
// worse, not better. It is to change what the width is *for*: navigation
// moves to the side where there is room for it, and screens that have a
// natural second column get one.

/**
 * Below this, the phone layout is correct: one column, tabs along the bottom
 * where a thumb can reach. Chosen to sit above a large phone in landscape and
 * below any tablet in portrait, so a device does not flip layout when rotated
 * unless it genuinely has the room.
 */
export const WIDE = 900;

/** Where a second column stops being cramped and starts being useful. */
export const EXTRA_WIDE = 1280;

export type Layout = "compact" | "wide" | "extraWide";

export function layoutFor(width: number): Layout {
  if (width >= EXTRA_WIDE) return "extraWide";
  if (width >= WIDE) return "wide";
  return "compact";
}

export function isWide(width: number): boolean {
  return width >= WIDE;
}
