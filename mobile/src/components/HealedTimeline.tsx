import { useCallback, useEffect, useState } from "react";
import { Modal, View, Text, StyleSheet, Pressable, ScrollView, Alert } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";
import { useBrand } from "@/context/BrandContext";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { Notice } from "@/components/ui";
import { imageDataUrl } from "@/lib/imageType";
import {
  addHealedRecord,
  getHealedRecords,
  healedAge,
  recordsFor,
  removeHealedRecord,
  resolveHealed,
  type HealedRecord,
} from "@/lib/healedRecords";
import { READING_MAX_WIDTH } from "@/lib/chrome";
import { RADIUS, SPACE, TYPE } from "@/lib/theme";

/**
 * What the piece looked like once it settled.
 *
 * The editor can simulate two years and ten. This is the other half —
 * photographs of the real thing, so the line weights can be judged against
 * what actually happened rather than against a model with plausible constants
 * in it.
 *
 * The date the piece was done is asked for once and remembered, because
 * without it "6 weeks after" is a guess, and the age is the entire point of
 * the record.
 */
export function HealedTimeline({
  designId,
  title,
  createdAt,
  onClose,
}: {
  designId: string;
  title: string;
  /** When the design was made — the honest default for when it was inked. */
  createdAt: number;
  onClose: () => void;
}) {
  const { brand, theme } = useBrand();
  const [records, setRecords] = useState<HealedRecord[]>([]);
  const [shots, setShots] = useState<{ record: HealedRecord; uri: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const all = await getHealedRecords(brand.id);
    const mine = recordsFor(all, designId);
    const resolved = await resolveHealed(brand.id, mine);
    // Both pieces of state are set together from one await, so the list and
    // the photos can never render a frame out of step with each other.
    setRecords(mine);
    setShots(resolved);
  }, [brand.id, designId]);

  useEffect(() => {
    let active = true;
    (async () => {
      const all = await getHealedRecords(brand.id);
      const mine = recordsFor(all, designId);
      const resolved = await resolveHealed(brand.id, mine);
      if (!active) return;
      setRecords(mine);
      setShots(resolved);
    })();
    return () => {
      active = false;
    };
  }, [brand.id, designId]);

  async function addPhoto() {
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Allow photo access to add a healed photo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      base64: true,
      quality: 0.85,
    });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset?.base64) return;

    setBusy(true);
    try {
      await addHealedRecord(brand.id, {
        designId,
        dataUrl: imageDataUrl(asset.base64, asset.mimeType),
        // The design's own date is the best guess available without asking,
        // and it is right whenever the stencil was made for the session.
        inkedAt: createdAt,
      });
      await load();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that photo.");
    } finally {
      setBusy(false);
    }
  }

  function confirmRemove(record: HealedRecord) {
    Alert.alert("Remove this photo?", healedAge(record), [
      { text: "Keep", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          await removeHealedRecord(brand.id, record.id);
          await load();
        },
      },
    ]);
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
              HOW IT HEALED
            </Text>
            <Text
              numberOfLines={1}
              style={[TYPE.heading, { color: theme.foreground, fontFamily: theme.fontDisplay }]}
            >
              {title}
            </Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          {error && <Notice>{error}</Notice>}

          {shots.length === 0 ? (
            <View style={[styles.empty, { borderColor: theme.line, backgroundColor: theme.surface }]}>
              <Icon name="history" size={28} color={theme.muted} />
              <Text style={[TYPE.body, { color: theme.foreground, fontFamily: theme.fontBodyMedium }]}>
                No healed photos yet
              </Text>
              <Text style={[TYPE.caption, styles.centred, { color: theme.muted, fontFamily: theme.fontBody }]}>
                Add one at two weeks and again at six months. Day-one photos show the stencil; these
                show whether the line weights held.
              </Text>
            </View>
          ) : (
            shots.map(({ record, uri }) => (
              <Pressable
                key={record.id}
                onLongPress={() => confirmRemove(record)}
                accessibilityRole="image"
                accessibilityLabel={`Healed photo, ${healedAge(record)}`}
                style={[styles.shot, { borderColor: theme.line, backgroundColor: theme.surface }]}
              >
                <Image source={{ uri }} style={styles.photo} contentFit="cover" alt={healedAge(record)} />
                <View style={styles.shotMeta}>
                  <Text style={[TYPE.body, { color: theme.foreground, fontFamily: theme.fontBodyMedium }]}>
                    {healedAge(record)}
                  </Text>
                  <Text style={[TYPE.micro, { color: theme.muted, fontFamily: theme.fontBody }]}>
                    {new Date(record.at).toLocaleDateString()}
                  </Text>
                </View>
              </Pressable>
            ))
          )}

          <Button
            label={busy ? "Saving" : "Add a healed photo"}
            icon="camera-outline"
            variant="primary"
            disabled={busy}
            onPress={addPhoto}
            style={{ marginTop: SPACE.md }}
          />
          {records.length > 0 && (
            <Text style={[TYPE.caption, { color: theme.muted, fontFamily: theme.fontBody, marginTop: SPACE.sm }]}>
              Long-press a photo to remove it. Ages are measured from when this design was made.
            </Text>
          )}
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
  empty: { borderWidth: 1, borderRadius: RADIUS.lg, padding: SPACE.lg, alignItems: "center", gap: SPACE.xs },
  centred: { textAlign: "center" },
  shot: { borderWidth: 1, borderRadius: RADIUS.lg, overflow: "hidden" },
  photo: { width: "100%", aspectRatio: 1 },
  shotMeta: { padding: SPACE.sm, gap: 2 },
});
