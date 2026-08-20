import { useEffect, useRef, useState } from "react";
import {
  Modal,
  Platform,
  View,
  Text,
  Image as RNImage,
  StyleSheet,
  Pressable,
  Alert,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";
import * as ImagePicker from "expo-image-picker";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, runOnJS } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useBrand } from "@/context/BrandContext";
import { Button } from "@/components/Button";
import { Chip, Notice } from "@/components/ui";
import { composePlacement } from "@/lib/placement";
import { imageDataUrl } from "@/lib/imageType";
import { saveDataUrlToPhotos } from "@/lib/files";
import { CARD_HEIGHT_IN, CARD_WIDTH_IN, getScreenPpi, setScreenPpi } from "@/lib/measure";
import { PREF_KEYS, preferences } from "@/lib/preferences";
import { File } from "expo-file-system";
import { HEAL_AGES, type HealAge } from "@/lib/healing";
import { simulateHealing } from "@/lib/productionTools";
import { SPACE, RADIUS } from "@/lib/theme";

type Mode = "size" | "photo" | "live";

/**
 * Answers the question a thumbnail can't: how big is this really, and does it
 * sit right where it's going.
 *
 * Two modes, because those are two different questions. True size draws the
 * design at its measured size so the phone can be held against the arm or the
 * cookie. On a photo is judged by eye — a design floating over a snapshot has
 * no real scale, so no measurement is claimed there.
 */
