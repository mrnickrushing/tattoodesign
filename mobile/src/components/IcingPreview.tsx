import { useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";
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
import { SPACE, RADIUS } from "@/lib/theme";

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
    recolor(uri, colors)
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
              <View style={[styles.swatch, { backgroundColor: c.hex, borderColor: theme.line }]} />
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

const styles = StyleSheet.create({
  root: { flex: 1, padding: SPACE.md },
  head: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, marginBottom: SPACE.md },
  title: { fontSize: 26, letterSpacing: 0.3 },
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
  swatch: { width: 44, height: 44, borderRadius: RADIUS.sm, borderWidth: 1 },
});
