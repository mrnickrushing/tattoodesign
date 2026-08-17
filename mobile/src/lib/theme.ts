import type { BrandId } from "./brands";

export type Theme = {
  background: string;
  foreground: string;
  paper: string;
  accent: string;
  accentText: string;
  /** Distinct from accent on purpose — accent doubles as the primary CTA
   * color, so error states need their own color to read as "wrong" rather
   * than "another button". Mirrors the web app's --danger token. */
  danger: string;
  line: string;
  /** Muted text, e.g. subtitles / captions. */
  muted: string;
  fontDisplay: string;
  fontBody: string;
  fontBodyMedium: string;
  fontScript: string;
};

export const THEMES: Record<BrandId, Theme> = {
  ink: {
    background: "#121110",
    foreground: "#f4f2ef",
    paper: "#1b1917",
    accent: "#da1b2e",
    accentText: "#ffffff",
    danger: "#ff5a3c",
    line: "#322e2a",
    muted: "#a19d98",
    fontDisplay: "BebasNeue_400Regular",
    fontBody: "Sora_400Regular",
    fontBodyMedium: "Sora_600SemiBold",
    fontScript: "Caveat_600SemiBold",
  },
  sugar: {
    background: "#fbf1ea",
    foreground: "#3b2b28",
    paper: "#ffffff",
    accent: "#d1487a",
    accentText: "#ffffff",
    danger: "#c0392b",
    line: "#f0ddd0",
    muted: "#8a7570",
    fontDisplay: "PlayfairDisplay_700Bold",
    fontBody: "Inter_400Regular",
    fontBodyMedium: "Inter_600SemiBold",
    fontScript: "Caveat_600SemiBold",
  },
};

export const NEUTRAL_THEME: Theme = {
  background: "#f5f4f0",
  foreground: "#141311",
  paper: "#ffffff",
  accent: "#b5121b",
  accentText: "#ffffff",
  danger: "#b5121b",
  line: "#dedad2",
  muted: "#8a857e",
  fontDisplay: "BebasNeue_400Regular",
  fontBody: "Inter_400Regular",
  fontBodyMedium: "Inter_600SemiBold",
  fontScript: "Caveat_600SemiBold",
};
