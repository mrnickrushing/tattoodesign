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
import type { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Print from "expo-print";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams } from "expo-router";
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
  replaceInLibrary,
  setDesignFavorite,
  setDesignTags,
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
import { pickImageFile } from "@/lib/imageImport";
import { saveDataUrlToPhotos, shareDataUrl, shareUri } from "@/lib/files";
import { composeSheet } from "@/lib/sheet";
import { fillGrid, packGrid } from "@/lib/layout";
import { Button } from "@/components/Button";
import { ScreenHeader, Chip, SectionLabel, Card } from "@/components/ui";
import { ImageViewer } from "@/components/ImageViewer";
import { NamePrompt } from "@/components/NamePrompt";
import { IcingPreview } from "@/components/IcingPreview";
import { PlacementPreview } from "@/components/PlacementPreview";
import { DesignActions, type DesignAction } from "@/components/DesignActions";
import { allTags, filterDesigns, normalizeTags, type SourceFilter } from "@/lib/libraryFilter";
import { DesignEditor } from "@/components/DesignEditor";
import { PrinterStudio } from "@/components/PrinterStudio";
import { EmptyStock } from "@/components/EmptyStock";
import { GlassSurface } from "@/components/GlassSurface";
import { Icon } from "@/components/Icon";
import { PaperSubstrate } from "@/components/PaperSubstrate";
import { getPrinterProfile, savePrinterProfile, type PrinterProfile } from "@/lib/printerProfiles";
import { type IconName } from "@/lib/icons";
import { SPACE, RADIUS, TYPE, lift } from "@/lib/theme";

type SheetTemplate = { id: string; label: string; widthIn: number; heightIn: number };

const TEMPLATES: SheetTemplate[] = [
  { id: "letter", label: "Letter", widthIn: 8.5, heightIn: 11 },
  { id: "tabloid", label: "Tabloid", widthIn: 11, heightIn: 17 },
  { id: "a4", label: "A4", widthIn: 8.27, heightIn: 11.69 },
  { id: "thermal80", label: "Thermal 80", widthIn: 3.15, heightIn: 11 },
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
  locked?: boolean;
};

const MAX_PX_PER_IN = 50;

