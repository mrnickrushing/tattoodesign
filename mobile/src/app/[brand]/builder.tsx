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
  type LibraryDesign,
} from "@/lib/designLibrary";
import { generateId } from "@/lib/id";
import { saveDataUrlToPhotos } from "@/lib/files";

type SheetTemplate = { id: string; label: string; widthIn: number; heightIn: number };

const TEMPLATES: SheetTemplate[] = [
  { id: "letter", label: "Letter", widthIn: 8.5, heightIn: 11 },
  { id: "tabloid", label: "Tabloid", widthIn: 11, heightIn: 17 },
  { id: "a4", label: "A4", widthIn: 8.27, heightIn: 11.69 },
  { id: "square", label: "Square", widthIn: 12, heightIn: 12 },
];

type SheetItem = {
  id: string;
  dataUrl: string;
  title: string;
  xIn: number;
  yIn: number;
  wIn: number;
  hIn: number;
  rotation: number;
};

const MAX_PX_PER_IN = 50;

export default function BuilderScreen() {
  const { brand, theme } = useBrand();
  const { width: screenWidth } = useWindowDimensions();

  const [templateId, setTemplateId] = useState("letter");
  const [items, setItems] = useState<SheetItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
    Haptics.selectionAsync();
    setTemplateId(id);
    setItems([]);
    setSelectedId(null);
  }

  function addItem(design: { dataUrl: string; title: string }) {
    const wIn = Math.min(3, template.widthIn * 0.35);
    const id = generateId();
    setItems((prev) => [
      ...prev,
      {
        id,
        dataUrl: design.dataUrl,
        title: design.title,
        xIn: template.widthIn / 2 - wIn / 2,
        yIn: template.heightIn / 2 - wIn / 2,
        wIn,
        hIn: wIn,
        rotation: 0,
      },
    ]);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedId(id);
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
      <Text
        accessibilityRole="header"
        style={[styles.title, { color: theme.foreground, fontFamily: theme.fontDisplay }]}
      >
        {brand.builder.title}
      </Text>
      <Text style={[styles.subtitle, { color: theme.muted, fontFamily: theme.fontBody }]}>
        Drag to move, pinch to resize, twist to rotate. Tap to select.
      </Text>

      <View style={styles.chips} accessibilityRole="radiogroup">
        {TEMPLATES.map((t) => {
          const active = t.id === templateId;
          return (
            <Pressable
              key={t.id}
              onPress={() => changeTemplate(t.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={t.label}
              style={({ pressed }) => [
                styles.chip,
                {
                  backgroundColor: active ? theme.accent : theme.paper,
                  borderColor: theme.line,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <Text
                style={{
                  color: active ? theme.accentText : theme.foreground,
                  fontFamily: theme.fontBody,
                  fontSize: 12,
                }}
              >
                {t.label}
              </Text>
            </Pressable>
          );
        })}
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
        <Pressable
          onPress={removeSelected}
          accessibilityRole="button"
          accessibilityLabel="Remove selected design"
          style={({ pressed }) => [
            styles.removeButton,
            { borderColor: theme.danger, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={{ color: theme.danger, fontFamily: theme.fontBodyMedium, fontSize: 13 }}>
            Remove selected design
          </Text>
        </Pressable>
      )}

      <Pressable
        onPress={handlePrint}
        accessibilityRole="button"
        accessibilityLabel="Print sheet"
        style={({ pressed }) => [
          styles.primaryButton,
          { backgroundColor: theme.accent, opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
        ]}
      >
        <Text style={{ color: theme.accentText, fontFamily: theme.fontBodyMedium }}>
          Print sheet
        </Text>
      </Pressable>
      <Pressable
        onPress={handleSave}
        accessibilityRole="button"
        accessibilityLabel="Save sheet to Photos"
        style={({ pressed }) => [
          styles.secondaryButton,
          { borderColor: theme.line, opacity: pressed ? 0.7 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
        ]}
      >
        <Text style={{ color: theme.foreground, fontFamily: theme.fontBodyMedium }}>
          Save to Photos
        </Text>
      </Pressable>

      <View style={styles.libraryHeader}>
        <Text
          accessibilityRole="header"
          style={[styles.label, { color: theme.foreground, fontFamily: theme.fontBodyMedium }]}
        >
          Your designs
        </Text>
        <Pressable
          onPress={pickUpload}
          accessibilityRole="button"
          accessibilityLabel="Upload a design"
          hitSlop={10}
          style={{ paddingVertical: 6, paddingHorizontal: 4 }}
        >
          <Text style={{ color: theme.muted, fontFamily: theme.fontBody, fontSize: 12 }}>
            Upload
          </Text>
        </Pressable>
      </View>

      {library.length === 0 ? (
        <Text style={{ color: theme.muted, fontSize: 13, fontFamily: theme.fontBody }}>
          Designs from Generate and Convert will show up here.
        </Text>
      ) : (
        <View style={styles.libraryGrid}>
          {library.map((d) => (
            <Pressable
              key={d.id}
              onPress={() => addItem(d)}
              accessibilityRole="button"
              accessibilityLabel={`Add ${d.title} to sheet`}
              style={({ pressed }) => [
                styles.libraryThumb,
                { borderColor: theme.line, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Image
                source={{ uri: d.dataUrl }}
                style={styles.image}
                contentFit="contain"
                alt={d.title}
              />
            </Pressable>
          ))}
        </View>
      )}
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
            : "Double tap to select, then use Remove selected design to delete."
        }
      >
        <Image
          source={{ uri: item.dataUrl }}
          style={styles.image}
          contentFit="contain"
          pointerEvents="none"
          alt={item.title}
        />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 60 },
  title: { fontSize: 30, marginBottom: 6 },
  subtitle: { fontSize: 14, lineHeight: 20, marginBottom: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 44,
    justifyContent: "center",
  },
  sheetWrap: { alignItems: "center", marginBottom: 12 },
  sheet: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#00000022",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  removeButton: {
    alignSelf: "center",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginBottom: 16,
    minHeight: 44,
    justifyContent: "center",
  },
  primaryButton: {
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 10,
    minHeight: 44,
    justifyContent: "center",
  },
  secondaryButton: {
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    marginBottom: 24,
    minHeight: 44,
    justifyContent: "center",
  },
  libraryHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  label: { fontSize: 15 },
  libraryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  libraryThumb: {
    width: 72,
    height: 72,
    borderRadius: 10,
    borderWidth: 1,
    overflow: "hidden",
    backgroundColor: "#fff",
  },
  image: { width: "100%", height: "100%" },
});
