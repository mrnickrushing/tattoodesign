import { useEffect, useState } from "react";
import { AccessibilityInfo, StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useBrand } from "@/context/BrandContext";
import { RADIUS, SPACE } from "@/lib/theme";

function useReduceMotion() {
  const [reduceMotion, setReduceMotion] = useState(true);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

/**
 * Reserves list space with a stock-toned placeholder, so loading retains the
 * material character of a flash sheet instead of dropping in grey bars.
 */
export function Skeleton({
  width = "100%",
  height = SPACE.xl,
  radius = RADIUS.md,
  style,
}: {
  width?: DimensionValue;
  height?: DimensionValue;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useBrand();
  const reduceMotion = useReduceMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = 0;
    if (!reduceMotion) {
      progress.value = withRepeat(
        withTiming(1, { duration: 1050, easing: Easing.inOut(Easing.ease), reduceMotion: ReduceMotion.Never }),
        -1,
        false
      );
    }
  }, [progress, reduceMotion]);

  const shimmerStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion ? 0 : interpolate(progress.value, [0, 0.5, 1], [0.1, 0.4, 0.1]),
    transform: [{ translateX: interpolate(progress.value, [0, 1], [-SPACE.xxl, SPACE.xxl]) }],
  }));

  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[
        styles.block,
        { width, height, borderRadius: radius, backgroundColor: `${theme.stockMark}35` },
        style,
      ]}
    >
      <Animated.View style={[styles.shimmer, { backgroundColor: `${theme.stockInk}18` }, shimmerStyle]} />
    </View>
  );
}

/**
 * Provides a ready-made quiet loading rhythm for saved-sheet and recent-design
 * lists, avoiding a spinner where the final content will be rows.
 */
export function SkeletonRow({
  count = 3,
  height = SPACE.xxl,
}: {
  count?: number;
  height?: DimensionValue;
}) {
  const rows = Math.max(0, Math.floor(count));
  return (
    <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.rows}>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} height={height} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { overflow: "hidden" },
  shimmer: { ...StyleSheet.absoluteFill, width: "45%" },
  rows: { gap: SPACE.sm },
});
