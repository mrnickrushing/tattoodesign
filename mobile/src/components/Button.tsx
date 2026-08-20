import { Pressable, Text, ActivityIndicator, StyleSheet, View, type ViewStyle } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useBrand } from "@/context/BrandContext";
import { RADIUS, SPACE, glow, lift } from "@/lib/theme";

type Variant = "primary" | "secondary" | "danger";

export function Button({
  label,
  icon,
  onPress,
  variant = "secondary",
  disabled,
  loading,
  style,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}) {
  const { brand, theme } = useBrand();
  const off = disabled || loading;

  const bg =
    variant === "primary" ? "transparent" : variant === "danger" ? "transparent" : theme.surfaceAlt;
  const fg =
    variant === "primary"
      ? theme.accentText
      : variant === "danger"
        ? theme.danger
        : theme.foreground;
  const border =
    variant === "primary" ? theme.accent : variant === "danger" ? theme.danger : theme.line;

  // Depth reads differently per brand: a colored glow on near-black, a soft
  // neutral lift on cream. Only the primary action gets it — one emphasis.
  const depth =
    variant === "primary" && !off ? (brand.id === "ink" ? glow(theme, "md") : lift("md")) : null;

  return (
    <Pressable
      onPress={() => {
        if (off) return;
        Haptics.impactAsync(
          variant === "primary"
            ? Haptics.ImpactFeedbackStyle.Medium
            : Haptics.ImpactFeedbackStyle.Light
        );
        onPress();
      }}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off }}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: bg, borderColor: border },
        depth,
        off && styles.off,
        pressed && !off && { transform: [{ scale: 0.975 }], opacity: 0.9 },
        style,
      ]}
    >
      {variant === "primary" && (
        <>
          <LinearGradient
            colors={
              brand.id === "ink"
                ? (["#ff334b", theme.accent, "#a70f22"] as const)
                : (["#ee6f9c", theme.accent, "#aa315d"] as const)
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.sheen} />
        </>
      )}
      {loading ? (
        <ActivityIndicator color={fg} style={styles.content} />
      ) : (
        <View style={[styles.row, styles.content]}>
          {icon && <Ionicons name={icon} size={17} color={fg} />}
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            style={[styles.label, { color: fg, fontFamily: theme.fontBodyMedium }]}
          >
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: SPACE.md,
    overflow: "hidden",
  },
  sheen: {
    position: "absolute",
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "rgba(255,255,255,0.12)",
    right: -54,
    top: -84,
  },
  content: { zIndex: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  // numberOfLines + adjustsFontSizeToFit on the Text keep a label on one
  // line, shrinking it slightly instead of breaking words ("Dupl icate")
  // when four pills share a row. flexShrink lets the text yield to the icon.
  label: { fontSize: 15, letterSpacing: 0.2, flexShrink: 1 },
  off: { opacity: 0.35 },
});