export function PlacementPreview({
  uri,
  title,
  initialWidthIn = 3,
  onClose,
}: {
  uri: string;
  title: string;
  initialWidthIn?: number;
  onClose: () => void;
}) {
  const { brand, theme } = useBrand();
  const { width: screenW, height: screenH } = useWindowDimensions();

  const [mode, setMode] = useState<Mode>("size");
  const [aspect, setAspect] = useState(1);
  const [ppi, setPpi] = useState(160);
  const [calibrated, setCalibrated] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [widthIn, setWidthIn] = useState(initialWidthIn);
  const [photo, setPhoto] = useState<{ uri: string; width: number; height: number } | null>(null);
  const [opacity, setOpacity] = useState(0.85);
  const [saving, setSaving] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [freezing, setFreezing] = useState(false);
  const [healAge, setHealAge] = useState<HealAge>("fresh");
  const [healedUris, setHealedUris] = useState<Partial<Record<HealAge, string>>>({});
  const [healing, setHealing] = useState(false);
  const cameraRef = useRef<CameraView>(null);
  const liveAvailable = Platform.OS !== "web";

  useEffect(() => {
    let active = true;
    getScreenPpi().then((result) => {
      if (!active) return;
      setPpi(result.ppi);
      setCalibrated(result.calibrated);
    });
    RNImage.getSize(
      uri,
      (w, h) => {
        if (active && w > 0 && h > 0) setAspect(h / w);
      },
      () => {
        // Square is the safest guess: these are line art on a square canvas.
      }
    );
    return () => {
      active = false;
    };
  }, [uri]);

  const stageH = screenH * 0.52;
  const stageW = screenW - SPACE.md * 2;

  // Tracked by center, so rotating and resizing don't shift the design.
  const cx = useSharedValue(stageW / 2);
  const cy = useSharedValue(stageH / 2);
  const widthPt = useSharedValue(initialWidthIn * 160);
  const rotation = useSharedValue(0);

  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const startW = useSharedValue(0);
  const startR = useSharedValue(0);

  /** Pinching in true-size mode changes the real size, so it's written back. */
  function commitWidth(points: number) {
    const next = Math.max(0.25, points / ppi);
    setWidthIn(next);
    void preferences.set(brand.id, PREF_KEYS.placementWidthIn, next);
  }

  function applyWidthIn(next: number) {
    const clamped = Math.max(0.25, Math.min(next, 24));
    setWidthIn(clamped);
    widthPt.value = clamped * ppi;
    void preferences.set(brand.id, PREF_KEYS.placementWidthIn, clamped);
  }

  const pan = Gesture.Pan()
    .onStart(() => {
      startX.value = cx.value;
      startY.value = cy.value;
    })
    .onUpdate((e) => {
      cx.value = startX.value + e.translationX;
      cy.value = startY.value + e.translationY;
    });

  const pinch = Gesture.Pinch()
    .onStart(() => {
      startW.value = widthPt.value;
    })
    .onUpdate((e) => {
      widthPt.value = Math.max(24, startW.value * e.scale);
    })
    .onEnd(() => {
      runOnJS(commitWidth)(widthPt.value);
    });

  const rotate = Gesture.Rotation()
    .onStart(() => {
      startR.value = rotation.value;
    })
    .onUpdate((e) => {
      rotation.value = startR.value + (e.rotation * 180) / Math.PI;
    });

  const gesture = Gesture.Simultaneous(pan, pinch, rotate);

  const designStyle = useAnimatedStyle(() => {
    const w = widthPt.value;
    const h = w * aspect;
    return {
      position: "absolute",
      left: cx.value - w / 2,
      top: cy.value - h / 2,
      width: w,
      height: h,
      transform: [{ rotateZ: `${rotation.value}deg` }],
      opacity: mode === "size" ? 1 : opacity,
    };
  });

  function reset() {
    Haptics.selectionAsync();
    cx.value = stageW / 2;
    cy.value = stageH / 2;
    rotation.value = 0;
    applyWidthIn(initialWidthIn);
  }

  async function saveCalibration(next: number) {
    setPpi(next);
    setCalibrated(true);
    // Same real size, re-expressed in the newly measured points per inch.
    widthPt.value = widthIn * next;
    await setScreenPpi(next);
    setCalibrating(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  function switchMode(next: Mode) {
    setMode(next);
    // Live and true-size both claim real measurement, so both re-anchor the
    // design to the calibrated pixels-per-inch.
    if (next !== "photo") widthPt.value = widthIn * ppi;
  }

  async function enterLive() {
    if (!liveAvailable) {
      Alert.alert("Not on web", "Live placement needs the phone's camera — use the iOS or Android app.");
      return;
    }
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) {
        Alert.alert("Camera access needed", "Allow camera access to preview the design live on the spot.");
        return;
      }
    }
    switchMode("live");
    Haptics.selectionAsync();
  }

  /**
   * Freeze-frame: capture what the camera sees and hand it to the existing
   * photo workflow — the frozen frame becomes an "On a photo" mockup, keeping
   * the design exactly where it sat, with compare and save already built.
   */
  async function freezeFrame() {
    if (!cameraRef.current) return;
    setFreezing(true);
    try {
      const shot = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.9 });
      if (!shot?.base64) throw new Error("The camera returned no frame.");
      setPhoto({
        uri: imageDataUrl(shot.base64),
        width: shot.width,
        height: shot.height,
      });
      setMode("photo");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (e) {
      Alert.alert("Couldn't freeze the frame", e instanceof Error ? e.message : "Try again.");
    } finally {
      setFreezing(false);
    }
  }

  async function pickPhoto(fromCamera: boolean) {
    const permission = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        fromCamera ? "Camera access needed" : "Photo access needed",
        "Allow access to use a photo here."
      );
      return;
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.9 })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          base64: true,
          quality: 0.9,
        });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset?.base64) return;
    setPhoto({
      uri: imageDataUrl(asset.base64, asset.mimeType),
      width: asset.width,
      height: asset.height,
    });
    setMode("photo");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  /**
   * Ages the design overlay for the live view. Migration is millimetres at
   * the calibrated screen density, so what floats on the arm is the honest
   * projection at true size. Renders cache per age; fresh clears back to the
   * raw design.
   */
  async function chooseHealAge(age: HealAge) {
    setHealAge(age);
    Haptics.selectionAsync();
    if (age === "fresh" || healedUris[age]) return;
    setHealing(true);
    try {
      const base64 = await new File(uri).base64();
      const aged = simulateHealing(`data:image/png;base64,${base64}`, age, ppi / 25.4);
      setHealedUris((current) => ({ ...current, [age]: aged }));
    } catch (e) {
      setHealAge("fresh");
      Alert.alert("Couldn't simulate healing", e instanceof Error ? e.message : "Try again.");
    } finally {
      setHealing(false);
    }
  }

  const overlayUri = mode === "live" && healAge !== "fresh" ? (healedUris[healAge] ?? uri) : uri;

  /** The photo is letterboxed into the stage, so the design's position has to
   *  be expressed against the photo itself before it can be flattened. */
  function photoFrame() {
    if (!photo) return null;
    const scale = Math.min(stageW / photo.width, stageH / photo.height);
    const w = photo.width * scale;
    const h = photo.height * scale;
    return { left: (stageW - w) / 2, top: (stageH - h) / 2, width: w, height: h };
  }

  async function saveMockup() {
    const frame = photoFrame();
    if (!photo || !frame) return;
    setSaving(true);
    try {
      const w = widthPt.value;
      const h = w * aspect;
      const dataUrl = await composePlacement(photo.uri, uri, {
        x: (cx.value - w / 2 - frame.left) / frame.width,
        y: (cy.value - h / 2 - frame.top) / frame.height,
        width: w / frame.width,
        height: h / frame.height,
        rotation: rotation.value,
        opacity,
      });
      await saveDataUrlToPhotos(dataUrl, `placement-${Date.now()}.png`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Saved", "Mockup added to your Photos.");
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Couldn't save", e instanceof Error ? e.message : "Try again.");
    } finally {
      setSaving(false);
    }
  }

  const frame = photoFrame();

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.root}>
        <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text
                accessibilityRole="header"
                style={[styles.title, { color: theme.foreground, fontFamily: theme.fontDisplay }]}
              >
                Size it up
              </Text>
              <Text
                numberOfLines={1}
                style={{ color: theme.muted, fontFamily: theme.fontBody, fontSize: 12 }}
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

          <View style={styles.chips} accessibilityRole="radiogroup">
            <Chip
              label="True size"
              icon="resize-outline"
              active={mode === "size"}
              onPress={() => switchMode("size")}
            />
            <Chip
              label="On a photo"
              icon="body-outline"
              active={mode === "photo"}
              onPress={() => (photo ? switchMode("photo") : pickPhoto(false))}
            />
            <Chip
              label="Live"
              icon="videocam-outline"
              active={mode === "live"}
              onPress={() => void enterLive()}
            />
          </View>

          <GestureDetector gesture={gesture}>
            <View
              style={[
                styles.stage,
                {
                  height: stageH,
                  backgroundColor: mode === "size" ? theme.stock : "#000000",
                  borderColor: theme.line,
                },
              ]}
            >
              {mode === "live" && (
                <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
              )}
              {mode === "photo" && photo && frame && (
                <Image
                  source={{ uri: photo.uri }}
                  style={{
                    position: "absolute",
                    left: frame.left,
                    top: frame.top,
                    width: frame.width,
                    height: frame.height,
                  }}
                  contentFit="fill"
                  alt="Placement photo"
                />
              )}
              <Animated.View style={designStyle} pointerEvents="none">
                <Image
                  source={{ uri: overlayUri }}
                  style={StyleSheet.absoluteFill}
                  contentFit="contain"
                  alt={title}
                />
              </Animated.View>
              {mode === "live" && healAge !== "fresh" && overlayUri !== uri && (
                <View style={[styles.simulatedBadge, { backgroundColor: `${theme.surface}e8` }]} pointerEvents="none">
                  <Ionicons name="time-outline" size={11} color={theme.accent} />
                  <Text style={{ color: theme.accent, fontFamily: theme.fontBodyMedium, fontSize: 9, letterSpacing: 1 }}>SIMULATED</Text>
                </View>
              )}
            </View>
          </GestureDetector>

          <Text style={[styles.hint, { color: theme.muted, fontFamily: theme.fontBody }]}>
            Drag to move · pinch to resize · twist to rotate
          </Text>

          {mode === "size" ? (
            <View style={styles.controls}>
              <View style={styles.sizeRow}>
                <Stepper
                  icon="remove"
                  label="Smaller"
                  onPress={() => applyWidthIn(widthIn - 0.25)}
                />
                <View style={styles.readout}>
                  <Text
                    style={{
                      color: theme.foreground,
                      fontFamily: theme.fontDisplay,
                      fontSize: 30,
                    }}
                  >
                    {widthIn.toFixed(2).replace(/\.?0+$/, "")}
                    <Text style={{ fontSize: 15, fontFamily: theme.fontBody }}> in wide</Text>
                  </Text>
                  <Text style={{ color: theme.muted, fontFamily: theme.fontBody, fontSize: 11 }}>
                    {(widthIn * aspect).toFixed(2).replace(/\.?0+$/, "")} in tall
                  </Text>
                </View>
                <Stepper icon="add" label="Bigger" onPress={() => applyWidthIn(widthIn + 0.25)} />
              </View>

              {!calibrated && (
                <View style={{ marginTop: SPACE.sm }}>
                  <Notice tone="info" icon="information-circle-outline">
                    Sizes are an estimate until you calibrate this screen.
                  </Notice>
                </View>
              )}

              <View style={styles.row}>
                <Button
                  label={calibrated ? "Recalibrate" : "Calibrate screen"}
                  icon="card-outline"
                  onPress={() => setCalibrating(true)}
                  style={{ flex: 1 }}
                />
                <Button label="Reset" icon="refresh-outline" onPress={reset} style={{ flex: 1 }} />
              </View>
              <Text style={[styles.footnote, { color: theme.muted, fontFamily: theme.fontBody }]}>
                {brand.id === "sugar"
                  ? "Hold the phone next to the cookie to check the fit."
                  : "Hold the phone against the spot to check the fit."}
              </Text>
            </View>
          ) : mode === "live" ? (
            <View style={styles.controls}>
              <View style={styles.opacityRow}>
                <Ionicons name="contrast-outline" size={15} color={theme.muted} />
                <Slider
                  style={{ flex: 1 }}
                  minimumValue={0.2}
                  maximumValue={1}
                  value={opacity}
                  onValueChange={setOpacity}
                  minimumTrackTintColor={theme.accent}
                  maximumTrackTintColor={theme.line}
                  thumbTintColor={theme.accent}
                  accessibilityLabel="Design opacity"
                />
                <Text style={{ color: theme.muted, fontSize: 12, width: 38, textAlign: "right" }}>
                  {Math.round(opacity * 100)}%
                </Text>
              </View>
              <View style={styles.sizeRow}>
                <Stepper icon="remove" label="Smaller" onPress={() => applyWidthIn(widthIn - 0.25)} />
                <View style={styles.readout}>
                  <Text style={{ color: theme.foreground, fontFamily: theme.fontDisplay, fontSize: 30 }}>
                    {widthIn.toFixed(2).replace(/\.?0+$/, "")}
                    <Text style={{ fontSize: 15, fontFamily: theme.fontBody }}> in wide</Text>
                  </Text>
                  <Text style={{ color: theme.muted, fontFamily: theme.fontBody, fontSize: 11 }}>
                    on this screen{calibrated ? "" : " · calibrate for exact size"}
                  </Text>
                </View>
                <Stepper icon="add" label="Bigger" onPress={() => applyWidthIn(widthIn + 0.25)} />
              </View>
              <View style={styles.healRow}>
                {HEAL_AGES.map((item) => (
                  <Chip
                    key={item.id}
                    label={item.label}
                    active={healAge === item.id}
                    onPress={() => void chooseHealAge(item.id)}
                  />
                ))}
                {healing && <Text style={{ color: theme.muted, fontFamily: theme.fontBody, fontSize: 10 }}>aging…</Text>}
              </View>
              <Button
                label="Freeze frame"
                icon="camera-outline"
                variant="primary"
                loading={freezing}
                onPress={() => void freezeFrame()}
                style={{ marginTop: SPACE.sm }}
              />
              <Text style={[styles.footnote, { color: theme.muted, fontFamily: theme.fontBody }]}>
                Point the camera at the spot — the design floats at true size. Freeze to compare and save.
              </Text>
            </View>
          ) : (
            <View style={styles.controls}>
              <View style={styles.opacityRow}>
                <Ionicons name="contrast-outline" size={15} color={theme.muted} />
                <Slider
                  style={{ flex: 1 }}
                  minimumValue={0.2}
                  maximumValue={1}
                  value={opacity}
                  onValueChange={setOpacity}
                  minimumTrackTintColor={theme.accent}
                  maximumTrackTintColor={theme.line}
                  thumbTintColor={theme.accent}
                  accessibilityLabel="Design opacity"
                />
                <Text style={{ color: theme.muted, fontSize: 12, width: 38, textAlign: "right" }}>
                  {Math.round(opacity * 100)}%
                </Text>
              </View>
              <View style={styles.row}>
                <Button
                  label="Photo"
                  icon="images-outline"
                  onPress={() => pickPhoto(false)}
                  style={{ flex: 1 }}
                />
                <Button
                  label="Camera"
                  icon="camera-outline"
                  onPress={() => pickPhoto(true)}
                  style={{ flex: 1 }}
                />
              </View>
              <Button
                label="Save mockup"
                icon="download-outline"
                variant="primary"
                loading={saving}
                disabled={!photo}
                onPress={saveMockup}
                style={{ marginTop: SPACE.sm }}
              />
            </View>
          )}
        </SafeAreaView>

        {calibrating && (
          <Calibrate
            ppi={ppi}
            onCancel={() => setCalibrating(false)}
            onSave={saveCalibration}
          />
        )}
      </GestureHandlerRootView>
    </Modal>
  );
}

