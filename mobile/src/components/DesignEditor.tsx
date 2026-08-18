import { useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";
import * as Haptics from "expo-haptics";
import { File } from "expo-file-system";
import {
  Canvas,
  Image as SkiaImage,
  Path,
  Skia,
  type SkImage,
} from "@shopify/react-native-skia";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useBrand } from "@/context/BrandContext";
import { Button } from "@/components/Button";
import { Chip, Notice } from "@/components/ui";
import { CropTool } from "@/components/CropTool";
import { cropImage, isFullCrop, type CropRect } from "@/lib/crop";
import { applyStrokes, type Stroke } from "@/lib/touchup";
import { addCutLine, DEFAULT_CUT_LINE, type CutLineOptions } from "@/lib/cutline";
import { SPACE, RADIUS } from "@/lib/theme";

type Tool = "touchup" | "crop" | "cutline";

function decode(dataUrl: string | null): { image: SkImage | null; error: string | null } {
  if (!dataUrl) return { image: null, error: null };
  try {
    const image = Skia.Image.MakeImageFromEncoded(
      Skia.Data.fromBase64(dataUrl.slice(dataUrl.indexOf(",") + 1))
    );
    return image
      ? { image, error: null }
      : { image: null, error: "Couldn't read that design." };
  } catch {
    // Skia is a native module: in a browser preview it isn't there at all.
    return { image: null, error: "Editing needs the app, not a browser preview." };
  }
}

/**
 * Everything you'd otherwise leave the app to do.
 *
 * A design arrives from the tracer with specks in it and a frame that's
 * slightly wrong, and the answer used to be "re-trace it" or "open something
 * else". Each tool here rewrites the design's own pixels at full resolution
 * and hands back a new version, which can replace the original or be kept
 * alongside it.
 */
