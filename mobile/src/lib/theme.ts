import type { BrandId } from "./brands";

export type Theme = {
  background: string;
  /** One step up from background — cards, sheets, the tab bar. */
  surface: string;
  /** Two steps up — inputs and wells that should read as recessed. */
  surfaceAlt: string;
  foreground: string;
  paper: string;
  accent: string;
  accentText: string;
  /** Accent at low alpha — for glows and tinted fills on dark ground. */
  accentGlow: string;
  /** Distinct from accent on purpose — accent doubles as the primary CTA
   * color, so error states need their own color to read as "wrong" rather
   * than "another button". Mirrors the web app's --danger token. */
  danger: string;
  line: string;
  /** Muted text, e.g. subtitles / captions. */
  muted: string;

  /** --- The signature surface: real flash paper / parchment stock. --- */
  /** Stock color. Never pure #fff — printed stock is warm and slightly off. */
  stock: string;
  /** Registration/crop marks at the stock's corners. */
  stockMark: string;
  /** Dot grid printed on blank stock. */
  stockGrid: string;
  /** Ink color for placeholder marks drawn on the stock. */
  stockInk: string;

  fontDisplay: string;
  fontBody: string;
  fontBodyMedium: string;
  fontScript: string;
};

export const THEMES: Record<BrandId, Theme> = {
  ink: {
    background: "#0a0909",
    surface: "#171311",
    surfaceAlt: "#241b18",
    foreground: "#fff7f1",
    paper: "#171311",
    accent: "#ef233c",
    accentText: "#ffffff",
    accentGlow: "rgba(239, 35, 60, 0.38)",
    danger: "#ff5a3c",
    line: "#392824",
    muted: "#aaa09a",
    // Tattoo flash is printed on warm off-white stock, never bright white.
    stock: "#f7f4ee",
    stockMark: "#c9c2b6",
    stockGrid: "#e4ded3",
    stockInk: "#1a1714",
    fontDisplay: "BebasNeue_400Regular",
    fontBody: "Sora_400Regular",
    fontBodyMedium: "Sora_600SemiBold",
    fontScript: "Caveat_600SemiBold",
  },
  sugar: {
    background: "#fff6f0",
    surface: "#ffffff",
    surfaceAlt: "#fff0f4",
    foreground: "#442d30",
    paper: "#ffffff",
    accent: "#d83c78",
    accentText: "#ffffff",
    accentGlow: "rgba(216, 60, 120, 0.3)",
    danger: "#c0392b",
    line: "#efd1da",
    muted: "#93777b",
    // Parchment, the baking equivalent of flash stock.
    stock: "#fffdfa",
    stockMark: "#e8d3c6",
    stockGrid: "#f5e6dc",
    stockInk: "#3b2b28",
    fontDisplay: "PlayfairDisplay_700Bold",
    fontBody: "Inter_400Regular",
    fontBodyMedium: "Inter_600SemiBold",
    fontScript: "Caveat_600SemiBold",
  },
};

export const NEUTRAL_THEME: Theme = {
  background: "#100f0e",
  surface: "#1a1817",
  surfaceAlt: "#232120",
  foreground: "#f4f2ef",
  paper: "#1a1817",
  accent: "#c8342f",
  accentText: "#ffffff",
  accentGlow: "rgba(200, 52, 47, 0.3)",
  danger: "#ff5a3c",
  line: "#2e2a27",
  muted: "#8d8681",
  stock: "#f7f4ee",
  stockMark: "#c9c2b6",
  stockGrid: "#e4ded3",
  stockInk: "#1a1714",
  fontDisplay: "BebasNeue_400Regular",
  fontBody: "Inter_400Regular",
  fontBodyMedium: "Inter_600SemiBold",
  fontScript: "Caveat_600SemiBold",
};

/** Sugar needs a late-night workspace, not a cold inversion of its paper. */
export const SUGAR_DARK: Theme = {
  background: "#241716",
  surface: "#33211f",
  surfaceAlt: "#442c29",
  foreground: "#fff4ed",
  paper: "#33211f",
  accent: "#f0719f",
  accentText: "#32151f",
  accentGlow: "rgba(240, 113, 159, 0.34)",
  danger: "#ff9678",
  line: "#60413d",
  muted: "#d0aaa4",
  // These describe physical parchment in the preview, not the app chrome.
  stock: "#fffdfa",
  stockMark: "#e8d3c6",
  stockGrid: "#f5e6dc",
  stockInk: "#3b2b28",
  fontDisplay: "PlayfairDisplay_700Bold",
  fontBody: "Inter_400Regular",
  fontBodyMedium: "Inter_600SemiBold",
  fontScript: "Caveat_600SemiBold",
};

/** Sugar’s dark appearance keeps the bakery warm after the kitchen lights dim. */
export function resolveTheme(brand: BrandId, scheme: "light" | "dark" | null | undefined): Theme {
  return brand === "sugar" && scheme === "dark" ? SUGAR_DARK : THEMES[brand];
}

/** Shared spacing / radius / motion scale so screens stop inventing values. */
export const SPACE = { xs: 6, sm: 10, md: 16, lg: 24, xl: 32, xxl: 44 } as const;
export const RADIUS = { sm: 8, md: 14, lg: 20, xl: 28, pill: 999 } as const;

/** Type has named jobs so hierarchy survives a screen’s local layout choices. */
export const TYPE = {
  // Huge display type needs air between its all-caps forms, not extra leading.
  hero: { fontSize: 76, lineHeight: 79, letterSpacing: 1.4 },
  display: { fontSize: 48, lineHeight: 50, letterSpacing: 0.5 },
  title: { fontSize: 34, lineHeight: 38, letterSpacing: 0.1 },
  heading: { fontSize: 22, lineHeight: 28, letterSpacing: 0 },
  body: { fontSize: 15, lineHeight: 21, letterSpacing: 0 },
  caption: { fontSize: 12, lineHeight: 16.2, letterSpacing: 0.25 },
  // Small all-caps labels need tracking to remain legible beside artwork.
  micro: { fontSize: 9, lineHeight: 12.2, letterSpacing: 1.1 },
} as const;

/** Accent-tinted elevation. Black drop-shadows are invisible on near-black,
 *  so depth on the Ink side comes from a colored glow instead. */
export function glow(theme: Theme, strength: "sm" | "md" = "md") {
  return {
    shadowColor: theme.accent,
    shadowOpacity: strength === "sm" ? 0.25 : 0.45,
    shadowRadius: strength === "sm" ? 10 : 20,
    shadowOffset: { width: 0, height: strength === "sm" ? 3 : 8 },
    elevation: strength === "sm" ? 4 : 10,
  };
}

/** Neutral lift for light surfaces (Sugar Haus), where a glow would look odd. */
export function lift(strength: "sm" | "md" = "md") {
  return {
    shadowColor: "#000",
    shadowOpacity: strength === "sm" ? 0.06 : 0.12,
    shadowRadius: strength === "sm" ? 8 : 18,
    shadowOffset: { width: 0, height: strength === "sm" ? 2 : 6 },
    elevation: strength === "sm" ? 2 : 6,
  };
}
