import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  TextInput,
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
  renameInLibrary,
  type LibraryDesign,
} from "@/lib/designLibrary";
import {
  deleteSheet,
  getDraft,
  listSheets,
  renameSheet,
  saveDraft,
  saveSheet,
  type SavedSheet,
} from "@/lib/sheetLibrary";
import { generateId } from "@/lib/id";
import { saveDataUrlToPhotos } from "@/lib/files";
import { composeSheet } from "@/lib/sheet";
import { Button } from "@/components/Button";
import { ScreenHeader, Chip, SectionLabel, Card } from "@/components/ui";
import { ImageViewer } from "@/components/ImageViewer";
import { NamePrompt } from "@/components/NamePrompt";
import { IcingPreview } from "@/components/IcingPreview";
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
  /** The library design this came from, so a saved layout can re-resolve the
   *  image file rather than depending on a path that may have moved. */
  designId?: string;
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

type NamePromptState =
  | { kind: "save"; initial: string }
  | { kind: "rename-sheet"; id: string; initial: string }
  | { kind: "rename-design"; id: string; initial: string };

/** Re-points saved items at the current design files, and drops any whose
 *  design has since been deleted so a loaded sheet never shows a dead frame. */
function resolveItems(items: SheetItem[], library: LibraryDesign[]): SheetItem[] {
  return items
    .filter((item) => !item.designId || library.some((d) => d.id === item.designId))
    .map((item) => {
      const design = library.find((d) => d.id === item.designId);
      return design ? { ...item, uri: design.uri, title: design.title } : item;
    });
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

export default function BuilderScreen() {
  const { brand, theme } = useBrand();
  const { width: screenWidth } = useWindowDimensions();

  const [templateId, setTemplateId] = useState("letter");
  const [items, setItems] = useState<SheetItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<LibraryDesign | null>(null);
  const [widthDraft, setWidthDraft] = useState("");
  const [library, setLibrary] = useState<LibraryDesign[]>([]);
  const [sheets, setSheets] = useState<SavedSheet[]>([]);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [sheetName, setSheetName] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<NamePromptState | null>(null);
  const [icing, setIcing] = useState<LibraryDesign | null>(null);
  const [promptSeq, setPromptSeq] = useState(0);
  /** Bumped to remount the placed designs when their geometry changes from
   *  outside a gesture, so the view re-seeds from state. */
  const [syncKey, setSyncKey] = useState(0);
  /** Autosave stays off until the stored draft has been read back, or the
   *  first render would overwrite it with an empty canvas. */
  const restored = useRef(false);

  const template = TEMPLATES.find((t) => t.id === templateId)!;
  const pxPerIn = Math.min(MAX_PX_PER_IN, (screenWidth - 40) / template.widthIn);
  const sheetWidth = template.widthIn * pxPerIn;
  const sheetHeight = template.heightIn * pxPerIn;

  useEffect(() => {
    let active = true;
    restored.current = false;
    (async () => {
      const [lib, saved, draft] = await Promise.all([
        getLibrary(brand.id),
        listSheets(brand.id),
        getDraft(brand.id),
      ]);
      if (!active) return;
      setLibrary(lib);
      setSheets(saved);
      if (draft) {
        if (TEMPLATES.some((t) => t.id === draft.templateId)) setTemplateId(draft.templateId);
        setItems(resolveItems(draft.items, lib));
        setSheetId(draft.sheetId);
        setSheetName(draft.sheetName);
        setSyncKey((k) => k + 1);
      }
      restored.current = true;
    })();
    return () => {
      active = false;
    };
  }, [brand.id]);

  // Debounced so dragging a design doesn't write on every frame.
  useEffect(() => {
    if (!restored.current) return;
    const timer = setTimeout(() => {
      saveDraft(brand.id, { templateId, items, sheetId, sheetName });
    }, 400);
    return () => clearTimeout(timer);
  }, [brand.id, templateId, items, sheetId, sheetName]);

  const selected = items.find((i) => i.id === selectedId) ?? null;

  /** The sequence number gives each open its own mount, so a value typed and
   *  then cancelled doesn't come back the next time. */
  function openPrompt(next: NamePromptState) {
    setPromptSeq((n) => n + 1);
    setPrompt(next);
  }

  function refreshLibrary() {
    getLibrary(brand.id).then(setLibrary);
  }

  function changeTemplate(id: string) {
    const next = TEMPLATES.find((t) => t.id === id);
    if (!next) return;
    Haptics.selectionAsync();
    setTemplateId(id);
    setSyncKey((k) => k + 1);
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

  function addItem(design: LibraryDesign) {
    const wIn = Math.min(3, template.widthIn * 0.35);
    const id = generateId();
    setItems((prev) => [
      ...prev,
      {
        id,
        designId: design.id,
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

  /**
   * Writes a finished gesture back into state, clamped onto the page.
   *
   * The gesture itself runs entirely on shared values for smoothness, so
   * until this lands the React state still describes where the design *was*.
   * That matters more than it used to: the sheet is now re-composited from
   * these numbers at print time rather than screenshotted, so a position
   * that never makes it back here is a design that prints in the wrong place.
   */
  const commitItem = useCallback(
    (id: string, next: { xIn: number; yIn: number; wIn: number; hIn: number; rotation: number }) => {
      const wIn = clamp(next.wIn, 0.25, template.widthIn);
      const hIn = clamp(next.hIn, 0.25, template.heightIn);
      const xIn = clamp(next.xIn, 0, Math.max(0, template.widthIn - wIn));
      const yIn = clamp(next.yIn, 0, Math.max(0, template.heightIn - hIn));
      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, xIn, yIn, wIn, hIn, rotation: next.rotation } : item))
      );
      // Dragged past the edge: state now says "on the page", so the view has
      // to be re-seeded or it would sit somewhere the sheet won't print.
      const snapped =
        Math.abs(xIn - next.xIn) > 0.005 ||
        Math.abs(yIn - next.yIn) > 0.005 ||
        Math.abs(wIn - next.wIn) > 0.005 ||
        Math.abs(hIn - next.hIn) > 0.005;
      if (snapped) setSyncKey((k) => k + 1);
    },
    [template.widthIn, template.heightIn]
  );

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

  /** Resize about the design's center so it doesn't jump when retyped, keep
   *  the aspect ratio, and clamp so it can't exceed the page. */
  function setSelectedWidth(nextWidthIn: number) {
    const item = items.find((i) => i.id === selectedId);
    if (!item) return;
    const maxW = template.widthIn;
    const ratio = item.hIn / item.wIn;
    const w = Math.max(0.25, Math.min(nextWidthIn, maxW));
    const h = w * ratio;
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id
          ? {
              ...i,
              wIn: w,
              hIn: h,
              xIn: Math.max(0, Math.min(i.xIn + (i.wIn - w) / 2, template.widthIn - w)),
              yIn: Math.max(0, Math.min(i.yIn + (i.hIn - h) / 2, template.heightIn - h)),
            }
          : i
      )
    );
    setSyncKey((k) => k + 1);
  }

  function nudgeWidth(delta: number) {
    const item = items.find((i) => i.id === selectedId);
    if (!item) return;
    Haptics.selectionAsync();
    setSelectedWidth(Number((item.wIn + delta).toFixed(2)));
  }

  function commitWidth() {
    const parsed = parseFloat(widthDraft);
    if (Number.isFinite(parsed)) setSelectedWidth(parsed);
    setWidthDraft("");
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

  function newSheet() {
    if (items.length === 0) return;
    Alert.alert("Start a new sheet?", "The current layout is cleared unless you've saved it.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "New sheet",
        style: "destructive",
        onPress: () => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          setItems([]);
          setSelectedId(null);
          setSheetId(null);
          setSheetName(null);
        },
      },
    ]);
  }

  /** `asCopy` forks the layout into its own sheet instead of updating the
   *  one that's open — the "save as" of a document app. */
  async function storeSheet(name: string, asCopy = false) {
    const saved = await saveSheet(brand.id, {
      id: asCopy ? null : sheetId,
      name,
      templateId,
      items,
    });
    setSheetId(saved.id);
    setSheetName(saved.name);
    setSheets(await listSheets(brand.id));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  function openSavePrompt() {
    if (items.length === 0) {
      Alert.alert("Nothing to save", "Add a design to the sheet first.");
      return;
    }
    openPrompt({ kind: "save", initial: sheetName ?? `${brand.builder.tabLabel} ${sheets.length + 1}` });
  }

  function openSheet(sheet: SavedSheet) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (TEMPLATES.some((t) => t.id === sheet.templateId)) setTemplateId(sheet.templateId);
    const resolved = resolveItems(sheet.items, library);
    const dropped = sheet.items.length - resolved.length;
    if (dropped > 0) {
      // Say so rather than quietly opening a thinner sheet than was saved.
      Alert.alert(
        "Some designs are missing",
        `${dropped} design${dropped === 1 ? "" : "s"} on this sheet ${
          dropped === 1 ? "was" : "were"
        } deleted from your library, so ${dropped === 1 ? "it" : "they"} couldn't be placed.`
      );
    }
    setItems(resolved);
    setSelectedId(null);
    setSheetId(sheet.id);
    setSheetName(sheet.name);
    setSyncKey((k) => k + 1);
  }

  function confirmDeleteSheet(sheet: SavedSheet) {
    Alert.alert(`Delete "${sheet.name}"?`, "The designs on it stay in your library.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await deleteSheet(brand.id, sheet.id);
          setSheets(await listSheets(brand.id));
          // Keep the layout on screen, just detach it from the deleted record.
          if (sheetId === sheet.id) {
            setSheetId(null);
            setSheetName(null);
          }
        },
      },
    ]);
  }

  async function handlePromptSubmit(value: string, asCopy = false) {
    if (!prompt) return;
    if (prompt.kind === "save") {
      await storeSheet(value, asCopy);
      return;
    }
    if (prompt.kind === "rename-sheet") {
      await renameSheet(brand.id, prompt.id, value);
      setSheets(await listSheets(brand.id));
      if (sheetId === prompt.id) setSheetName(value);
      return;
    }
    await renameInLibrary(brand.id, prompt.id, value);
    const lib = await getLibrary(brand.id);
    setLibrary(lib);
    setItems((prev) => resolveItems(prev, lib));
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

  /** Re-composite from the original design files at print resolution. */
  async function renderSheet(): Promise<string> {
    return composeSheet(
      items.map((i) => ({
        uri: i.uri,
        xIn: i.xIn,
        yIn: i.yIn,
        wIn: i.wIn,
        hIn: i.hIn,
        rotation: i.rotation,
        mirrored: i.mirrored,
      })),
      template.widthIn,
      template.heightIn
    );
  }

  async function handleSave() {
    if (items.length === 0) {
      Alert.alert("Nothing to save", "Add a design to the sheet first.");
      return;
    }
    try {
      const dataUrl = await renderSheet();
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
      const dataUrl = await renderSheet();
      const widthPx = Math.round(template.widthIn * 72);
      const heightPx = Math.round(template.heightIn * 72);
      const html =
        `<html><head><style>` +
        `@page { size: ${template.widthIn}in ${template.heightIn}in; margin: 0; }` +
        `html,body { margin:0; padding:0; }` +
        `img { width:${template.widthIn}in; height:${template.heightIn}in; display:block; }` +
        `</style></head><body><img src="${dataUrl}" /></body></html>`;
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

      {/* Document header: what's open, and the two things you do to it. */}
      <View style={[styles.sheetBar, { borderColor: theme.line }]}>
        <View style={styles.sheetBarText}>
          <Text
            numberOfLines={1}
            style={{ color: theme.foreground, fontFamily: theme.fontBodyMedium, fontSize: 14 }}
          >
            {sheetName ?? "Untitled sheet"}
          </Text>
          <Text style={{ color: theme.muted, fontFamily: theme.fontBody, fontSize: 11 }}>
            {items.length === 0
              ? "Empty"
              : `${items.length} design${items.length === 1 ? "" : "s"}`}
            {sheetName ? " · saved" : ""}
          </Text>
        </View>
        <IconAction icon="add-outline" label="New sheet" onPress={newSheet} />
        <IconAction icon="bookmark-outline" label="Save sheet" onPress={openSavePrompt} />
      </View>

      <View style={styles.sheetWrap}>
        <View
          collapsable={false}
          style={[styles.sheet, { width: sheetWidth, height: sheetHeight }]}
        >
          {items.map((item) => (
            <DraggableItem
              key={`${item.id}:${syncKey}`}
              item={item}
              pxPerIn={pxPerIn}
              selected={item.id === selectedId}
              accent={theme.accent}
              onSelect={() => setSelectedId(item.id)}
              onCommit={commitItem}
            />
          ))}
        </View>
      </View>

      {selected && (
        <Card style={{ marginBottom: SPACE.md }}>
          <View style={styles.sizeRow}>
            <View style={styles.sizeLabel}>
              <Ionicons name="resize-outline" size={15} color={theme.muted} />
              <Text style={{ color: theme.foreground, fontFamily: theme.fontBody, fontSize: 14 }}>
                Width
              </Text>
            </View>
            <View style={styles.stepper}>
              <Stepper icon="remove" onPress={() => nudgeWidth(-0.25)} />
              <TextInput
                value={widthDraft}
                onChangeText={setWidthDraft}
                onFocus={() => setWidthDraft(selected.wIn.toFixed(2).replace(/\.?0+$/, ""))}
                onEndEditing={commitWidth}
                onSubmitEditing={commitWidth}
                keyboardType="decimal-pad"
                returnKeyType="done"
                selectTextOnFocus
                accessibilityLabel="Width in inches"
                style={[
                  styles.sizeInput,
                  {
                    backgroundColor: theme.surfaceAlt,
                    borderColor: theme.line,
                    color: theme.foreground,
                    fontFamily: theme.fontBodyMedium,
                  },
                ]}
              />
              <Text style={{ color: theme.muted, fontSize: 13, fontFamily: theme.fontBody }}>
                in
              </Text>
              <Stepper icon="add" onPress={() => nudgeWidth(0.25)} />
            </View>
          </View>
          <Text style={{ color: theme.muted, fontSize: 11, marginTop: 6 }}>
            Prints at exactly this size · {selected.hIn.toFixed(2).replace(/\.?0+$/, "")}in tall
          </Text>
        </Card>
      )}

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

      {sheets.length > 0 && (
        <>
          <SectionLabel>Saved sheets</SectionLabel>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.sheetRow}
            style={{ marginBottom: SPACE.lg }}
          >
            {sheets.map((s) => {
              const open = s.id === sheetId;
              const size = TEMPLATES.find((t) => t.id === s.templateId);
              return (
                <Pressable
                  key={s.id}
                  onPress={() => openSheet(s)}
                  onLongPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    Alert.alert(s.name, undefined, [
                      {
                        text: "Rename",
                        onPress: () =>
                          openPrompt({ kind: "rename-sheet", id: s.id, initial: s.name }),
                      },
                      {
                        text: "Delete",
                        style: "destructive",
                        onPress: () => confirmDeleteSheet(s),
                      },
                      { text: "Cancel", style: "cancel" },
                    ]);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${s.name}`}
                  accessibilityHint="Long press to rename or delete"
                  accessibilityState={{ selected: open }}
                  style={({ pressed }) => [
                    styles.sheetCard,
                    {
                      backgroundColor: theme.surface,
                      borderColor: open ? theme.accent : theme.line,
                      opacity: pressed ? 0.75 : 1,
                    },
                  ]}
                >
                  <Ionicons
                    name={open ? "bookmark" : "bookmark-outline"}
                    size={15}
                    color={open ? theme.accent : theme.muted}
                  />
                  <Text
                    numberOfLines={1}
                    style={{
                      color: theme.foreground,
                      fontFamily: theme.fontBodyMedium,
                      fontSize: 13,
                    }}
                  >
                    {s.name}
                  </Text>
                  <Text style={{ color: theme.muted, fontFamily: theme.fontBody, fontSize: 11 }}>
                    {s.items.length} design{s.items.length === 1 ? "" : "s"}
                    {size ? ` · ${size.label}` : ""}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </>
      )}

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
                  // Icing colors are a Sugar Haus question; flash is inked.
                  ...(brand.id === "sugar"
                    ? [{ text: "Try icing colors", onPress: () => setIcing(d) }]
                    : []),
                  {
                    text: "Rename",
                    onPress: () =>
                      openPrompt({ kind: "rename-design", id: d.id, initial: d.title }),
                  },
                  {
                    text: "Delete",
                    style: "destructive",
                    onPress: async () => {
                      await removeFromLibrary(brand.id, d.id);
                      const lib = await getLibrary(brand.id);
                      setLibrary(lib);
                      // Its file is gone, so anything placed from it would
                      // render as a blank frame — take those off the sheet.
                      setItems((prev) => resolveItems(prev, lib));
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

      <NamePrompt
        key={promptSeq}
        visible={!!prompt}
        title={
          prompt?.kind === "save"
            ? sheetId
              ? "Update sheet"
              : "Name this sheet"
            : prompt?.kind === "rename-sheet"
              ? "Rename sheet"
              : "Rename design"
        }
        placeholder={prompt?.kind === "rename-design" ? "Design name" : "Sheet name"}
        initialValue={prompt?.initial ?? ""}
        confirmLabel={prompt?.kind === "save" && sheetId ? "Update" : "Save"}
        secondary={
          prompt?.kind === "save" && sheetId
            ? { label: "Save as copy", onSubmit: (v) => handlePromptSubmit(v, true) }
            : undefined
        }
        onSubmit={(v) => handlePromptSubmit(v)}
        onClose={() => setPrompt(null)}
      />

      {icing && (
        <IcingPreview
          uri={icing.uri}
          title={icing.title}
          onSave={async (dataUrl) => {
            await addToLibrary(brand.id, {
              dataUrl,
              title: `${icing.title} (iced)`,
              source: "converted",
            });
            refreshLibrary();
          }}
          onClose={() => setIcing(null)}
        />
      )}
    </ScrollView>
  );
}

/** Compact square action for the sheet bar, where a full button would shout. */
function IconAction({
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
        styles.iconAction,
        {
          borderColor: theme.line,
          backgroundColor: theme.surfaceAlt,
          opacity: pressed ? 0.6 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={17} color={theme.foreground} />
    </Pressable>
  );
}

function Stepper({
  icon,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  const { theme } = useBrand();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={icon === "add" ? "Increase width" : "Decrease width"}
      hitSlop={6}
      style={({ pressed }) => [
        styles.stepBtn,
        {
          borderColor: theme.line,
          backgroundColor: theme.surfaceAlt,
          opacity: pressed ? 0.6 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={16} color={theme.foreground} />
    </Pressable>
  );
}

function DraggableItem({
  item,
  pxPerIn,
  selected,
  accent,
  onSelect,
  onCommit,
}: {
  item: SheetItem;
  pxPerIn: number;
  selected: boolean;
  accent: string;
  onSelect: () => void;
  onCommit: (
    id: string,
    next: { xIn: number; yIn: number; wIn: number; hIn: number; rotation: number }
  ) => void;
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

  // Note: these shared values seed from the item once, on mount. When the
  // item is changed from outside a gesture — the width field, a template
  // swap, a clamp back onto the page — the parent bumps a sync key that
  // remounts this view, rather than an effect writing into the shared values
  // (mixing the two is what the immutability lint rule is warning about).

  // Runs on the UI thread at the end of every gesture: hands the final
  // geometry back in inches so state, and therefore print, agrees with what's
  // on screen.
  const commit = () => {
    "worklet";
    runOnJS(onCommit)(item.id, {
      xIn: translateX.value / pxPerIn,
      yIn: translateY.value / pxPerIn,
      wIn: width.value / pxPerIn,
      hIn: height.value / pxPerIn,
      rotation: rotation.value,
    });
  };

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
      commit();
    });

  const pinch = Gesture.Pinch()
    .onStart(() => {
      startW.value = width.value;
      startH.value = height.value;
    })
    .onUpdate((e) => {
      width.value = Math.max(24, startW.value * e.scale);
      height.value = Math.max(24, startH.value * e.scale);
    })
    .onEnd(() => {
      commit();
    });

  const rotate = Gesture.Rotation()
    .onStart(() => {
      startRotation.value = rotation.value;
    })
    .onUpdate((e) => {
      rotation.value = startRotation.value + (e.rotation * 180) / Math.PI;
    })
    .onEnd(() => {
      commit();
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
  sheetBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.sm,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    paddingVertical: SPACE.sm,
    marginBottom: SPACE.md,
  },
  sheetBarText: { flex: 1, gap: 2 },
  iconAction: {
    width: 38,
    height: 38,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetRow: { gap: SPACE.sm, paddingRight: SPACE.md },
  sheetCard: {
    width: 132,
    gap: 4,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACE.sm,
  },
  sheet: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#00000018",
    borderRadius: 2,
    ...lift("md"),
  },
  actions: { flexDirection: "row", gap: SPACE.sm, marginBottom: SPACE.lg },
  itemActions: { flexDirection: "row", gap: SPACE.sm, marginBottom: SPACE.md },
  sizeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sizeLabel: { flexDirection: "row", alignItems: "center", gap: 7 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 8 },
  sizeInput: {
    borderWidth: 1,
    borderRadius: RADIUS.sm,
    paddingHorizontal: 10,
    paddingVertical: 7,
    minWidth: 66,
    textAlign: "center",
    fontSize: 15,
  },
  stepBtn: {
    width: 34,
    height: 34,
    borderRadius: RADIUS.sm,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
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
