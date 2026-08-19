import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import type { Ionicons } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { File, Paths } from "expo-file-system";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import Svg, { Line as SvgLine, Path as SvgPath } from "react-native-svg";
import { SafeAreaView } from "react-native-safe-area-context";
import { useBrand } from "@/context/BrandContext";
import { Button } from "@/components/Button";
import { CropTool } from "@/components/CropTool";
import { GlassSurface } from "@/components/GlassSurface";
import { Icon } from "@/components/Icon";
import { PaperSubstrate } from "@/components/PaperSubstrate";
import { Notice } from "@/components/ui";
import {
  addRasterAsset,
  cloneProject,
  loadOrCreateProject,
  projectAssetFile,
  saveProject,
  type DesignLayer,
  type EditableDesignProject,
  type Point,
  type StrokeLayer,
} from "@/lib/designProject";
import {
  addLayer,
  duplicateLayer,
  makeShapeLayer,
  makeStrokeLayer,
  makeTextLayer,
  moveLayer,
  projectToSvg,
  rasterLayerAssets,
  removeLayer,
  strokePathsInCanvasSpace,
  restoreSnapshot,
  snapshotProject,
  updateLayer,
} from "@/lib/projectMutations";
import type { LibraryDesign } from "@/lib/designLibrary";
import { renderProject } from "@/lib/projectRenderer";
import type { CropRect } from "@/lib/crop";
import { DEFAULT_STENCIL_OPTIONS, stencilMask, stencilize } from "@/lib/stencil";
import { DEFAULT_TRACE, polylinesToStrokeLayer, skeletonize, tracePolylines } from "@/lib/vectorize";
import { addCutLine, DEFAULT_CUT_LINE } from "@/lib/cutline";
import { shareUri } from "@/lib/files";
import { compareCapture, inspectProduction, simulateHealing, wrapForSurface, type ProductionFinding } from "@/lib/productionTools";
import { HEAL_AGES, type HealAge } from "@/lib/healing";
import { MIN_LINE_GAP_MM, checkLineSpacing, pxPerMmFromDpi, spacingFinding } from "@/lib/spacing";
import {
  DEFAULT_SYMMETRY,
  MAX_SEGMENTS,
  MIN_SEGMENTS,
  clampSegments,
  replicateStroke,
  symmetryGuides,
  type SymmetryAxis,
  type SymmetryMode,
  type SymmetrySettings,
} from "@/lib/symmetry";
import { ICONS, type IconName } from "@/lib/icons";
import { RADIUS, SPACE, TYPE, glow, lift } from "@/lib/theme";

type EditorTool = "select" | "draw" | "erase" | "insert" | "refine" | "crop" | "layers" | "production" | "history";

type SaveResult = { id: string; title: string };

const TOOLS: { id: EditorTool; label: string; icon: IconName }[] = [
  { id: "select", label: "Arrange", icon: "move" },
  { id: "draw", label: "Draw", icon: "brush" },
  { id: "erase", label: "Mask", icon: "mask" },
  { id: "insert", label: "Add", icon: "add" },
  { id: "refine", label: "Lines", icon: "branch" },
  { id: "crop", label: "Crop", icon: "crop" },
  { id: "layers", label: "Layers", icon: "layers" },
  { id: "production", label: "Pro", icon: "production" },
  { id: "history", label: "History", icon: "history" },
];

// Tracing allocates per thinning pass, so the mask is capped well below the
// canvas size. The resulting geometry scales back up losslessly.
const TRACE_MAX_DIMENSION = 1400;