function Stepper({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const { theme } = useBrand();
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [
        styles.stepBtn,
        { borderColor: theme.line, backgroundColor: theme.surfaceAlt, opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <Ionicons name={icon} size={20} color={theme.foreground} />
    </Pressable>
  );
}

/**
 * Match the outline to a real bank card. Every ID-1 card is 3.370in wide
 * worldwide, so one slider turns this screen's points into inches.
 */
function Calibrate({
  ppi,
  onSave,
  onCancel,
}: {
  ppi: number;
  onSave: (ppi: number) => void;
  onCancel: () => void;
}) {
  const { theme } = useBrand();
  const [value, setValue] = useState(ppi);

  return (
    <View
      style={[StyleSheet.absoluteFill, styles.calibrate, { backgroundColor: theme.background }]}
    >
      <Text
        accessibilityRole="header"
        style={[styles.title, { color: theme.foreground, fontFamily: theme.fontDisplay }]}
      >
        Calibrate
      </Text>
      <Text style={[styles.hint, { color: theme.muted, fontFamily: theme.fontBody }]}>
        Hold any bank or ID card against the screen and match the outline.
      </Text>

      <View style={styles.cardWrap}>
        <View
          style={{
            width: CARD_WIDTH_IN * value,
            height: CARD_HEIGHT_IN * value,
            borderRadius: 12,
            borderWidth: 2,
            borderColor: theme.accent,
            backgroundColor: `${theme.accent}12`,
          }}
        />
      </View>

      <Slider
        minimumValue={90}
        maximumValue={260}
        value={value}
        onValueChange={setValue}
        minimumTrackTintColor={theme.accent}
        maximumTrackTintColor={theme.line}
        thumbTintColor={theme.accent}
        accessibilityLabel="Card size"
      />

      <View style={styles.row}>
        <Button label="Cancel" onPress={onCancel} style={{ flex: 1 }} />
        <Button
          label="Save"
          variant="primary"
          onPress={() => onSave(Math.round(value))}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  healRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: SPACE.sm },
  simulatedBadge: { position: "absolute", top: 8, left: 8, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
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
  chips: { flexDirection: "row", gap: SPACE.sm, marginBottom: SPACE.sm },
  stage: { borderWidth: 1, borderRadius: RADIUS.md, overflow: "hidden" },
  hint: { fontSize: 11, textAlign: "center", marginTop: 8 },
  controls: { marginTop: SPACE.sm },
  sizeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  readout: { alignItems: "center" },
  row: { flexDirection: "row", gap: SPACE.sm, marginTop: SPACE.sm },
  footnote: { fontSize: 11, textAlign: "center", marginTop: SPACE.sm },
  opacityRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  stepBtn: {
    width: 52,
    height: 52,
    borderRadius: RADIUS.md,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  calibrate: { padding: SPACE.md, justifyContent: "center", gap: SPACE.md },
  cardWrap: { alignItems: "center", justifyContent: "center", paddingVertical: SPACE.lg },
});
