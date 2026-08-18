import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  Alert,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Print from "expo-print";
import * as Haptics from "expo-haptics";
import { captureRef } from "react-native-view-shot";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  runOnJS,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useBrand } from "@/context/BrandContext";
import {
  addToLibrary,
  getLibrary,
  removeFromLibrary,
  type LibraryDesign,
} from "@/lib/designLibrary";
import { generateId } from "@/lib/id";
import { saveDataUrlToPhotos } from "@/lib/files";
import { Button } from "@/components/Button";
import { ScreenHeader, Chip, SectionLabel } from "@/components/ui";
import { ImageViewer } from "@/components/ImageViewer";
import { SPACE, RADIUS, lift } from "@/lib/theme";

type SheetTemplate = { id: string; label: string; widthIn: number; heightIn: number };

const TEMPLATES: SheetTemplate[] = [
  { id: "letter", label: "Letter", widthIn: 8.5, heightIn: 11 },
  { id: "tabloid", label: "Tabloid", widthIn: 11, heightIn: 17 },
  { id: "a4", label: "A4", widthIn: 8.27, heightIn: 11.69 },
  { id: "square", label: "Square", widthIn: 12, heightIn: 12 },
];

type SheetItem = {
  id: string;
  uri: string;
  title: string;
  xIn: number;
  yIn: number;
  wIn: number;
  hIn: number;
  rotation: number;
  /** Stencils are often applied reversed, so mirroring is a first-class op. */
  mirrored: boolean;
};

const MAX_PX_PER_IN = 50;