// Thermal stencil printers in printerProfiles.ts run at 203 DPI; preflight
// measures the artwork as it will actually come off one.
const PRINT_DPI = 203;

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function DesignEditor({
  design,
  onSave,
  onClose,
}: {
  design: LibraryDesign;
  onSave: (dataUrl: string, replace: boolean) => Promise<SaveResult>;
  onClose: () => void;
}) {
  const { brand, theme } = useBrand();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const [project, setProject] = useState<EditableDesignProject | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [originalPreview, setOriginalPreview] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [tool, setTool] = useState<EditorTool>("select");
  const [past, setPast] = useState<EditableDesignProject[]>([]);
  const [future, setFuture] = useState<EditableDesignProject[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [brush, setBrush] = useState(16);
  const [brushColor, setBrushColor] = useState("#111111");
  const [currentStroke, setCurrentStroke] = useState<Point[]>([]);
  const [symmetry, setSymmetry] = useState<SymmetrySettings>(DEFAULT_SYMMETRY);
  const [cropping, setCropping] = useState(false);
  const [lineWeight, setLineWeight] = useState(1);
  const [threshold, setThreshold] = useState(60);
  const [wrapAmount, setWrapAmount] = useState(0.35);
  const [wrapTaper, setWrapTaper] = useState(0.2);
  const [findings, setFindings] = useState<ProductionFinding[]>([]);
  const [healAge, setHealAge] = useState<HealAge>("fresh");
  const [healed, setHealed] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const next = await loadOrCreateProject(brand.id, design);
        const flattened = await renderProject(next);
        if (!active) return;
        setProject(next);
        setPreview(flattened);
        setOriginalPreview(flattened);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Couldn't open this project.");
      } finally {
        if (active) setBusy(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [brand.id, design]);

  const selected = useMemo(
    () => project?.layers.find((layer) => layer.id === project.selectedLayerId) ?? null,
    [project]
  );

  const stageW = screenW - SPACE.md * 2;
  const aspect = project ? project.canvas.height / project.canvas.width : 1;
  const stageH = Math.min(stageW * aspect, screenH * 0.48);
  const scale = project ? stageW / project.canvas.width : 1;

  async function persist(next: EditableDesignProject) {
    setBusy(true);
    try {
      const bumped = { ...next, revision: next.revision + 1 };
      await saveProject(bumped);
      const flattened = await renderProject(bumped);
      setProject(bumped);
      setPreview(flattened);
      setHealed(null);
      setHealAge("fresh");
      setDirty(true);
      return bumped;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That edit couldn't be applied.");
      return next;
    } finally {
      setBusy(false);
    }
  }

  async function commit(label: string, next: EditableDesignProject) {
    if (!project) return;
    setPast((items) => [...items.slice(-39), clone(project)]);
    setFuture([]);
    await persist(snapshotProject(next, label));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  async function undo() {
    if (!project || !past.length) return;
    const previous = past.at(-1)!;
    setPast((items) => items.slice(0, -1));
    setFuture((items) => [clone(project), ...items].slice(0, 40));
    await persist(previous);
  }

  async function redo() {
    if (!project || !future.length) return;
    const next = future[0];
    setFuture((items) => items.slice(1));
    setPast((items) => [...items.slice(-39), clone(project)]);
    await persist(next);
  }

  function addStrokePoint(x: number, y: number) {
    if (!project) return;
    setCurrentStroke((points) => [
      ...points,
      {
        x: Math.max(0, Math.min(project.canvas.width, x / scale)),
        y: Math.max(0, Math.min(project.canvas.height, y / scale)),
      },
    ]);
  }

  async function finishStroke() {
    if (!project || !currentStroke.length) return;
    let next = project;
    let strokeLayer = selected?.kind === "stroke" && !selected.locked ? selected : null;
    if (!strokeLayer) {
      strokeLayer = makeStrokeLayer(project.canvas.width, project.canvas.height, tool === "erase" ? "Mask" : "Linework");
      next = addLayer(next, strokeLayer);
    }
    const id = strokeLayer.id;
    // Symmetry commits the whole set as one undo step — one gesture, one entry.
    const paths = replicateStroke(currentStroke, symmetry, project.canvas);
    next = updateLayer(next, id, (layer) => ({
      ...(layer as StrokeLayer),
      strokes: [
        ...(layer as StrokeLayer).strokes,
        ...paths.map((points) => ({
          points,
          width: brush / scale,
          color: brushColor,
          mode: tool === "erase" ? ("erase" as const) : ("draw" as const),
          opacity: 1,
        })),
      ],
    }));
    setCurrentStroke([]);
    const base = tool === "erase" ? "Mask stroke" : "Brush stroke";
    await commit(paths.length > 1 ? `${base} ×${paths.length}` : base, next);
  }

  async function transformSelected(patch: Partial<DesignLayer["transform"]>, label: string) {
    if (!project || !selected || selected.locked) return;
    await commit(
      label,
      updateLayer(project, selected.id, (layer) => ({
        ...layer,
        transform: { ...layer.transform, ...patch },
      }))
    );
  }

  function finishPan(dx: number, dy: number) {
    if (!selected) return;
    void transformSelected(
      { x: selected.transform.x + dx / scale, y: selected.transform.y + dy / scale },
      "Move layer"
    );
  }

  function finishPinch(multiplier: number) {
    if (!selected) return;
    void transformSelected(
      {
        scaleX: Math.max(0.05, Math.min(8, selected.transform.scaleX * multiplier)),
        scaleY: Math.max(0.05, Math.min(8, selected.transform.scaleY * multiplier)),
      },
      "Scale layer"
    );
  }

  function finishRotate(radians: number) {
    if (!selected) return;
    void transformSelected(
      { rotation: selected.transform.rotation + (radians * 180) / Math.PI },
      "Rotate layer"
    );
  }

  const drawGesture = Gesture.Pan()
    .minDistance(0)
    .onStart((event) => runOnJS(addStrokePoint)(event.x, event.y))
    .onUpdate((event) => runOnJS(addStrokePoint)(event.x, event.y))
    .onEnd(() => runOnJS(finishStroke)());

  const arrangeGesture = Gesture.Simultaneous(
    Gesture.Pan().onEnd((event) => runOnJS(finishPan)(event.translationX, event.translationY)),
    Gesture.Pinch().onEnd((event) => runOnJS(finishPinch)(event.scale)),
    Gesture.Rotation().onEnd((event) => runOnJS(finishRotate)(event.rotation))
  );

  const stageGesture = tool === "draw" || tool === "erase" ? drawGesture : arrangeGesture;

  async function applyCrop(rect: CropRect) {
    setCropping(false);
    if (!project || (rect.width > 0.999 && rect.height > 0.999)) return;
    const oldW = project.canvas.width;
    const oldH = project.canvas.height;
    const nextW = Math.max(1, Math.round(oldW * rect.width));
    const nextH = Math.max(1, Math.round(oldH * rect.height));
    const offsetX = rect.x * oldW;
    const offsetY = rect.y * oldH;
    const next: EditableDesignProject = {
      ...project,
      canvas: { ...project.canvas, width: nextW, height: nextH },
      layers: project.layers.map((layer) => ({
        ...layer,
        transform: {
          ...layer.transform,
          x: layer.transform.x - offsetX,
          y: layer.transform.y - offsetY,
        },
      })),
    };
    await commit("Crop canvas", next);
  }

  async function addProcessedLayer(kind: "stencil" | "cutline") {
    if (!project || !preview) return;
    setBusy(true);
    try {
      const dataUrl =
        kind === "stencil"
          ? await stencilize(preview, { ...DEFAULT_STENCIL_OPTIONS, threshold, lineWeight, maxDimension: Math.max(project.canvas.width, project.canvas.height) })
          : await addCutLine(preview, DEFAULT_CUT_LINE);
      const hidden = { ...project, layers: project.layers.map((layer) => ({ ...layer, visible: false })) };
      const result = await addRasterAsset(hidden, dataUrl, kind === "stencil" ? "Refined linework" : "Cut line");
      await commit(kind === "stencil" ? "Refine linework" : "Add cut line", result.project);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't process the linework.");
    } finally {
      setBusy(false);
    }
  }

  async function traceToVector() {
    if (!project || !preview) return;
    setBusy(true);
    try {
      const longest = Math.max(project.canvas.width, project.canvas.height);
      const { mask, width, height } = await stencilMask(preview, {
        ...DEFAULT_STENCIL_OPTIONS,
        threshold,
        lineWeight,
        maxDimension: Math.min(longest, TRACE_MAX_DIMENSION),
      });
      const paths = tracePolylines(skeletonize(mask, width, height), width, height, DEFAULT_TRACE);
      if (!paths.length) {
        setError("No linework found to trace. Lower the detail threshold and try again.");
        return;
      }
      // The mask is traced at a working resolution, so scale the geometry back
      // onto the canvas before it becomes a layer.
      const toCanvas = project.canvas.width / width;
      const scaled = paths.map((points) => points.map((point) => ({ x: point.x * toCanvas, y: point.y * toCanvas })));
      const layer = polylinesToStrokeLayer(
        scaled,
        project.canvas.width,
        project.canvas.height,
        Math.max(1, (lineWeight + 1) * toCanvas),
        brushColor
      );
      const hidden = { ...project, layers: project.layers.map((item) => ({ ...item, visible: false })) };
      await commit(`Trace to vector · ${paths.length} paths`, addLayer(hidden, layer));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't trace the linework.");
    } finally {
      setBusy(false);
    }
  }

  async function save(replace: boolean) {
    if (!project || !preview) return;
    setBusy(true);
    try {
      const result = await onSave(preview, replace);
      if (replace) {
        await saveProject({ ...project, id: result.id, title: result.title });
      } else {
        await cloneProject(project, result.id, result.title);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the project.");
      setBusy(false);
    }
  }

  async function exportSvg() {
    if (!project) return;
    try {
      const file = new File(Paths.cache, `${project.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "inkline"}.svg`);
      if (file.exists) file.delete();
      // Raster layers carry their pixels on disk; read them so the export is a
      // complete picture of the project rather than only its vector layers.
      const assets: Record<string, string> = {};
      for (const asset of rasterLayerAssets(project)) {
        const source = projectAssetFile(project.brand, project.id, asset);
        if (source.exists) assets[asset] = `data:image/png;base64,${await source.base64()}`;
      }
      file.write(projectToSvg(project, assets));
      await shareUri(file.uri);
    } catch (e) {
      Alert.alert("Couldn't export SVG", e instanceof Error ? e.message : "Try again.");
    }
  }

  async function applyWrap() {
    if (!project || !preview) return;
    try {
      const warped = wrapForSurface(preview, wrapAmount, wrapTaper);
      const hidden = { ...project, layers: project.layers.map((layer) => ({ ...layer, visible: false })) };
      const result = await addRasterAsset(hidden, warped, "Surface wrap proof");
      await commit("Surface wrap", result.project);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't build the surface wrap.");
    }
  }

  async function flattenVisibleCopy() {
    if (!project || !preview) return;
    const hidden = { ...project, layers: project.layers.map((layer) => ({ ...layer, visible: false })) };
    const result = await addRasterAsset(hidden, preview, "Flattened composite");
    await commit("Flatten visible copy", result.project);
  }

  function runHealing(age: HealAge) {
    setHealAge(age);
    if (!preview || age === "fresh") {
      setHealed(null);
      return;
    }
    try {
      setHealed(simulateHealing(preview, age, pxPerMmFromDpi(PRINT_DPI)));
      Haptics.selectionAsync();
    } catch (e) {
      setHealed(null);
      setError(e instanceof Error ? e.message : "Couldn't simulate healing.");
    }
  }

  function runProductionCheck() {
    if (!preview || !project) return;
    try {
      // Spacing is judged at the same print density the resolution finding
      // assumes, so both readings describe one physical piece.
      const minGapMm = MIN_LINE_GAP_MM[brand.id];
      const spacing = checkLineSpacing(
        strokePathsInCanvasSpace(project),
        pxPerMmFromDpi(PRINT_DPI),
        minGapMm
      );
      setFindings([
        ...inspectProduction(preview, PRINT_DPI, brand.id),
        spacingFinding(spacing, brand.id, minGapMm),
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't inspect the artwork.");
    }
  }

  async function checkCapture() {
    if (!preview) return;
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1, base64: true });
    if (picked.canceled) return;
    const asset = picked.assets[0];
    if (!asset.base64) return setError("That capture couldn't be read locally.");
    setFindings(compareCapture(preview, `data:${asset.mimeType ?? "image/jpeg"};base64,${asset.base64}`));
  }

  async function shareReviewPacket() {
    if (!project || !preview) return;
    const safeTitle = project.title.replace(/[<>]/g, "");
    const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${safeTitle} review</title><style>body{margin:0;background:#111;color:#f7f2ed;font:16px system-ui}.wrap{max-width:760px;margin:auto;padding:40px 22px}.tag{color:#ff3658;font-weight:800;letter-spacing:.16em;font-size:12px}h1{font-size:36px;margin:10px 0}.art{background:#fff;border-radius:22px;padding:24px;margin:28px 0}.art img{display:block;width:100%;height:auto}.box{border:1px solid #403633;border-radius:16px;padding:18px;color:#c9c0ba}small{color:#988e88}</style><div class="wrap"><div class="tag">CLIENT REVIEW PROOF</div><h1>${safeTitle}</h1><small>Revision ${project.revision} · ${new Date().toLocaleString()}</small><div class="art"><img src="${preview}" alt="${safeTitle}"></div><div class="box"><b>Review checklist</b><p>Confirm composition, placement direction, line weight, spelling, and size. Reply with APPROVED or a numbered list of changes.</p><small>This proof is for review—not a final print master.</small></div></div>`;
    const file = new File(Paths.cache, `${safeTitle.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "design"}-review.html`);
    if (file.exists) file.delete();
    file.write(html);
    await shareUri(file.uri);
  }

  function confirmClose() {
    if (!dirty) return onClose();
    Alert.alert("Leave the editor?", "Your project is autosaved. The library preview changes only when you tap Replace.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Leave", onPress: onClose },
    ]);
  }

  // Preview every path the commit will produce, so the fold is visible while
  // the finger is still down rather than only after lifting.
  const overlayPaths = useMemo(() => {
    if (!project || !currentStroke.length) return [];
    return replicateStroke(currentStroke, symmetry, project.canvas).map((points) =>
      points.map((point, index) => `${index ? "L" : "M"}${point.x * scale} ${point.y * scale}`).join(" ")
    );
  }, [project, currentStroke, symmetry, scale]);

  const guides = useMemo(() => {
    if (!project || (tool !== "draw" && tool !== "erase")) return [];
    return symmetryGuides(symmetry, project.canvas);
  }, [project, symmetry, tool]);

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={confirmClose}>
      <GestureHandlerRootView style={styles.root}>
        <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
          <View style={styles.topbar}>
            <Pressable onPress={confirmClose} accessibilityRole="button" accessibilityLabel="Close editor" style={[styles.iconButton, { backgroundColor: theme.surfaceAlt }]}>
              <Icon name="chevronDown" size={TYPE.heading.fontSize} color={theme.foreground} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={[styles.eyebrow, { color: theme.accent, fontFamily: theme.fontBodyMedium }]}>PRO EDITOR · AUTOSAVED</Text>
              <Text numberOfLines={1} style={[styles.title, { color: theme.foreground, fontFamily: theme.fontDisplay }]}>{project?.title ?? design.title}</Text>
            </View>
            <Pressable onPress={undo} disabled={!past.length || busy} accessibilityRole="button" accessibilityLabel="Undo" style={[styles.iconButton, { backgroundColor: theme.surfaceAlt, opacity: past.length ? 1 : 0.35 }]}>
              <Icon name="undo" size={TYPE.body.fontSize + SPACE.xs / 2} color={theme.foreground} />
            </Pressable>
            <Pressable onPress={redo} disabled={!future.length || busy} accessibilityRole="button" accessibilityLabel="Redo" style={[styles.iconButton, { backgroundColor: theme.surfaceAlt, opacity: future.length ? 1 : 0.35 }]}>
              <Icon name="redo" size={TYPE.body.fontSize + SPACE.xs / 2} color={theme.foreground} />
            </Pressable>
          </View>

          <View style={[styles.workspace, brand.id === "ink" ? glow(theme, "sm") : lift("sm"), { backgroundColor: theme.surface, borderColor: theme.line }]}>
            <View style={styles.workspaceMeta}>
              <View style={[styles.livePill, { backgroundColor: `${theme.accent}18` }]}>
                <View style={[styles.liveDot, { backgroundColor: theme.accent }]} />
                <Text style={[styles.liveText, { color: theme.accent, fontFamily: theme.fontBodyMedium }]}>{project?.canvas.width ?? "—"} × {project?.canvas.height ?? "—"} PX</Text>
              </View>
              <Pressable onPress={() => setShowOriginal((value) => !value)} disabled={!originalPreview} style={[styles.compare, { borderColor: theme.line }]}>
                <Icon name="layers" size={TYPE.caption.fontSize} color={theme.muted} />
                <Text style={[TYPE.micro, { color: theme.muted, fontFamily: theme.fontBodyMedium }]}>{showOriginal ? "EDITED" : "ORIGINAL"}</Text>
              </Pressable>
              {!!healed && !showOriginal && (
                <View style={[styles.livePill, { backgroundColor: `${theme.accent}18` }]}>
                  <Icon name="history" size={TYPE.caption.fontSize} color={theme.accent} />
                  <Text style={[styles.liveText, { color: theme.accent, fontFamily: theme.fontBodyMedium }]}>SIMULATED</Text>
                </View>
              )}
              <Pressable onPress={() => setShowGrid((value) => !value)} accessibilityRole="button" accessibilityLabel="Toggle layout grid" style={[styles.compare, { borderColor: showGrid ? theme.accent : theme.line }]}>
                <Icon name="sheet" size={TYPE.caption.fontSize} color={showGrid ? theme.accent : theme.muted} />
                <Text style={[TYPE.micro, { color: showGrid ? theme.accent : theme.muted, fontFamily: theme.fontBodyMedium }]}>GRID</Text>
              </Pressable>
            </View>

            <GestureDetector gesture={stageGesture}>
              <View style={[styles.stage, { width: stageW, height: stageH }]}>
                <PaperSubstrate
                  seed={project?.title.length ?? design.title.length}
                  intensity={0.5}
                  style={{ backgroundColor: project?.canvas.background ?? theme.stock }}
                />
                {(showOriginal ? originalPreview : healed ?? preview) && (
                  <Image source={{ uri: (showOriginal ? originalPreview : healed ?? preview)! }} style={StyleSheet.absoluteFill} contentFit="fill" alt={project?.title ?? design.title} />
                )}
                {showGrid && <View pointerEvents="none" style={StyleSheet.absoluteFill}>{[1, 2, 3].map(index => <View key={`v${index}`} style={[styles.gridLine, { left: `${index * 25}%`, top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: theme.accent }]} />)}{[1, 2, 3].map(index => <View key={`h${index}`} style={[styles.gridLine, { top: `${index * 25}%`, left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: theme.accent }]} />)}</View>}
                {!!selected && tool === "select" && !showOriginal && (
                  <View
                    pointerEvents="none"
                    style={[
                      styles.selection,
                      {
                        left: selected.transform.x * scale,
                        top: selected.transform.y * scale,
                        width: selected.transform.width * Math.abs(selected.transform.scaleX) * scale,
                        height: selected.transform.height * Math.abs(selected.transform.scaleY) * scale,
                        borderColor: theme.accent,
                        transform: [{ rotate: `${selected.transform.rotation}deg` }],
                      },
                    ]}
                  >
                    <View style={[styles.handle, styles.handleTL, { backgroundColor: theme.accent }]} />
                    <View style={[styles.handle, styles.handleBR, { backgroundColor: theme.accent }]} />
                  </View>
                )}
                {(!!guides.length || !!overlayPaths.length) && (
                  <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width={stageW} height={stageH}>
                    {guides.map((guide, index) => (
                      <SvgLine key={`guide-${index}`} x1={guide.x1 * scale} y1={guide.y1 * scale} x2={guide.x2 * scale} y2={guide.y2 * scale} stroke={theme.accent} strokeWidth={StyleSheet.hairlineWidth * 2} strokeDasharray="6 6" opacity={0.5} />
                    ))}
                    {overlayPaths.map((path, index) => (
                      <SvgPath key={`stroke-${index}`} d={path} fill="none" stroke={tool === "erase" ? project?.canvas.background ?? "white" : brushColor} strokeWidth={brush} strokeLinecap="round" strokeLinejoin="round" opacity={index ? 0.75 : 1} />
                    ))}
                  </Svg>
                )}
                {busy && <View style={[styles.loading, { backgroundColor: `${theme.background}aa` }]}><ActivityIndicator color={theme.accent} /><Text style={[TYPE.caption, { color: theme.foreground, fontFamily: theme.fontBodyMedium }]}>RENDERING FULL RESOLUTION</Text></View>}
              </View>
            </GestureDetector>
          </View>

          {error && <Notice>{error}</Notice>}

          <GlassSurface style={styles.toolSurface}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toolDock} style={styles.toolScroll}>
              {TOOLS.map((item) => {
              const active = item.id === tool;
              return (
                <Pressable key={item.id} onPress={() => { setTool(item.id); Haptics.selectionAsync(); }} accessibilityRole="button" accessibilityState={{ selected: active }} style={[styles.tool, { backgroundColor: active ? theme.accent : theme.surfaceAlt, borderColor: active ? theme.accent : theme.line }]}>
                  <Icon name={item.icon} size={SPACE.md + SPACE.xs / 2} color={active ? theme.accentText : theme.foreground} />
                  <Text style={[TYPE.micro, { color: active ? theme.accentText : theme.muted, fontFamily: theme.fontBodyMedium }]}>{item.label.toUpperCase()}</Text>
                </Pressable>
              );
              })}
            </ScrollView>
          </GlassSurface>

          <GlassSurface style={styles.inspectorSurface}>
            <ScrollView style={styles.inspector} contentContainerStyle={{ padding: SPACE.sm, paddingBottom: SPACE.sm }} keyboardShouldPersistTaps="handled">
              <Inspector
              tool={tool}
              project={project}
              selected={selected}
              brush={brush}
              brushColor={brushColor}
              threshold={threshold}
              lineWeight={lineWeight}
              symmetry={symmetry}
              onSymmetry={setSymmetry}
              onBrush={setBrush}
              onBrushColor={setBrushColor}
              onThreshold={setThreshold}
              onLineWeight={setLineWeight}
              onProject={(label, next) => commit(label, next)}
              onTransform={transformSelected}
              onCrop={() => setCropping(true)}
              onProcess={addProcessedLayer}
              onRestore={(index) => project && commit("Restore snapshot", restoreSnapshot(project, index))}
              onExportSvg={exportSvg}
              onTrace={traceToVector}
              wrapAmount={wrapAmount}
              wrapTaper={wrapTaper}
              findings={findings}
              onWrapAmount={setWrapAmount}
              onWrapTaper={setWrapTaper}
              onApplyWrap={applyWrap}
              onInspect={runProductionCheck}
              healAge={healAge}
              onHealAge={runHealing}
              onCheckCapture={checkCapture}
              onShareReview={shareReviewPacket}
              onFlatten={flattenVisibleCopy}
              />
            </ScrollView>
          </GlassSurface>

          <View style={styles.savebar}>
            <Button label="Save copy" icon="duplicate-outline" disabled={!project || !preview || busy} onPress={() => save(false)} style={{ flex: 1 }} />
            <Button label="Replace design" icon="checkmark" variant="primary" disabled={!project || !preview || busy} onPress={() => save(true)} style={{ flex: 1.25 }} />
          </View>
        </SafeAreaView>

        {cropping && project && preview && (
          <CropTool uri={preview} imageWidth={project.canvas.width} imageHeight={project.canvas.height} onApply={applyCrop} onClose={() => setCropping(false)} />
        )}
      </GestureHandlerRootView>
    </Modal>
  );
}

