import { useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import Slider from "@react-native-community/slider";
import * as Haptics from "expo-haptics";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Path as SvgPath } from "react-native-svg";
import { useBrand } from "@/context/BrandContext";
import { Button } from "@/components/Button";
import { Notice } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { findSurface } from "@/lib/curveWarp";
import { saveDataUrlToPhotos } from "@/lib/files";
import {
  BAKE_COLORS,
  COATING_COLORS,
  SUBSTRATES,
  fitCheck,
  outlinePath,
  printableAreaIn,
  type Substrate,
} from "@/lib/substrate";
import { RADIUS, SPACE, TYPE } from "@/lib/theme";
import { CONTENT_MAX_WIDTH } from "@/lib/chrome";

/**
 * What it looks like on the actual thing.
 *
 * A design judged on white paper says almost nothing about how it will look on
 * a 1.5-inch ball. This puts it on one: pick the substrate, colour it, drag
 * the design onto it, and see it foreshortened by the same surface maths the
 * print compensation uses — so what is on screen is the wrap the object really
 * produces rather than a flat sticker pasted on a circle.
 *
 * The shapes are deliberately plain. This is a placement check, and a flat
 * coloured disc is easier to judge a design against than a rendered cookie.
 */
export function SubstrateMockup({
  uri,
  title,
  onClose,
}: {
  uri: string;
  title: string;
  onClose: () => void;
}) {
  const { theme } = useBrand();
  const { width: screenW, height: screenH } = useWindowDimensions();

  const [substrate, setSubstrate] = useState<Substrate>(SUBSTRATES[0]);
  const [bake, setBake] = useState(BAKE_COLORS[0].color);
  const [coating, setCoating] = useState(COATING_COLORS[0].color);
  const [widthIn, setWidthIn] = useState(1);
  const [aspect, setAspect] = useState(1);
  // Keyed by what produced it. Storing the key alongside the image means a
  // stale warp from the previous substrate is simply not matched, rather than
  // needing to be cleared synchronously inside the effect that replaces it.
  const [warped, setWarped] = useState<{ key: string; uri: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // A square stage the object is drawn into: big enough to judge detail on a
  // phone, and able to use the room an iPad has.
  const stage = Math.min(screenW - SPACE.md * 2, screenH * 0.44, 520);
  const pxPerIn = stage / (substrate.widthIn * 1.35);

  useEffect(() => {
    let active = true;
    Image.loadAsync(uri)
      .then((image) => {
        if (active && image?.width && image?.height) setAspect(image.height / image.width);
      })
      .catch(() => {
        // An unreadable aspect just means the design is treated as square,
        // which is wrong by a little rather than broken.
      });
    return () => {
      active = false;
    };
  }, [uri]);

  // Warping needs Skia, which is not available everywhere this can open, and
  // a flat surface has nothing to warp. The unwarped design is an honest
  // fallback: the same placement, without the foreshortening.
  const surface = findSurface(substrate.surfaceId);
  const curved = !!surface && surface.kind !== "flat";
  const warpKey = `${substrate.surfaceId}:${widthIn.toFixed(2)}:${aspect.toFixed(3)}`;

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        // The paper goes first. A traced stencil is black on white, and white
        // is what "no ink" looks like on paper — left in, it arrives as a
        // white rectangle sitting on the icing.
        // A library design is a file:// path on a phone and a blob: URL in a
        // browser; Skia decodes neither. Resolve to bytes first.
        const { readImageDataUrl } = await import("@/lib/imageSource");
        const { knockOutPaper } = await import("@/lib/knockout");
        const bare = knockOutPaper(await readImageDataUrl(uri));
        if (!curved || !surface) {
          if (active) setWarped({ key: warpKey, uri: bare });
          return;
        }
        const { wrapForSurface } = await import("@/lib/productionTools");
        const out = wrapForSurface(bare, surface, widthIn, widthIn * aspect, "foreshorten", "clear");
        if (active) setWarped({ key: warpKey, uri: out });
      } catch {
        // Skia is not available everywhere this can open. The untouched design
        // is an honest fallback: the same placement, with its paper still
        // attached and no foreshortening.
      }
    })();
    return () => {
      active = false;
    };
  }, [uri, surface, curved, widthIn, aspect, warpKey]);

  const area = printableAreaIn(substrate);
  const fit = fitCheck(substrate, widthIn, aspect);

  const objectPx = substrate.widthIn * pxPerIn;
  const objectPxH = substrate.heightIn * pxPerIn;
  const coatingInset = (substrate.frostingInset ?? 0) * objectPx;

  const designW = widthIn * pxPerIn;
  const designH = designW * aspect;

  // Bumped to remount the draggable layer, which is how the design gets
  // re-centred. The alternative — writing the shared values from an event
  // handler — is a mutation the compiler rejects, and remounting a child that
  // owns its own values is the pattern the rest of the app already uses.
  const [placementKey, setPlacementKey] = useState(0);

  function recentre() {
    setPlacementKey((value) => value + 1);
    Haptics.selectionAsync();
  }

  function pickSubstrate(next: Substrate) {
    setSubstrate(next);
    // Land on a size that fits, so the first thing shown is never an error.
    setWidthIn((current) => Math.min(current, fitCheck(next, 0.1, aspect).maxWidthIn));
    recentre();
  }

  const shown = warped?.key === warpKey ? warped.uri : uri;

  async function saveDesign() {
    setSaving(true);
    try {
      // What gets saved is the artwork as it would be printed, not a picture
      // of the mockup. Offering to save "the mockup" and handing over
      // something else would be worse than not offering.
      await saveDataUrlToPhotos(shown, `design-${Date.now()}.png`);
      setSaved(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.root}>
        <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
          <View style={styles.topbar}>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close mockup"
              style={[styles.iconButton, { backgroundColor: theme.surfaceAlt }]}
            >
              <Icon name="chevronDown" size={TYPE.heading.fontSize} color={theme.foreground} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={[TYPE.micro, { color: theme.accent, fontFamily: theme.fontBodyMedium }]}>
                ON THE REAL THING
              </Text>
              <Text
                numberOfLines={1}
                style={[TYPE.heading, { color: theme.foreground, fontFamily: theme.fontDisplay }]}
              >
                {title}
              </Text>
            </View>
            <Pressable
              onPress={recentre}
              accessibilityRole="button"
              accessibilityLabel="Recentre the design"
              style={[styles.iconButton, { backgroundColor: theme.surfaceAlt }]}
            >
              <Icon name="refresh" size={TYPE.body.fontSize + SPACE.xs / 2} color={theme.foreground} />
            </Pressable>
          </View>

          <View style={[styles.stageWrap, { height: stage }]}>
            <View style={[styles.stageBox, { width: stage, height: stage }]}>
              {substrate.stick && (
                <View
                  style={[
                    styles.stick,
                    {
                      top: stage / 2 + objectPxH / 2 - 4,
                      height: Math.max(0, stage / 2 - objectPxH / 2 + 4),
                    },
                  ]}
                />
              )}

              <View style={{ width: objectPx, height: objectPxH }}>
                <Svg width={objectPx} height={objectPxH}>
                  <SvgPath d={outlinePath(substrate.shape, objectPx)} fill={bake} />
                  {substrate.frostingInset !== null ? (
                    <SvgPath
                      d={outlinePath(substrate.shape, objectPx - coatingInset * 2)}
                      fill={coating}
                      translateX={coatingInset}
                      translateY={coatingInset}
                    />
                  ) : (
                    <SvgPath d={outlinePath(substrate.shape, objectPx)} fill={coating} />
                  )}
                </Svg>

                <PlacedDesign
                  key={placementKey}
                  uri={shown}
                  title={title}
                  width={designW}
                  height={designH}
                />
              </View>
            </View>
          </View>

          <Text
            style={[
              TYPE.caption,
              styles.hint,
              { color: fit.fits ? theme.muted : theme.accent, fontFamily: theme.fontBody },
            ]}
          >
            {fit.fits
              ? `${widthIn.toFixed(2)}in wide on a ${substrate.widthIn}in ${substrate.label.toLowerCase()} · ${area.widthIn.toFixed(2)}in of printable surface`
              : `${fit.reason} The largest that works here is ${fit.maxWidthIn.toFixed(2)}in.`}
          </Text>

          <ScrollView style={styles.controls} contentContainerStyle={{ paddingBottom: SPACE.xl }}>
            <Text style={[TYPE.micro, styles.label, { color: theme.muted, fontFamily: theme.fontBodyMedium }]}>
              WHAT IS IT
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              {SUBSTRATES.map((item) => {
                const active = item.id === substrate.id;
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => pickSubstrate(item)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: active ? theme.accent : theme.surfaceAlt,
                        borderColor: active ? theme.accent : theme.line,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        TYPE.micro,
                        { color: active ? theme.accentText : theme.muted, fontFamily: theme.fontBodyMedium },
                      ]}
                    >
                      {item.label.toUpperCase()}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Text style={[TYPE.caption, styles.label, { color: theme.muted, fontFamily: theme.fontBody }]}>
              {substrate.caption}
            </Text>

            <Text style={[TYPE.micro, styles.label, { color: theme.muted, fontFamily: theme.fontBodyMedium }]}>
              {substrate.frostingInset === null ? "COATING" : "ICING"}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              {COATING_COLORS.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => {
                    setCoating(item.color);
                    Haptics.selectionAsync();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.label} icing`}
                  accessibilityState={{ selected: coating === item.color }}
                  style={[
                    styles.swatch,
                    {
                      backgroundColor: item.color,
                      borderColor: coating === item.color ? theme.accent : theme.line,
                      borderWidth: coating === item.color ? 3 : 1,
                    },
                  ]}
                />
              ))}
            </ScrollView>

            {substrate.frostingInset !== null && (
              <>
                <Text style={[TYPE.micro, styles.label, { color: theme.muted, fontFamily: theme.fontBodyMedium }]}>
                  THE BAKE
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
                  {BAKE_COLORS.map((item) => (
                    <Pressable
                      key={item.id}
                      onPress={() => {
                        setBake(item.color);
                        Haptics.selectionAsync();
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`${item.label} cookie`}
                      accessibilityState={{ selected: bake === item.color }}
                      style={[
                        styles.swatch,
                        {
                          backgroundColor: item.color,
                          borderColor: bake === item.color ? theme.accent : theme.line,
                          borderWidth: bake === item.color ? 3 : 1,
                        },
                      ]}
                    />
                  ))}
                </ScrollView>
              </>
            )}

            <Text style={[TYPE.micro, styles.label, { color: theme.muted, fontFamily: theme.fontBodyMedium }]}>
              SIZE
            </Text>
            <View style={styles.sliderRow}>
              <Text style={[TYPE.micro, { width: 60, color: theme.muted, fontFamily: theme.fontBodyMedium }]}>
                {widthIn.toFixed(2)}IN
              </Text>
              <Slider
                style={{ flex: 1 }}
                minimumValue={0.25}
                maximumValue={Math.max(0.5, substrate.widthIn)}
                step={0.05}
                value={widthIn}
                onValueChange={setWidthIn}
                minimumTrackTintColor={theme.accent}
                maximumTrackTintColor={theme.line}
                thumbTintColor={theme.accent}
              />
            </View>
            <Pressable
              onPress={() => setWidthIn(Number(fit.maxWidthIn.toFixed(2)))}
              accessibilityRole="button"
              style={[styles.chip, { alignSelf: "flex-start", backgroundColor: theme.surfaceAlt, borderColor: theme.line }]}
            >
              <Text style={[TYPE.micro, { color: theme.muted, fontFamily: theme.fontBodyMedium }]}>
                FILL THE SURFACE
              </Text>
            </Pressable>

            {error && (
              <View style={{ marginTop: SPACE.md }}>
                <Notice>{error}</Notice>
              </View>
            )}

            <Button
              label={saved ? "Saved to Photos" : "Save the design"}
              icon="download-outline"
              variant="primary"
              disabled={saving}
              onPress={saveDesign}
              style={{ marginTop: SPACE.md }}
            />
            <Text style={[TYPE.caption, styles.label, { color: theme.muted, fontFamily: theme.fontBody }]}>
              Saves the artwork at the size shown, wrapped for the surface where that applies. The mockup itself is for judging by eye.
            </Text>
          </ScrollView>
        </SafeAreaView>
      </GestureHandlerRootView>
    </Modal>
  );
}


/**
 * The design, draggable and rotatable on the object.
 *
 * Owns its own shared values so that re-centring is a remount rather than a
 * write from an event handler, which the React compiler treats as mutating a
 * value it does not control.
 */
function PlacedDesign({
  uri,
  title,
  width,
  height,
}: {
  uri: string;
  title: string;
  width: number;
  height: number;
}) {
  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const spin = useSharedValue(0);
  const spinStart = useSharedValue(0);

  const pan = Gesture.Pan()
    .onBegin(() => {
      "worklet";
      startX.value = offsetX.value;
      startY.value = offsetY.value;
    })
    .onUpdate((event) => {
      "worklet";
      offsetX.value = startX.value + event.translationX;
      offsetY.value = startY.value + event.translationY;
    });

  const rotate = Gesture.Rotation()
    .onBegin(() => {
      "worklet";
      spinStart.value = spin.value;
    })
    .onUpdate((event) => {
      "worklet";
      spin.value = spinStart.value + (event.rotation * 180) / Math.PI;
    });

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: offsetX.value },
      { translateY: offsetY.value },
      { rotate: `${spin.value}deg` },
    ],
  }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <GestureDetector gesture={Gesture.Simultaneous(pan, rotate)}>
        <Animated.View style={[styles.designLayer, style]}>
          <Image source={{ uri }} style={{ width, height }} contentFit="contain" alt={title} />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  screen: { flex: 1, paddingHorizontal: SPACE.md, width: "100%", maxWidth: CONTENT_MAX_WIDTH, alignSelf: "center" },
  topbar: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, paddingVertical: SPACE.sm },
  iconButton: { width: 38, height: 38, borderRadius: RADIUS.pill, alignItems: "center", justifyContent: "center" },
  stageWrap: { alignItems: "center", justifyContent: "center" },
  stageBox: { alignItems: "center", justifyContent: "center" },
  stick: { position: "absolute", width: 8, borderRadius: 4, alignSelf: "center", backgroundColor: "#e8ddc8" },
  designLayer: { flex: 1, alignItems: "center", justifyContent: "center" },
  hint: { textAlign: "center", marginTop: SPACE.xs, marginBottom: SPACE.sm },
  controls: { flex: 1 },
  label: { marginTop: SPACE.sm, marginBottom: SPACE.xs },
  row: { flexDirection: "row", gap: SPACE.xs, paddingVertical: 2 },
  chip: { borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: SPACE.sm, paddingVertical: SPACE.xs },
  swatch: { width: 34, height: 34, borderRadius: RADIUS.pill },
  sliderRow: { flexDirection: "row", alignItems: "center", gap: SPACE.xs },
});