export default function BuilderScreen() {
  const { brand, theme } = useBrand();
  const { width: screenWidth } = useWindowDimensions();

  const [templateId, setTemplateId] = useState("letter");
  const [items, setItems] = useState<SheetItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<LibraryDesign | null>(null);
  const [library, setLibrary] = useState<LibraryDesign[]>([]);
  const sheetRef = useRef<View>(null);

  const template = TEMPLATES.find((t) => t.id === templateId)!;
  const pxPerIn = Math.min(MAX_PX_PER_IN, (screenWidth - 40) / template.widthIn);
  const sheetWidth = template.widthIn * pxPerIn;
  const sheetHeight = template.heightIn * pxPerIn;

  useEffect(() => {
    let active = true;
    getLibrary(brand.id).then((l) => {
      if (active) setLibrary(l);
    });
    return () => {
      active = false;
    };
  }, [brand.id]);

  function refreshLibrary() {
    getLibrary(brand.id).then(setLibrary);
  }

  function changeTemplate(id: string) {
    const next = TEMPLATES.find((t) => t.id === id);
    if (!next) return;
    Haptics.selectionAsync();
    setTemplateId(id);
    // Trying a different sheet size shouldn't throw the layout away. Keep
    // every design and just pull anything that now falls off the page back
    // onto it.
    setItems((prev) =>
      prev.map((it) => ({
        ...it,
        wIn: Math.min(it.wIn, next.widthIn),
        hIn: Math.min(it.hIn, next.heightIn),
        xIn: Math.max(0, Math.min(it.xIn, next.widthIn - Math.min(it.wIn, next.widthIn))),
        yIn: Math.max(0, Math.min(it.yIn, next.heightIn - Math.min(it.hIn, next.heightIn))),
      }))
    );
  }

  function addItem(design: { uri: string; title: string }) {
    const wIn = Math.min(3, template.widthIn * 0.35);
    const id = generateId();
    setItems((prev) => [
      ...prev,
      {
        id,
        uri: design.uri,
        title: design.title,
        xIn: template.widthIn / 2 - wIn / 2,
        yIn: template.heightIn / 2 - wIn / 2,
        wIn,
        hIn: wIn,
        rotation: 0,
        mirrored: false,
      },
    ]);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedId(id);
  }

  function duplicateSelected() {
    const src = items.find((i) => i.id === selectedId);
    if (!src) return;
    const id = generateId();
    // Offset slightly so the copy is visibly its own object, and keep it
    // on the page even when duplicating something near the edge.
    const step = 0.25;
    setItems((prev) => [
      ...prev,
      {
        ...src,
        id,
        xIn: Math.min(src.xIn + step, Math.max(0, template.widthIn - src.wIn)),
        yIn: Math.min(src.yIn + step, Math.max(0, template.heightIn - src.hIn)),
      },
    ]);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedId(id);
  }

  function mirrorSelected() {
    if (!selectedId) return;
    Haptics.selectionAsync();
    setItems((prev) =>
      prev.map((i) => (i.id === selectedId ? { ...i, mirrored: !i.mirrored } : i))
    );
  }

  function removeSelected() {
    if (!selectedId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setItems((prev) => prev.filter((i) => i.id !== selectedId));
    setSelectedId(null);
  }

  async function pickUpload() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Photo access needed", "Allow photo access to upload a design.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      base64: true,
      quality: 1,
    });
    if (result.canceled || !result.assets[0]?.base64) return;
    const dataUrl = `data:image/jpeg;base64,${result.assets[0].base64}`;
    await addToLibrary(brand.id, {
      dataUrl,
      title: `Upload ${new Date().toLocaleTimeString()}`,
      source: "uploaded",
    });
    refreshLibrary();
  }

  async function captureSheet(): Promise<string> {
    const uri = await captureRef(sheetRef, {
      format: "png",
      quality: 1,
      result: "base64",
    });
    return `data:image/png;base64,${uri}`;
  }

  async function handleSave() {
    if (items.length === 0) {
      Alert.alert("Nothing to save", "Add a design to the sheet first.");
      return;
    }
    try {
      const dataUrl = await captureSheet();
      await saveDataUrlToPhotos(dataUrl, `sheet-${Date.now()}.png`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Saved", "Sheet added to your Photos.");
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Couldn't save", e instanceof Error ? e.message : "Try again.");
    }
  }

  async function handlePrint() {
    if (items.length === 0) {
      Alert.alert("Nothing to print", "Add a design to the sheet first.");
      return;
    }
    try {
      const dataUrl = await captureSheet();
      const widthPx = Math.round(template.widthIn * 72);
      const heightPx = Math.round(template.heightIn * 72);
      const html = `<html><body style="margin:0;padding:0;"><img src="${dataUrl}" style="width:${widthPx}px;height:${heightPx}px;object-fit:contain;" /></body></html>`;
      await Print.printAsync({ html, width: widthPx, height: heightPx });
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Couldn't print", e instanceof Error ? e.message : "Try again.");
    }
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.scroll}
    >
      <ScreenHeader
        eyebrow={brand.builder.tabLabel}
        title={brand.builder.title}
        subtitle="Tap a design to place it. Drag to move, pinch to resize, twist to rotate."
      />

      <View style={styles.chips} accessibilityRole="radiogroup">
        {TEMPLATES.map((t) => (
          <Chip
            key={t.id}
            label={t.label}
            active={t.id === templateId}
            onPress={() => changeTemplate(t.id)}
          />
        ))}
      </View>

      <View style={styles.sheetWrap}>
        <View
          ref={sheetRef}
          collapsable={false}
          style={[styles.sheet, { width: sheetWidth, height: sheetHeight }]}
        >
          {items.map((item) => (
            <DraggableItem
              key={item.id}
              item={item}
              pxPerIn={pxPerIn}
              selected={item.id === selectedId}
              accent={theme.accent}
              onSelect={() => setSelectedId(item.id)}
            />
          ))}
        </View>
      </View>

      {selectedId && (
        <View style={styles.itemActions}>
          <Button
            label="Duplicate"
            icon="copy-outline"
            onPress={duplicateSelected}
            style={{ flex: 1 }}
          />
          <Button
            label="Mirror"
            icon="swap-horizontal-outline"
            onPress={mirrorSelected}
            style={{ flex: 1 }}
          />
          <Button
            label="Remove"
            icon="trash-outline"
            variant="danger"
            onPress={removeSelected}
            style={{ flex: 1 }}
          />
        </View>
      )}

      <View style={styles.actions}>
        <Button
          label="Print sheet"
          icon="print-outline"
          variant="primary"
          onPress={handlePrint}
          style={{ flex: 1 }}
        />
        <Button
          label="Save sheet"
          icon="download-outline"
          onPress={handleSave}
          style={{ flex: 1 }}
        />
      </View>

      <SectionLabel action={{ label: "Upload", icon: "cloud-upload-outline", onPress: pickUpload }}>
        Your designs
      </SectionLabel>

      {library.length === 0 ? (
        <View style={[styles.emptyLib, { borderColor: theme.line }]}>
          <Ionicons name="albums-outline" size={26} color={theme.muted} />
          <Text style={{ color: theme.muted, fontSize: 13, fontFamily: theme.fontBody, textAlign: "center" }}>
            Designs you generate or trace land here, ready to place.
          </Text>
        </View>
      ) : (
        <View style={styles.libraryGrid}>
          {library.map((d) => (
            <Pressable
              key={d.id}
              onPress={() => addItem(d)}
              onLongPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                Alert.alert(d.title, undefined, [
                  { text: "View", onPress: () => setPreview(d) },
                  {
                    text: "Delete",
                    style: "destructive",
                    onPress: async () => {
                      await removeFromLibrary(brand.id, d.id);
                      refreshLibrary();
                    },
                  },
                  { text: "Cancel", style: "cancel" },
                ]);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Add ${d.title} to sheet`}
              accessibilityHint="Long press to view or delete"
              style={({ pressed }) => [
                styles.libraryThumb,
                { borderColor: theme.line, backgroundColor: theme.stock, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Image
                source={{ uri: d.uri }}
                style={styles.image}
                contentFit="contain"
                alt={d.title}
              />
            </Pressable>
          ))}
        </View>
      )}

      <ImageViewer
        uri={preview?.uri ?? null}
        title={preview?.title}
        onClose={() => setPreview(null)}
      />
    </ScrollView>
  );
}

function DraggableItem({
  item,
  pxPerIn,
  selected,
  accent,
  onSelect,
}: {
  item: SheetItem;
  pxPerIn: number;
  selected: boolean;
  accent: string;
  onSelect: () => void;
}) {
  const translateX = useSharedValue(item.xIn * pxPerIn);
  const translateY = useSharedValue(item.yIn * pxPerIn);
  const width = useSharedValue(item.wIn * pxPerIn);
  const height = useSharedValue(item.hIn * pxPerIn);
  const rotation = useSharedValue(item.rotation);

  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const startW = useSharedValue(0);
  const startH = useSharedValue(0);
  const startRotation = useSharedValue(0);

  const tap = Gesture.Tap().onEnd(() => {
    runOnJS(onSelect)();
  });

  // Mutating `.value` on a shared value from inside a gesture worklet is the
  // documented, correct Reanimated pattern (worklets run on the UI thread,
  // not as React render code).
  const pan = Gesture.Pan()
    .onStart(() => {
      startX.value = translateX.value;
      startY.value = translateY.value;
    })
    .onUpdate((e) => {
      translateX.value = startX.value + e.translationX;
      translateY.value = startY.value + e.translationY;
    })
    .onEnd(() => {
      runOnJS(onSelect)();
    });

  const pinch = Gesture.Pinch()
    .onStart(() => {
      startW.value = width.value;
      startH.value = height.value;
    })
    .onUpdate((e) => {
      width.value = Math.max(24, startW.value * e.scale);
      height.value = Math.max(24, startH.value * e.scale);
    });

  const rotate = Gesture.Rotation()
    .onStart(() => {
      startRotation.value = rotation.value;
    })
    .onUpdate((e) => {
      rotation.value = startRotation.value + (e.rotation * 180) / Math.PI;
    });

  const composed = Gesture.Simultaneous(pan, pinch, rotate, tap);

  const style = useAnimatedStyle(() => ({
    position: "absolute",
    left: translateX.value,
    top: translateY.value,
    width: width.value,
    height: height.value,
    transform: [{ rotateZ: `${rotation.value}deg` }],
    borderWidth: selected ? 2 : 0,
    borderColor: accent,
  }));

  return (
    <GestureDetector gesture={composed}>
      <Animated.View
        style={style}
        accessible
        accessibilityRole="button"
        accessibilityLabel={item.title}
        accessibilityHint={
          selected
            ? "Selected. Drag to move, pinch to resize, twist to rotate."
            : "Double tap to select, then duplicate, mirror, or remove it."
        }
      >
        <Image
          source={{ uri: item.uri }}
          style={[styles.image, item.mirrored && { transform: [{ scaleX: -1 }] }]}
          contentFit="contain"
          pointerEvents="none"
          alt={item.mirrored ? `${item.title}, mirrored` : item.title}
        />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: SPACE.md, paddingTop: SPACE.lg, paddingBottom: SPACE.xxl },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: SPACE.md },
  sheetWrap: { alignItems: "center", marginBottom: SPACE.md },
  sheet: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#00000018",
    borderRadius: 2,
    ...lift("md"),
  },
  actions: { flexDirection: "row", gap: SPACE.sm, marginBottom: SPACE.lg },
  itemActions: { flexDirection: "row", gap: SPACE.sm, marginBottom: SPACE.md },
  emptyLib: {
    alignItems: "center",
    gap: SPACE.sm,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: RADIUS.md,
    paddingVertical: SPACE.lg,
    paddingHorizontal: SPACE.md,
  },
  libraryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  libraryThumb: {
    width: 76,
    height: 76,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    overflow: "hidden",
  },
  image: { width: "100%", height: "100%" },
});