function Inspector({
  tool,
  project,
  selected,
  brush,
  brushColor,
  threshold,
  lineWeight,
  symmetry,
  onSymmetry,
  onBrush,
  onBrushColor,
  onThreshold,
  onLineWeight,
  onProject,
  onTransform,
  onCrop,
  onProcess,
  onRestore,
  onExportSvg,
  onTrace,
  wrapAmount,
  wrapTaper,
  findings,
  onWrapAmount,
  onWrapTaper,
  onApplyWrap,
  onInspect,
  healAge,
  onHealAge,
  onCheckCapture,
  onShareReview,
  onFlatten,
}: {
  tool: EditorTool;
  project: EditableDesignProject | null;
  selected: DesignLayer | null;
  brush: number;
  brushColor: string;
  threshold: number;
  lineWeight: number;
  symmetry: SymmetrySettings;
  onSymmetry: (value: SymmetrySettings) => void;
  onBrush: (value: number) => void;
  onBrushColor: (value: string) => void;
  onThreshold: (value: number) => void;
  onLineWeight: (value: number) => void;
  onProject: (label: string, project: EditableDesignProject) => void;
  onTransform: (patch: Partial<DesignLayer["transform"]>, label: string) => void;
  onCrop: () => void;
  onProcess: (kind: "stencil" | "cutline") => void;
  onRestore: (index: number) => void;
  onExportSvg: () => void;
  onTrace: () => void;
  wrapAmount: number;
  wrapTaper: number;
  findings: ProductionFinding[];
  onWrapAmount: (value: number) => void;
  onWrapTaper: (value: number) => void;
  onApplyWrap: () => void;
  onInspect: () => void;
  healAge: HealAge;
  onHealAge: (age: HealAge) => void;
  onCheckCapture: () => void;
  onShareReview: () => void;
  onFlatten: () => void;
}) {
  const { theme } = useBrand();
  if (!project) return null;

  if (tool === "draw" || tool === "erase") {
    return (
      <PanelTitle icon={tool === "draw" ? "brush-outline" : "remove-circle-outline"} title={tool === "draw" ? "Precision brush" : "Nondestructive mask"} subtitle={tool === "draw" ? "Draw clean linework on its own editable layer." : "Paint the paper color while preserving the original underneath."}>
        <SliderRow label="Brush size" value={brush} min={2} max={72} display={`${Math.round(brush)} pt`} onChange={onBrush} />
        <View style={styles.segmentRow}>
          {["#111111", "#ffffff", "#d7263d", "#5b3a8f"].map((color) => (
            <Pressable key={color} onPress={() => onBrushColor(color)} accessibilityLabel={`Brush color ${color}`} style={[styles.swatch, { backgroundColor: color, borderColor: color === brushColor ? theme.accent : theme.line }]} />
          ))}
        </View>
        <SymmetryControls symmetry={symmetry} onSymmetry={onSymmetry} />
      </PanelTitle>
    );
  }

  if (tool === "select") {
    return (
      <PanelTitle icon="move-outline" title={selected?.name ?? "Select a layer"} subtitle="Drag, pinch, and twist on the canvas—or dial in exact values below.">
        {selected ? (
          <>
            <SliderRow label="Scale" value={Math.abs(selected.transform.scaleX)} min={0.05} max={4} step={0.01} display={`${Math.round(Math.abs(selected.transform.scaleX) * 100)}%`} onChange={(value) => onTransform({ scaleX: Math.sign(selected.transform.scaleX || 1) * value, scaleY: Math.sign(selected.transform.scaleY || 1) * value }, "Scale layer")} />
            <SliderRow label="Rotation" value={selected.transform.rotation} min={-180} max={180} step={1} display={`${Math.round(selected.transform.rotation)}°`} onChange={(value) => onTransform({ rotation: value }, "Rotate layer")} />
            <SliderRow label="Opacity" value={selected.opacity} min={0} max={1} step={0.01} display={`${Math.round(selected.opacity * 100)}%`} onChange={(value) => onProject("Layer opacity", updateLayer(project, selected.id, (layer) => ({ ...layer, opacity: value })))} />
            <View style={styles.actionRow}>
              <MiniAction icon="swap-horizontal-outline" label="Mirror" onPress={() => onTransform({ scaleX: selected.transform.scaleX * -1 }, "Mirror layer")} />
              <MiniAction icon="duplicate-outline" label="Duplicate" onPress={() => onProject("Duplicate layer", duplicateLayer(project, selected.id))} />
              <MiniAction icon={selected.locked ? "lock-open-outline" : "lock-closed-outline"} label={selected.locked ? "Unlock" : "Lock"} onPress={() => onProject(selected.locked ? "Unlock layer" : "Lock layer", updateLayer(project, selected.id, (layer) => ({ ...layer, locked: !layer.locked })))} />
              <MiniAction icon="trash-outline" label="Delete" danger onPress={() => onProject("Delete layer", removeLayer(project, selected.id))} />
            </View>
          </>
        ) : null}
      </PanelTitle>
    );
  }

  if (tool === "insert") {
    return (
      <PanelTitle icon="add-circle-outline" title="Add editable content" subtitle="New objects stay independent, selectable, and reversible.">
        <View style={styles.actionRow}>
          <MiniAction icon="ellipse-outline" label="Ellipse" onPress={() => onProject("Add ellipse", addLayer(project, makeShapeLayer(project.canvas.width, project.canvas.height, "ellipse")))} />
          <MiniAction icon="square-outline" label="Rectangle" onPress={() => onProject("Add rectangle", addLayer(project, makeShapeLayer(project.canvas.width, project.canvas.height, "rectangle")))} />
          <MiniAction icon="remove-outline" label="Rule" onPress={() => onProject("Add rule", addLayer(project, makeShapeLayer(project.canvas.width, project.canvas.height, "line")))} />
          <MiniAction icon="text-outline" label="Text" onPress={() => onProject("Add text", addLayer(project, makeTextLayer(project.canvas.width, project.canvas.height)))} />
        </View>
        {selected?.kind === "text" && (
          <TextInput value={selected.text} onChangeText={(text) => onProject("Edit text", updateLayer(project, selected.id, (layer) => ({ ...(layer as Extract<DesignLayer, { kind: "text" }>), text })))} placeholder="Text" placeholderTextColor={theme.muted} style={[styles.textInput, { color: theme.foreground, backgroundColor: theme.surfaceAlt, borderColor: theme.line }]} />
        )}
      </PanelTitle>
    );
  }

  if (tool === "refine") {
    return (
      <PanelTitle icon="git-branch-outline" title="Line laboratory" subtitle="Create an editable processed pass while keeping every earlier layer intact.">
        <SliderRow label="Detail threshold" value={threshold} min={10} max={180} display={`${Math.round(threshold)}`} onChange={onThreshold} />
        <SliderRow label="Line weight" value={lineWeight} min={0} max={4} step={1} display={`${Math.round(lineWeight) + 1}px`} onChange={onLineWeight} />
        <Text style={[TYPE.caption, { color: theme.muted, fontFamily: theme.fontBody, marginTop: SPACE.xs }]}>
          Vector traces the linework into editable paths — scalable, node-editable, and ready for a cutter or plotter. Refine keeps it as pixels.
        </Text>
        <View style={styles.actionRow}>
          <MiniAction icon="color-filter-outline" label="Refine" onPress={() => onProcess("stencil")} />
          <MiniAction icon="git-network-outline" label="Vector" onPress={onTrace} />
          <MiniAction icon="ellipse-outline" label="Cut line" onPress={() => onProcess("cutline")} />
          <MiniAction icon="code-slash-outline" label="SVG" onPress={onExportSvg} />
        </View>
      </PanelTitle>
    );
  }

  if (tool === "crop") {
    return <PanelTitle icon="crop-outline" title="Crop the project" subtitle="The canvas changes, but source layers remain intact and movable."><Button label="Choose crop" icon="crop-outline" variant="primary" onPress={onCrop} /></PanelTitle>;
  }

  if (tool === "layers") {
    return (
      <PanelTitle icon="layers-outline" title={`${project.layers.length} editable layer${project.layers.length === 1 ? "" : "s"}`} subtitle="Top layers appear in front. Lock production-critical artwork before arranging.">
        {[...project.layers].reverse().map((layer) => (
            <Pressable key={layer.id} onPress={() => onProject("Select layer", { ...project, selectedLayerId: layer.id })} style={[styles.layerRow, { backgroundColor: layer.id === project.selectedLayerId ? `${theme.accent}16` : theme.surfaceAlt, borderColor: layer.id === project.selectedLayerId ? theme.accent : theme.line }]}>
              <Pressable onPress={() => onProject(layer.visible ? "Hide layer" : "Show layer", updateLayer(project, layer.id, (item) => ({ ...item, visible: !item.visible })))} hitSlop={8}>
              <Icon name={layer.visible ? "visibility" : "visibilityOff"} size={TYPE.body.fontSize + SPACE.xs / 3} color={layer.visible ? theme.foreground : theme.muted} />
              </Pressable>
              <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={[TYPE.caption, { color: theme.foreground, fontFamily: theme.fontBodyMedium }]}>{layer.name}</Text>
              <Text style={[TYPE.micro, { color: theme.muted, fontFamily: theme.fontBody }]}>{layer.kind.toUpperCase()} · {Math.round(layer.opacity * 100)}%</Text>
              </View>
            <Pressable onPress={() => onProject("Move layer up", moveLayer(project, layer.id, 1))} hitSlop={8}><Icon name="chevronUp" size={TYPE.body.fontSize + SPACE.xs / 3} color={theme.muted} /></Pressable>
            <Pressable onPress={() => onProject("Move layer down", moveLayer(project, layer.id, -1))} hitSlop={8}><Icon name="chevronDown" size={TYPE.body.fontSize + SPACE.xs / 3} color={theme.muted} /></Pressable>
            <Icon name={layer.locked ? "lock" : "unlock"} size={TYPE.caption.fontSize} color={layer.locked ? theme.accent : theme.muted} />
          </Pressable>
        ))}
        <Button label="Flatten visible into new layer" icon="copy-outline" onPress={onFlatten} />
      </PanelTitle>
    );
  }

  if (tool === "production") {
    return (
      <PanelTitle icon="shield-checkmark-outline" title="Production desk" subtitle="Preflight, compensate for curved placement, compare a capture, and prepare a client proof.">
        <SliderRow label="Surface curvature" value={wrapAmount} min={0} max={1} step={0.05} display={`${Math.round(wrapAmount * 100)}%`} onChange={onWrapAmount} />
        <SliderRow label="Edge taper" value={wrapTaper} min={0} max={1} step={0.05} display={`${Math.round(wrapTaper * 100)}%`} onChange={onWrapTaper} />
        <View style={styles.symmetryBlock}>
          <Text style={[TYPE.micro, { color: theme.muted, fontFamily: theme.fontBodyMedium }]}>HOW IT WILL HEAL</Text>
          <View style={styles.segmentRow}>
            {HEAL_AGES.map((item) => {
              const active = item.id === healAge;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => onHealAge(item.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[styles.symmetryChip, { backgroundColor: active ? theme.accent : theme.surfaceAlt, borderColor: active ? theme.accent : theme.line }]}
                >
                  <Text style={[TYPE.micro, { color: active ? theme.accentText : theme.muted, fontFamily: theme.fontBodyMedium }]}>{item.label.toUpperCase()}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[TYPE.caption, { color: theme.muted, fontFamily: theme.fontBody }]}>
            {HEAL_AGES.find((item) => item.id === healAge)?.caption}. An estimate of ink spread at print size — useful for catching detail that will close up, not a promise.
          </Text>
        </View>
        <View style={styles.actionRow}>
          <MiniAction icon="body-outline" label="Apply wrap" onPress={onApplyWrap} />
          <MiniAction icon="shield-checkmark-outline" label="Preflight" onPress={onInspect} />
          <MiniAction icon="camera-outline" label="Check photo" onPress={onCheckCapture} />
          <MiniAction icon="send-outline" label="Review" onPress={onShareReview} />
        </View>
        {findings.map((finding) => (
          <View key={finding.title} style={[styles.finding, { borderColor: theme.line, backgroundColor: theme.surfaceAlt }]}>
            <Icon name={finding.level === "pass" ? "checkmark" : "alert"} size={TYPE.body.fontSize + SPACE.xs / 3} color={finding.level === "pass" ? "#36b37e" : theme.accent} />
            <View style={{ flex: 1 }}>
              <Text style={[TYPE.caption, { color: theme.foreground, fontFamily: theme.fontBodyMedium }]}>{finding.title}</Text>
              <Text style={[TYPE.micro, { color: theme.muted, fontFamily: theme.fontBody }]}>{finding.detail}</Text>
            </View>
          </View>
        ))}
      </PanelTitle>
    );
  }

  return (
    <PanelTitle icon="time-outline" title="Version history" subtitle="Inkline keeps named snapshots inside the editable project.">
      {project.snapshots.length === 0 ? <Text style={[TYPE.caption, { color: theme.muted, fontFamily: theme.fontBody }]}>Your first edit will create the first restore point.</Text> : [...project.snapshots].reverse().map((snapshot, reverseIndex) => {
        const index = project.snapshots.length - reverseIndex - 1;
        return <Pressable key={`${snapshot.createdAt}-${index}`} onPress={() => onRestore(index)} style={[styles.historyRow, { borderColor: theme.line }]}><Icon name="commit" size={TYPE.body.fontSize} color={theme.accent} /><View style={{ flex: 1 }}><Text style={[TYPE.caption, { color: theme.foreground, fontFamily: theme.fontBodyMedium }]}>{snapshot.label}</Text><Text style={[TYPE.micro, { color: theme.muted, fontFamily: theme.fontBody }]}>{new Date(snapshot.createdAt).toLocaleString()}</Text></View><Text style={[TYPE.micro, { color: theme.accent, fontFamily: theme.fontBodyMedium }]}>RESTORE</Text></Pressable>;
      })}
    </PanelTitle>
  );
}

function PanelTitle({ icon, title, subtitle, children }: { icon: keyof typeof Ionicons.glyphMap; title: string; subtitle: string; children?: React.ReactNode }) {
  const { theme } = useBrand();
  return <View style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.line }]}><View style={styles.panelHead}><View style={[styles.panelIcon, { backgroundColor: `${theme.accent}18` }]}><Icon name={iconNameFor(icon)} size={TYPE.body.fontSize + SPACE.xs / 3} color={theme.accent} /></View><View style={{ flex: 1 }}><Text style={[TYPE.body, { color: theme.foreground, fontFamily: theme.fontBodyMedium }]}>{title}</Text><Text style={[TYPE.caption, { color: theme.muted, fontFamily: theme.fontBody }]}>{subtitle}</Text></View></View>{children && <View style={{ marginTop: SPACE.sm }}>{children}</View>}</View>;
}

