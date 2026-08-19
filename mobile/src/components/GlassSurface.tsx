import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable, type GlassStyle } from "expo-glass-effect";
import type { ReactNode } from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useBrand } from "@/context/BrandContext";

export const hasLiquidGlass =
  Platform.OS === "ios" && isLiquidGlassAvailable() && isGlassEffectAPIAvailable();

/**
 * Lets chrome become translucent where the OS can do it safely, while keeping
 * the familiar surfaced card treatment intact on every other device.
 */
export function GlassSurface({
  children,
  tint = "regular",
  style,
  fallbackColor,
}: {
  children: ReactNode;
  tint?: GlassStyle;
  style?: StyleProp<ViewStyle>;
  fallbackColor?: string;
}) {
  const { theme } = useBrand();

  if (hasLiquidGlass) {
    return (
      <GlassView glassEffectStyle={tint} tintColor={theme.surface} style={[styles.glass, style]}>
        {children}
      </GlassView>
    );
  }

  return (
    <View style={[styles.fallback, { backgroundColor: fallbackColor ?? theme.surface, borderColor: theme.line }, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  glass: { overflow: "hidden" },
  fallback: { borderWidth: 1, overflow: "hidden" },
});
