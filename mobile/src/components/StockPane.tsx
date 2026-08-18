import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  type ViewStyle,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useBrand } from "@/context/BrandContext";
import { ImageViewer } from "@/components/ImageViewer";
import { RADIUS } from "@/lib/theme";

/**
 * The app's signature surface. Real tattoo flash is printed on warm off-white
 * stock with registration marks at the corners and a numbered index so a
 * customer can point and say "that one, number two". Sugar Haus is the same
 * device reskinned as parchment. Empty isn't a void here — it's blank stock
 * waiting for a design, which is why the marks and grid show through.
 */
export function StockPane({
  /** Index shown in the corner badge, e.g. 1 -> "01". */
  index,
  label,
  uri,
  loading,
  loadingLabel = "Working",
  emptyIcon = "scan-outline",
  emptyHint,
  style,
  onPressEmpty,
}: {
  index?: number;
  label: string;
  uri: string | null;
  loading?: boolean;
  loadingLabel?: string;
  emptyIcon?: keyof typeof Ionicons.glyphMap;
  emptyHint?: string;
  style?: ViewStyle;
  /** Called when tapped while empty — e.g. "pick a photo". A filled pane
   *  always opens the zoom viewer instead. */
  onPressEmpty?: () => void;
}) {
  const { theme } = useBrand();
  const [zoomed, setZoomed] = useState(false);
  const filled = !!uri;

  return (
    <Pressable
      onPress={() => {
        if (filled) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setZoomed(true);
        } else onPressEmpty?.();
      }}
      disabled={!filled && !onPressEmpty}
      accessibilityRole={filled || onPressEmpty ? "button" : "image"}
      accessibilityLabel={
        filled ? `${label}, tap to zoom` : `${label}, empty`
      }
      style={({ pressed }) => [
        styles.pane,
        { backgroundColor: theme.stock, borderColor: theme.line },
        pressed && (filled || onPressEmpty) ? { opacity: 0.9 } : null,
        style,
      ]}
    >
      {/* Registration marks — the tell that this is printed stock. */}
      <CropMarks color={theme.stockMark} />
      {!filled && <DotGrid color={theme.stockGrid} />}

      {filled ? (
        <Image source={{ uri: uri! }} style={styles.image} contentFit="contain" alt={label} />
      ) : (
        <View style={styles.empty}>
          <Ionicons name={emptyIcon} size={28} color={theme.stockMark} />
          {emptyHint && (
            <Text style={[styles.hint, { color: theme.stockMark }]} numberOfLines={2}>
              {emptyHint}
            </Text>
          )}
        </View>
      )}

      {loading && (
        <View style={[styles.overlay, { backgroundColor: `${theme.stock}e6` }]}>
          <ActivityIndicator color={theme.accent} />
          <Text style={[styles.loadingText, { color: theme.stockInk }]}>{loadingLabel}</Text>
        </View>
      )}

      {/* Index + label sit on the stock like a printed caption, not a chip. */}
      <View style={styles.caption} pointerEvents="none">
        {index !== undefined && (
          <Text style={[styles.index, { color: theme.stockInk, fontFamily: theme.fontDisplay }]}>
            {String(index).padStart(2, "0")}
          </Text>
        )}
        <Text style={[styles.label, { color: theme.stockMark }]}>{label.toUpperCase()}</Text>
      </View>

      {/* Affordance: only shown once there's something worth opening. */}
      {filled && (
        <View style={[styles.expand, { backgroundColor: `${theme.stockInk}14` }]} pointerEvents="none">
          <Ionicons name="expand-outline" size={13} color={theme.stockInk} />
        </View>
      )}

      <ImageViewer
        uri={zoomed ? uri : null}
        title={label}
        onClose={() => setZoomed(false)}
      />
    </Pressable>
  );
}

/** Four L-shaped corner marks, the way a print proof is trimmed. */
function CropMarks({ color }: { color: string }) {
  const corners: ViewStyle[] = [
    { top: 8, left: 8, borderTopWidth: 1, borderLeftWidth: 1 },
    { top: 8, right: 8, borderTopWidth: 1, borderRightWidth: 1 },
    { bottom: 8, left: 8, borderBottomWidth: 1, borderLeftWidth: 1 },
    { bottom: 8, right: 8, borderBottomWidth: 1, borderRightWidth: 1 },
  ];
  return (
    <>
      {corners.map((c, i) => (
        <View key={i} pointerEvents="none" style={[styles.mark, { borderColor: color }, c]} />
      ))}
    </>
  );
}

/** Printed dot grid, only visible while the stock is blank. */
function DotGrid({ color }: { color: string }) {
  const dots = [];
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      dots.push(
        <View
          key={`${r}-${c}`}
          style={[
            styles.dot,
            { backgroundColor: color, top: `${12 + r * 12.5}%`, left: `${12 + c * 12.5}%` },
          ]}
        />
      );
    }
  }
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {dots}
    </View>
  );
}

const styles = StyleSheet.create({
  pane: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  image: { width: "100%", height: "100%" },
  mark: { position: "absolute", width: 12, height: 12 },
  dot: { position: "absolute", width: 1.5, height: 1.5, borderRadius: 1 },
  empty: { alignItems: "center", gap: 6, paddingHorizontal: 16 },
  hint: { fontSize: 11, textAlign: "center", lineHeight: 15 },
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  loadingText: { fontSize: 11, letterSpacing: 0.5 },
  caption: {
    position: "absolute",
    left: 12,
    bottom: 10,
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
  },
  expand: {
    position: "absolute",
    right: 8,
    bottom: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  index: { fontSize: 20, lineHeight: 22, opacity: 0.35 },
  label: { fontSize: 9, letterSpacing: 1.5, fontWeight: "600" },
});
