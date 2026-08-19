import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Modal,
  Pressable,
  StyleSheet,
  View,
  Text,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  runOnJS,
  Easing,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useBrand } from "@/context/BrandContext";
import { SPACE, RADIUS } from "@/lib/theme";

const MAX_SCALE = 6;
const DOUBLE_TAP_SCALE = 2.5;
const TRANSITION_DURATION = 360;

export type ImageViewerOriginFrame = {
  /** Screen coordinates from `measureInWindow`, in the same coordinate space as the modal. */
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Full-screen viewer for a finished design. Line art is the whole point of
 * this app, and detail in a stencil is the thing you actually need to judge
 * before committing it to skin or icing — so the panes are worth opening.
 */
export function ImageViewer({
  uri,
  title,
  actions,
  onClose,
  originFrame = null,
}: {
  uri: string | null;
  title?: string;
  /** Shown beside the close button. Viewing a design is usually the moment
   *  you decide to change it, so the way out shouldn't be back and re-find. */
  actions?: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }[];
  onClose: () => void;
  /**
   * Optional thumbnail bounds measured with `measureInWindow`. When present,
   * the viewer expands from that frame and returns there rather than hard-cutting.
   */
  originFrame?: ImageViewerOriginFrame | null;
}) {
  const { theme } = useBrand();
  const { width, height } = useWindowDimensions();
  const [reduceMotion, setReduceMotion] = useState(true);
  const [motionPreferenceKnown, setMotionPreferenceKnown] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const openedUri = useRef<string | null>(null);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);
  const openTransition = useSharedValue(1);
  const closeTransition = useSharedValue(1);
  const validOrigin =
    originFrame && originFrame.width > 0 && originFrame.height > 0 ? originFrame : null;
  const usesOriginZoom = validOrigin !== null && !reduceMotion;

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) {
          setReduceMotion(enabled);
          setMotionPreferenceKnown(true);
        }
      })
      .catch(() => {
        // Keep the cross-fade fallback if a platform cannot report this setting.
        if (active) setMotionPreferenceKnown(true);
      });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!uri) {
      openedUri.current = null;
      openTransition.value = 1;
      return;
    }
    // A measured origin waits for the accessibility preference before becoming
    // visible, so reduce-motion users never see even one zoomed frame.
    if (validOrigin && !motionPreferenceKnown) return;
    if (openedUri.current === uri) return;

    openedUri.current = uri;
    if (usesOriginZoom) {
      openTransition.value = 0;
      openTransition.value = withTiming(1, {
        duration: TRANSITION_DURATION,
        easing: Easing.out(Easing.cubic),
      });
    } else {
      openTransition.value = 1;
    }
  }, [motionPreferenceKnown, openTransition, uri, usesOriginZoom, validOrigin]);

  function reset(withAnimation = true) {
    scale.value = withAnimation ? withTiming(1) : 1;
    savedScale.value = 1;
    x.value = withAnimation ? withTiming(0) : 0;
    y.value = withAnimation ? withTiming(0) : 0;
    savedX.value = 0;
    savedY.value = 0;
  }

  function finishClose() {
    reset(false);
    closeTransition.value = 1;
    onClose();
    setIsClosing(false);
  }

  function handleClose(afterClose?: () => void) {
    if (isClosing) return;

    // Keep the existing immediate action behavior. A route-changing action
    // may replace the viewer itself, leaving no reliable target to animate to.
    if (afterClose) {
      reset();
      onClose();
      afterClose();
      return;
    }

    if (usesOriginZoom) {
      setIsClosing(true);
      reset(false);
      closeTransition.value = withTiming(
        0,
        { duration: TRANSITION_DURATION, easing: Easing.out(Easing.cubic) },
        (finished) => {
          if (finished) runOnJS(finishClose)();
        }
      );
      return;
    }

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
  const transitionStyle = useAnimatedStyle(() => {
    if (!usesOriginZoom || !validOrigin) return {};

    const progress = isClosing ? closeTransition.value : openTransition.value;
    const scaleX = validOrigin.width / width + (1 - validOrigin.width / width) * progress;
    const scaleY = validOrigin.height / width + (1 - validOrigin.height / width) * progress;
    const translateX = (validOrigin.x + validOrigin.width / 2 - width / 2) * (1 - progress);
    const translateY = (validOrigin.y + validOrigin.height / 2 - height / 2) * (1 - progress);

    return {
      // Scale first so the final translation remains in screen coordinates.
      transform: [{ scaleX }, { scaleY }, { translateX }, { translateY }],
    };
  });
  const transitionOpacity = useAnimatedStyle(() =>
    usesOriginZoom
      ? { opacity: isClosing ? closeTransition.value : openTransition.value }
      : { opacity: 1 }
  );

  return (
    <Modal
      visible={!!uri && (!validOrigin || motionPreferenceKnown)}
      transparent
      animationType={usesOriginZoom ? "none" : "fade"}
      onRequestClose={() => handleClose()}
      statusBarTranslucent
    >
      <GestureHandlerRootView style={styles.root}>
        <View style={styles.backdrop}>
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, styles.backdropTint, transitionOpacity]}
          />
          <GestureDetector gesture={gesture}>
            <Animated.View style={[styles.stage, { width, height }]}>
              {uri && (
                <Animated.View style={[{ width, height: width }, transitionStyle]}>
                  <Animated.View style={[StyleSheet.absoluteFill, imageStyle]}>
                    <Image
                      source={{ uri }}
                      style={styles.image}
                      contentFit="contain"
                      alt={title ?? "Design"}
                    />
                  </Animated.View>
                </Animated.View>
              )}
            </Animated.View>
          </GestureDetector>

          <Animated.View style={[styles.chrome, transitionOpacity]} pointerEvents="box-none">
            <SafeAreaView edges={["top"]} style={styles.topBar} pointerEvents="box-none">
            <View style={styles.topRow} pointerEvents="box-none">
              {title ? (
                <Text style={[styles.title, { fontFamily: theme.fontBodyMedium }]} numberOfLines={1}>
                  {title}
                </Text>
              ) : (
                <View />
              )}
              <View style={styles.actions}>
                {actions?.map((action) => (
                  <Pressable
                    key={action.label}
                    onPress={() => handleClose(action.onPress)}
                    accessibilityRole="button"
                    accessibilityLabel={action.label}
                    hitSlop={14}
                    style={({ pressed }) => [styles.close, { opacity: pressed ? 0.6 : 1 }]}
                  >
                    <Ionicons name={action.icon} size={20} color="#fff" />
                  </Pressable>
                ))}
                <Pressable
                  onPress={() => handleClose()}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  hitSlop={14}
                  style={({ pressed }) => [styles.close, { opacity: pressed ? 0.6 : 1 }]}
                >
                  <Ionicons name="close" size={22} color="#fff" />
                </Pressable>
              </View>
            </View>
            </SafeAreaView>

            <SafeAreaView edges={["bottom"]} style={styles.hintWrap} pointerEvents="none">
              <Text style={[styles.hint, { fontFamily: theme.fontBody }]}>
                Pinch or double-tap to zoom · tap to close
              </Text>
            </SafeAreaView>
          </Animated.View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { flex: 1 },
  backdropTint: { backgroundColor: "rgba(8,7,7,0.97)" },
  stage: { alignItems: "center", justifyContent: "center" },
  image: { width: "100%", height: "100%" },
  chrome: { ...StyleSheet.absoluteFill },
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
  actions: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
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