export function DesignEditor({
  uri,
  title,
  onSave,
  onClose,
}: {
  uri: string;
  title: string;
  /** `replace` false keeps the original and adds this as a new design. */
  onSave: (dataUrl: string, replace: boolean) => Promise<void> | void;
  onClose: () => void;
}) {
  const { brand, theme } = useBrand();
  const { width: screenW, height: screenH } = useWindowDimensions();

  const [tool, setTool] = useState<Tool>("touchup");
  /** The design as it stands, as a data URL — every tool reads and writes it. */
  const [working, setWorking] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [mode, setMode] = useState<Stroke["mode"]>("erase");
  const [brush, setBrush] = useState(18);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [current, setCurrent] = useState<{ x: number; y: number }[]>([]);

  const [cropping, setCropping] = useState(false);
  const [cut, setCut] = useState<CutLineOptions>(DEFAULT_CUT_LINE);
  const [dirty, setDirty] = useState(false);

  // Read the file once; from here on the design lives as base64 in memory,
  // which is what every Skia operation here wants anyway.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const base64 = await new File(uri).base64();
        if (!active) return;
        setWorking(`data:image/png;base64,${base64}`);
      } catch {
        // The underlying message is internal plumbing; this is the fact.
        if (active) setOpError("Couldn't open that design.");
      }
    })();
    return () => {
      active = false;
    };
  }, [uri]);

  // Decoded straight from `working`, not held in state: it's derived data,
  // and keeping it in an effect meant every applied edit rendered once with
  // the old picture still on screen.
  const decoded = decode(working);
  const image = decoded.image;
  const error = opError ?? decoded.error;

  const stageW = screenW - SPACE.md * 2;
  const aspect = image ? image.height() / image.width() : 1;
  const stageH = Math.min(stageW * aspect, screenH * 0.46);
  const drawW = stageH / aspect > stageW ? stageW : stageH / aspect;
  const drawH = drawW * aspect;

  function addPoint(x: number, y: number) {
    setCurrent((prev) => [...prev, { x, y }]);
  }

  function endStroke() {
    setCurrent((points) => {
      if (points.length > 0) {
        setStrokes((prev) => [...prev, { points, width: brush, mode }]);
        setDirty(true);
      }
      return [];
    });
  }

  function addDot(x: number, y: number) {
    // A speck is removed with one tap, and a pan that never moves doesn't
    // produce a stroke — so tapping gets its own gesture.
    setStrokes((prev) => [...prev, { points: [{ x, y }], width: brush, mode }]);
    setDirty(true);
  }

  const draw = Gesture.Pan()
    .minDistance(0)
    .onStart((e) => {
      runOnJS(addPoint)(e.x, e.y);
    })
    .onUpdate((e) => {
      runOnJS(addPoint)(e.x, e.y);
    })
    .onEnd(() => {
      runOnJS(endStroke)();
    });

  const dot = Gesture.Tap().onEnd((e) => {
    runOnJS(addDot)(e.x, e.y);
  });

  /** Pan wins when the finger actually moves; otherwise it's a tap. */
  const paint = Gesture.Exclusive(draw, dot);

  function pathFor(points: { x: number; y: number }[]) {
    const path = Skia.Path.Make();
    if (points.length === 0) return path;
    path.moveTo(points[0].x, points[0].y);
    if (points.length === 1) path.lineTo(points[0].x + 0.1, points[0].y + 0.1);
    for (const point of points.slice(1)) path.lineTo(point.x, point.y);
    return path;
  }

  /** Bakes any pending brush strokes into the working image. */
  async function flush(): Promise<string | null> {
    if (!working) return null;
    if (strokes.length === 0) return working;
    const next = await applyStrokes(working, strokes, drawW, drawH);
    setStrokes([]);
    setWorking(next);
    return next;
  }

  async function run(job: (src: string) => Promise<string>) {
    setBusy(true);
    try {
      const base = await flush();
      if (!base) return;
      setWorking(await job(base));
      setDirty(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e) {
      setOpError(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  async function applyCrop(rect: CropRect) {
    setCropping(false);
    if (isFullCrop(rect)) return;
    await run((src) => cropImage(src, rect));
  }

  async function save(replace: boolean) {
    setBusy(true);
    try {
      const finished = await flush();
      if (!finished) return;
      await onSave(finished, replace);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    } catch (e) {
      setOpError(e instanceof Error ? e.message : "Couldn't save.");
      setBusy(false);
    }
  }

  function confirmClose() {
    if (!dirty) {
      onClose();
      return;
    }
    Alert.alert("Discard changes?", "The design goes back to how it was.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: onClose },
    ]);
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={confirmClose}>
      <GestureHandlerRootView style={styles.root}>
        <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text
                accessibilityRole="header"
                style={[styles.title, { color: theme.foreground, fontFamily: theme.fontDisplay }]}
              >
                Edit design
              </Text>
              <Text
                numberOfLines={1}
                style={{ color: theme.muted, fontFamily: theme.fontBody, fontSize: 12 }}
              >
                {title}
              </Text>
            </View>
            <Pressable
              onPress={confirmClose}
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

          <View style={styles.chips} accessibilityRole="radiogroup">
            <Chip
              label="Touch up"
              icon="brush-outline"
              active={tool === "touchup"}
              onPress={() => setTool("touchup")}
            />
            <Chip
              label="Crop"
              icon="crop-outline"
              active={tool === "crop"}
              onPress={() => setTool("crop")}
            />
            <Chip
              label="Cut line"
              icon="ellipse-outline"
              active={tool === "cutline"}
              onPress={() => setTool("cutline")}
            />
          </View>

          <View style={[styles.stage, { height: stageH, backgroundColor: theme.stock, borderColor: theme.line }]}>
            {image && (
              <GestureDetector gesture={paint}>
                <Canvas style={{ width: drawW, height: drawH }}>
                  <SkiaImage image={image} x={0} y={0} width={drawW} height={drawH} fit="fill" />
                  {[...strokes, { points: current, width: brush, mode }].map((stroke, i) =>
                    stroke.points.length ? (
                      <Path
                        key={i}
                        path={pathFor(stroke.points)}
                        color={stroke.mode === "erase" ? "white" : "black"}
                        style="stroke"
                        strokeWidth={stroke.width}
                        strokeCap="round"
                        strokeJoin="round"
                      />
                    ) : null
                  )}
                </Canvas>
              </GestureDetector>
            )}
            {(busy || (!working && !error)) && (
              <View style={styles.busy}>
                <ActivityIndicator color={theme.accent} />
              </View>
            )}
          </View>

          {error && (
            <View style={{ marginTop: SPACE.sm }}>
              <Notice>{error}</Notice>
            </View>
          )}

          <ScrollView style={styles.controls} contentContainerStyle={{ paddingBottom: SPACE.sm }}>
            {tool === "touchup" && (
              <View>
                <View style={styles.chips}>
                  <Chip
                    label="Erase"
                    icon="remove-circle-outline"
                    active={mode === "erase"}
                    onPress={() => setMode("erase")}
                  />
                  <Chip
                    label="Draw"
                    icon="create-outline"
                    active={mode === "draw"}
                    onPress={() => setMode("draw")}
                  />
                </View>
                <SliderRow
                  label="Brush"
                  icon="ellipse"
                  value={brush}
                  min={4}
                  max={60}
                  suffix="pt"
                  onChange={setBrush}
                />
                <View style={styles.row}>
                  <Button
                    label="Undo stroke"
                    icon="arrow-undo-outline"
                    disabled={strokes.length === 0}
                    onPress={() => setStrokes((prev) => prev.slice(0, -1))}
                    style={{ flex: 1 }}
                  />
                  <Button
                    label="Clear"
                    icon="close-circle-outline"
                    disabled={strokes.length === 0}
                    onPress={() => setStrokes([])}
                    style={{ flex: 1 }}
                  />
                </View>
                <Text style={[styles.hint, { color: theme.muted, fontFamily: theme.fontBody }]}>
                  Erase paints the background over specks; draw puts a line back in.
                </Text>
              </View>
            )}

            {tool === "crop" && (
              <View>
                <Button
                  label="Choose the crop"
                  icon="crop-outline"
                  variant="primary"
                  onPress={() => setCropping(true)}
                />
                <Text style={[styles.hint, { color: theme.muted, fontFamily: theme.fontBody }]}>
                  Trims the design itself, so everything placed from it follows.
                </Text>
              </View>
            )}

            {tool === "cutline" && (
              <View>
                <SliderRow
                  label="Printed width"
                  icon="resize-outline"
                  value={cut.widthIn}
                  min={1}
                  max={8}
                  step={0.25}
                  suffix="in"
                  onChange={(v) => setCut((prev) => ({ ...prev, widthIn: v }))}
                />
                <SliderRow
                  label="Gap"
                  icon="scan-outline"
                  value={cut.gapIn}
                  min={0.02}
                  max={0.5}
                  step={0.01}
                  suffix="in"
                  onChange={(v) => setCut((prev) => ({ ...prev, gapIn: v }))}
                />
                <SliderRow
                  label="Line"
                  icon="remove-outline"
                  value={cut.thicknessIn}
                  min={0.01}
                  max={0.08}
                  step={0.005}
                  suffix="in"
                  onChange={(v) => setCut((prev) => ({ ...prev, thicknessIn: v }))}
                />
                <Button
                  label="Add cut line"
                  icon="ellipse-outline"
                  variant="primary"
                  onPress={() => run((src) => addCutLine(src, cut))}
                  style={{ marginTop: SPACE.sm }}
                />
                <Text style={[styles.hint, { color: theme.muted, fontFamily: theme.fontBody }]}>
                  {brand.id === "sugar"
                    ? "Follows the artwork, so round toppers cut round."
                    : "A trim line that follows the drawing, not a box around it."}
                </Text>
              </View>
            )}
          </ScrollView>

          <View style={styles.row}>
            <Button
              label="Save a copy"
              icon="duplicate-outline"
              disabled={busy || !working}
              onPress={() => save(false)}
              style={{ flex: 1 }}
            />
            <Button
              label="Replace"
              icon="checkmark"
              variant="primary"
              disabled={busy || !working}
              onPress={() => save(true)}
              style={{ flex: 1 }}
            />
          </View>
        </SafeAreaView>

        {cropping && image && working && (
          <CropTool
            uri={working}
            imageWidth={image.width()}
            imageHeight={image.height()}
            onApply={applyCrop}
            onClose={() => setCropping(false)}
          />
        )}
      </GestureHandlerRootView>
    </Modal>
  );
}

function SliderRow({
  label,
  icon,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  const { theme } = useBrand();
  return (
    <View style={{ marginTop: SPACE.sm }}>
      <View style={styles.sliderTop}>
        <View style={styles.sliderLabel}>
          <Ionicons name={icon} size={14} color={theme.muted} />
          <Text style={{ color: theme.foreground, fontFamily: theme.fontBody, fontSize: 14 }}>
            {label}
          </Text>
        </View>
        <Text
          style={{
            color: theme.accent,
            fontFamily: theme.fontBodyMedium,
            fontSize: 13,
            fontVariant: ["tabular-nums"],
          }}
        >
          {suffix === "in" ? value.toFixed(2).replace(/\.?0+$/, "") : Math.round(value)} {suffix}
        </Text>
      </View>
      <Slider
        minimumValue={min}
        maximumValue={max}
        step={step ?? 1}
        value={value}
        onValueChange={onChange}
        onSlidingComplete={() => Haptics.selectionAsync()}
        minimumTrackTintColor={theme.accent}
        maximumTrackTintColor={theme.line}
        thumbTintColor={theme.accent}
        accessibilityLabel={label}
        accessibilityValue={{ min, max, now: value }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  screen: { flex: 1, padding: SPACE.md },
  head: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, marginBottom: SPACE.md },
  title: { fontSize: 26, letterSpacing: 0.3 },
  close: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  chips: { flexDirection: "row", gap: SPACE.sm, marginBottom: SPACE.sm, flexWrap: "wrap" },
  stage: {
    borderWidth: 1,
    borderRadius: RADIUS.md,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  busy: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  controls: { flex: 1, marginTop: SPACE.sm },
  row: { flexDirection: "row", gap: SPACE.sm, marginTop: SPACE.sm },
  hint: { fontSize: 11, lineHeight: 16, marginTop: SPACE.sm },
  sliderTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sliderLabel: { flexDirection: "row", alignItems: "center", gap: 7 },
});
