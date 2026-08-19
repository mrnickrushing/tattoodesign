import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet } from "react-native";
import Svg, { Path } from "react-native-svg";
import Animated, {
  Easing,
  ReduceMotion,
  cancelAnimation,
  runOnJS,
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { useBrand } from "@/context/BrandContext";
import type { Point } from "@/lib/designProject";
import { revealTimings, type RevealTiming } from "@/lib/reveal";
import { pathLength } from "@/lib/vectorize";

const AnimatedPath = Animated.createAnimatedComponent(Path);

function pointsToPath(points: Point[]) {
  if (points.length === 0) return "";
  return points.reduce(
    (path, point, index) => `${path}${index === 0 ? "M" : " L"}${point.x} ${point.y}`,
    ""
  );
}

function useReduceMotion() {
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

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

function RevealingPath({
  points,
  timing,
  strokeWidth,
  color,
  replayKey,
  reduceMotion,
  onLastPathDone,
}: {
  points: Point[];
  timing: RevealTiming;
  strokeWidth: number;
  color: string;
  replayKey: string | number | undefined;
  reduceMotion: boolean | null;
  onLastPathDone: (() => void) | undefined;
}) {
  const length = Math.max(pathLength(points), 0.01);
  const offset = useSharedValue(length);
  const path = pointsToPath(points);
  const isLast = onLastPathDone !== undefined;
  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: offset.value }));

  useEffect(() => {
    cancelAnimation(offset);
    offset.set(length);
    if (reduceMotion !== false) {
      offset.set(0);
      return;
    }
    offset.set(withDelay(
      timing.delayMs,
      withTiming(
        0,
        { duration: timing.durationMs, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.Never },
        (finished) => {
          if (finished && isLast && onLastPathDone) runOnJS(onLastPathDone)();
        }
      )
    ));
  }, [isLast, length, offset, onLastPathDone, reduceMotion, replayKey, timing.delayMs, timing.durationMs]);

  if (!path) return null;
  return (
    <AnimatedPath
      d={path}
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={`${length} ${length}`}
      animatedProps={animatedProps}
    />
  );
}

/**
 * Makes vector linework arrive in its natural drawing order, giving a finished
 * stencil a reveal worthy of the wait rather than a sudden image swap.
 */
export function StencilReveal({
  paths,
  width,
  height,
  strokeWidth = 2,
  color,
  totalMs,
  onDone,
  replayKey,
}: {
  paths: Point[][];
  width: number;
  height: number;
  strokeWidth?: number;
  color?: string;
  totalMs?: number;
  onDone?: () => void;
  replayKey?: string | number;
}) {
  const { theme } = useBrand();
  const reduceMotion = useReduceMotion();
  const onDoneRef = useRef(onDone);
  const completedRef = useRef(false);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);
  const timings = revealTimings(paths, totalMs);
  const lastTiming = timings.reduce<RevealTiming | null>(
    (latest, timing) => (!latest || timing.delayMs + timing.durationMs > latest.delayMs + latest.durationMs ? timing : latest),
    null
  );

  const finish = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    onDoneRef.current?.();
  }, []);

  useEffect(() => {
    completedRef.current = false;
    if (paths.length === 0 || (reduceMotion !== null && reduceMotion)) finish();
  }, [finish, paths.length, reduceMotion, replayKey]);

  if (paths.length === 0) return null;

  return (
    <Svg
      accessible={false}
      accessibilityElementsHidden
      pointerEvents="none"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={styles.svg}
    >
      {paths.map((points, index) => {
        const timing = timings[index];
        if (!timing) return null;
        const isLast = timing === lastTiming;
        return (
          <RevealingPath
            key={`${replayKey ?? "initial"}-${index}`}
            points={points}
            timing={timing}
            strokeWidth={strokeWidth}
            color={color ?? theme.stockInk}
            replayKey={replayKey}
            reduceMotion={reduceMotion}
            onLastPathDone={isLast ? finish : undefined}
          />
        );
      })}
    </Svg>
  );
}

const styles = StyleSheet.create({
  svg: { overflow: "visible" },
});
