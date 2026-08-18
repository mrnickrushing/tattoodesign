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
    background: "#0d0c0b",
    surface: "#161412",
    surfaceAlt: "#1e1b18",
    foreground: "#f4f2ef",
    paper: "#161412",
    accent: "#da1b2e",
    accentText: "#ffffff",
    accentGlow: "rgba(218, 27, 46, 0.35)",
    danger: "#ff5a3c",
    line: "#2b2724",
    muted: "#8d8681",
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
    background: "#fbf1ea",
    surface: "#ffffff",
    surfaceAlt: "#fdf6f1",
    foreground: "#3b2b28",
    paper: "#ffffff",
    accent: "#d1487a",
    accentText: "#ffffff",
    accentGlow: "rgba(209, 72, 122, 0.28)",
    danger: "#c0392b",
    line: "#f0ddd0",
    muted: "#96827c",
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

/** Shared spacing / radius / motion scale so screens stop inventing values. */
export const SPACE = { xs: 6, sm: 10, md: 16, lg: 24, xl: 32, xxl: 44 } as const;
export const RADIUS = { sm: 8, md: 14, lg: 20, xl: 28, pill: 999 } as const;

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