function SliderRow({ label, value, min, max, step, display, onChange }: { label: string; value: number; min: number; max: number; step?: number; display: string; onChange: (value: number) => void }) {
  const { theme } = useBrand();
  return <View style={styles.sliderRow}><View style={styles.sliderTop}><Text style={[TYPE.caption, { color: theme.foreground, fontFamily: theme.fontBody }]}>{label}</Text><Text style={[TYPE.caption, { color: theme.accent, fontFamily: theme.fontBodyMedium, fontVariant: ["tabular-nums"] }]}>{display}</Text></View><Slider minimumValue={min} maximumValue={max} step={step} value={value} onValueChange={onChange} onSlidingComplete={() => Haptics.selectionAsync()} minimumTrackTintColor={theme.accent} maximumTrackTintColor={theme.line} thumbTintColor={theme.accent} accessibilityLabel={label} /></View>;
}

const SYMMETRY_MODES: { id: SymmetryMode; label: string; icon: IconName }[] = [
  { id: "off", label: "Off", icon: "close" },
  { id: "mirror", label: "Mirror", icon: "swap" },
  { id: "radial", label: "Radial", icon: "refresh" },
];

const SYMMETRY_AXES: { id: SymmetryAxis; label: string }[] = [
  { id: "vertical", label: "Vertical" },
  { id: "horizontal", label: "Horizontal" },
  { id: "both", label: "Quad" },
];

