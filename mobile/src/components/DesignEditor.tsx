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
import Svg, { Circle as SvgCircle, Line as SvgLine, Path as SvgPath } from "react-native-svg";
import { SafeAreaView } from "react-native-safe-area-context";
import { useBrand } from "@/context/BrandContext";
import { Button } from "@/components/Button";
import { ChoicePrompt, type Choice } from "@/components/ChoicePrompt";
import { CropTool } from "@/components/CropTool";
import { GlassSurface } from "@/components/GlassSurface";
import { Icon } from "@/components/Icon";
import { PaperSubstrate } from "@/components/PaperSubstrate";
import { Notice } from "@/components/ui";
import {
  addRasterAsset,
  cloneProject,
  loadOrCreateProject,
  projectAssetBase64,
  saveProject,
  type DesignLayer,
  type EditableDesignProject,
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
import { layDown, toolsFor } from "@/lib/material";
import { consolidateWithin } from "@/lib/sketch";
import { DEFAULT_TRACE, polylinesToStrokeLayer, skeletonize, tracePolylines } from "@/lib/vectorize";
import { addCutLine, DEFAULT_CUT_LINE } from "@/lib/cutline";
import { shareDataUrl, shareUri } from "@/lib/files";
import { assessCoverup, compareCapture, inspectProduction, moldFromDesign, simulateHealing, trayFromDesign, wrapForSurface, type ProductionFinding } from "@/lib/productionTools";
import { ballFor, type Substrate } from "@/lib/substrate";
import { encodeStl, toBase64 } from "@/lib/stl";
import { HEAL_AGES, type HealAge } from "@/lib/healing";
import { MIN_LINE_GAP_MM, checkLineSpacing, pxPerMmFromDpi, spacingFinding } from "@/lib/spacing";
import { PREF_KEYS, isFiniteNumber, preferences } from "@/lib/preferences";
import {
  DEFAULT_PEN,
  conditionStroke,
  sampleFromStylus,
  type PenSample,
  type PenSettings,
} from "@/lib/penInput";
import { renderStroke } from "@/lib/ribbon";
import { useShortcut } from "@/lib/desktopInput";
import { SHORTCUTS } from "@/lib/shortcuts";
import { findSurface, maxApparentWidthIn, printScale, surfacesFor } from "@/lib/curveWarp";
import {
  DEFAULT_BANDS,
  MAX_BANDS,
  MIN_BANDS,
  defaultPlan,
  type BandStrategy,
  type SeparationPlan,
} from "@/lib/tone";
import { DEFAULT_SHADING, SHADING_STYLES, type ShadingOptions, type ShadingStyle } from "@/lib/shading";
import { shadingLayers, toneStudy, type ToneStudy } from "@/lib/toneSeparate";
import { LETTERING_STYLES, letteringStyle, type LetteringStyleId } from "@/lib/lettering";
import { DEFAULT_CLEANUP, applyCleanup, cleanupReport } from "@/lib/cleanup";
import {
  deleteNode,
  insertMidpoint,
  layerToCanvas,
  moveNode,
  nearestNode,
  nearestSegment,
  type NodeRef,
} from "@/lib/nodeEdit";
import { renderLettering } from "@/lib/letteringRender";
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
import { RADIUS, SPACE, TYPE, glow, lift, type Theme } from "@/lib/theme";

type EditorTool = "select" | "draw" | "erase" | "nodes" | "insert" | "refine" | "tone" | "crop" | "layers" | "production" | "history";

type SaveResult = { id: string; title: string };

/**
 * What a gesture reports about the stylus, when there is one. Structurally
 * matched rather than imported: the handler declares this payload as optional
 * and only fills it for a real pen, which is exactly the shape we want.
 */
type StylusReading = { pressure: number; altitudeAngle: number } | undefined;

const TOOLS: { id: EditorTool; label: string; icon: IconName }[] = [
  { id: "select", label: "Arrange", icon: "move" },
  { id: "draw", label: "Draw", icon: "brush" },
  { id: "erase", label: "Mask", icon: "mask" },
  { id: "nodes", label: "Nodes", icon: "nodes" },
  { id: "insert", label: "Add", icon: "add" },
  { id: "refine", label: "Lines", icon: "branch" },
  { id: "tone", label: "Tone", icon: "contrast" },
  { id: "crop", label: "Crop", icon: "crop" },
  { id: "layers", label: "Layers", icon: "layers" },
  { id: "production", label: "Pro", icon: "production" },
  { id: "history", label: "History", icon: "history" },
];

// Tracing allocates per thinning pass, so the mask is capped well below the
// canvas size. The resulting geometry scales back up losslessly.
const TRACE_MAX_DIMENSION = 1400;

/**
 * How far apart, in traced line weights, two contours can sit and still be the
 * same line found twice. Two is the width of a pencil search — wide enough to
 * catch a sketchy triple-drawn edge, narrow enough to leave a deliberate
 * double line alone.
 */
const SKETCH_SEARCH_WIDTHS = 2;

// How far a photo is knocked back when it becomes something to draw over.
// Faint enough that black linework reads clearly on top, strong enough to
// still see what you are tracing.
const UNDERLAY_OPACITY = 0.3;

/** Names for the values, darkest first — what an artist would call them. */
const BAND_LABELS = ["Core black", "Shadow", "Mid tone", "Light", "Highlight", "Paper"];

/** Resize a plan without losing the choices already made for surviving bands. */
function resizePlan(plan: SeparationPlan, bands: number): SeparationPlan {
  const fresh = defaultPlan(bands);
  return {
    ...fresh,
    strategy: plan.strategy,
    passes: fresh.passes.map((pass, index) => plan.passes[index] ?? pass),
  };
}

/** Switch one band to a style, or to bare paper. */
function setPass(plan: SeparationPlan, band: number, style: ShadingStyle | null): SeparationPlan {
  const fallback = defaultPlan(plan.bands).passes[band]?.shading;
  return {
    ...plan,
    passes: plan.passes.map((pass, index) =>
      index !== band
        ? pass
        : {
            shading: style
              ? // Keep whatever density and angle were already dialled in, so
                // trying a technique does not throw away the tuning.
                { ...(pass.shading ?? fallback ?? DEFAULT_SHADING), style }
              : null,
          }
    ),
  };
}

function patchPass(plan: SeparationPlan, band: number, patch: Partial<ShadingOptions>): SeparationPlan {
  return {
    ...plan,
    passes: plan.passes.map((pass, index) =>
      index !== band || !pass.shading ? pass : { shading: { ...pass.shading, ...patch } }
    ),
  };
}

/** A raster layer currently serving as a tracing reference. */
function isUnderlay(layer: DesignLayer): boolean {
  return layer.kind === "raster" && layer.locked && layer.opacity <= UNDERLAY_OPACITY + 0.01;
}

// Room left for the floating controls in full-screen drawing mode. Everything
// else is given over to the canvas.
const IMMERSIVE_CHROME = 132;

// Thermal stencil printers in printerProfiles.ts run at 203 DPI; preflight
// measures the artwork as it will actually come off one.
const PRINT_DPI = 203;

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Guards a stored pen profile against an older or corrupt shape. */
function isPenSettings(value: unknown): value is PenSettings {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.stabilization === "number" &&
    typeof candidate.pressure === "boolean" &&
    typeof candidate.pressureDepth === "number" &&
    typeof candidate.tiltGain === "number" &&
    typeof candidate.velocityTaper === "number" &&
    typeof candidate.taperLength === "number"
  );
}

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
  // Raw samples for the stroke in progress. Conditioning is derived from them
  // rather than applied on the way in, so the preview under the pen and the
  // geometry committed when it lifts come out of one call and cannot disagree.
  const [currentSamples, setCurrentSamples] = useState<PenSample[]>([]);
  const [pen, setPen] = useState<PenSettings>(DEFAULT_PEN);
  const [pencilOnly, setPencilOnly] = useState(false);
  // Only offered once a stylus has actually been seen. Apple Pencil is an iPad
  // accessory — it does not pair with any iPhone — so on a phone the control
  // would be a switch whose only effect is to stop drawing working, with
  // nothing on screen to explain why.
  const [sawStylus, setSawStylus] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [symmetry, setSymmetry] = useState<SymmetrySettings>(DEFAULT_SYMMETRY);
  const [letteringText, setLetteringText] = useState("");
  const [letteringStyleId, setLetteringStyleId] = useState<LetteringStyleId>("script");
  const [letteringCurve, setLetteringCurve] = useState(0);
  /**
   * The open choice list, if any. Held here rather than passed through an
   * alert because Android alerts cap at three buttons and silently drop the
   * rest — see ChoicePrompt.
   */
  const [choosing, setChoosing] = useState<{
    title: string;
    subtitle?: string;
    choices: Choice[];
    onPick: (value: number) => void;
  } | null>(null);
  const [nodeMode, setNodeMode] = useState<"move" | "delete" | "insert">("move");
  const [nodeDraft, setNodeDraft] = useState<StrokeLayer | null>(null);
  // State, not a ref: the gesture rebuilds each render, so the onEnd closure
  // reads the latest value — the same pattern finishStroke relies on.
  const [dragNode, setDragNode] = useState<NodeRef | null>(null);
  const [cropping, setCropping] = useState(false);
  const [lineWeight, setLineWeight] = useState(1);
  const [threshold, setThreshold] = useState(60);
  const [surfaceId, setSurfaceId] = useState("flat");
  const [wrapWidthIn, setWrapWidthIn] = useState(3);
  const [findings, setFindings] = useState<ProductionFinding[]>([]);
  const [healAge, setHealAge] = useState<HealAge>("fresh");
  const [healed, setHealed] = useState<string | null>(null);
  const [plan, setPlan] = useState<SeparationPlan>(() => defaultPlan(DEFAULT_BANDS));
  const [study, setStudy] = useState<ToneStudy | null>(null);

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

  useEffect(() => {
    let active = true;
    Promise.all([
      preferences.get(brand.id, PREF_KEYS.brushSize, 16, isFiniteNumber),
      preferences.get(brand.id, PREF_KEYS.brushColor, "#111111"),
      preferences.get(brand.id, PREF_KEYS.pen, DEFAULT_PEN, isPenSettings),
    ]).then(([size, color, saved]) => {
      if (!active) return;
      setBrush(Math.max(2, Math.min(72, size)));
      setBrushColor(color);
      setPen(saved);
    });
    return () => {
      active = false;
    };
  }, [brand.id]);

  function rememberBrush(value: number) {
    setBrush(value);
    void preferences.set(brand.id, PREF_KEYS.brushSize, value);
  }

  function rememberBrushColor(value: string) {
    setBrushColor(value);
    void preferences.set(brand.id, PREF_KEYS.brushColor, value);
  }

  function rememberPen(patch: Partial<PenSettings>) {
    setPen((current) => {
      const next = { ...current, ...patch };
      void preferences.set(brand.id, PREF_KEYS.pen, next);
      return next;
    });
  }

  const selected = useMemo(
    () => project?.layers.find((layer) => layer.id === project.selectedLayerId) ?? null,
    [project]
  );

  const aspect = project ? project.canvas.height / project.canvas.width : 1;
  // Fit the canvas inside what is available rather than filling the width and
  // capping the height: one scale factor maps both axes, so a stage whose
  // aspect does not match the canvas puts every gesture in the wrong place
  // down the long axis and stretches the preview to match.
  const availableW = immersive ? screenW - SPACE.sm * 2 : screenW - SPACE.md * 2;
  const availableH = immersive ? screenH - IMMERSIVE_CHROME : screenH * 0.48;
  const stageW = Math.min(availableW, availableH / aspect);
  const stageH = stageW * aspect;
  const scale = project ? stageW / project.canvas.width : 1;

  async function persist(next: EditableDesignProject) {
    setBusy(true);
    try {
      const bumped = { ...next, revision: next.revision + 1 };
      await saveProject(bumped);
      const flattened = await renderProject(bumped);
      setProject(bumped);
      setPreview(flattened);
      // A study of the previous artwork would quietly keep being shown over
      // the new one. Better to make it obviously absent than subtly wrong.
      setStudy(null);
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

  /**
   * One reading from the digitiser, in stage points, conditioned and stored.
   *
   * Everything downstream works in canvas pixels, so the position is converted
   * before it is filtered — smoothing and taper are both distance-based, and
   * running them in stage points would make the brush behave differently at
   * every zoom level.
   */
  function addStrokeSample(x: number, y: number, stylus: StylusReading) {
    if (!project) return;
    if (stylus && !sawStylus) setSawStylus(true);
    const raw = sampleFromStylus(
      Math.max(0, Math.min(project.canvas.width, x / scale)),
      Math.max(0, Math.min(project.canvas.height, y / scale)),
      stylus
    );
    setCurrentSamples((samples) => [...samples, raw]);
  }

  function beginStroke(x: number, y: number, stylus: StylusReading) {
    setCurrentSamples([]);
    addStrokeSample(x, y, stylus);
  }

  async function finishStroke() {
    const drawn = conditionStroke(currentSamples, brush / scale, pen);
    if (!project || !drawn.length) {
      setCurrentSamples([]);
      return;
    }
    let next = project;
    let strokeLayer = selected?.kind === "stroke" && !selected.locked ? selected : null;
    if (!strokeLayer) {
      strokeLayer = makeStrokeLayer(project.canvas.width, project.canvas.height, tool === "erase" ? "Mask" : "Linework");
      next = addLayer(next, strokeLayer);
    }
    const id = strokeLayer.id;
    // Symmetry commits the whole set as one undo step — one gesture, one entry.
    const paths = replicateStroke(drawn, symmetry, project.canvas);
    next = updateLayer(next, id, (layer) => ({
      ...(layer as StrokeLayer),
      strokes: [
        ...(layer as StrokeLayer).strokes,
        ...paths.map((points) => ({
          points,
          // Nominal width. Per-point widths carry the pen dynamics; this is
          // what any point without one falls back to.
          width: brush / scale,
          color: brushColor,
          mode: tool === "erase" ? ("erase" as const) : ("draw" as const),
          opacity: 1,
        })),
      ],
    }));
    setCurrentSamples([]);
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

  // stylusData is populated only for a real stylus — on iOS the handler gates
  // it on UITouchTypePencil — so its presence is both the pressure reading and
  // the answer to "was that the Pencil or a palm?".
  const drawGesture = Gesture.Pan()
    .minDistance(0)
    .onStart((event) => {
      "worklet";
      if (pencilOnly && !event.stylusData) return;
      runOnJS(beginStroke)(event.x, event.y, event.stylusData);
    })
    .onUpdate((event) => {
      "worklet";
      if (pencilOnly && !event.stylusData) return;
      runOnJS(addStrokeSample)(event.x, event.y, event.stylusData);
    })
    .onEnd(() => {
      "worklet";
      runOnJS(finishStroke)();
    });

  const arrangeGesture = Gesture.Simultaneous(
    Gesture.Pan().onEnd((event) => runOnJS(finishPan)(event.translationX, event.translationY)),
    Gesture.Pinch().onEnd((event) => runOnJS(finishPinch)(event.scale)),
    Gesture.Rotation().onEnd((event) => runOnJS(finishRotate)(event.rotation))
  );

  // Nodes mode: fingers land in stage points; hit-testing runs in canvas px.
  function nodeTouchStart(x: number, y: number) {
    if (!project || selected?.kind !== "stroke" || selected.locked) return;
    const canvasPoint = { x: x / scale, y: y / scale };
    const radius = 26 / scale;
    if (nodeMode === "move") {
      const hit = nearestNode(selected, canvasPoint, radius);
      setDragNode(hit);
      if (hit) setNodeDraft(moveNode(selected, hit, canvasPoint));
      return;
    }
    if (nodeMode === "delete") {
      const hit = nearestNode(selected, canvasPoint, radius);
      if (!hit) return;
      void commit("Delete node", updateLayer(project, selected.id, (layer) => deleteNode(layer as StrokeLayer, hit)));
      Haptics.selectionAsync();
      return;
    }
    const segment = nearestSegment(selected, canvasPoint, radius);
    if (!segment) return;
    void commit("Insert node", updateLayer(project, selected.id, (layer) => insertMidpoint(layer as StrokeLayer, segment)));
    Haptics.selectionAsync();
  }

  function nodeTouchMove(x: number, y: number) {
    if (nodeMode !== "move" || !dragNode || selected?.kind !== "stroke") return;
    setNodeDraft(moveNode(selected, dragNode, { x: x / scale, y: y / scale }));
  }

  function nodeTouchEnd() {
    const node = dragNode;
    setDragNode(null);
    if (!project || !node || !nodeDraft || selected?.kind !== "stroke") {
      setNodeDraft(null);
      return;
    }
    const draft = nodeDraft;
    setNodeDraft(null);
    void commit("Move node", updateLayer(project, selected.id, () => draft));
  }

  const nodeGesture = Gesture.Pan()
    .minDistance(0)
    .onStart((event) => runOnJS(nodeTouchStart)(event.x, event.y))
    .onUpdate((event) => runOnJS(nodeTouchMove)(event.x, event.y))
    .onEnd(() => runOnJS(nodeTouchEnd)());

  const stageGesture =
    tool === "draw" || tool === "erase" ? drawGesture : tool === "nodes" ? nodeGesture : arrangeGesture;

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

  /**
   * The value study. Judged before any marks are made — if this does not read
   * as the subject, no amount of shading technique will save the stencil made
   * from it.
   */
  async function runToneStudy(next: SeparationPlan) {
    setPlan(next);
    if (!preview) return;
    setBusy(true);
    try {
      setStudy(toneStudy(preview, next.bands, next.strategy));
      setError(null);
    } catch (e) {
      setStudy(null);
      setError(e instanceof Error ? e.message : "The value study couldn't be built.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Turns the study into layers: one per band the plan inks, darkest on top.
   *
   * The source stays visible and untouched. Shading you cannot compare against
   * the thing it came from is shading you cannot judge, and the layer panel is
   * where it gets turned off once it has been judged.
   */
  async function applySeparation() {
    if (!project || !preview) return;
    setBusy(true);
    try {
      const { layers, marks } = shadingLayers(preview, plan, project.canvas.width, project.canvas.height);
      if (!layers.length) {
        setError("No band in this plan produces marks. Give a darker band a style and try again.");
        return;
      }
      let next = project;
      for (const layer of layers) next = addLayer(next, layer);
      await commit(`Tone separation · ${layers.length} layer${layers.length === 1 ? "" : "s"}, ${marks} marks`, next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The separation couldn't be applied.");
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
      const traced = tracePolylines(skeletonize(mask, width, height), width, height, DEFAULT_TRACE);
      if (!traced.length) {
        setError("No linework found to trace. Lower the detail threshold and try again.");
        return;
      }
      // Someone finding a line on paper draws it three or four times, and the
      // tracer faithfully returns all four. Two contours within a couple of
      // line weights of each other are the same searched line, so they collapse
      // to one before any of this becomes editable geometry.
      const paths = consolidateWithin(traced, (lineWeight + 1) * SKETCH_SEARCH_WIDTHS);
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
      const collapsed = traced.length - paths.length;
      await commit(
        `Trace to vector \u00b7 ${paths.length} paths${collapsed > 0 ? ` \u00b7 ${collapsed} merged` : ""}`,
        addLayer(hidden, layer)
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't trace the linework.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Redraws the linework as the chosen tool would actually lay it down.
   *
   * A design on screen is a flat vector at one weight. A tattoo is a needle
   * grouping dragged at a particular speed and a cookie is a bead squeezed out
   * of a tip, and neither lays a constant line. Three widths rather than the
   * full table: the question here is fine, bold or heavy, and the whole set
   * belongs in a picker rather than an alert.
   */
  async function layDownWithTool() {
    if (!project) return;
    const layer =
      selected?.kind === "stroke" && !selected.locked
        ? selected
        : [...project.layers].reverse().find(
            (item): item is StrokeLayer => item.kind === "stroke" && item.visible && !item.locked
          );
    if (!layer || !layer.strokes.length) {
      setError("Nothing to lay down — trace or draw some linework first.");
      return;
    }

    // The whole table rather than three of it: a list has room for every tool
    // and for what each one is, where an alert had room for neither.
    const tools = toolsFor(brand.id);
    setChoosing({
      title: brand.id === "sugar" ? "Which tip?" : "Which grouping?",
      subtitle: "The linework is redrawn at the width this tool really lays down, thickening where the hand slowed.",
      choices: tools.map((tool, index) => ({
        value: index,
        label: `${tool.label} — ${tool.widthMm}mm`,
        detail: tool.note,
      })),
      onPick: (index) => {
        const tool = tools[index];
        if (!tool) return;
        const pxPerMm = pxPerMmFromDpi(PRINT_DPI);
        const next = {
          ...layer,
          strokes: layer.strokes.map((stroke) =>
            stroke.mode === "draw"
              ? { ...stroke, points: layDown(stroke.points, tool.widthMm, pxPerMm), width: tool.widthMm * pxPerMm }
              : stroke
          ),
        };
        void commit(`Lay down \u00b7 ${tool.label}`, {
          ...project,
          layers: project.layers.map((item) => (item.id === layer.id ? next : item)),
        });
      },
    });
  }

  async function cleanUpStrokes() {
    if (!project) return;
    // Clean the selected stroke layer, or the topmost visible one — the layer
    // a fresh trace just landed on.
    const layer =
      selected?.kind === "stroke" && !selected.locked
        ? selected
        : [...project.layers].reverse().find(
            (item): item is StrokeLayer => item.kind === "stroke" && item.visible && !item.locked
          );
    if (!layer || !layer.strokes.length) {
      setError("Nothing to clean — trace or draw some linework first.");
      return;
    }
    const drawn = layer.strokes.filter((stroke) => stroke.mode === "draw");
    const erases = layer.strokes.filter((stroke) => stroke.mode === "erase");
    const report = cleanupReport(
      drawn.map((stroke) => stroke.points),
      pxPerMmFromDpi(PRINT_DPI),
      MIN_LINE_GAP_MM[brand.id]
    );
    if (!report.specks && !report.bridgeableGaps) {
      Alert.alert(
        "Already clean",
        report.spacing.violations
          ? `No specks or breaks. ${report.spacing.violations} tight spot${report.spacing.violations === 1 ? "" : "s"} below ${MIN_LINE_GAP_MM[brand.id]}mm remain — those need manual reworking or a larger print size.`
          : "No stray specks, no broken lines, and spacing holds at print size."
      );
      return;
    }
    // Repaired geometry inherits each layer's dominant stroke look — the
    // repair merges paths, so per-path attribution can't survive anyway.
    const look = drawn[0];
    const result = applyCleanup(drawn.map((stroke) => stroke.points), DEFAULT_CLEANUP);
    const next = updateLayer(project, layer.id, (item) => ({
      ...(item as StrokeLayer),
      strokes: [
        ...result.paths.map((points) => ({
          points,
          width: look.width,
          color: look.color,
          mode: "draw" as const,
          opacity: look.opacity,
        })),
        ...erases,
      ],
    }));
    await commit(
      `Clean up · ${result.specksRemoved} speck${result.specksRemoved === 1 ? "" : "s"}, ${result.gapsBridged} bridge${result.gapsBridged === 1 ? "" : "s"}`,
      next
    );
    Alert.alert(
      "Cleaned up",
      `Removed ${result.specksRemoved} stray speck${result.specksRemoved === 1 ? "" : "s"} and bridged ${result.gapsBridged} broken line${result.gapsBridged === 1 ? "" : "s"}. One undo reverses all of it.`
    );
  }

  async function addLettering() {
    if (!project || !letteringText.trim()) return;
    setBusy(true);
    try {
      const style = letteringStyle(letteringStyleId);
      const rendered = await renderLettering(letteringText, letteringStyleId, {
        curve: letteringCurve,
      });
      const { mask, width, height } = await stencilMask(rendered.dataUrl, {
        ...DEFAULT_STENCIL_OPTIONS,
        mode: "photocopy",
        maxDimension: TRACE_MAX_DIMENSION,
      });
      const paths = tracePolylines(skeletonize(mask, width, height), width, height, {
        ...DEFAULT_TRACE,
        simplifyTolerance: style.simplifyTolerance,
      });
      if (!paths.length) {
        setError("The lettering traced to nothing — try a larger size or simpler text.");
        return;
      }
      // Scale to a comfortable share of the canvas and centre it.
      const target = project.canvas.width * 0.8;
      const toCanvas = target / width;
      const offsetX = (project.canvas.width - width * toCanvas) / 2;
      const offsetY = (project.canvas.height - height * toCanvas) / 2;
      const scaled = paths.map((points) =>
        points.map((point) => ({ x: point.x * toCanvas + offsetX, y: point.y * toCanvas + offsetY }))
      );
      const layer = polylinesToStrokeLayer(
        scaled,
        project.canvas.width,
        project.canvas.height,
        Math.max(1.5, 2 * toCanvas),
        brushColor,
        `Lettering · ${letteringText.trim().slice(0, 18)}`
      );
      await commit(`Add lettering "${letteringText.trim().slice(0, 14)}"`, addLayer(project, layer));

      // Script bleeds where letters nearly touch — check it immediately at
      // print density and surface the reading with the other findings.
      const minGapMm = MIN_LINE_GAP_MM[brand.id];
      const report = checkLineSpacing(scaled, pxPerMmFromDpi(PRINT_DPI), minGapMm);
      setFindings((current) => [
        ...current.filter((finding) => finding.title !== "Line spacing"),
        spacingFinding(report, brand.id, minGapMm),
      ]);
      setLetteringText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't trace the lettering.");
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
        const bytes = await projectAssetBase64(project.brand, project.id, asset);
        if (bytes) assets[asset] = `data:image/png;base64,${bytes}`;
      }
      file.write(projectToSvg(project, assets));
      await shareUri(file.uri);
    } catch (e) {
      Alert.alert("Couldn't export SVG", e instanceof Error ? e.message : "Try again.");
    }
  }

  /**
   * `compensate` is what you print — pre-distorted so it reads correctly once
   * it is on the curve. `foreshorten` is the proof — what the flat artwork
   * will actually look like there. Both come off the same map.
   */
  async function applyWrap(direction: "compensate" | "foreshorten") {
    if (!project || !preview) return;
    const surface = findSurface(surfaceId);
    if (!surface || surface.kind === "flat") {
      setError("Pick the surface this is going on first.");
      return;
    }
    try {
      const heightIn = wrapWidthIn * (project.canvas.height / project.canvas.width);
      const warped = wrapForSurface(preview, surface, wrapWidthIn, heightIn, direction);
      const hidden = { ...project, layers: project.layers.map((layer) => ({ ...layer, visible: false })) };
      const label = direction === "compensate" ? "Compensated for" : "Proof on";
      const result = await addRasterAsset(hidden, warped, `${label} ${surface.label.toLowerCase()}`);
      await commit(`${label} ${surface.label.toLowerCase()}`, result.project);
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

  /**
   * Whether this design will bury the tattoo already there.
   *
   * Both photographs are resampled onto one grid, which is also the assumption
   * the artist has to satisfy: frame the existing piece the way the new design
   * will sit over it. Nothing here can register one to the other, and a
   * comparison of two differently-framed photos would be confidently wrong.
   */
  async function checkCoverup() {
    if (!preview) return;
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1, base64: true });
    if (picked.canceled) return;
    const asset = picked.assets[0];
    if (!asset.base64) return setError("That photo couldn't be read locally.");
    try {
      const assessment = assessCoverup(preview, `data:${asset.mimeType ?? "image/jpeg"};base64,${asset.base64}`);
      setFindings([
        assessment.finding,
        {
          level: "pass",
          title: "What's underneath",
          detail: `The old piece reads ${Math.round(assessment.edgeStrength * 100)}% crisp, so the new one needs about ${assessment.threshold.toFixed(1)}x its ink to hide it.`,
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't compare the two photos.");
    }
  }

  /**
   * Exports a casting tray for the 3D printer.
   *
   * The tray is what gets printed; silicone poured into it is what becomes the
   * mold, and the mold is what touches food. Thickness is asked rather than
   * guessed because a drawing has no depth in it — it is the one number the
   * artwork genuinely cannot supply.
   */
  function exportCastingTray() {
    if (!project || !preview) return;

    // A ball takes a different road entirely. It has no flat face to stand on,
    // so there is no tray of standing shapes to make and no thickness to ask
    // about — its thickness is how wide it is.
    const ball = ballFor(surfaceId);
    if (ball) {
      askBallCavities(ball);
      return;
    }

    setChoosing({
      title: "How thick are they?",
      subtitle: "The shapes stand this proud of the tray floor, so it is how deep the finished piece will be.",
      choices: [
        { value: 4, label: "Thin — 4mm", detail: "A flat topper or a thin chocolate." },
        { value: 7, label: "Standard — 7mm", detail: "A cookie you would recognise as a cookie." },
        { value: 12, label: "Chunky — 12mm", detail: "A solid piece with real weight to it." },
      ],
      onPick: (shapeMm) => askCavities(shapeMm),
    });
  }

  /**
   * A ball is not a tray of standing shapes, so it does not get asked a tray's
   * questions. Its thickness is its own diameter and there is nothing to decide
   * about filling an outline — the drawing is pressed onto a dome either way.
   */
  function askBallCavities(ball: Substrate) {
    setChoosing({
      title: `How many ${ball.label.toLowerCase()}s at a time?`,
      subtitle: "Each one needs both halves of the mold, so this is what one pair of trays makes.",
      choices: [1, 2, 4, 6, 9, 12].map((copies) => ({
        value: copies,
        label: copies === 1 ? "Just one" : `${copies}`,
        detail: copies === 1 ? "One ball per pour." : undefined,
      })),
      onPick: (copies) => void reviewSphereMold(ball, copies),
    });
  }

  /**
   * How many cavities one pour should fill.
   *
   * The tray grows to hold them and the packer arranges them as close to square
   * as it can, because a print bed is square and its limit is whichever way the
   * tray ends up widest.
   */
  function askCavities(shapeMm: number) {
    setChoosing({
      title: "How many at a time?",
      subtitle: "Each cavity is one piece out of a single pour of silicone.",
      choices: [1, 2, 4, 6, 9, 12, 18, 24].map((copies) => ({
        value: copies,
        label: copies === 1 ? "Just one" : `${copies}`,
        detail: copies === 1 ? "One piece per pour." : undefined,
      })),
      onPick: (copies) => void reviewCastingTray(shapeMm, true, copies),
    });
  }

  /**
   * Builds the tray and puts it up for approval before anything is shared.
   *
   * Handing over a file the code has already worked out will not print is the
   * expensive kind of quiet failure — the printer runs for three hours and the
   * fine detail simply is not there at the end of it. So the preflight is shown
   * where the decision is made rather than left on a panel nobody has open.
   *
   * The same moment is the only place the fill question can be asked, because
   * it is the only place we know whether it is a real question: a drawing
   * cannot say whether an enclosed white region is inside the shape or a hole
   * through it, and only the person who drew it knows.
   */
  async function reviewCastingTray(shapeMm: number, fillOutlines: boolean, copies: number, reliefMm?: number) {
    if (!project || !preview) return;
    setBusy(true);
    let tray: ReturnType<typeof trayFromDesign> = null;
    try {
      // Zero means "not set", and buildTray's own defaults are the same 0.4mm
      // and 220mm bed, so an unanswered setting changes nothing.
      const [nozzleMm, bedMm] = await Promise.all([
        preferences.get<number>(brand.id, PREF_KEYS.nozzleMm, 0),
        preferences.get<number>(brand.id, PREF_KEYS.bedMm, 0),
      ]);
      tray = trayFromDesign(preview, {
        widthIn: project.canvas.width / PRINT_DPI,
        shapeMm,
        fillOutlines,
        copies,
        reliefMm,
        nozzleMm: nozzleMm > 0 ? nozzleMm : undefined,
        bedMm: bedMm > 0 ? bedMm : undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't build the casting tray.");
      return;
    } finally {
      setBusy(false);
    }
    if (!tray) {
      setError("Nothing to stand up — trace or draw a shape first.");
      return;
    }
    const built = tray;
    setFindings(built.findings);

    const warnings = built.findings.filter((finding) => finding.level === "warn");
    const arrangement =
      built.cavities > 1 ? `${built.cavities} cavities, ${built.columns} x ${built.rows}` : "One cavity";
    const summary =
      `${arrangement} on a ${built.widthMm.toFixed(0)} x ${built.depthMm.toFixed(0)}mm tray. ` +
      (built.reliefAppliedMm > 0
        ? `Pieces ${(shapeMm + built.reliefAppliedMm).toFixed(1)}mm thick, lines and all. `
        : "") +
      `About ${built.plasticCm3.toFixed(0)}cm³ of filament, and roughly ${built.siliconeMl.toFixed(0)}ml of silicone to fill it.`;

    // A list rather than an alert: with both readings of the drawing on offer
    // this runs to four options, and Android alerts quietly drop the fourth.
    // Each alternative is only shown when it is a real question — see the
    // conditions below — so most designs still get two rows and a cancel.
    const choices: Choice[] = [];
    // Only when the fill actually changed the shape. Otherwise both readings
    // are the same tray and the question is noise.
    if (fillOutlines && built.outlinesFilled) {
      choices.push({
        value: 1,
        label: "Keep the holes",
        detail: "Stand the marks up as they are, instead of filling what they enclose.",
      });
    }
    // Only when there was linework to raise and it was raised. Nothing to
    // decline otherwise.
    if (built.reliefAppliedMm > 0) {
      choices.push({
        value: 2,
        label: "Cast it flat",
        detail: `Drop the raised lines and make a plain ${shapeMm.toFixed(1)}mm silhouette.`,
      });
    }
    choices.push({
      value: 0,
      label: warnings.length ? "Export anyway" : "Export",
      detail: `${built.widthMm.toFixed(0)} x ${built.depthMm.toFixed(0)}mm STL for the printer.`,
    });

    setChoosing({
      title: warnings.length ? "Worth checking before you print" : "Ready to export",
      subtitle: warnings.length
        ? `${warnings.map((finding) => finding.detail).join("\n\n")}\n\n${summary}`
        : summary,
      choices,
      onPick: (value) => {
        if (value === 1) void reviewCastingTray(shapeMm, false, copies, reliefMm);
        else if (value === 2) void reviewCastingTray(shapeMm, fillOutlines, copies, 0);
        else void shareCastingTray(built);
      },
    });
  }

  /**
   * Builds both halves of a ball mold and puts them up for approval.
   *
   * Two files, and they are not interchangeable: one carries the drawing and
   * one is smooth, and each has to be printed on its own. So they are offered
   * one at a time rather than handed over as a pair somebody has to keep
   * straight afterwards.
   */
  async function reviewSphereMold(ball: Substrate, copies: number) {
    if (!project || !preview) return;
    setBusy(true);
    let built: ReturnType<typeof moldFromDesign> = null;
    try {
      const [nozzleMm, bedMm] = await Promise.all([
        preferences.get<number>(brand.id, PREF_KEYS.nozzleMm, 0),
        preferences.get<number>(brand.id, PREF_KEYS.bedMm, 0),
      ]);
      built = moldFromDesign(preview, {
        diameterIn: ball.widthIn,
        stick: ball.stick,
        copies,
        nozzleMm: nozzleMm > 0 ? nozzleMm : undefined,
        bedMm: bedMm > 0 ? bedMm : undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't build the mold.");
      return;
    } finally {
      setBusy(false);
    }
    if (!built) {
      setError("Nothing to wrap onto a ball — trace or draw a design first.");
      return;
    }
    const mold = built;
    setFindings(mold.findings);

    const warnings = mold.findings.filter((finding) => finding.level === "warn");
    const summary =
      `${mold.cavities} ${ball.label.toLowerCase()}${mold.cavities === 1 ? "" : "s"} a pour, from two trays of ` +
      `${mold.designed.widthMm.toFixed(0)} x ${mold.designed.depthMm.toFixed(0)}mm. ` +
      `About ${(mold.designed.plasticCm3 + mold.plain.plasticCm3).toFixed(0)}cm³ of filament for the pair, and ` +
      `${(mold.designed.siliconeMl + mold.plain.siliconeMl).toFixed(0)}ml of silicone to fill them.`;

    setChoosing({
      title: warnings.length ? "Worth checking before you print" : "Two halves to print",
      subtitle: warnings.length
        ? `${warnings.map((finding) => finding.detail).join("\n\n")}\n\n${summary}`
        : summary,
      choices: [
        {
          value: 0,
          label: "Export the half with the drawing",
          detail: "The domes carry the picture. Print this one first.",
        },
        {
          value: 1,
          label: "Export the smooth half",
          detail: "The back of the ball, with the pour holes and the key hollows.",
        },
      ],
      onPick: (value) => {
        const half = value === 0 ? mold.designed : mold.plain;
        void shareMoldHalf(half, value === 0 ? "designed" : "smooth");
      },
    });
  }

  async function shareMoldHalf(half: { mesh: Parameters<typeof encodeStl>[0] }, which: string) {
    if (!project) return;
    setBusy(true);
    try {
      const bytes = encodeStl(half.mesh, `${project.title} mold ${which}`);
      const name = project.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "mold";
      await shareDataUrl(`data:model/stl;base64,${toBase64(bytes)}`, `${name}-mold-${which}.stl`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't share the mold half.");
    } finally {
      setBusy(false);
    }
  }

  async function shareCastingTray(tray: NonNullable<ReturnType<typeof trayFromDesign>>) {
    if (!project) return;
    setBusy(true);
    try {
      const bytes = encodeStl(tray.mesh, `${project.title} casting tray`);
      const name = project.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "tray";
      await shareDataUrl(`data:model/stl;base64,${toBase64(bytes)}`, `${name}-tray.stl`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't share the casting tray.");
    } finally {
      setBusy(false);
    }
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

  // The editor is where a keyboard helps most: undo is the single most-used
  // action in it, and on a laptop it currently needs a mouse trip to a toolbar
  // button every time.
  useShortcut(SHORTCUTS.undo, past.length && !busy ? undo : null);
  useShortcut(SHORTCUTS.redo, future.length && !busy ? redo : null);
  useShortcut(SHORTCUTS.close, immersive ? () => setImmersive(false) : confirmClose);

  /**
   * Full-screen drawing. Entering from a tool that has nothing to do with the
   * brush would hand over the whole screen and then offer no way to mark it,
   * so anything non-drawing lands on the brush.
   */
  function enterImmersive() {
    if (tool !== "draw" && tool !== "erase") setTool("draw");
    setImmersive(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
    if (!project || !currentSamples.length) return [];
    const nominal = brush / scale;
    const drawn = conditionStroke(currentSamples, nominal, pen);
    // The preview goes through the same renderer the commit will, so the
    // taper and pressure are visible while the pen is still down rather than
    // appearing only after it lifts.
    return replicateStroke(drawn, symmetry, project.canvas).map((points) =>
      renderStroke(points, nominal, scale)
    );
  }, [project, currentSamples, symmetry, scale, brush, pen]);

  // Node handles: the layer being dragged (draft) or the selected stroke
  // layer. Dense traces stay legible by capping how many handles render.
  const nodeLayer = tool === "nodes" && selected?.kind === "stroke" ? nodeDraft ?? selected : null;
  const nodeHandles = useMemo(() => {
    if (!nodeLayer) return [];
    const handles: { x: number; y: number }[] = [];
    for (const stroke of nodeLayer.strokes) {
      if (stroke.mode === "erase") continue;
      for (const point of stroke.points) {
        handles.push(layerToCanvas(nodeLayer, point));
        if (handles.length > 400) return handles;
      }
    }
    return handles;
  }, [nodeLayer]);

  const guides = useMemo(() => {
    if (!project || (tool !== "draw" && tool !== "erase")) return [];
    return symmetryGuides(symmetry, project.canvas);
  }, [project, symmetry, tool]);

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={confirmClose}>
      <GestureHandlerRootView style={styles.root}>
        <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
          {!immersive && (
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
          )}

          <View style={[styles.workspace, immersive ? styles.workspaceImmersive : (brand.id === "ink" ? glow(theme, "sm") : lift("sm")), { backgroundColor: immersive ? theme.background : theme.surface, borderColor: immersive ? "transparent" : theme.line }]}>
            {!immersive && (
            <View style={styles.workspaceMeta}>
              <View style={[styles.livePill, { backgroundColor: `${theme.accent}18` }]}>
                <View style={[styles.liveDot, { backgroundColor: theme.accent }]} />
                <Text style={[styles.liveText, { color: theme.accent, fontFamily: theme.fontBodyMedium }]}>{project?.canvas.width ?? "—"} × {project?.canvas.height ?? "—"} PX</Text>
              </View>
              <Pressable onPress={() => setShowOriginal((value) => !value)} disabled={!originalPreview} style={[styles.compare, { borderColor: theme.line }]}>
                <Icon name="layers" size={TYPE.caption.fontSize} color={theme.muted} />
                <Text style={[TYPE.micro, { color: theme.muted, fontFamily: theme.fontBodyMedium }]}>{showOriginal ? "EDITED" : "ORIGINAL"}</Text>
              </Pressable>
              {tool === "tone" && !!study && !showOriginal && (
                <View style={[styles.livePill, { backgroundColor: `${theme.accent}18` }]}>
                  <Icon name="contrast" size={TYPE.caption.fontSize} color={theme.accent} />
                  <Text style={[styles.liveText, { color: theme.accent, fontFamily: theme.fontBodyMedium }]}>VALUE STUDY</Text>
                </View>
              )}
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
              <Pressable
                onPress={enterImmersive}
                accessibilityRole="button"
                accessibilityLabel="Draw full screen"
                style={[styles.compare, { borderColor: theme.line }]}
              >
                <Icon name="expand" size={TYPE.caption.fontSize} color={theme.muted} />
                <Text style={[TYPE.micro, { color: theme.muted, fontFamily: theme.fontBodyMedium }]}>FULL SCREEN</Text>
              </Pressable>
            </View>
            )}

            <GestureDetector gesture={stageGesture}>
              <View style={[styles.stage, { width: stageW, height: stageH }]}>
                <PaperSubstrate
                  seed={project?.title.length ?? design.title.length}
                  intensity={0.5}
                  style={{ backgroundColor: project?.canvas.background ?? theme.stock }}
                />
                {(() => {
                  // The value study replaces the preview while the tone tool is
                  // open, because the only way to judge a separation is to look
                  // at it in place of the picture it came from.
                  const shown = showOriginal
                    ? originalPreview
                    : tool === "tone" && study
                      ? study.dataUrl
                      : healed ?? preview;
                  return shown ? (
                    <Image source={{ uri: shown }} style={StyleSheet.absoluteFill} contentFit="fill" alt={project?.title ?? design.title} />
                  ) : null;
                })()}
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
                {(!!guides.length || !!overlayPaths.length || !!nodeHandles.length) && (
                  <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width={stageW} height={stageH}>
                    {guides.map((guide, index) => (
                      <SvgLine key={`guide-${index}`} x1={guide.x1 * scale} y1={guide.y1 * scale} x2={guide.x2 * scale} y2={guide.y2 * scale} stroke={theme.accent} strokeWidth={StyleSheet.hairlineWidth * 2} strokeDasharray="6 6" opacity={0.5} />
                    ))}
                    {nodeHandles.map((handle, index) => (
                      <SvgCircle key={`node-${index}`} cx={handle.x * scale} cy={handle.y * scale} r={4.5} fill={theme.surface} stroke={theme.accent} strokeWidth={1.5} />
                    ))}
                    {overlayPaths.map((path, index) => {
                      const ink = tool === "erase" ? project?.canvas.background ?? "white" : brushColor;
                      return path.fill ? (
                        <SvgPath key={`stroke-${index}`} d={path.d} fill={ink} stroke="none" opacity={index ? 0.75 : 1} />
                      ) : (
                        <SvgPath key={`stroke-${index}`} d={path.d} fill="none" stroke={ink} strokeWidth={path.width} strokeLinecap="round" strokeLinejoin="round" opacity={index ? 0.75 : 1} />
                      );
                    })}
                  </Svg>
                )}
                {busy && <View style={[styles.loading, { backgroundColor: `${theme.background}aa` }]}><ActivityIndicator color={theme.accent} /><Text style={[TYPE.caption, { color: theme.foreground, fontFamily: theme.fontBodyMedium }]}>RENDERING FULL RESOLUTION</Text></View>}
              </View>
            </GestureDetector>
          </View>

          {error && !immersive && <Notice>{error}</Notice>}

          {immersive && (
            <ImmersiveBar
              theme={theme}
              tool={tool}
              onTool={setTool}
              brush={brush}
              onBrush={rememberBrush}
              pencilOnly={pencilOnly}
              onPencilOnly={setPencilOnly}
              stylusSeen={sawStylus}
              canUndo={!!past.length && !busy}
              canRedo={!!future.length && !busy}
              onUndo={undo}
              onRedo={redo}
              onExit={() => setImmersive(false)}
            />
          )}

          {!immersive && (
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
          )}

          {!immersive && (
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
              letteringText={letteringText}
              letteringStyleId={letteringStyleId}
              letteringCurve={letteringCurve}
              onLetteringText={setLetteringText}
              onLetteringStyle={setLetteringStyleId}
              onLetteringCurve={setLetteringCurve}
              onAddLettering={addLettering}
              onBrush={rememberBrush}
              onBrushColor={rememberBrushColor}
              pen={pen}
              onPen={rememberPen}
              plan={plan}
              study={study}
              onPlan={setPlan}
              onStudy={runToneStudy}
              onSeparate={applySeparation}
              pencilOnly={pencilOnly}
              onPencilOnly={setPencilOnly}
              stylusSeen={sawStylus}
              onThreshold={setThreshold}
              onLineWeight={setLineWeight}
              onProject={(label, next) => commit(label, next)}
              onTransform={transformSelected}
              onCrop={() => setCropping(true)}
              onProcess={addProcessedLayer}
              onRestore={(index) => project && commit("Restore snapshot", restoreSnapshot(project, index))}
              onExportSvg={exportSvg}
              onTrace={traceToVector}
              onCleanup={cleanUpStrokes}
              onLayDown={layDownWithTool}
              nodeMode={nodeMode}
              onNodeMode={setNodeMode}
              surfaceId={surfaceId}
              wrapWidthIn={wrapWidthIn}
              findings={findings}
              onSurface={setSurfaceId}
              onWrapWidth={setWrapWidthIn}
              onApplyWrap={applyWrap}
              onInspect={runProductionCheck}
              onCheckCoverup={brand.id === "sugar" ? undefined : checkCoverup}
              onCastingTray={brand.id === "sugar" ? exportCastingTray : undefined}
              healAge={healAge}
              onHealAge={runHealing}
              onCheckCapture={checkCapture}
              onShareReview={shareReviewPacket}
              onFlatten={flattenVisibleCopy}
              />
            </ScrollView>
          </GlassSurface>
          )}

          {!immersive && (
          <View style={styles.savebar}>
            <Button label="Save copy" icon="duplicate-outline" disabled={!project || !preview || busy} onPress={() => save(false)} style={{ flex: 1 }} />
            <Button label="Replace design" icon="checkmark" variant="primary" disabled={!project || !preview || busy} onPress={() => save(true)} style={{ flex: 1.25 }} />
          </View>
          )}
        </SafeAreaView>

        {cropping && project && preview && (
          <CropTool uri={preview} imageWidth={project.canvas.width} imageHeight={project.canvas.height} onApply={applyCrop} onClose={() => setCropping(false)} />
        )}

        {choosing && (
          <ChoicePrompt
            visible
            title={choosing.title}
            subtitle={choosing.subtitle}
            choices={choosing.choices}
            onPick={choosing.onPick}
            onClose={() => setChoosing(null)}
          />
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
  letteringText,
  letteringStyleId,
  letteringCurve,
  onLetteringText,
  onLetteringStyle,
  onLetteringCurve,
  onAddLettering,
  onBrush,
  onBrushColor,
  pen,
  onPen,
  plan,
  study,
  onPlan,
  onStudy,
  onSeparate,
  pencilOnly,
  onPencilOnly,
  stylusSeen,
  onThreshold,
  onLineWeight,
  onProject,
  onTransform,
  onCrop,
  onProcess,
  onRestore,
  onExportSvg,
  onTrace,
  onCleanup,
  onLayDown,
  nodeMode,
  onNodeMode,
  surfaceId,
  wrapWidthIn,
  findings,
  onSurface,
  onWrapWidth,
  onApplyWrap,
  onInspect,
  onCheckCoverup,
  onCastingTray,
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
  letteringText: string;
  letteringStyleId: LetteringStyleId;
  letteringCurve: number;
  onLetteringText: (value: string) => void;
  onLetteringStyle: (value: LetteringStyleId) => void;
  onLetteringCurve: (value: number) => void;
  onAddLettering: () => void;
  onBrush: (value: number) => void;
  onBrushColor: (value: string) => void;
  onThreshold: (value: number) => void;
  onLineWeight: (value: number) => void;
  pen: PenSettings;
  onPen: (patch: Partial<PenSettings>) => void;
  plan: SeparationPlan;
  study: ToneStudy | null;
  onPlan: (plan: SeparationPlan) => void;
  onStudy: (plan: SeparationPlan) => void;
  onSeparate: () => void;
  pencilOnly: boolean;
  onPencilOnly: (value: boolean) => void;
  stylusSeen: boolean;
  onProject: (label: string, project: EditableDesignProject) => void;
  onTransform: (patch: Partial<DesignLayer["transform"]>, label: string) => void;
  onCrop: () => void;
  onProcess: (kind: "stencil" | "cutline") => void;
  onRestore: (index: number) => void;
  onExportSvg: () => void;
  onTrace: () => void;
  onCleanup: () => void;
  onLayDown: () => void;
  nodeMode: "move" | "delete" | "insert";
  onNodeMode: (mode: "move" | "delete" | "insert") => void;
  surfaceId: string;
  wrapWidthIn: number;
  findings: ProductionFinding[];
  onSurface: (id: string) => void;
  onWrapWidth: (value: number) => void;
  onApplyWrap: (direction: "compensate" | "foreshorten") => void;
  onInspect: () => void;
  /** Absent for Sugar Haus: there is nothing underneath a cookie. */
  onCheckCoverup?: () => void;
  /** Ink Lab has no use for a mold. */
  onCastingTray?: () => void;
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
        <PenControls pen={pen} onPen={onPen} pencilOnly={pencilOnly} onPencilOnly={onPencilOnly} stylusSeen={stylusSeen} />
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

  if (tool === "nodes") {
    const editable = selected?.kind === "stroke" && !selected.locked;
    return (
      <PanelTitle icon="git-commit-outline" title="Node editor" subtitle={editable ? "Every trace, lettering pass, and stroke is points you can touch." : "Select an unlocked stroke layer to edit its points."}>
        {editable && (
          <>
            <View style={styles.segmentRow}>
              {(
                [
                  { id: "move" as const, label: "Move", icon: "move" as const },
                  { id: "delete" as const, label: "Delete", icon: "delete" as const },
                  { id: "insert" as const, label: "Insert", icon: "add" as const },
                ]
              ).map((item) => {
                const active = nodeMode === item.id;
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => { onNodeMode(item.id); Haptics.selectionAsync(); }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={[styles.symmetryChip, { backgroundColor: active ? theme.accent : theme.surfaceAlt, borderColor: active ? theme.accent : theme.line }]}
                  >
                    <Icon name={item.icon} size={15} color={active ? theme.accentText : theme.foreground} />
                    <Text style={{ color: active ? theme.accentText : theme.muted, fontFamily: theme.fontBodyMedium, fontSize: 10 }}>{item.label.toUpperCase()}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={{ color: theme.muted, fontFamily: theme.fontBody, fontSize: 10, lineHeight: 14, marginTop: SPACE.xs }}>
              {nodeMode === "move"
                ? "Drag a handle to reshape the line. One drag is one undo."
                : nodeMode === "delete"
                  ? "Tap a handle to remove it. A line down to two points deletes whole."
                  : "Tap between two handles to add a point on the segment."}
            </Text>
          </>
        )}
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
        <View style={styles.symmetryBlock}>
          <Text style={{ color: theme.muted, fontFamily: theme.fontBodyMedium, fontSize: 10, letterSpacing: 1 }}>LETTERING</Text>
          <TextInput
            value={letteringText}
            onChangeText={onLetteringText}
            placeholder="Name, date, or a line of script"
            placeholderTextColor={theme.muted}
            accessibilityLabel="Lettering text"
            style={[styles.textInput, { color: theme.foreground, backgroundColor: theme.surfaceAlt, borderColor: theme.line }]}
          />
          <View style={styles.segmentRow}>
            {LETTERING_STYLES.map((item) => {
              const active = item.id === letteringStyleId;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => { onLetteringStyle(item.id); Haptics.selectionAsync(); }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[styles.symmetryChip, { backgroundColor: active ? theme.accent : theme.surfaceAlt, borderColor: active ? theme.accent : theme.line }]}
                >
                  <Text style={{ color: active ? theme.accentText : theme.muted, fontFamily: theme.fontBodyMedium, fontSize: 10 }}>{item.label.toUpperCase()}</Text>
                </Pressable>
              );
            })}
          </View>
          <SliderRow
            label="Baseline curve"
            value={letteringCurve}
            min={-1}
            max={1}
            step={0.05}
            display={letteringCurve === 0 ? "Straight" : `${letteringCurve > 0 ? "Arch" : "Valley"} ${Math.round(Math.abs(letteringCurve) * 100)}%`}
            onChange={onLetteringCurve}
          />
          <Button label="Trace lettering to strokes" icon="text-outline" variant="primary" onPress={onAddLettering} disabled={!letteringText.trim()} />
          <Text style={{ color: theme.muted, fontFamily: theme.fontBody, fontSize: 10, lineHeight: 14 }}>
            Renders in the chosen face, then traces to editable vector strokes — scalable, node-editable, checked for line spacing at print size.
          </Text>
        </View>
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
          <MiniAction icon="sparkles-outline" label="Clean up" onPress={onCleanup} />
          <MiniAction icon="brush-outline" label="Lay down" onPress={onLayDown} />
          <MiniAction icon="ellipse-outline" label="Cut line" onPress={() => onProcess("cutline")} />
          <MiniAction icon="code-slash-outline" label="SVG" onPress={onExportSvg} />
          {onCastingTray && <MiniAction icon="cube-outline" label="Mold tray" onPress={onCastingTray} />}
        </View>
      </PanelTitle>
    );
  }

  if (tool === "crop") {
    return <PanelTitle icon="crop-outline" title="Crop the project" subtitle="The canvas changes, but source layers remain intact and movable."><Button label="Choose crop" icon="crop-outline" variant="primary" onPress={onCrop} /></PanelTitle>;
  }

  if (tool === "tone") {
    const inked = plan.passes.filter((pass) => pass.shading).length;
    return (
      <PanelTitle
        icon="contrast-outline"
        title="Value study"
        subtitle="Decide which greys become ink before any line exists. This is the step that separates a stencil from a filter."
      >
        <SliderRow
          label="Values"
          value={plan.bands}
          min={MIN_BANDS}
          max={MAX_BANDS}
          step={1}
          display={`${plan.bands}`}
          onChange={(value) => onPlan(resizePlan(plan, value))}
        />
        <View style={styles.segmentRow}>
          {(
            [
              { id: "balanced" as BandStrategy, label: "Balanced" },
              { id: "even" as BandStrategy, label: "Even" },
            ]
          ).map((item) => {
            const active = plan.strategy === item.id;
            return (
              <Pressable
                key={item.id}
                onPress={() => {
                  onPlan({ ...plan, strategy: item.id });
                  Haptics.selectionAsync();
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[styles.symmetryChip, { backgroundColor: active ? theme.accent : theme.surfaceAlt, borderColor: active ? theme.accent : theme.line }]}
              >
                <Text style={[TYPE.micro, { color: active ? theme.accentText : theme.muted, fontFamily: theme.fontBodyMedium }]}>
                  {item.label.toUpperCase()}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={[TYPE.caption, { color: theme.muted, fontFamily: theme.fontBody }]}>
          {plan.strategy === "balanced"
            ? "Each value holds about the same amount of the picture. Separates a photo shot in flat light, which even bands cannot."
            : "The 0–255 range split into equal slices. Right when the photo already uses its whole range."}
        </Text>

        {plan.passes.map((pass, band) => (
          <View key={band} style={styles.symmetryBlock}>
            <View style={styles.toneHeader}>
              <View
                style={[
                  styles.toneSwatch,
                  {
                    backgroundColor: `rgb(${study?.tones[band] ?? 255},${study?.tones[band] ?? 255},${study?.tones[band] ?? 255})`,
                    borderColor: theme.line,
                  },
                ]}
              />
              <Text style={[TYPE.caption, { flex: 1, color: theme.foreground, fontFamily: theme.fontBodyMedium }]}>
                {BAND_LABELS[band] ?? `Value ${band + 1}`}
              </Text>
              {!!study && (
                <Text style={[TYPE.micro, { color: theme.muted, fontFamily: theme.fontBody }]}>
                  {Math.round((study.coverage[band] ?? 0) * 100)}%
                </Text>
              )}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.segmentRow}>
              <Pressable
                onPress={() => onPlan(setPass(plan, band, null))}
                accessibilityRole="button"
                accessibilityState={{ selected: !pass.shading }}
                style={[styles.symmetryChip, { backgroundColor: !pass.shading ? theme.accent : theme.surfaceAlt, borderColor: !pass.shading ? theme.accent : theme.line }]}
              >
                <Text style={[TYPE.micro, { color: !pass.shading ? theme.accentText : theme.muted, fontFamily: theme.fontBodyMedium }]}>PAPER</Text>
              </Pressable>
              {SHADING_STYLES.map((item) => {
                const active = pass.shading?.style === item.id;
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => {
                      onPlan(setPass(plan, band, item.id));
                      Haptics.selectionAsync();
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={[styles.symmetryChip, { backgroundColor: active ? theme.accent : theme.surfaceAlt, borderColor: active ? theme.accent : theme.line }]}
                  >
                    <Text style={[TYPE.micro, { color: active ? theme.accentText : theme.muted, fontFamily: theme.fontBodyMedium }]}>
                      {item.label.toUpperCase()}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {!!pass.shading && (
              <>
                <Text style={[TYPE.micro, { color: theme.muted, fontFamily: theme.fontBody }]}>
                  {SHADING_STYLES.find((item) => item.id === pass.shading?.style)?.caption}
                </Text>
                <SliderRow
                  label="Density"
                  value={pass.shading.density}
                  min={0.05}
                  max={1}
                  step={0.05}
                  display={`${Math.round(pass.shading.density * 100)}%`}
                  onChange={(value) => onPlan(patchPass(plan, band, { density: value }))}
                />
                <SliderRow
                  label="Angle"
                  value={pass.shading.angle}
                  min={0}
                  max={180}
                  step={5}
                  display={`${Math.round(pass.shading.angle)}°`}
                  onChange={(value) => onPlan(patchPass(plan, band, { angle: value }))}
                />
                <SliderRow
                  label="Mark weight"
                  value={pass.shading.weight}
                  min={0.5}
                  max={8}
                  step={0.5}
                  display={`${pass.shading.weight} px`}
                  onChange={(value) => onPlan(patchPass(plan, band, { weight: value }))}
                />
              </>
            )}
          </View>
        ))}

        <Button label={study ? "Rebuild the study" : "Build the value study"} icon="contrast-outline" onPress={() => onStudy(plan)} />
        <Button
          label={`Shade ${inked} value${inked === 1 ? "" : "s"} into layers`}
          icon="layers-outline"
          variant="primary"
          disabled={!inked}
          onPress={onSeparate}
        />
        <Text style={[TYPE.caption, { color: theme.muted, fontFamily: theme.fontBody }]}>
          Each value becomes its own editable layer, darkest on top. Print the outline alone and keep the shading as reference, or transfer both.
        </Text>
      </PanelTitle>
    );
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
        {selected?.kind === "raster" && (
          <Button
            label={isUnderlay(selected) ? "Bring reference back to full strength" : "Use as tracing reference"}
            icon="layers-outline"
            onPress={() =>
              onProject(
                isUnderlay(selected) ? "Reference at full strength" : "Trace over reference",
                updateLayer(project, selected.id, (layer) =>
                  isUnderlay(layer)
                    ? { ...layer, opacity: 1, locked: false }
                    : // Dimmed so your own linework reads over it, and locked so
                      // a stray drag moves the drawing rather than the thing you
                      // are drawing from.
                      { ...layer, opacity: UNDERLAY_OPACITY, locked: true }
                )
              )
            }
          />
        )}
        <Button label="Flatten visible into new layer" icon="copy-outline" onPress={onFlatten} />
      </PanelTitle>
    );
  }

  if (tool === "production") {
    return (
      <PanelTitle icon="shield-checkmark-outline" title="Production desk" subtitle="Preflight, compensate for curved placement, compare a capture, and prepare a client proof.">
        <SurfaceControls
          surfaceId={surfaceId}
          widthIn={wrapWidthIn}
          onSurface={onSurface}
          onWidth={onWrapWidth}
          onApply={onApplyWrap}
        />
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
          <MiniAction icon="shield-checkmark-outline" label="Preflight" onPress={onInspect} />
          <MiniAction icon="camera-outline" label="Check photo" onPress={onCheckCapture} />
          {onCheckCoverup && <MiniAction icon="layers-outline" label="Cover-up" onPress={onCheckCoverup} />}
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

/**
 * The only chrome that survives full-screen mode.
 *
 * Deliberately small: the reason to go full screen is that the canvas was
 * competing with a tool dock, an inspector and a save bar for a phone-sized
 * screen. What is left is what you cannot draw without — which tool, how big,
 * whether a palm counts, and a way back.
 */
function ImmersiveBar({
  theme,
  tool,
  onTool,
  brush,
  onBrush,
  pencilOnly,
  onPencilOnly,
  stylusSeen,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onExit,
}: {
  theme: Theme;
  tool: EditorTool;
  onTool: (tool: EditorTool) => void;
  brush: number;
  onBrush: (value: number) => void;
  pencilOnly: boolean;
  onPencilOnly: (value: boolean) => void;
  stylusSeen: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onExit: () => void;
}) {
  return (
    <GlassSurface style={styles.immersiveBar}>
      <View style={styles.immersiveRow}>
        <Pressable
          onPress={onExit}
          accessibilityRole="button"
          accessibilityLabel="Leave full screen"
          style={[styles.immersiveButton, { backgroundColor: theme.surfaceAlt }]}
        >
          <Icon name="collapse" size={TYPE.body.fontSize + SPACE.xs / 2} color={theme.foreground} />
        </Pressable>

        {(["draw", "erase"] as const).map((id) => {
          const active = tool === id;
          return (
            <Pressable
              key={id}
              onPress={() => {
                onTool(id);
                Haptics.selectionAsync();
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={id === "draw" ? "Draw" : "Mask"}
              style={[styles.immersiveButton, { backgroundColor: active ? theme.accent : theme.surfaceAlt }]}
            >
              <Icon
                name={id === "draw" ? "brush" : "mask"}
                size={TYPE.body.fontSize + SPACE.xs / 2}
                color={active ? theme.accentText : theme.foreground}
              />
            </Pressable>
          );
        })}

        {stylusSeen && (
          <Pressable
            onPress={() => {
              onPencilOnly(!pencilOnly);
              Haptics.selectionAsync();
            }}
            accessibilityRole="switch"
            accessibilityState={{ checked: pencilOnly }}
            accessibilityLabel="Pencil only"
            style={[styles.immersiveButton, { backgroundColor: pencilOnly ? theme.accent : theme.surfaceAlt }]}
          >
            <Icon name="edit" size={TYPE.body.fontSize + SPACE.xs / 2} color={pencilOnly ? theme.accentText : theme.foreground} />
          </Pressable>
        )}

        <View style={{ flex: 1 }} />

        <Pressable
          onPress={onUndo}
          disabled={!canUndo}
          accessibilityRole="button"
          accessibilityLabel="Undo"
          style={[styles.immersiveButton, { backgroundColor: theme.surfaceAlt, opacity: canUndo ? 1 : 0.35 }]}
        >
          <Icon name="undo" size={TYPE.body.fontSize + SPACE.xs / 2} color={theme.foreground} />
        </Pressable>
        <Pressable
          onPress={onRedo}
          disabled={!canRedo}
          accessibilityRole="button"
          accessibilityLabel="Redo"
          style={[styles.immersiveButton, { backgroundColor: theme.surfaceAlt, opacity: canRedo ? 1 : 0.35 }]}
        >
          <Icon name="redo" size={TYPE.body.fontSize + SPACE.xs / 2} color={theme.foreground} />
        </Pressable>
      </View>

      <View style={styles.immersiveRow}>
        <Text style={[TYPE.micro, { color: theme.muted, fontFamily: theme.fontBodyMedium, width: 52 }]}>
          {Math.round(brush)}PX
        </Text>
        <Slider
          style={{ flex: 1 }}
          minimumValue={2}
          maximumValue={72}
          step={1}
          value={brush}
          onValueChange={onBrush}
          minimumTrackTintColor={theme.accent}
          maximumTrackTintColor={theme.line}
          thumbTintColor={theme.accent}
        />
      </View>
    </GlassSurface>
  );
}

/**
 * How the brush responds to the hand holding it.
 *
 * Stabilization is first because it is the one that changes the most for the
 * most people: a hand steady enough for paper is not steady enough for glass,
 * and this is the difference between shaky linework and confident linework.
 * The rest only do anything with a stylus, so they say so instead of appearing
 * broken to someone drawing with a finger.
 */
function PenControls({
  pen,
  onPen,
  pencilOnly,
  onPencilOnly,
  stylusSeen,
}: {
  pen: PenSettings;
  onPen: (patch: Partial<PenSettings>) => void;
  pencilOnly: boolean;
  onPencilOnly: (value: boolean) => void;
  stylusSeen: boolean;
}) {
  const { theme } = useBrand();
  return (
    <View style={styles.symmetryBlock}>
      <Text style={[TYPE.micro, { color: theme.muted, fontFamily: theme.fontBodyMedium }]}>PEN FEEL</Text>
      <SliderRow
        label="Steady hand"
        value={pen.stabilization}
        min={0}
        max={1}
        step={0.05}
        display={pen.stabilization < 0.05 ? "Off" : `${Math.round(pen.stabilization * 100)}%`}
        onChange={(value) => onPen({ stabilization: value })}
      />
      <SliderRow
        label="Pressure"
        value={pen.pressure ? pen.pressureDepth : 0}
        min={0}
        max={1}
        step={0.05}
        display={pen.pressure && pen.pressureDepth > 0 ? `${Math.round(pen.pressureDepth * 100)}%` : "Off"}
        onChange={(value) => onPen({ pressure: value > 0, pressureDepth: value })}
      />
      <SliderRow
        label="Tilt shading"
        value={pen.tiltGain}
        min={0}
        max={1.5}
        step={0.05}
        display={pen.tiltGain < 0.05 ? "Off" : `${Math.round(pen.tiltGain * 100)}%`}
        onChange={(value) => onPen({ tiltGain: value })}
      />
      <SliderRow
        label="Speed taper"
        value={pen.velocityTaper}
        min={0}
        max={1}
        step={0.05}
        display={pen.velocityTaper < 0.05 ? "Off" : `${Math.round(pen.velocityTaper * 100)}%`}
        onChange={(value) => onPen({ velocityTaper: value })}
      />
      <SliderRow
        label="End taper"
        value={pen.taperLength}
        min={0}
        max={60}
        step={1}
        display={pen.taperLength < 1 ? "Off" : `${Math.round(pen.taperLength)} px`}
        onChange={(value) => onPen({ taperLength: value })}
      />
      {stylusSeen && (
        <Pressable
          onPress={() => {
            onPencilOnly(!pencilOnly);
            Haptics.selectionAsync();
          }}
          accessibilityRole="switch"
          accessibilityState={{ checked: pencilOnly }}
          style={[styles.symmetryChip, { alignSelf: "flex-start", backgroundColor: pencilOnly ? theme.accent : theme.surfaceAlt, borderColor: pencilOnly ? theme.accent : theme.line }]}
        >
          <Text style={[TYPE.micro, { color: pencilOnly ? theme.accentText : theme.muted, fontFamily: theme.fontBodyMedium }]}>
            PENCIL ONLY
          </Text>
        </Pressable>
      )}
      <Text style={[TYPE.caption, { color: theme.muted, fontFamily: theme.fontBody }]}>
        {!stylusSeen
          ? "Steadying and taper work with a finger. Pressure and tilt need a stylus — Apple Pencil is iPad-only, so on a phone those two sit idle."
          : pencilOnly
            ? "Fingers pan and pinch; only the Pencil leaves a mark, so you can rest your hand on the glass."
            : "Pressure and tilt are live. Turn on Pencil only to rest your hand on the glass."}
      </Text>
    </View>
  );
}

/**
 * What the artwork is going onto, and how big it will read once it is there.
 *
 * Both numbers are real measurements — the circumference of the thing and the
 * width the piece should appear — rather than an abstract "curvature" that
 * cannot be checked against a tape measure. The correction follows from them.
 */
function SurfaceControls({
  surfaceId,
  widthIn,
  onSurface,
  onWidth,
  onApply,
}: {
  surfaceId: string;
  widthIn: number;
  onSurface: (id: string) => void;
  onWidth: (value: number) => void;
  onApply: (direction: "compensate" | "foreshorten") => void;
}) {
  const { brand, theme } = useBrand();
  const surfaces = surfacesFor(brand.id);
  const surface = findSurface(surfaceId) ?? surfaces[0];
  const curved = surface.kind !== "flat";
  const limit = maxApparentWidthIn(surface);
  const overSized = curved && widthIn > limit;
  const scale = printScale(surface, widthIn);

  return (
    <View style={styles.symmetryBlock}>
      <Text style={[TYPE.micro, { color: theme.muted, fontFamily: theme.fontBodyMedium }]}>GOING ONTO</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.segmentRow}>
        {surfaces.map((item) => {
          const active = item.id === surface.id;
          return (
            <Pressable
              key={item.id}
              onPress={() => {
                onSurface(item.id);
                Haptics.selectionAsync();
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[styles.symmetryChip, { backgroundColor: active ? theme.accent : theme.surfaceAlt, borderColor: active ? theme.accent : theme.line }]}
            >
              <Text style={[TYPE.micro, { color: active ? theme.accentText : theme.muted, fontFamily: theme.fontBodyMedium }]}>
                {item.label.toUpperCase()}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <Text style={[TYPE.caption, { color: theme.muted, fontFamily: theme.fontBody }]}>{surface.caption}</Text>

      {curved && (
        <>
          <SliderRow
            label="Reads as"
            value={widthIn}
            min={0.5}
            max={8}
            step={0.25}
            display={`${widthIn.toFixed(2)} in wide`}
            onChange={onWidth}
          />
          <Text style={[TYPE.caption, { color: overSized ? theme.accent : theme.muted, fontFamily: theme.fontBody }]}>
            {overSized
              ? `${widthIn.toFixed(2)}in is more curve than one flat piece can cover on a ${surface.label.toLowerCase()}. It will be fitted to ${limit.toFixed(2)}in — split it into pieces if you need it bigger.`
              : `Print it ${(widthIn * scale).toFixed(2)}in wide (${Math.round((scale - 1) * 100)}% wider) and it will read as ${widthIn.toFixed(2)}in once it is on.`}
          </Text>
          {surface.kind === "sphere" && (
            <Text style={[TYPE.caption, { color: theme.muted, fontFamily: theme.fontBody }]}>
              A ball cannot be wrapped by flat paper without some distortion. This is the best single piece: true at the centre, approximate at the edge.
            </Text>
          )}
          <View style={styles.actionRow}>
            <MiniAction icon="body-outline" label="Compensate" onPress={() => onApply("compensate")} />
            <MiniAction icon="eye-outline" label="Proof it" onPress={() => onApply("foreshorten")} />
          </View>
        </>
      )}
    </View>
  );
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
  // Full-bleed: the point of full screen is that nothing frames the canvas.
  workspaceImmersive: { flex: 1, justifyContent: "center", borderWidth: 0, padding: 0 },
  workspaceMeta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: SPACE.xs, marginBottom: SPACE.xs },
  immersiveBar: { position: "absolute", left: SPACE.sm, right: SPACE.sm, bottom: SPACE.sm, borderRadius: RADIUS.lg, padding: SPACE.sm, gap: SPACE.xs },
  immersiveRow: { flexDirection: "row", alignItems: "center", gap: SPACE.xs },
  toneHeader: { flexDirection: "row", alignItems: "center", gap: SPACE.xs },
  toneSwatch: { width: 20, height: 20, borderRadius: RADIUS.sm, borderWidth: 1 },
  immersiveButton: { width: 42, height: 42, borderRadius: RADIUS.pill, alignItems: "center", justifyContent: "center" },
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
