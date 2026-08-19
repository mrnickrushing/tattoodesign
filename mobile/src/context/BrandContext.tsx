import { createContext, useContext, useMemo } from "react";
import { useColorScheme } from "react-native";
import type { BrandConfig } from "@/lib/brands";
import { resolveTheme, type Theme } from "@/lib/theme";

export type BrandContextValue = {
  brand: BrandConfig;
  theme: Theme;
  /** The appearance of the resolved studio chrome, not merely the device setting. */
  appearance?: "light" | "dark";
};

const BrandContext = createContext<BrandContextValue | null>(null);

type BrandProviderValue = Pick<BrandContextValue, "brand"> & Partial<Pick<BrandContextValue, "theme">>;

export function BrandProvider({
  value,
  children,
}: {
  value: BrandProviderValue;
  children: React.ReactNode;
}) {
  const scheme = useColorScheme();
  const resolvedScheme = scheme === "light" || scheme === "dark" ? scheme : null;
  const resolvedValue = useMemo<BrandContextValue>(() => {
    const theme = resolveTheme(value.brand.id, resolvedScheme);
    // Ink Lab is dark stock in either system appearance; Sugar follows the
    // system so its warm night palette does not light up an early kitchen.
    const appearance = value.brand.id === "ink" || resolvedScheme === "dark" ? "dark" : "light";
    return { brand: value.brand, theme, appearance };
  }, [resolvedScheme, value.brand]);

  return <BrandContext.Provider value={resolvedValue}>{children}</BrandContext.Provider>;
}

export function useBrand(): BrandContextValue {
  const ctx = useContext(BrandContext);
  if (!ctx) throw new Error("useBrand must be used within a BrandProvider");
  return ctx;
}
