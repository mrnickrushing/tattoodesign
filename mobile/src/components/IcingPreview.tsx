import { useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Platform,
  type LayoutChangeEvent,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";
import { Canvas, LinearGradient, RoundedRect } from "@shopify/react-native-skia";
import { useBrand } from "@/context/BrandContext";
import { Button } from "@/components/Button";
import { Notice } from "@/components/ui";
import {
  DEFAULT_ICING,
  FLOOD_COLORS,
  LINE_COLORS,
  recolor,
  type IcingColors,
} from "@/lib/icing";
import { readImageDataUrl } from "@/lib/imageSource";
import { SPACE, RADIUS, TYPE } from "@/lib/theme";

/**
 * Try icing colors on a design before mixing any.
 *
 * The decision this supports is "will the outline still read once the flood
 * goes down" — which is why both colors are pickable and shown together,
 * rather than tinting the whole thing one shade.
 */
export function IcingPreview({
  uri,
  title,
  onSave,
  onClose,
}: {
  uri: string;
  title: string;
  /** Keeps the colored version as its own design, ready to place on a sheet. */
  onSave: (dataUrl: string, colors: IcingColors) => Promise<void> | void;
  onClose: () => void;
}) {
  const { theme } = useBrand();
  const [colors, setColors] = useState<IcingColors>(DEFAULT_ICING);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    // A library design is a file:// path on a phone and a blob: URL in a
    // browser; recolor decodes base64 and can read neither.
    readImageDataUrl(uri)
      .then((source) => recolor(source, colors))
      .then((result) => {
        if (!active) return;
        setPreview(result);
        setError(null);
        setPending(false);
      })
      .catch((e: unknown) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Couldn't build the preview.");
        setPending(false);
      });
    return () => {
      active = false;
    };
  }, [uri, colors]);

  function pick(patch: Partial<IcingColors>) {
    Haptics.selectionAsync();
    setPending(true);
    setSaved(false);
    setColors((prev) => ({ ...prev, ...patch }));
  }

  async function save() {
    if (!preview) return;
    await onSave(preview, colors);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSaved(true);
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]}>
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text
              accessibilityRole="header"
              style={[styles.title, { color: theme.foreground, fontFamily: theme.fontDisplay }]}
              numberOfLines={1}
            >
              Icing colors
            </Text>
            <Text
              style={{ color: theme.muted, fontFamily: theme.fontBody, fontSize: 12 }}
              numberOfLines={1}
            >
              {title}
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={12}
            style={({ pressed }) => [
              styles.close,
              { backgroundColor: theme.surfaceAlt, opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Ionicons name="close" size={20} color={theme.foreground} />
          </Pressable>
        </View>

        <View style={[styles.stage, { backgroundColor: colors.flood, borderColor: theme.line }]}>
          {preview && (
            <Image
              source={{ uri: preview }}
              style={StyleSheet.absoluteFill}
              contentFit="contain"
              alt={`${title} in ${colors.flood} icing`}
            />
          )}
          <IcingFinish color={colors.flood} radius={RADIUS.md} />
          {pending && (
            <View style={styles.pending}>
              <ActivityIndicator color={theme.accent} />
            </View>
          )}
        </View>

        {error && (
          <View style={{ marginTop: SPACE.md }}>
            <Notice>{error}</Notice>
          </View>
        )}

        <Swatches
          label="Flood"
          options={FLOOD_COLORS}
          selected={colors.flood}
          onPick={(hex) => pick({ flood: hex })}
        />
        <Swatches
          label="Piping"
          options={LINE_COLORS}
          selected={colors.line}
          onPick={(hex) => pick({ line: hex })}
        />

        <Button
          label={saved ? "Saved to your designs" : "Save this version"}
          icon={saved ? "checkmark" : "color-palette-outline"}
          variant="primary"
          disabled={!preview || pending || saved}
          onPress={save}
          style={{ marginTop: SPACE.md }}
        />
      </SafeAreaView>
    </Modal>
  );
}

function Swatches({
  label,
  options,
  selected,
  onPick,
}: {
  label: string;
  options: { name: string; hex: string }[];
  selected: string;
  onPick: (hex: string) => void;
}) {
  const { theme } = useBrand();
  return (
    <View style={{ marginTop: SPACE.md }}>
      <Text style={[styles.field, { color: theme.muted, fontFamily: theme.fontBodyMedium }]}>
        {label.toUpperCase()}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {options.map((c) => {
          const active = c.hex.toLowerCase() === selected.toLowerCase();
          return (
            <Pressable
              key={c.hex}
              onPress={() => onPick(c.hex)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${label} ${c.name}`}
              style={({ pressed }) => [
                styles.swatchWrap,
                { borderColor: active ? theme.accent : "transparent", opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <View style={[styles.swatch, { backgroundColor: c.hex, borderColor: theme.line }]}>
                <IcingFinish color={c.hex} radius={RADIUS.sm} />
              </View>
              <Text style={{ color: theme.muted, fontSize: 10, fontFamily: theme.fontBody }}>
                {c.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

type IcingFinishProps = {
  color: string;
  radius: number;
};

/**
 * Royal icing holds a rounded, wet-looking surface after it has set. Skia is
 * intentionally native-only here: web would need CanvasKit initialization,
 * while the existing flat swatch remains a truthful and safe fallback.
 */
function IcingFinish({ color, radius }: IcingFinishProps) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const luminance = colorLuminance(color);
  // Pale buttercreams need a quiet sheen; dark berry and cocoa icing can carry
  // a brighter reflection without turning chalky.
  const highlight = 0.16 + (1 - luminance) * 0.28;
  const bevel = 0.1 + (1 - luminance) * 0.16;

  function onLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    setSize((current) =>
      current.width === width && current.height === height ? current : { width, height }
    );
  }

  if (Platform.OS === "web") {
    return null;
  }

  const { width, height } = size;
  if (width === 0 || height === 0) {
    return <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={onLayout} />;
  }

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={onLayout}>
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        {/* The edge catches light first, making a flat flood color feel piped
            and slightly raised rather than like a printed swatch. */}
        <RoundedRect
          x={0.5}
          y={0.5}
          width={width - 1}
          height={height - 1}
          r={radius}
          color={`rgba(255, 255, 255, ${bevel.toFixed(2)})`}
          style="stroke"
          strokeWidth={1}
        />
        <RoundedRect
          x={width * 0.055}
          y={height * 0.05}
          width={width * 0.72}
          height={height * 0.42}
          r={Math.max(1, radius - 2)}
        >
          <LinearGradient
            start={{ x: width * 0.08, y: height * 0.05 }}
            end={{ x: width * 0.64, y: height * 0.47 }}
            colors={[
              `rgba(255, 255, 255, ${highlight.toFixed(2)})`,
              `rgba(255, 255, 255, ${(highlight * 0.42).toFixed(2)})`,
              "rgba(255, 255, 255, 0)",
            ]}
            positions={[0, 0.52, 1]}
          />
        </RoundedRect>
        <RoundedRect
          x={width * 0.15}
          y={height * 0.11}
          width={width * 0.32}
          height={Math.max(1, height * 0.11)}
          r={RADIUS.pill}
        >
          <LinearGradient
            start={{ x: width * 0.15, y: height * 0.11 }}
            end={{ x: width * 0.47, y: height * 0.11 }}
            colors={[
              `rgba(255, 255, 255, ${(highlight * 0.85).toFixed(2)})`,
              "rgba(255, 255, 255, 0)",
            ]}
            positions={[0, 1]}
          />
        </RoundedRect>
      </Canvas>
    </View>
  );
}

function colorLuminance(hex: string) {
  const value = hex.replace("#", "");
  if (!/^[\da-f]{6}$/i.test(value)) return 0.5;

  const channel = (offset: number) => {
    const normalized = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: SPACE.md },
  head: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, marginBottom: SPACE.md },
  title: { ...TYPE.heading, letterSpacing: 0.3 },
  close: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  stage: {
    flex: 1,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    overflow: "hidden",
  },
  pending: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  field: { fontSize: 10, letterSpacing: 1.5, marginBottom: SPACE.sm },
  row: { gap: SPACE.sm, paddingRight: SPACE.md },
  swatchWrap: {
    alignItems: "center",
    gap: 5,
    padding: 4,
    borderWidth: 2,
    borderRadius: RADIUS.md,
    width: 62,
  },
  swatch: { width: 44, height: 44, borderRadius: RADIUS.sm, borderWidth: 1, overflow: "hidden" },
});