function SymmetryControls({ symmetry, onSymmetry }: { symmetry: SymmetrySettings; onSymmetry: (value: SymmetrySettings) => void }) {
  const { theme } = useBrand();
  return (
    <View style={styles.symmetryBlock}>
      <Text style={[TYPE.micro, { color: theme.muted, fontFamily: theme.fontBodyMedium }]}>SYMMETRY</Text>
      <View style={styles.segmentRow}>
        {SYMMETRY_MODES.map((item) => {
          const active = item.id === symmetry.mode;
          return (
            <Pressable
              key={item.id}
              onPress={() => { onSymmetry({ ...symmetry, mode: item.id }); Haptics.selectionAsync(); }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[styles.symmetryChip, { backgroundColor: active ? theme.accent : theme.surfaceAlt, borderColor: active ? theme.accent : theme.line }]}
            >
              <Icon name={item.icon} size={TYPE.caption.fontSize} color={active ? theme.accentText : theme.foreground} />
              <Text style={[TYPE.micro, { color: active ? theme.accentText : theme.muted, fontFamily: theme.fontBodyMedium }]}>{item.label.toUpperCase()}</Text>
            </Pressable>
          );
        })}
      </View>
      {symmetry.mode === "mirror" && (
        <View style={styles.segmentRow}>
          {SYMMETRY_AXES.map((item) => {
            const active = item.id === symmetry.axis;
            return (
              <Pressable
                key={item.id}
                onPress={() => { onSymmetry({ ...symmetry, axis: item.id }); Haptics.selectionAsync(); }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[styles.symmetryChip, { backgroundColor: active ? `${theme.accent}22` : theme.surfaceAlt, borderColor: active ? theme.accent : theme.line }]}
              >
                <Text style={[TYPE.micro, { color: active ? theme.accent : theme.muted, fontFamily: theme.fontBodyMedium }]}>{item.label.toUpperCase()}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
      {symmetry.mode === "radial" && (
        <SliderRow
          label="Segments"
          value={symmetry.segments}
          min={MIN_SEGMENTS}
          max={MAX_SEGMENTS}
          step={1}
          display={`${clampSegments(symmetry.segments)}×`}
          onChange={(value) => onSymmetry({ ...symmetry, segments: clampSegments(value) })}
        />
      )}
    </View>
  );
}

function MiniAction({ icon, label, onPress, danger = false }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; danger?: boolean }) {
  const { theme } = useBrand();
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={[styles.miniAction, { backgroundColor: theme.surfaceAlt, borderColor: danger ? theme.danger : theme.line }]}><Icon name={iconNameFor(icon)} size={TYPE.body.fontSize + SPACE.xs / 3} color={danger ? theme.danger : theme.foreground} /><Text numberOfLines={1} style={[TYPE.micro, { color: danger ? theme.danger : theme.muted, fontFamily: theme.fontBodyMedium }]}>{label.toUpperCase()}</Text></Pressable>;
}

function iconNameFor(icon: keyof typeof Ionicons.glyphMap): IconName {
  const aliases: Partial<Record<keyof typeof Ionicons.glyphMap, IconName>> = {
    "close-outline": "close",
    "swap-horizontal-outline": "swap",
    "duplicate-outline": "copy",
    "lock-closed-outline": "lock",
    "lock-open-outline": "unlock",
    "trash-outline": "delete",
    "ellipse-outline": "add",
    "square-outline": "add",
    "remove-outline": "mask",
    "text-outline": "text",
    "color-filter-outline": "filter",
    "git-network-outline": "branch",
    "code-slash-outline": "document",
    "body-outline": "expand",
    "shield-checkmark-outline": "production",
    "camera-outline": "camera",
    "send-outline": "send",
    "brush-outline": "brush",
    "remove-circle-outline": "mask",
    "move-outline": "move",
    "add-circle-outline": "add",
    "git-branch-outline": "branch",
    "crop-outline": "crop",
    "layers-outline": "layers",
    "time-outline": "history",
  };
  return aliases[icon] ?? (Object.keys(ICONS) as IconName[]).find((name) => ICONS[name].ion === icon) ?? "tool";
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  screen: { flex: 1, paddingHorizontal: SPACE.md },
  topbar: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, paddingVertical: SPACE.sm },
  iconButton: { width: 38, height: 38, borderRadius: RADIUS.pill, alignItems: "center", justifyContent: "center" },
  eyebrow: { ...TYPE.micro },
  title: { ...TYPE.heading },
  workspace: { borderWidth: 1, borderRadius: RADIUS.lg, padding: SPACE.sm, overflow: "hidden" },
  workspaceMeta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: SPACE.xs },
  livePill: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: RADIUS.pill, paddingHorizontal: 9, paddingVertical: 5 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { ...TYPE.micro },
  compare: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: 9, paddingVertical: 5 },
  stage: { alignSelf: "center", overflow: "hidden", borderRadius: RADIUS.sm },
  selection: { position: "absolute", borderWidth: 1.5, borderStyle: "dashed" },
  gridLine: { position: "absolute", opacity: 0.42 },
  handle: { position: "absolute", width: 10, height: 10, borderRadius: 5 },
  handleTL: { left: -5, top: -5 },
  handleBR: { right: -5, bottom: -5 },
  loading: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", gap: SPACE.xs },
  toolSurface: { flexGrow: 0, marginTop: SPACE.sm, borderRadius: RADIUS.md },
  toolScroll: { flexGrow: 0 },
  toolDock: { gap: SPACE.xs, paddingRight: SPACE.md },
  tool: { width: 62, height: 54, borderRadius: RADIUS.md, borderWidth: 1, alignItems: "center", justifyContent: "center", gap: 3 },
  inspectorSurface: { flex: 1, marginTop: SPACE.sm, borderRadius: RADIUS.md },
  inspector: { flex: 1 },
  panel: { borderWidth: 1, borderRadius: RADIUS.md, padding: SPACE.sm },
  panelHead: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  panelIcon: { width: 34, height: 34, borderRadius: RADIUS.sm, alignItems: "center", justifyContent: "center" },
  sliderRow: { marginTop: SPACE.xs },
  sliderTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  segmentRow: { flexDirection: "row", gap: SPACE.sm, marginTop: SPACE.sm },
  symmetryBlock: { marginTop: SPACE.md, gap: SPACE.xs },
  symmetryChip: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: SPACE.xs, borderRadius: RADIUS.sm, borderWidth: 1 },
  swatch: { width: 32, height: 32, borderRadius: 16, borderWidth: 3 },
  actionRow: { flexDirection: "row", gap: SPACE.xs, marginTop: SPACE.xs },
  miniAction: { flex: 1, minHeight: 52, borderWidth: 1, borderRadius: RADIUS.sm, alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 3 },
  textInput: { borderWidth: 1, borderRadius: RADIUS.sm, minHeight: 44, paddingHorizontal: SPACE.sm, marginTop: SPACE.sm },
  layerRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, borderWidth: 1, borderRadius: RADIUS.sm, minHeight: 48, paddingHorizontal: SPACE.sm, marginBottom: SPACE.xs },
  historyRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, minHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth },
  finding: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, borderWidth: 1, borderRadius: RADIUS.sm, padding: SPACE.sm, marginTop: SPACE.xs },
  savebar: { flexDirection: "row", gap: SPACE.sm, paddingVertical: SPACE.sm },
});
