import { Modal, Pressable, StyleSheet, View, Text, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useBrand } from "@/context/BrandContext";
import { SPACE, RADIUS } from "@/lib/theme";

const MAX_SCALE = 6;
const DOUBLE_TAP_SCALE = 2.5;

/**
 * Full-screen viewer for a finished design. Line art is the whole point of
 * this app, and detail in a stencil is the thing you actually need to judge
 * before committing it to skin or icing — so the panes are worth opening.
 */
export function ImageViewer({
  uri,
  title,
  onClose,
}: {
  uri: string | null;
  title?: string;
  onClose: () => void;
}) {
  const { theme } = useBrand();
  const { width, height } = useWindowDimensions();

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  function reset() {
    scale.value = withTiming(1);
    savedScale.value = 1;
    x.value = withTiming(0);
    y.value = withTiming(0);
    savedX.value = 0;
    savedY.value = 0;
  }

  function handleClose() {
    reset();
    onClose();
  }

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(MAX_SCALE, Math.max(1, savedScale.value * e.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      // Snapping back to fit means you can never lose the image off-screen.
      if (scale.value <= 1.02) {
        scale.value = withTiming(1);
        savedScale.value = 1;
        x.value = withTiming(0);
        y.value = withTiming(0);
        savedX.value = 0;
        savedY.value = 0;
      }
    });

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      // Panning only makes sense once zoomed past fit.
      if (savedScale.value <= 1) return;
      x.value = savedX.value + e.translationX;
      y.value = savedY.value + e.translationY;
    })
    .onEnd(() => {
      savedX.value = x.value;
      savedY.value = y.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (savedScale.value > 1) {
        scale.value = withTiming(1);
        savedScale.value = 1;
        x.value = withTiming(0);
        y.value = withTiming(0);
        savedX.value = 0;
        savedY.value = 0;
      } else {
        scale.value = withTiming(DOUBLE_TAP_SCALE);
        savedScale.value = DOUBLE_TAP_SCALE;
      }
    });

  // A single tap closes, but only when not zoomed in — otherwise every
  // attempt to reposition a zoomed image would dismiss the viewer.
  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .onEnd(() => {
      if (savedScale.value <= 1) runOnJS(handleClose)();
    });

  const gesture = Gesture.Simultaneous(
    pinch,
    pan,
    Gesture.Exclusive(doubleTap, singleTap)
  );

  const imageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
  }));

  return (
    <Modal
      visible={!!uri}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <GestureHandlerRootView style={styles.root}>
        <View style={styles.backdrop}>
          <GestureDetector gesture={gesture}>
            <Animated.View style={[styles.stage, { width, height }]}>
              {uri && (
                <Animated.View style={[{ width, height: width }, imageStyle]}>
                  <Image
                    source={{ uri }}
                    style={styles.image}
                    contentFit="contain"
                    alt={title ?? "Design"}
                  />
                </Animated.View>
              )}
            </Animated.View>
          </GestureDetector>

          <SafeAreaView edges={["top"]} style={styles.topBar} pointerEvents="box-none">
            <View style={styles.topRow} pointerEvents="box-none">
              {title ? (
                <Text style={[styles.title, { fontFamily: theme.fontBodyMedium }]} numberOfLines={1}>
                  {title}
                </Text>
              ) : (
                <View />
              )}
              <Pressable
                onPress={handleClose}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={14}
                style={({ pressed }) => [styles.close, { opacity: pressed ? 0.6 : 1 }]}
              >
                <Ionicons name="close" size={22} color="#fff" />
              </Pressable>
            </View>
          </SafeAreaView>

          <SafeAreaView edges={["bottom"]} style={styles.hintWrap} pointerEvents="none">
            <Text style={[styles.hint, { fontFamily: theme.fontBody }]}>
              Pinch or double-tap to zoom · tap to close
            </Text>
          </SafeAreaView>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: "rgba(8,7,7,0.97)" },
  stage: { alignItems: "center", justifyContent: "center" },
  image: { width: "100%", height: "100%" },
  topBar: { position: "absolute", top: 0, left: 0, right: 0 },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm,
    gap: SPACE.md,
  },
  title: { color: "#fff", fontSize: 14, flex: 1 },
  close: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.pill,
    backgroundColor: "rgba(255,255,255,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  hintWrap: { position: "absolute", bottom: 0, left: 0, right: 0, alignItems: "center" },
  hint: { color: "rgba(255,255,255,0.45)", fontSize: 12, paddingBottom: SPACE.md },
});
