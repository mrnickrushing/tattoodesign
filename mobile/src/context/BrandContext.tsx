import { createContext, useContext } from "react";
import type { BrandConfig } from "@/lib/brands";
import type { Theme } from "@/lib/theme";

export type BrandContextValue = {
  brand: BrandConfig;
  theme: Theme;
};

const BrandContext = createContext<BrandContextValue | null>(null);

export function BrandProvider({
  value,
  children,
}: {
  value: BrandContextValue;
  children: React.ReactNode;
}) {
  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBrand(): BrandContextValue {
  const ctx = useContext(BrandContext);
  if (!ctx) throw new Error("useBrand must be used within a BrandProvider");
  return ctx;
}
