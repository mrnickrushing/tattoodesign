import { useEffect, useState } from "react";
import { Modal, View, Text, StyleSheet, Pressable, ScrollView, Alert } from "react-native";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";
import { useBrand } from "@/context/BrandContext";
import { Icon } from "@/components/Icon";
import { Notice } from "@/components/ui";
import { restoreVersion, versionImage, type LibraryDesign } from "@/lib/designLibrary";
import { describeAge } from "@/lib/printLog";
import { READING_MAX_WIDTH } from "@/lib/chrome";
import { RADIUS, SPACE, TYPE } from "@/lib/theme";

/**
 * Going back to a version you already had.
 *
 * Editing used to delete the version it replaced, so a design iterated five
 * times had no way back to the third — and the one that got printed is often
 * not the one you ended up with.
 *
 * Restoring is itself an edit: the current version joins the history rather
 * than being discarded, so going back is undoable too. Anything else would
 * make restore the one destructive action in the whole editor.
 */
export function VersionHistory({
  design,
  onClose,
  onRestored,
}: {
  design: LibraryDesign;
  onClose: () => void;
  onRestored: () => void;
}) {
  const { brand, theme } = useBrand();
  const [shots, setShots] = useState<{ file: string; at: number; uri: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Captured once. Ages that shift between renders would be both wrong and
  // an impure read during render.
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    (async () => {
      const resolved: { file: string; at: number; uri: string }[] = [];
      for (const version of design.history ?? []) {
        const uri = await versionImage(brand.id, version.file);
        // A version whose pixels are gone is not shown — offering to restore
        // something that cannot be restored is worse than not offering.
        if (uri) resolved.push({ ...version, uri });
      }
      if (active) setShots(resolved);
    })();
    return () => {
      active = false;
    };
  }, [brand.id, design.history]);

  function confirmRestore(file: string, at: number) {
    Alert.alert(
      "Restore this version?",
      `The current version is kept, so you can come back to it. This one is from ${describeAge(now - at)}.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Restore",
          onPress: async () => {
            setBusy(true);
            setError(null);
            try {
              const restored = await restoreVersion(brand.id, design.id, file);
              if (!restored) throw new Error("That version's image is no longer available.");
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              onRestored();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Couldn't restore that version.");
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  }

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
        <View style={styles.topbar}>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={[styles.iconButton, { backgroundColor: theme.surfaceAlt }]}
          >
            <Icon name="chevronDown" size={TYPE.heading.fontSize} color={theme.foreground} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[TYPE.micro, { color: theme.accent, fontFamily: theme.fontBodyMedium }]}>
              EARLIER VERSIONS
            </Text>
            <Text
              numberOfLines={1}
              style={[TYPE.heading, { color: theme.foreground, fontFamily: theme.fontDisplay }]}
            >
              {design.title}
            </Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          {error && <Notice>{error}</Notice>}

          <View style={[styles.current, { borderColor: theme.accent, backgroundColor: theme.surface }]}>
            <Image source={{ uri: design.uri }} style={styles.thumb} contentFit="contain" alt="Current version" />
            <View style={{ flex: 1 }}>
              <Text style={[TYPE.body, { color: theme.foreground, fontFamily: theme.fontBodyMedium }]}>
                Now
              </Text>
              <Text style={[TYPE.micro, { color: theme.muted, fontFamily: theme.fontBody }]}>
                The version in your library
              </Text>
            </View>
          </View>

          {shots.map((version) => (
            <Pressable
              key={version.file}
              onPress={() => !busy && confirmRestore(version.file, version.at)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`Restore the version from ${describeAge(now - version.at)}`}
              style={({ pressed }) => [
                styles.row,
                { borderColor: theme.line, backgroundColor: theme.surface, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Image source={{ uri: version.uri }} style={styles.thumb} contentFit="contain" alt="Earlier version" />
              <View style={{ flex: 1 }}>
                <Text style={[TYPE.body, { color: theme.foreground, fontFamily: theme.fontBodyMedium }]}>
                  {describeAge(now - version.at)}
                </Text>
                <Text style={[TYPE.micro, { color: theme.muted, fontFamily: theme.fontBody }]}>
                  {new Date(version.at).toLocaleString()}
                </Text>
              </View>
              <Icon name="undo" size={TYPE.body.fontSize} color={theme.muted} />
            </Pressable>
          ))}

          {shots.length === 0 && (
            <Text style={[TYPE.caption, { color: theme.muted, fontFamily: theme.fontBody }]}>
              The earlier images for this design are no longer on this device.
            </Text>
          )}

          <Text style={[TYPE.caption, { color: theme.muted, fontFamily: theme.fontBody, marginTop: SPACE.sm }]}>
            Restoring keeps the current version too, so you can always come back to it.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: SPACE.md },
  topbar: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, paddingVertical: SPACE.sm },
  iconButton: { width: 38, height: 38, borderRadius: RADIUS.pill, alignItems: "center", justifyContent: "center" },
  body: {
    paddingBottom: SPACE.xxl,
    gap: SPACE.sm,
    width: "100%",
    maxWidth: READING_MAX_WIDTH,
    alignSelf: "center",
  },
  current: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.sm,
    borderWidth: 2,
    borderRadius: RADIUS.lg,
    padding: SPACE.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.sm,
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    padding: SPACE.sm,
  },
  thumb: { width: 56, height: 56, borderRadius: RADIUS.sm, backgroundColor: "#fff" },
});
