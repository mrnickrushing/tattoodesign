// Batch conversion: many photos through one trace preset, keep the good ones.
//
// Sequencing lives in lib/batch.ts as a pure reducer; this modal runs the
// queue one photo at a time (tracing is CPU-heavy — parallel runs would fight
// over the JS thread), renders the keep/discard grid, and lands keepers in
// the library under a shared batch tag.

import { useEffect, useRef, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useBrand } from "@/context/BrandContext";
import { Button } from "@/components/Button";
import { Notice } from "@/components/ui";
import { addToLibrary, setDesignTags } from "@/lib/designLibrary";
import { imageDataUrl } from "@/lib/imageType";
import { stencilize, type StencilOptions } from "@/lib/stencil";
import {
  BATCH_LIMIT,
  batchTag,
  completeItem,
  createBatch,
  failItem,
  keepers,
  nextPending,
  retryItem,
  startItem,
  summarize,
  toggleKeep,
  type BatchState,
} from "@/lib/batch";
import { RADIUS, SPACE } from "@/lib/theme";

export function BatchConvert({
  options,
  onDone,
  onClose,
}: {
  /** The trace preset from the convert screen — one preset for the batch. */
  options: StencilOptions;
  /** Called with how many designs were added, so the caller can refresh. */
  onDone: (added: number) => void;
  onClose: () => void;
}) {
  const { brand, theme } = useBrand();
  const [state, setState] = useState<BatchState | null>(null);
  const [adding, setAdding] = useState(false);
  const stateRef = useRef<BatchState | null>(null);
  stateRef.current = state;

  useEffect(() => {
    let active = true;
    (async () => {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Photo access needed", "Allow photo access to pick a batch.");
        onClose();
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        selectionLimit: BATCH_LIMIT,
        quality: 0.9,
      });
      if (!active) return;
      if (result.canceled || !result.assets.length) {
        onClose();
        return;
      }
      setState(createBatch(result.assets.map((asset) => asset.uri)));
    })();
    return () => {
      active = false;
    };
    // The picker runs once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The runner: whenever the queue has a free slot, trace the next photo.
  useEffect(() => {
    if (!state) return;
    const next = nextPending(state);
    if (!next) return;
    let cancelled = false;
    setState((current) => (current ? startItem(current, next.id) : current));
    (async () => {
      try {
        const base64 = await new File(next.uri).base64();
        const traced = await stencilize(imageDataUrl(base64), options);
        if (!cancelled) setState((current) => (current ? completeItem(current, next.id, traced) : current));
      } catch (e) {
        if (!cancelled)
          setState((current) =>
            current ? failItem(current, next.id, e instanceof Error ? e.message : "Trace failed") : current
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state, options]);

  async function addKeepers() {
    const current = stateRef.current;
    if (!current) return;
    setAdding(true);
    try {
      const tag = batchTag(Date.now());
      const kept = keepers(current);
      for (const [index, item] of kept.entries()) {
        const entry = await addToLibrary(brand.id, {
          dataUrl: item.resultUrl!,
          title: `Batch trace ${index + 1}`,
          source: "converted",
        });
        await setDesignTags(brand.id, entry.id, [tag]);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onDone(kept.length);
    } catch (e) {
      Alert.alert("Couldn't add the batch", e instanceof Error ? e.message : "Try again.");
      setAdding(false);
    }
  }

  const summary = state ? summarize(state) : null;

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]}>
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.accent, fontFamily: theme.fontBodyMedium, fontSize: 10, letterSpacing: 1.6 }}>
              ONE PRESET · MANY PHOTOS
            </Text>
            <Text style={{ color: theme.foreground, fontFamily: theme.fontDisplay, fontSize: 26 }}>Batch trace</Text>
          </View>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close batch"
            style={[styles.close, { backgroundColor: theme.surfaceAlt }]}
          >
            <Ionicons name="close" size={20} color={theme.foreground} />
          </Pressable>
        </View>

        {summary && (
          <Text style={{ color: theme.muted, fontFamily: theme.fontBody, fontSize: 12, paddingHorizontal: SPACE.md }}>
            {summary.finished
              ? `${summary.done} traced · ${summary.failed} failed · ${summary.kept} kept`
              : `Tracing ${summary.done + summary.failed + 1} of ${summary.total}…`}
          </Text>
        )}

        <ScrollView contentContainerStyle={styles.grid}>
          {state?.items.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => {
                if (item.status === "done") {
                  setState((current) => (current ? toggleKeep(current, item.id) : current));
                  Haptics.selectionAsync();
                } else if (item.status === "failed") {
                  setState((current) => (current ? retryItem(current, item.id) : current));
                }
              }}
              accessibilityRole="button"
              accessibilityLabel={
                item.status === "done"
                  ? `${item.keep ? "Discard" : "Keep"} traced result`
                  : item.status === "failed"
                    ? "Retry this photo"
                    : "Waiting"
              }
              style={[
                styles.cell,
                {
                  borderColor: item.status === "done" && item.keep ? theme.accent : theme.line,
                  backgroundColor: theme.stock,
                  opacity: item.status === "done" && !item.keep ? 0.45 : 1,
                },
              ]}
            >
              <Image
                source={{ uri: item.resultUrl ?? item.uri }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
              />
              <View style={[styles.badge, { backgroundColor: `${theme.surface}e8` }]}>
                {item.status === "processing" && <Ionicons name="hourglass-outline" size={13} color={theme.accent} />}
                {item.status === "pending" && <Ionicons name="time-outline" size={13} color={theme.muted} />}
                {item.status === "failed" && <Ionicons name="refresh-outline" size={13} color={theme.danger} />}
                {item.status === "done" && (
                  <Ionicons name={item.keep ? "checkmark-circle" : "ellipse-outline"} size={13} color={item.keep ? theme.accent : theme.muted} />
                )}
              </View>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.footer}>
          {summary && summary.failed > 0 && summary.finished && (
            <Notice tone="info" icon="refresh-outline">
              Tap a failed photo to retry it with the same preset.
            </Notice>
          )}
          <Button
            label={
              summary?.finished
                ? `Add ${summary.kept} to the library`
                : "Tracing…"
            }
            icon="albums-outline"
            variant="primary"
            loading={adding}
            disabled={!summary?.finished || summary.kept === 0 || adding}
            onPress={() => void addKeepers()}
          />
          <Text style={{ color: theme.muted, fontFamily: theme.fontBody, fontSize: 10, textAlign: "center" }}>
            Tap a result to keep or discard it. Kept designs are tagged with today&apos;s batch.
          </Text>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  head: { flexDirection: "row", alignItems: "center", padding: SPACE.md, gap: SPACE.sm },
  close: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm, padding: SPACE.md },
  cell: { width: "30%", aspectRatio: 1, borderWidth: 2, borderRadius: RADIUS.sm, overflow: "hidden" },
  badge: { position: "absolute", top: 5, right: 5, width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  footer: { padding: SPACE.md, gap: SPACE.sm },
});
