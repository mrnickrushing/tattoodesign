// How much room the app's own chrome takes out of a screen.
//
// On runtimes with liquid glass the tab bar is absolutely positioned so the
// glass can refract the content scrolling under it. That is the point of it —
// but an absolute bar is outside layout, so nothing reserves space for it and
// the last thing on every screen ends up behind it. Each screen was padding a
// flat 44pt, which is about half what the bar actually occupies once the home
// indicator is counted.

import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isWide } from "./breakpoints";
import { hasLiquidGlass } from "@/components/GlassSurface";
import { SPACE } from "./theme";

/**
 * Widest a column of reading content is allowed to get.
 *
 * A phone layout stretched across a 27-inch monitor gives line lengths nobody
 * can read. But a fixed narrow column centred in a wide window is the other
 * failure — that is what makes the web app read as a phone floating in a
 * browser. So this caps *text*, and useContentWidth below lets screens whose
 * content is a canvas or a grid take the room instead.
 */
export const READING_MAX_WIDTH = 760;

/** What a canvas or a grid may grow to before it stops being useful. */
export const CANVAS_MAX_WIDTH = 1400;

/** Must match the tabBarStyle height in app/[brand]/_layout.tsx. */
export const TAB_BAR_HEIGHT = SPACE.xxl * 2;

/**
 * Bottom padding for a screen's scroll content: clear of the tab bar, plus
 * breathing room so the last card does not sit flush against it.
 *
 * When the bar is in normal flow the navigator already reserves its space, so
 * only the breathing room is needed.
 */
export function useContentBottomInset(): number {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // A sidebar takes no vertical room, so reserving a bar's worth of it would
  // just be a gap at the bottom of every wide screen.
  if (isWide(width)) return SPACE.xl;
  if (!hasLiquidGlass) return SPACE.xxl;
  return TAB_BAR_HEIGHT + insets.bottom + SPACE.md;
}

/**
 * How wide this screen's content should be, and whether it is centred.
 *
 * Reading screens keep a column. Working screens — the sheet, the library —
 * use the width, because for them more room genuinely means more visible
 * work rather than longer lines of text.
 */
export function useContentWidth(kind: "reading" | "canvas" = "reading"): {
  maxWidth: number;
  alignSelf: "center" | "stretch";
} {
  const { width } = useWindowDimensions();
  if (!isWide(width)) return { maxWidth: CANVAS_MAX_WIDTH, alignSelf: "stretch" };
  return kind === "canvas"
    ? { maxWidth: CANVAS_MAX_WIDTH, alignSelf: "center" }
    : { maxWidth: READING_MAX_WIDTH, alignSelf: "center" };
}