type NamePromptState =
  | { kind: "save"; initial: string }
  | { kind: "rename-sheet"; id: string; initial: string }
  | { kind: "rename-design"; id: string; initial: string }
  | { kind: "tag-design"; id: string; initial: string };

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
  const { sheet: requestedSheetId } = useLocalSearchParams<{ sheet?: string }>();
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
  const [librarySearch, setLibrarySearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [icing, setIcing] = useState<LibraryDesign | null>(null);
  const [menu, setMenu] = useState<LibraryDesign | null>(null);
  const [placing, setPlacing] = useState<LibraryDesign | null>(null);
  const [editing, setEditing] = useState<LibraryDesign | null>(null);
  const [promptSeq, setPromptSeq] = useState(0);
  /** Bumped to remount the placed designs when their geometry changes from
   *  outside a gesture, so the view re-seeds from state. */
  const [syncKey, setSyncKey] = useState(0);
  /** Snapshots of the layout before each change. Deep history isn't the point
   *  — being able to take back the drag that just wrecked an even row is. */
  const [history, setHistory] = useState<SheetItem[][]>([]);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [guidesVisible, setGuidesVisible] = useState(true);
  const [printerOpen, setPrinterOpen] = useState(false);
  const [printerProfile, setPrinterProfile] = useState<PrinterProfile | null>(null);
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
      const requested = requestedSheetId
        ? saved.find((sheet) => sheet.id === requestedSheetId)
        : null;
      if (requested) {
        if (TEMPLATES.some((t) => t.id === requested.templateId)) setTemplateId(requested.templateId);
        setItems(resolveItems(requested.items, lib));
        setSheetId(requested.id);
        setSheetName(requested.name);
        setSyncKey((k) => k + 1);
      } else if (draft) {
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
  }, [brand.id, requestedSheetId]);

  useEffect(() => {
    getPrinterProfile(brand.id).then(setPrinterProfile);
  }, [brand.id]);

  useEffect(() => {
    if (!printerProfile) return;
    const timer = setTimeout(() => void savePrinterProfile(brand.id, printerProfile), 250);
    return () => clearTimeout(timer);
  }, [brand.id, printerProfile]);

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

  function sameLayout(a: SheetItem[], b: SheetItem[]) {
    return (
      a.length === b.length &&
      a.every((item, i) => {
        const other = b[i];
        return (
          item.id === other.id &&
          item.xIn === other.xIn &&
          item.yIn === other.yIn &&
          item.wIn === other.wIn &&
          item.hIn === other.hIn &&
          item.rotation === other.rotation &&
          item.mirrored === other.mirrored &&
          !!item.locked === !!other.locked
        );
      })
    );
  }

  /** Call before changing `items`. Skips no-op snapshots, because ending a
   *  two-finger gesture commits pinch and rotation separately and would
   *  otherwise cost two undos to take back one move. */
  function pushHistory(snapshot: SheetItem[] = items) {
    setHistory((prev) => {
      const last = prev[prev.length - 1];
      if (last && sameLayout(last, snapshot)) return prev;
      return [...prev.slice(-29), snapshot];
    });
  }

  function undo() {
    if (history.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setItems(history[history.length - 1]);
    setHistory((prev) => prev.slice(0, -1));
    setSelectedId(null);
    setSyncKey((k) => k + 1);
  }

  function changeTemplate(id: string) {
    const next = TEMPLATES.find((t) => t.id === id);
    if (!next) return;
    Haptics.selectionAsync();
    pushHistory();
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
    const ratio = design.width && design.height ? design.height / design.width : 1;
    const hIn = Math.min(template.heightIn, wIn * ratio);
    const id = generateId();
    pushHistory();
    setItems((prev) => [
      ...prev,
      {
        id,
        designId: design.id,
        uri: design.uri,
        title: design.title,
        xIn: template.widthIn / 2 - wIn / 2,
        yIn: template.heightIn / 2 - hIn / 2,
        wIn,
        hIn,
        rotation: 0,
        mirrored: false,
        locked: false,
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
  function commitItem(
    id: string,
    next: { xIn: number; yIn: number; wIn: number; hIn: number; rotation: number }
  ) {
    const source = items.find((item) => item.id === id);
    if (source?.locked) return;
    const step = 0.125;
    const quantize = (value: number) => snapEnabled ? Math.round(value / step) * step : value;
    const wIn = clamp(quantize(next.wIn), 0.25, template.widthIn);
    const hIn = clamp(quantize(next.hIn), 0.25, template.heightIn);
    const xIn = clamp(quantize(next.xIn), 0, Math.max(0, template.widthIn - wIn));
    const yIn = clamp(quantize(next.yIn), 0, Math.max(0, template.heightIn - hIn));
    pushHistory();
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, xIn, yIn, wIn, hIn, rotation: next.rotation } : item
      )
    );
    // Dragged past the edge: state now says "on the page", so the view has
    // to be re-seeded or it would sit somewhere the sheet won't print.
    const snapped =
      Math.abs(xIn - next.xIn) > 0.005 ||
      Math.abs(yIn - next.yIn) > 0.005 ||
      Math.abs(wIn - next.wIn) > 0.005 ||
      Math.abs(hIn - next.hIn) > 0.005;
    if (snapped) setSyncKey((k) => k + 1);
  }

  function duplicateSelected() {
    const src = items.find((i) => i.id === selectedId);
    if (!src) return;
    const id = generateId();
    pushHistory();
    // Offset slightly so the copy is visibly its own object, and keep it
    // on the page even when duplicating something near the edge.
    const step = 0.25;
    setItems((prev) => [
      ...prev,
      {
        ...src,
        id,
        locked: false,
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
    pushHistory();
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
    pushHistory();
    setItems((prev) =>
      prev.map((i) => (i.id === selectedId ? { ...i, mirrored: !i.mirrored } : i))
    );
  }

  function toggleLockSelected() {
    if (!selectedId) return;
    pushHistory();
    setItems((prev) => prev.map((item) => item.id === selectedId ? { ...item, locked: !item.locked } : item));
    Haptics.selectionAsync();
  }

  function nudgeSelected(axis: "x" | "y", delta: number) {
    if (!selected || selected.locked) return;
    pushHistory();
    setItems((prev) => prev.map((item) => item.id === selected.id ? {
      ...item,
      [axis === "x" ? "xIn" : "yIn"]: axis === "x"
        ? clamp(item.xIn + delta, 0, template.widthIn - item.wIn)
        : clamp(item.yIn + delta, 0, template.heightIn - item.hIn),
    } : item));
    setSyncKey((key) => key + 1);
  }

  function alignSelected(edge: "left" | "center" | "right" | "top" | "middle" | "bottom") {
    if (!selected || selected.locked) return;
    pushHistory();
    setItems((prev) => prev.map((item) => item.id === selected.id ? {
      ...item,
      xIn: edge === "left" ? 0 : edge === "center" ? (template.widthIn - item.wIn) / 2 : edge === "right" ? template.widthIn - item.wIn : item.xIn,
      yIn: edge === "top" ? 0 : edge === "middle" ? (template.heightIn - item.hIn) / 2 : edge === "bottom" ? template.heightIn - item.hIn : item.yIn,
    } : item));
    setSyncKey((key) => key + 1);
  }

  function fmtIn(value: number) {
    return value.toFixed(2).replace(/\.?0+$/, "");
  }

  /** Tile the page with copies of the selected design at its current size —
   *  a dozen toppers or a sheet of the same flash, in one tap. */
  function fillSheet() {
    if (!selected) return;
    const cells = fillGrid(template.widthIn, template.heightIn, selected.wIn, selected.hIn);
    if (cells.length === 0) {
      Alert.alert("Too big to tile", "Make the design smaller and try again.");
      return;
    }
    const source = selected;
    Alert.alert(
      "Fill the sheet?",
      `${cells.length} ${cells.length === 1 ? "copy" : "copies"} at ${fmtIn(source.wIn)}in wide. This replaces what's on the sheet.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: `Place ${cells.length}`,
          onPress: () => {
            pushHistory();
            setItems(
              cells.map((cell) => ({
                ...source,
                id: generateId(),
                xIn: cell.xIn,
                yIn: cell.yIn,
              }))
            );
            setSelectedId(null);
            setSyncKey((k) => k + 1);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          },
        },
      ]
    );
  }

  /** Even out what's already on the sheet: one grid, everything the same
   *  size, each design scaled to fit its cell rather than stretched. */
  function arrange() {
    if (items.length < 2) return;
    const cells = packGrid(template.widthIn, template.heightIn, items.length);
    if (cells.length < items.length) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    pushHistory();
    setItems(
      items.map((item, i) => {
        const cell = cells[i];
        const scale = Math.min(cell.wIn / item.wIn, cell.hIn / item.hIn);
        const wIn = item.wIn * scale;
        const hIn = item.hIn * scale;
        return {
          ...item,
          wIn,
          hIn,
          xIn: cell.xIn + (cell.wIn - wIn) / 2,
          yIn: cell.yIn + (cell.hIn - hIn) / 2,
        };
      })
    );
    setSelectedId(null);
    setSyncKey((k) => k + 1);
  }

  function removeSelected() {
    if (!selectedId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    pushHistory();
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
    if (prompt.kind === "tag-design") {
      await setDesignTags(brand.id, prompt.id, normalizeTags(value));
      // The active tag chip may have just been removed from its last design.
      const lib = await getLibrary(brand.id);
      setLibrary(lib);
      if (activeTag && !allTags(lib).includes(activeTag)) setActiveTag(null);
      return;
    }
    await renameInLibrary(brand.id, prompt.id, value);
    const lib = await getLibrary(brand.id);
    setLibrary(lib);
    setItems((prev) => resolveItems(prev, lib));
  }

  async function toggleFavorite(design: LibraryDesign) {
    await setDesignFavorite(brand.id, design.id, !design.favorite);
    setLibrary(await getLibrary(brand.id));
    Haptics.selectionAsync();
  }

  const libraryTags = allTags(library);
  const visibleLibrary = filterDesigns(library, {
    query: librarySearch,
    source: sourceFilter,
    favoritesOnly,
    tag: activeTag ?? undefined,
  });

  async function deleteDesign(design: LibraryDesign) {
    await removeFromLibrary(brand.id, design.id);
    const lib = await getLibrary(brand.id);
    setLibrary(lib);
    // Its file is gone, so anything placed from it would render as a blank
    // frame — take those off the sheet.
    pushHistory();
    setItems((prev) => resolveItems(prev, lib));
  }

  function designActions(design: LibraryDesign): DesignAction[] {
    return [
      {
        key: "place",
        label: "Size it up",
        hint: brand.id === "sugar" ? "True size, or on a photo" : "True size, or on the skin",
        icon: "resize-outline",
        onPress: () => setPlacing(design),
      },
      {
        key: "edit",
        label: "Edit",
        hint: "Touch up, crop, cut line",
        icon: "brush-outline",
        onPress: () => setEditing(design),
      },
      {
        key: "view",
        label: "View full screen",
        icon: "expand-outline",
        onPress: () => setPreview(design),
      },
      // Icing colors are a Sugar Haus question; flash is inked.
      ...(brand.id === "sugar"
        ? [
            {
              key: "icing",
              label: "Try icing colors",
              hint: "Flood and piping",
              icon: "color-palette-outline" as const,
              onPress: () => setIcing(design),
            },
          ]
        : []),
      {
        key: "favorite",
        label: design.favorite ? "Unfavorite" : "Favorite",
        hint: design.favorite ? undefined : "Pin it to the front of the library",
        icon: design.favorite ? "star" : "star-outline",
        onPress: () => toggleFavorite(design),
      },
      {
        key: "tags",
        label: "Tags",
        hint: design.tags?.length ? design.tags.join(", ") : "Client, motif, collection",
        icon: "pricetags-outline",
        onPress: () =>
          openPrompt({ kind: "tag-design", id: design.id, initial: (design.tags ?? []).join(", ") }),
      },
      {
        key: "rename",
        label: "Rename",
        icon: "text-outline",
        onPress: () => openPrompt({ kind: "rename-design", id: design.id, initial: design.title }),
      },
      {
        key: "share",
        label: "Share",
        hint: "AirDrop, Messages, anywhere",
        icon: "share-outline",
        onPress: async () => {
          try {
            await shareUri(design.uri);
          } catch (e) {
            Alert.alert("Couldn't share", e instanceof Error ? e.message : "Try again.");
          }
        },
      },
      {
        key: "delete",
        label: "Delete",
        icon: "trash-outline",
        tone: "danger",
        onPress: () =>
          Alert.alert(`Delete "${design.title}"?`, "This can't be undone.", [
            { text: "Cancel", style: "cancel" },
            { text: "Delete", style: "destructive", onPress: () => deleteDesign(design) },
          ]),
      },
    ];
  }

  async function shareSheet() {
    if (items.length === 0) {
      Alert.alert("Nothing to share", "Add a design to the sheet first.");
      return;
    }
    try {
      const dataUrl = await renderSheet();
      await shareDataUrl(dataUrl, "inkline-sheet.png");
    } catch (e) {
      Alert.alert("Couldn't share", e instanceof Error ? e.message : "Try again.");
    }
  }

  function pickUpload() {
    Alert.alert("Import a design", "Choose where to open it from.", [
      { text: "Photos", onPress: pickUploadFromPhotos },
      { text: "Files / iCloud", onPress: pickUploadFromFiles },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  async function pickUploadFromPhotos() {
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

  async function pickUploadFromFiles() {
    const file = await pickImageFile();
    if (!file) return;
    await addToLibrary(brand.id, {
      dataUrl: file.dataUrl,
      title: file.name.replace(/\.[^.]+$/, "") || "Imported design",
      source: "uploaded",
    });
    refreshLibrary();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  /** Re-composite from the original design files at print resolution. */
  const renderSheet = useCallback(async (output?: Pick<PrinterProfile, "dpi" | "scaleCorrection">): Promise<string> => {
    const scale = output?.scaleCorrection ?? 1;
    return composeSheet(
      items.map((i) => ({
        uri: i.uri,
        xIn: i.xIn * scale,
        yIn: i.yIn * scale,
        wIn: i.wIn * scale,
        hIn: i.hIn * scale,
        rotation: i.rotation,
        mirrored: i.mirrored,
      })),
      template.widthIn,
      template.heightIn,
      output?.dpi
    );
  }, [items, template.widthIn, template.heightIn]);

  const changePrinterProfile = useCallback((next: PrinterProfile) => {
    setPrinterProfile(next);
  }, []);

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

  async function handlePrint(output?: PrinterProfile) {
    if (items.length === 0) {
      Alert.alert("Nothing to print", "Add a design to the sheet first.");
      return;
    }
    try {
      const active = output ?? printerProfile ?? await getPrinterProfile(brand.id);
      const dataUrl = await renderSheet(active);
      const widthPx = Math.round(template.widthIn * 72);
      const heightPx = Math.round(template.heightIn * 72);
      const html =
        `<html><head><style>` +
        `@page { size: ${template.widthIn}in ${template.heightIn}in; margin: 0; }` +
        `html,body { margin:0; padding:0; }` +
        `img { width:${template.widthIn}in; height:${template.heightIn}in; display:block;${active.mirrored ? "transform:scaleX(-1);" : ""} }` +
        `</style></head><body><img src="${dataUrl}" /></body></html>`;
      await Print.printAsync({ html, width: widthPx, height: heightPx });
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Couldn't print", e instanceof Error ? e.message : "Try again.");
    }
  }

  function chooseTiledPrint() {
    if (!selected) return Alert.alert("Choose a design", "Select one design to print oversized.");
    Alert.alert("Oversized tiled print", "Inkline adds ¼-inch overlap, alignment marks, and page numbers.", [
      { text: "2× on Letter", onPress: () => printTiled(2, "letter") },
      { text: "4× on Letter", onPress: () => printTiled(4, "letter") },
      { text: "3× on A4", onPress: () => printTiled(3, "a4") },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  async function printTiled(scale: number, paper: "letter" | "a4") {
    if (!selected) return;
    try {
      const widthIn = selected.wIn * scale;
      const heightIn = selected.hIn * scale;
      const dataUrl = await composeSheet([{ ...selected, xIn: 0, yIn: 0, wIn: widthIn, hIn: heightIn }], widthIn, heightIn, 150);
      const page = paper === "letter" ? { w: 8.5, h: 11 } : { w: 8.27, h: 11.69 };
      const margin = 0.5;
      const overlap = 0.25;
      const tileW = page.w - margin * 2;
      const tileH = page.h - margin * 2;
      const stepX = tileW - overlap;
      const stepY = tileH - overlap;
      const cols = Math.max(1, Math.ceil((widthIn - overlap) / stepX));
      const rows = Math.max(1, Math.ceil((heightIn - overlap) / stepY));
      const pages = Array.from({ length: rows * cols }, (_, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);
        return `<section><div class="tile"><img src="${dataUrl}" style="width:${widthIn}in;height:${heightIn}in;left:${-col * stepX}in;top:${-row * stepY}in"/></div><span>${row + 1}.${col + 1} · page ${index + 1}/${rows * cols}</span><i class="tl">+</i><i class="tr">+</i><i class="bl">+</i><i class="br">+</i></section>`;
      }).join("");
      const html = `<html><head><style>@page{size:${page.w}in ${page.h}in;margin:0}*{box-sizing:border-box}body{margin:0}section{width:${page.w}in;height:${page.h}in;padding:${margin}in;position:relative;page-break-after:always}.tile{width:${tileW}in;height:${tileH}in;overflow:hidden;position:relative;border:1px dashed #999}.tile img{position:absolute;max-width:none}span{position:absolute;right:.5in;bottom:.18in;font:9pt sans-serif}i{position:absolute;font:14pt monospace;font-style:normal}.tl{left:.38in;top:.29in}.tr{right:.38in;top:.29in}.bl{left:.38in;bottom:.28in}.br{right:.38in;bottom:.28in}</style></head><body>${pages}</body></html>`;
      await Print.printAsync({ html, width: Math.round(page.w * 72), height: Math.round(page.h * 72) });
    } catch (error) {
      Alert.alert("Couldn't tile print", error instanceof Error ? error.message : "Try again.");
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
      <GlassSurface style={[styles.sheetBar, { borderColor: theme.line }]}>
        <View style={styles.sheetBarText}>
          <Text
            numberOfLines={1}
            style={[TYPE.body, { color: theme.foreground, fontFamily: theme.fontBodyMedium }]}
          >
            {sheetName ?? "Untitled sheet"}
          </Text>
          <Text style={[TYPE.caption, { color: theme.muted, fontFamily: theme.fontBody }]}>
            {items.length === 0
              ? "Empty"
              : `${items.length} design${items.length === 1 ? "" : "s"}`}
            {sheetName ? " · saved" : ""}
          </Text>
        </View>
        <IconAction
          icon="arrow-undo-outline"
          label="Undo"
          onPress={undo}
          disabled={history.length === 0}
        />
        <IconAction
          icon="grid-outline"
          label="Arrange evenly"
          onPress={arrange}
          disabled={items.length < 2}
        />
        <IconAction icon="add-outline" label="New sheet" onPress={newSheet} />
        <IconAction icon="bookmark-outline" label="Save sheet" onPress={openSavePrompt} />
      </GlassSurface>

      <GlassSurface style={[styles.precisionBar, { borderColor: theme.line }]}>
        <View style={{ flex: 1 }}>
          <Text style={[TYPE.caption, { color: theme.foreground, fontFamily: theme.fontBodyMedium }]}>Precision mode</Text>
          <Text style={[TYPE.micro, { color: theme.muted, fontFamily: theme.fontBody }]}>⅛-inch grid · safe edge · exact output</Text>
        </View>
        <IconAction icon={snapEnabled ? "magnet" : "magnet-outline"} label="Toggle snapping" onPress={() => setSnapEnabled((value) => !value)} />
        <IconAction icon={guidesVisible ? "grid" : "grid-outline"} label="Toggle guides" onPress={() => setGuidesVisible((value) => !value)} />
      </GlassSurface>

      <View style={styles.sheetWrap}>
        <View
          collapsable={false}
          style={[styles.sheet, { width: sheetWidth, height: sheetHeight }]}
        >
          <PaperSubstrate seed={template.widthIn * 100 + template.heightIn} intensity={0.52} />
          {guidesVisible && (
            <>
              <View pointerEvents="none" style={[styles.safeGuide, { borderColor: theme.stockMark }]} />
              {Array.from({ length: Math.floor(template.widthIn) }).map((_, index) => (
                <View key={`vx-${index}`} pointerEvents="none" style={[styles.gridV, { left: (index + 1) * pxPerIn, backgroundColor: theme.stockGrid }]} />
              ))}
              {Array.from({ length: Math.floor(template.heightIn) }).map((_, index) => (
                <View key={`hy-${index}`} pointerEvents="none" style={[styles.gridH, { top: (index + 1) * pxPerIn, backgroundColor: theme.stockGrid }]} />
              ))}
            </>
          )}
          {items.map((item) => (
            <DraggableItem
              key={`${item.id}:${syncKey}`}
              item={item}
              pxPerIn={pxPerIn}
              selected={item.id === selectedId}
              locked={!!item.locked}
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
              <Icon name="resize" size={TYPE.body.fontSize} color={theme.muted} />
              <Text style={[TYPE.body, { color: theme.foreground, fontFamily: theme.fontBody }]}>
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
              <Text style={[TYPE.caption, { color: theme.muted, fontFamily: theme.fontBody }]}>
                in
              </Text>
              <Stepper icon="add" onPress={() => nudgeWidth(0.25)} />
            </View>
          </View>
          <Text style={[TYPE.caption, { color: theme.muted, fontFamily: theme.fontBody, marginTop: SPACE.xs }]}>
            Prints at exactly this size · {fmtIn(selected.hIn)}in tall {selected.locked ? "· locked" : ""}
          </Text>
          <View style={styles.precisionControls}>
            <View style={styles.controlGroup}>
              <Text style={[styles.miniLabel, { color: theme.muted }]}>NUDGE ⅛ IN</Text>
              <View style={styles.miniActions}>
                <IconAction icon="arrow-back" label="Nudge left" onPress={() => nudgeSelected("x", -0.125)} disabled={!!selected.locked} />
                <IconAction icon="arrow-up" label="Nudge up" onPress={() => nudgeSelected("y", -0.125)} disabled={!!selected.locked} />
                <IconAction icon="arrow-down" label="Nudge down" onPress={() => nudgeSelected("y", 0.125)} disabled={!!selected.locked} />
                <IconAction icon="arrow-forward" label="Nudge right" onPress={() => nudgeSelected("x", 0.125)} disabled={!!selected.locked} />
              </View>
            </View>
            <View style={styles.controlGroup}>
              <Text style={[styles.miniLabel, { color: theme.muted }]}>ALIGN TO PAGE</Text>
              <View style={styles.miniActions}>
                {(["left", "center", "right", "top", "middle", "bottom"] as const).map((edge) => (
                  <IconAction key={edge} icon={({ left: "play-back", center: "contract", right: "play-forward", top: "caret-up", middle: "remove", bottom: "caret-down" } as const)[edge]} label={`Align ${edge}`} onPress={() => alignSelected(edge)} disabled={!!selected.locked} />
                ))}
              </View>
            </View>
          </View>
          <Button
            label="Fill sheet with copies"
            icon="grid-outline"
            onPress={fillSheet}
            style={{ marginTop: SPACE.sm }}
          />
        </Card>
      )}

      {selectedId && (
        <View style={styles.itemActions}>
          <Button
            label="Duplicate"
            icon="copy-outline"
            onPress={duplicateSelected}
            style={styles.actionPill}
          />
          <Button
            label="Mirror"
            icon="swap-horizontal-outline"
            onPress={mirrorSelected}
            style={styles.actionPill}
          />
          <Button
            label={selected?.locked ? "Unlock" : "Lock"}
            icon={selected?.locked ? "lock-open-outline" : "lock-closed-outline"}
            onPress={toggleLockSelected}
            style={styles.actionPill}
          />
          <Button
            label="Remove"
            icon="trash-outline"
            variant="danger"
            onPress={removeSelected}
            style={styles.actionPill}
          />
        </View>
      )}

      <View style={styles.actions}>
        <Button
          label="Printer studio"
          icon="options-outline"
          variant="primary"
          onPress={() => setPrinterOpen(true)}
          style={styles.actionPill}
        />
        <Button
          label="Tiled print"
          icon="albums-outline"
          onPress={chooseTiledPrint}
          style={styles.actionPill}
        />
        <Button
          label="Save sheet"
          icon="download-outline"
          onPress={handleSave}
          style={styles.actionPill}
        />
        <IconAction icon="share-outline" label="Share sheet" onPress={shareSheet} tall />
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
                  <Icon name="save" size={TYPE.body.fontSize} color={open ? theme.accent : theme.muted} />
                  <Text
                    numberOfLines={1}
                    style={{
                      color: theme.foreground,
                      fontFamily: theme.fontBodyMedium,
                      ...TYPE.caption,
                    }}
                  >
                    {s.name}
                  </Text>
                  <Text style={[TYPE.caption, { color: theme.muted, fontFamily: theme.fontBody }]}>
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

      {library.length > 0 && (
        <View style={styles.libraryTools}>
          <TextInput
            value={librarySearch}
            onChangeText={setLibrarySearch}
            placeholder="Search titles and tags"
            placeholderTextColor={theme.muted}
            autoCorrect={false}
            autoCapitalize="none"
            accessibilityLabel="Search designs"
            style={[styles.librarySearch, { color: theme.foreground, borderColor: theme.line, backgroundColor: theme.surfaceAlt }]}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.libraryChips}>
            {(
              [
                { id: "all" as const, label: "All" },
                { id: "generated" as const, label: "Generated" },
                { id: "converted" as const, label: "Converted" },
                { id: "uploaded" as const, label: "Uploaded" },
              ]
            ).map((chip) => {
              const active = sourceFilter === chip.id;
              return (
                <Pressable
                  key={chip.id}
                  onPress={() => { setSourceFilter(chip.id); Haptics.selectionAsync(); }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[styles.libraryChip, { backgroundColor: active ? theme.accent : theme.surfaceAlt, borderColor: active ? theme.accent : theme.line }]}
                >
                  <Text style={{ color: active ? theme.accentText : theme.muted, fontFamily: theme.fontBodyMedium, fontSize: 11 }}>{chip.label}</Text>
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => { setFavoritesOnly((v) => !v); Haptics.selectionAsync(); }}
              accessibilityRole="button"
              accessibilityLabel="Show favorites only"
              accessibilityState={{ selected: favoritesOnly }}
              style={[styles.libraryChip, { backgroundColor: favoritesOnly ? theme.accent : theme.surfaceAlt, borderColor: favoritesOnly ? theme.accent : theme.line }]}
            >
              <Icon name={favoritesOnly ? "favoriteFilled" : "favorite"} size={13} color={favoritesOnly ? theme.accentText : theme.muted} />
            </Pressable>
            {libraryTags.map((tag) => {
              const active = activeTag === tag;
              return (
                <Pressable
                  key={`tag-${tag}`}
                  onPress={() => { setActiveTag(active ? null : tag); Haptics.selectionAsync(); }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[styles.libraryChip, { backgroundColor: active ? `${theme.accent}22` : theme.surfaceAlt, borderColor: active ? theme.accent : theme.line }]}
                >
                  <Text style={{ color: active ? theme.accent : theme.muted, fontFamily: theme.fontBodyMedium, fontSize: 11 }}>#{tag}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      {library.length === 0 ? (
        <EmptyStock
          icon="sheet"
          title="Your sheet starts with a design"
          detail="Designs you generate or trace land here, ready to place."
          action={{ label: "Upload design", onPress: pickUpload }}
        />
      ) : visibleLibrary.length === 0 ? (
        <Text style={{ color: theme.muted, fontFamily: theme.fontBody, fontSize: 12, paddingVertical: SPACE.sm }}>
          Nothing matches these filters.
        </Text>
      ) : (
        <View style={styles.libraryGrid}>
          {visibleLibrary.map((d) => (
            <Pressable
              key={d.id}
              onPress={() => addItem(d)}
              onLongPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setMenu(d);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Add ${d.title} to sheet`}
              accessibilityHint="Long press for more actions"
              style={({ pressed }) => [
                styles.libraryThumb,
                { borderColor: theme.line, backgroundColor: theme.stock, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <PaperSubstrate seed={d.title.length} intensity={0.42} />
              <Image
                source={{ uri: d.uri }}
                style={styles.image}
                contentFit="contain"
                alt={d.title}
              />
              {d.favorite && (
                <View style={[styles.favoriteBadge, { backgroundColor: theme.surface }]}>
                  <Icon name="favoriteFilled" size={10} color={theme.accent} />
                </View>
              )}
            </Pressable>
          ))}
        </View>
      )}

      <ImageViewer
        uri={preview?.uri ?? null}
        title={preview?.title}
        actions={
          preview
            ? [
                {
                  icon: "resize-outline",
                  label: "Size it up",
                  onPress: () => setPlacing(preview),
                },
                { icon: "brush-outline", label: "Edit", onPress: () => setEditing(preview) },
              ]
            : undefined
        }
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
              : prompt?.kind === "tag-design"
                ? "Tags, comma-separated"
                : "Rename design"
        }
        placeholder={
          prompt?.kind === "tag-design"
            ? "jake, sleeve, rose"
            : prompt?.kind === "rename-design"
              ? "Design name"
              : "Sheet name"
        }
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

      {menu && (
        <DesignActions
          title={menu.title}
          uri={menu.uri}
          actions={designActions(menu)}
          onClose={() => setMenu(null)}
        />
      )}

      {editing && (
        <DesignEditor
          design={editing}
          onSave={async (dataUrl, replace) => {
            if (replace) {
              const updated = await replaceInLibrary(brand.id, editing.id, dataUrl);
              if (!updated) throw new Error("That design is no longer in the library.");
              const lib = await getLibrary(brand.id);
              setLibrary(lib);
              setItems((prev) => resolveItems(prev, lib));
              return { id: updated.id, title: updated.title };
            } else {
              const added = await addToLibrary(brand.id, {
                dataUrl,
                title: `${editing.title} (edited)`,
                source: "converted",
              });
              const lib = await getLibrary(brand.id);
              setLibrary(lib);
              setItems((prev) => resolveItems(prev, lib));
              return { id: added.id, title: added.title };
            }
          }}
          onClose={() => setEditing(null)}
        />
      )}

      {placing && (
        <PlacementPreview
          uri={placing.uri}
          title={placing.title}
          onClose={() => setPlacing(null)}
        />
      )}

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

      {printerProfile && (
        <PrinterStudio
          visible={printerOpen}
          profile={printerProfile}
          pageWidthIn={template.widthIn}
          pageHeightIn={template.heightIn}
          onChange={changePrinterProfile}
          onClose={() => setPrinterOpen(false)}
          onAirPrint={handlePrint}
          renderProof={renderSheet}
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
  disabled,
  tall,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Matches the height of the Buttons it sits beside. */
  tall?: boolean;
}) {
  const { theme } = useBrand();
  return (
    <Pressable
      onPress={() => {
        if (disabled) return;
        Haptics.selectionAsync();
        onPress();
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={8}
      style={({ pressed }) => [
        styles.iconAction,
        tall && styles.iconActionTall,
        {
          borderColor: theme.line,
          backgroundColor: theme.surfaceAlt,
          opacity: disabled ? 0.35 : pressed ? 0.6 : 1,
        },
      ]}
    >
      <Icon name={iconNameFor(icon)} size={TYPE.body.fontSize + SPACE.xs / 3} color={theme.foreground} />
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
      <Icon name={iconNameFor(icon)} size={TYPE.body.fontSize} color={theme.foreground} />
    </Pressable>
  );
}

function DraggableItem({
  item,
  pxPerIn,
  selected,
  locked,
  accent,
  onSelect,
  onCommit,
}: {
  item: SheetItem;
  pxPerIn: number;
  selected: boolean;
  locked: boolean;
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
  const pan = Gesture.Pan().enabled(!locked)
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

  const pinch = Gesture.Pinch().enabled(!locked)
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

  const rotate = Gesture.Rotation().enabled(!locked)
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
    opacity: locked && !selected ? 0.82 : 1,
  }));

  return (
    <GestureDetector gesture={composed}>
      <Animated.View
        style={style}
        accessible
        accessibilityRole="button"
        accessibilityLabel={item.title}
        accessibilityHint={
          locked
            ? "Locked. Select it and use Unlock before moving or resizing."
            : selected
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

function iconNameFor(icon: keyof typeof Ionicons.glyphMap): IconName {
  const aliases: Partial<Record<keyof typeof Ionicons.glyphMap, IconName>> = {
    "arrow-undo-outline": "undo",
    "grid-outline": "sheet",
    "add-outline": "add",
    "bookmark-outline": "save",
    magnet: "tool",
    "magnet-outline": "tool",
    grid: "sheet",
    "arrow-back": "back",
    "arrow-up": "up",
    "arrow-down": "down",
    "arrow-forward": "arrowForward",
    "play-back": "back",
    contract: "move",
    "play-forward": "arrowForward",
    "caret-up": "up",
    remove: "mask",
    "caret-down": "down",
    "share-outline": "share",
    "resize-outline": "resize",
  };
  return aliases[icon] ?? "tool";
}

const styles = StyleSheet.create({
  scroll: { padding: SPACE.md, paddingTop: SPACE.lg, paddingBottom: SPACE.xxl },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.xs + SPACE.xs / 3, marginBottom: SPACE.md },
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
  sheetBarText: { flex: 1, gap: SPACE.xs / 3 },
  precisionBar: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, borderWidth: 1, borderRadius: RADIUS.md, padding: SPACE.sm, marginBottom: SPACE.md },
  iconAction: {
    width: 38,
    height: 38,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  iconActionTall: { width: 52, height: 52, borderRadius: RADIUS.pill },
  sheetRow: { gap: SPACE.sm, paddingRight: SPACE.md },
  sheetCard: {
    width: 132,
    gap: 4,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACE.sm,
  },
  sheet: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#00000018",
    borderRadius: 2,
    overflow: "hidden",
    ...lift("md"),
  },
  safeGuide: { position: "absolute", left: 10, right: 10, top: 10, bottom: 10, borderWidth: 1, borderStyle: "dashed" },
  gridV: { position: "absolute", top: 0, bottom: 0, width: StyleSheet.hairlineWidth },
  gridH: { position: "absolute", left: 0, right: 0, height: StyleSheet.hairlineWidth },
  actionPill: { flexGrow: 1, flexBasis: "46%" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm, marginBottom: SPACE.lg },
  itemActions: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm, marginBottom: SPACE.md },
  sizeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sizeLabel: { flexDirection: "row", alignItems: "center", gap: SPACE.xs },
  precisionControls: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm, marginTop: SPACE.md },
  controlGroup: { flex: 1, minWidth: 140, gap: 6 },
  miniLabel: { ...TYPE.micro },
  miniActions: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.xs },
  stepper: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  sizeInput: {
    borderWidth: 1,
    borderRadius: RADIUS.sm,
    paddingHorizontal: 10,
    paddingVertical: 7,
    minWidth: 66,
    textAlign: "center",
    ...TYPE.body,
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
  libraryGrid: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.xs + SPACE.xs / 3 },
  libraryTools: { gap: SPACE.xs, marginBottom: SPACE.sm },
  librarySearch: { minHeight: 44, borderWidth: 1, borderRadius: RADIUS.sm, paddingHorizontal: 12, fontSize: 14 },
  libraryChips: { flexDirection: "row", gap: SPACE.xs, alignItems: "center" },
  libraryChip: { minHeight: 32, paddingHorizontal: 12, borderRadius: RADIUS.pill, borderWidth: 1, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 4 },
  favoriteBadge: { position: "absolute", top: 4, right: 4, width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  libraryThumb: {
    width: 76,
    height: 76,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    overflow: "hidden",
  },
  image: { width: "100%", height: "100%" },
});
