// How much room the app's own chrome takes out of a screen.
//
// On runtimes with liquid glass the tab bar is absolutely positioned so the
// glass can refract the content scrolling under it. That is the point of it —
// but an absolute bar is outside layout, so nothing reserves space for it and
// the last thing on every screen ends up behind it. Each screen was padding a
// flat 44pt, which is about half what the bar actually occupies once the home
// indicator is counted.

import { useSafeAreaInsets } from "react-native-safe-area-context";
import { hasLiquidGlass } from "@/components/GlassSurface";
import { SPACE } from "./theme";

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
  if (!hasLiquidGlass) return SPACE.xxl;
  return TAB_BAR_HEIGHT + insets.bottom + SPACE.md;
}
