import { Modal, View, Text, StyleSheet, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useBrand } from "@/context/BrandContext";
import { Button } from "@/components/Button";
import { FULL_CROP, type CropRect } from "@/lib/crop";
import { SPACE, RADIUS } from "@/lib/theme";

/** Small enough to crop a detail, large enough to still grab the handles. */
const MIN_SIZE = 48;
/** Visual size of a corner handle. */
const HANDLE = 30;
/** How close to a corner counts as grabbing it — a fingertip, not a cursor. */
const GRAB = 44;

/**
 * Drag-a-box crop editor.
 *
 * The frame moves over a fixed image rather than the image moving behind a
 * fixed frame: a reference photo is being read, not composed, so seeing the
 * whole picture while you decide what part of it to keep matters more than a
 * viewfinder metaphor. Mount it fresh per open (give it a `key`) — the box
 * seeds from the image on mount.
 */
export function CropTool({
  uri,
  imageWidth,
  imageHeight,
  initialRect = FULL_CROP,
  onApply,
  onClose,
}: {
  uri: string;
  /** Natural pixel size, used to fit the image and to keep the box on it. */
  imageWidth: number;
  imageHeight: number;
  /** Re-opening after a crop starts from the box you last drew, not the
   *  whole frame — adjusting a crop is far more common than redoing it. */
  initialRect?: CropRect;
  onApply: (rect: CropRect) => void;
  onClose: () => void;
}) {
  const { theme } = useBrand();
  const { width: screenW, height: screenH } = useWindowDimensions();

  // Contain-fit the image into the available stage.
  const stageW = screenW - SPACE.md * 2;
  const stageH = screenH * 0.62;
  const fit = Math.min(stageW / imageWidth, stageH / imageHeight);
  const dispW = Math.max(1, imageWidth * fit);
  const dispH = Math.max(1, imageHeight * fit);

  const x = useSharedValue(initialRect.x * dispW);
  const y = useSharedValue(initialRect.y * dispH);
  const w = useSharedValue(Math.max(MIN_SIZE, initialRect.width * dispW));
  const h = useSharedValue(Math.max(MIN_SIZE, initialRect.height * dispH));

  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const startW = useSharedValue(0);
  const startH = useSharedValue(0);

  function reset() {
    x.value = 0;
    y.value = 0;
    w.value = dispW;
    h.value = dispH;
  }

  function apply() {
    // Read the final box on the JS thread and hand it back as fractions.
    onApply({
      x: x.value / dispW,
      y: y.value / dispH,
      width: w.value / dispW,
      height: h.value / dispH,
    });
  }

  /** Which edges the current drag owns: 0 move, else a corner. */
  const mode = useSharedValue(0);

  // One gesture rather than a detector per handle: nested detectors don't
  // compose on their own, and the box's own pan wins the race every time, so
  // the corners were never reachable. Where the touch lands decides the job.
  const drag = Gesture.Pan()
    .onStart((e) => {
      startX.value = x.value;
      startY.value = y.value;
      startW.value = w.value;
      startH.value = h.value;
      // Never let the grab zones meet in the middle of a small box.
      const grab = Math.min(GRAB, Math.min(w.value, h.value) / 3);
      let left = e.x < grab;
      let top = e.y < grab;
      const right = e.x > w.value - grab;
      const bottom = e.y > h.value - grab;
      let corner = (left || right) && (top || bottom);
      // While the box still covers the whole photo there is nowhere to move
      // it to, so a drag anywhere means "pull the nearest corner in" — the
      // alternative is a gesture that silently does nothing.
      if (!corner && w.value >= dispW - 0.5 && h.value >= dispH - 0.5) {
        left = e.x < w.value / 2;
        top = e.y < h.value / 2;
        corner = true;
      }
      mode.value = corner ? (left ? (top ? 1 : 3) : top ? 2 : 4) : 0;
    })
    .onUpdate((e) => {
      if (mode.value === 0) {
        x.value = Math.min(Math.max(0, startX.value + e.translationX), dispW - w.value);
        y.value = Math.min(Math.max(0, startY.value + e.translationY), dispH - h.value);
        return;
      }
      const left = mode.value === 1 || mode.value === 3;
      const top = mode.value === 1 || mode.value === 2;
      if (left) {
        const nx = Math.min(
          Math.max(0, startX.value + e.translationX),
          startX.value + startW.value - MIN_SIZE
        );
        x.value = nx;
        w.value = startW.value + (startX.value - nx);
      } else {
        w.value = Math.min(
          Math.max(MIN_SIZE, startW.value + e.translationX),
          dispW - startX.value
        );
      }
      if (top) {
        const ny = Math.min(
          Math.max(0, startY.value + e.translationY),
          startY.value + startH.value - MIN_SIZE
        );
        y.value = ny;
        h.value = startH.value + (startY.value - ny);
      } else {
        h.value = Math.min(
          Math.max(MIN_SIZE, startH.value + e.translationY),
          dispH - startY.value
        );
      }
    });

  const boxStyle = useAnimatedStyle(() => ({
    left: x.value,
    top: y.value,
    width: w.value,
    height: h.value,
  }));

  // Four shades around the box, so what's being kept reads as the lit part.
  const shadeTop = useAnimatedStyle(() => ({ top: 0, left: 0, width: dispW, height: y.value }));
  const shadeBottom = useAnimatedStyle(() => ({
    top: y.value + h.value,
    left: 0,
    width: dispW,
    height: Math.max(0, dispH - (y.value + h.value)),
  }));
  const shadeLeft = useAnimatedStyle(() => ({
    top: y.value,
    left: 0,
    width: x.value,
    height: h.value,
  }));
  const shadeRight = useAnimatedStyle(() => ({
    top: y.value,
    left: x.value + w.value,
    width: Math.max(0, dispW - (x.value + w.value)),
    height: h.value,
  }));

  const corners = [
    { key: "tl", style: { left: -HANDLE / 2, top: -HANDLE / 2 } },
    { key: "tr", style: { right: -HANDLE / 2, top: -HANDLE / 2 } },
    { key: "bl", style: { left: -HANDLE / 2, bottom: -HANDLE / 2 } },
    { key: "br", style: { right: -HANDLE / 2, bottom: -HANDLE / 2 } },
  ] as const;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.root}>
        <SafeAreaView style={[styles.backdrop, { backgroundColor: theme.background }]}>
          <Text
            accessibilityRole="header"
            style={[styles.title, { color: theme.foreground, fontFamily: theme.fontDisplay }]}
          >
            Crop the photo
          </Text>
          <Text style={[styles.hint, { color: theme.muted, fontFamily: theme.fontBody }]}>
            Drag the corners to keep only the part you want traced.
          </Text>

          <View style={styles.stage}>
            <View style={{ width: dispW, height: dispH }}>
              <Image
                source={{ uri }}
                style={StyleSheet.absoluteFill}
                contentFit="fill"
                alt="Photo being cropped"
              />
              {[shadeTop, shadeBottom, shadeLeft, shadeRight].map((s, i) => (
                <Animated.View key={i} pointerEvents="none" style={[styles.shade, s]} />
              ))}

              <GestureDetector gesture={drag}>
                <Animated.View
                  style={[styles.box, { borderColor: theme.accent }, boxStyle]}
                  accessible
                  accessibilityRole="adjustable"
                  accessibilityLabel="Crop area"
                  accessibilityHint="Drag to move, drag a corner to resize"
                >
                  {corners.map((c) => (
                    <View key={c.key} pointerEvents="none" style={[styles.handleHit, c.style]}>
                      <View style={[styles.handle, { backgroundColor: theme.accent }]} />
                    </View>
                  ))}
                </Animated.View>
              </GestureDetector>
            </View>
          </View>

          <View style={styles.actions}>
            <Button label="Cancel" onPress={onClose} style={{ flex: 1 }} />
            <Button label="Reset" icon="refresh-outline" onPress={reset} style={{ flex: 1 }} />
            <Button
              label="Crop"
              icon="crop-outline"
              variant="primary"
              onPress={apply}
              style={{ flex: 1.2 }}
            />
          </View>
        </SafeAreaView>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { flex: 1, padding: SPACE.md },
  title: { fontSize: 26, marginTop: SPACE.sm },
  hint: { fontSize: 13, marginTop: 4, marginBottom: SPACE.md },
  stage: { flex: 1, alignItems: "center", justifyContent: "center" },
  shade: { position: "absolute", backgroundColor: "rgba(8,7,7,0.62)" },
  box: { position: "absolute", borderWidth: 2, borderRadius: 2 },
  handleHit: {
    position: "absolute",
    width: HANDLE,
    height: HANDLE,
    alignItems: "center",
    justifyContent: "center",
  },
  handle: { width: 16, height: 16, borderRadius: RADIUS.sm, borderWidth: 2, borderColor: "#fff" },
  actions: { flexDirection: "row", gap: SPACE.sm, marginTop: SPACE.md },
});
