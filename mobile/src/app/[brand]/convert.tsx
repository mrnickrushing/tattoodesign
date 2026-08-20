import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  Alert,
  Pressable,
  type LayoutChangeEvent,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { pickImageFile } from "@/lib/imageImport";
import Slider from "@react-native-community/slider";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useBrand } from "@/context/BrandContext";
import {
  DEFAULT_STENCIL_OPTIONS,
  stencilMask,
  stencilize,
  type StencilMode,
  type StencilOptions,
} from "@/lib/stencil";
import { PREF_KEYS, preferences } from "@/lib/preferences";
import { BatchConvert } from "@/components/BatchConvert";
import { DEFAULT_TRACE, skeletonize, tracePolylines } from "@/lib/vectorize";
import type { Point } from "@/lib/designProject";
import {
  addToLibrary,
  replaceInLibrary,
  type LibraryDesign,
} from "@/lib/designLibrary";
import { saveDataUrlToPhotos } from "@/lib/files";
import { cropImage, isFullCrop, type CropRect } from "@/lib/crop";
import { CropMarks, StockPane } from "@/components/StockPane";
import { CropTool } from "@/components/CropTool";
import { DesignEditor } from "@/components/DesignEditor";
import { Button } from "@/components/Button";
import { PaperSubstrate } from "@/components/PaperSubstrate";
import { Skeleton } from "@/components/Skeleton";
import { StencilReveal } from "@/components/StencilReveal";
import { ScreenHeader, Notice, Card } from "@/components/ui";
import { RADIUS, SPACE, TYPE } from "@/lib/theme";
import { CONTENT_MAX_WIDTH, useContentBottomInset } from "@/lib/chrome";

type RevealTrace = { paths: Point[][]; width: number; height: number };

const REVEAL_MAX_DIMENSION = 280;
const REVEAL_MAX_PROCESSING_MS = 420;

/**
 * The stencil mask is already the production geometry. Trace a small version
 * solely for the entrance, then leave the raster result as the reliable view.
 */
async function traceConvertedStencil(
  source: string,
  options: StencilOptions,
): Promise<RevealTrace | null> {
  const startedAt = Date.now();
  try {
    const { mask, width, height } = await stencilMask(source, {
      ...options,
      maxDimension: REVEAL_MAX_DIMENSION,
    });
    const paths = tracePolylines(
      skeletonize(mask, width, height),
      width,
      height,
      {
        ...DEFAULT_TRACE,
        minPathLength: 4,
        simplifyTolerance: 1.35,
        maxPaths: 280,
      },
    );
    if (Date.now() - startedAt > REVEAL_MAX_PROCESSING_MS || paths.length === 0)
      return null;
    return { paths, width, height };
  } catch {
    return null;
  }
}

export default function ConvertScreen() {
  const { brand, theme } = useBrand();
  const bottomInset = useContentBottomInset();
  /** The photo as picked. Crops are always taken from this, so re-cropping
   *  never compounds — the second crop isn't a crop of the first. */
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [sourceSize, setSourceSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [cropped, setCropped] = useState<{
    uri: string;
    rect: CropRect;
  } | null>(null);
  const [cropping, setCropping] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultReveal, setResultReveal] = useState<RevealTrace | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [opts, setOpts] = useState<StencilOptions>(DEFAULT_STENCIL_OPTIONS);
  const [overlayOpacity, setOverlayOpacity] = useState(0);
  const pipelineSeq = useRef(0);
  const [editing, setEditing] = useState<LibraryDesign | null>(null);
  const [editingTarget, setEditingTarget] = useState<
    "source" | "result" | null
  >(null);
  const [sourceDesign, setSourceDesign] = useState<LibraryDesign | null>(null);
  const [batching, setBatching] = useState(false);
  const [resultDesign, setResultDesign] = useState<LibraryDesign | null>(null);

  // Trace settings persist per brand — dialing in the same threshold every
  // session was pure friction.
  useEffect(() => {
    let active = true;
    preferences
      .get<Partial<StencilOptions>>(brand.id, PREF_KEYS.convertOptions, {})
      .then((stored) => {
        if (active && stored && typeof stored === "object") {
          setOpts((current) => ({ ...current, ...stored }));
        }
      });
    return () => {
      active = false;
    };
  }, [brand.id]);

  const runPipeline = useCallback(
    async (src: string, options: StencilOptions, seq: number) => {
      setProcessing(true);
      setError(null);
      setResultReveal(null);
      try {
        const next = await stencilize(src, options);
        const reveal = await traceConvertedStencil(src, options);
        if (seq === pipelineSeq.current) {
          setResultUrl(next);
          setResultReveal(reveal);
        }
      } catch {
        if (seq === pipelineSeq.current)
          setError("Couldn't process that image. Try a different photo.");
      } finally {
        if (seq === pipelineSeq.current) setProcessing(false);
      }
    },
    [],
  );

  const workingSource = cropped?.uri ?? sourceUrl;
  useEffect(() => {
    if (!workingSource) return;
    const seq = ++pipelineSeq.current;
    const timer = setTimeout(() => runPipeline(workingSource, opts, seq), 180);
    return () => clearTimeout(timer);
  }, [workingSource, opts, runPipeline]);

  const updateOpts = useCallback(
    (patch: Partial<StencilOptions>) => {
      const next = { ...opts, ...patch };
      setOpts(next);
      setSaved(false);
      void preferences.set(brand.id, PREF_KEYS.convertOptions, next);
    },
    [opts, brand.id],
  );

  function finishBatch(added: number) {
    setBatching(false);
    if (added > 0) {
      Alert.alert(
        "Batch added",
        `${added} traced design${added === 1 ? "" : "s"} landed in the library under today's batch tag.`
      );
    }
  }

  async function pickImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        "Photo access needed",
        "Allow photo access to pick a reference image.",
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      base64: true,
      quality: 1,
    });
    if (result.canceled || !result.assets[0]?.base64) return;
    const asset = result.assets[0];
    const dataUrl = `data:image/jpeg;base64,${asset.base64}`;
    setSourceUrl(dataUrl);
    setSourceSize({ width: asset.width, height: asset.height });
    setCropped(null);
    setSaved(false);
    setSourceDesign(null);
    setResultDesign(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  async function pickFromFiles() {
    const file = await pickImageFile();
    if (!file) return;
    setSourceUrl(file.dataUrl);
    setSourceSize(null);
    setCropped(null);
    setSaved(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  async function applyCrop(rect: CropRect) {
    setCropping(false);
    if (!sourceUrl) return;
    if (isFullCrop(rect)) {
      // Nothing was trimmed — go back to the untouched photo rather than
      // spending a re-encode to produce a copy of it.
      setCropped(null);
      return;
    }
    setProcessing(true);
    try {
      const uri = await cropImage(sourceUrl, rect);
      setCropped({ uri, rect });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e) {
      setProcessing(false);
      Alert.alert(
        "Couldn't crop",
        e instanceof Error ? e.message : "Try again.",
      );
    }
  }

  async function handleSave() {
    if (!resultUrl) return;
    try {
      await saveDataUrlToPhotos(resultUrl, `line-art-${Date.now()}.png`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Saved", "Added to your Photos.");
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        "Couldn't save",
        e instanceof Error ? e.message : "Try again.",
      );
    }
  }

  async function handleSend() {
    if (!resultUrl) return;
    await addToLibrary(brand.id, {
      dataUrl: resultUrl,
      title: "Converted design",
      source: "converted",
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSaved(true);
  }

  async function openEditor(target: "source" | "result") {
    const dataUrl = target === "source" ? workingSource : resultUrl;
    if (!dataUrl) return;
    const existing = target === "source" ? sourceDesign : resultDesign;
    const design =
      existing ??
      (await addToLibrary(brand.id, {
        dataUrl,
        title: target === "source" ? "Conversion source" : "Converted design",
        source: "converted",
      }));
    if (target === "source") setSourceDesign(design);
    else setResultDesign(design);
    setEditingTarget(target);
    setEditing(design);
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset, maxWidth: CONTENT_MAX_WIDTH, width: "100%", alignSelf: "center" }]}
    >
      <ScreenHeader
        eyebrow={brand.convert.tabLabel}
        title={brand.convert.title}
        subtitle={brand.convert.subtitle}
      />

      <View style={styles.panes}>
        <StockPane
          index={1}
          label={cropped ? "Cropped" : "Source"}
          uri={cropped?.uri ?? sourceUrl}
          emptyIcon="image-outline"
          emptyHint="Tap to pick a photo"
          onPressEmpty={pickImage}
        />
        {processing ? (
          <BenchWaitingPane label="Tracing clean linework" />
        ) : (
          <RevealedResultPane
            key={resultUrl ?? "empty"}
            uri={resultUrl}
            sourceUri={workingSource}
            overlayOpacity={overlayOpacity}
            reveal={resultReveal}
            replayKey={resultUrl ?? "empty"}
          />
        )}
      </View>

      <View style={styles.photoActions}>
        <Button
          label={sourceUrl ? "Change photo" : "Choose photo"}
          icon="image-outline"
          onPress={pickImage}
          style={{ flex: 1 }}
        />
        <Button
          label="Open Files"
          icon="folder-open-outline"
          onPress={pickFromFiles}
          style={{ flex: 1 }}
        />
        <Button
          label="Batch"
          icon="albums-outline"
          onPress={() => setBatching(true)}
          style={{ flex: 1 }}
        />
        <Button
          label={cropped ? "Re-crop" : "Crop"}
          icon="crop-outline"
          onPress={() => setCropping(true)}
          disabled={!sourceUrl || !sourceSize}
          style={{ flex: 1 }}
        />
      </View>

      <Card>
        <Text
          style={[
            styles.field,
            { color: theme.muted, fontFamily: theme.fontBodyMedium },
          ]}
        >
          STENCIL ENGINE
        </Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.engineRow}
        >
          {ENGINE_OPTIONS.map((engine) => (
            <EngineButton
              key={engine.id}
              engine={engine}
              active={(opts.mode ?? "outline") === engine.id}
              onPress={() => updateOpts({ mode: engine.id })}
            />
          ))}
        </ScrollView>

        <View style={[styles.divider, { backgroundColor: theme.line }]} />
        <View style={styles.lineHeader}>
          <View>
            <Text
              style={{
                ...TYPE.body,
                color: theme.foreground,
                fontFamily: theme.fontBodyMedium,
              }}
            >
              Pro line weight
            </Text>
            <Text
              style={{
                ...TYPE.caption,
                color: theme.muted,
                fontFamily: theme.fontBody,
              }}
            >
              Tune transfer lines for the needle grouping and printer.
            </Text>
          </View>
          <Pressable
            onPress={() => setOpts(DEFAULT_STENCIL_OPTIONS)}
            accessibilityRole="button"
          >
            <Text
              style={{
                ...TYPE.caption,
                color: theme.accent,
                fontFamily: theme.fontBodyMedium,
              }}
            >
              Reset
            </Text>
          </Pressable>
        </View>

        <View style={styles.presetRow}>
          {LINE_PRESETS.map((preset) => (
            <Pressable
              key={preset.label}
              onPress={() => updateOpts({ lineWeight: preset.value })}
              accessibilityRole="button"
              accessibilityState={{
                selected: Math.round(opts.lineWeight ?? 1) === preset.value,
              }}
              style={[
                styles.preset,
                {
                  borderColor:
                    Math.round(opts.lineWeight ?? 1) === preset.value
                      ? theme.accent
                      : theme.line,
                  backgroundColor:
                    Math.round(opts.lineWeight ?? 1) === preset.value
                      ? `${theme.accent}18`
                      : theme.surfaceAlt,
                },
              ]}
            >
              <View
                style={[
                  styles.lineSample,
                  {
                    height: preset.value + 1,
                    backgroundColor: theme.foreground,
                  },
                ]}
              />
              <Text
                style={{
                  ...TYPE.caption,
                  color: theme.foreground,
                  fontFamily: theme.fontBodyMedium,
                }}
              >
                {preset.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <SliderRow
          label="Detail"
          hint="Lower picks up more lines"
          icon="options-outline"
          value={opts.threshold ?? 60}
          min={10}
          max={180}
          onChange={(v) => updateOpts({ threshold: v })}
        />
        <SliderRow
          label="Line weight"
          hint={`${Math.round(opts.lineWeight ?? 1) + 1}px source line · printer proof adjusts for output DPI`}
          icon="brush-outline"
          value={opts.lineWeight ?? 1}
          min={0}
          max={4}
          onChange={(v) => updateOpts({ lineWeight: v })}
        />
        <SliderRow
          label="Smoothing"
          icon="water-outline"
          value={opts.denoise ?? 1}
          min={0}
          max={4}
          onChange={(v) => updateOpts({ denoise: v })}
        />

        <View style={[styles.switchRow, { borderTopColor: theme.line }]}>
          <View style={styles.switchLabel}>
            <Ionicons name="contrast-outline" size={15} color={theme.muted} />
            <Text
              style={{
                ...TYPE.body,
                color: theme.foreground,
                fontFamily: theme.fontBody,
              }}
            >
              Invert
            </Text>
          </View>
          <Switch
            value={!!opts.invert}
            onValueChange={(v) => {
              Haptics.selectionAsync();
              updateOpts({ invert: v });
            }}
            trackColor={{ true: theme.accent }}
            accessibilityLabel="Invert"
          />
        </View>

        <View style={[styles.switchRow, { borderTopColor: theme.line }]}>
          <View style={styles.switchCopy}>
            <View style={styles.switchLabel}>
              <Ionicons name="cut-outline" size={15} color={theme.muted} />
              <Text
                style={{
                  ...TYPE.body,
                  color: theme.foreground,
                  fontFamily: theme.fontBody,
                }}
              >
                Isolate background
              </Text>
            </View>
            <Text
              style={{
                ...TYPE.caption,
                color: theme.muted,
                fontFamily: theme.fontBody,
              }}
            >
              Removes flat paper and wall colors locally.
            </Text>
          </View>
          <Switch
            value={!!opts.isolateBackground}
            onValueChange={(value) => updateOpts({ isolateBackground: value })}
            trackColor={{ true: theme.accent }}
            accessibilityLabel="Isolate background"
          />
        </View>

        {!!workingSource && !!resultUrl && (
          <View style={[styles.overlayControl, { borderTopColor: theme.line }]}>
            <SliderRow
              label="Original overlay"
              hint={
                overlayOpacity === 0
                  ? "Slide to check registration against the source."
                  : `${Math.round(overlayOpacity * 100)}% original over stencil`
              }
              icon="layers-outline"
              value={overlayOpacity}
              min={0}
              max={1}
              step={0.05}
              displayValue={`${Math.round(overlayOpacity * 100)}%`}
              onChange={setOverlayOpacity}
            />
          </View>
        )}

        {error && (
          <View style={{ marginTop: SPACE.sm }}>
            <Notice>{error}</Notice>
          </View>
        )}
      </Card>

      <View style={styles.actions}>
        <Button
          label="Save to Photos"
          icon="download-outline"
          variant="primary"
          onPress={handleSave}
          disabled={!resultUrl}
          style={{ flex: 1 }}
        />
        <Button
          label={saved ? "On the sheet" : "Add to sheet"}
          icon={saved ? "checkmark" : "add"}
          onPress={handleSend}
          disabled={!resultUrl}
          style={{ flex: 1 }}
        />
        <Button
          label="Edit line art"
          icon="brush-outline"
          onPress={() => openEditor("result")}
          disabled={!resultUrl}
          style={{ flex: 0.8 }}
        />
      </View>
      <Button
        label="Edit source photograph"
        icon="color-wand-outline"
        onPress={() => openEditor("source")}
        disabled={!sourceUrl}
        style={{ marginTop: SPACE.sm }}
      />

      {cropping && sourceUrl && sourceSize && (
        <CropTool
          uri={sourceUrl}
          imageWidth={sourceSize.width}
          imageHeight={sourceSize.height}
          initialRect={cropped?.rect}
          onApply={applyCrop}
          onClose={() => setCropping(false)}
        />
      )}

      {editing && editingTarget && (
        <DesignEditor
          design={editing}
          onSave={async (dataUrl, replace) => {
            if (replace) {
              const updated = await replaceInLibrary(
                brand.id,
                editing.id,
                dataUrl,
              );
              if (!updated)
                throw new Error(
                  "That converted project is no longer available.",
                );
              if (editingTarget === "source") {
                setSourceUrl(dataUrl);
                setCropped(null);
                setSourceDesign(updated);
              } else {
                setResultUrl(dataUrl);
                setResultDesign(updated);
              }
              return { id: updated.id, title: updated.title };
            }
            const added = await addToLibrary(brand.id, {
              dataUrl,
              title: `${editing.title} (edited)`,
              source: "converted",
            });
            return { id: added.id, title: added.title };
          }}
          onClose={() => {
            setEditing(null);
            setEditingTarget(null);
          }}
        />
      )}
          {batching && (
        <BatchConvert
          options={opts}
          onDone={finishBatch}
          onClose={() => setBatching(false)}
        />
      )}
    </ScrollView>
  );
}

function SliderRow({
  label,
  hint,
  icon,
  value,
  min,
  max,
  step,
  displayValue,
  onChange,
}: {
  label: string;
  hint?: string;
  icon: keyof typeof Ionicons.glyphMap;
  value: number;
  min: number;
  max: number;
  step?: number;
  displayValue?: string;
  onChange: (v: number) => void;
}) {
  const { theme } = useBrand();
  return (
    <View style={{ marginBottom: SPACE.sm }}>
      <View style={styles.sliderTop}>
        <View style={styles.sliderLabel}>
          <Ionicons name={icon} size={14} color={theme.muted} />
          <Text
            style={{
              ...TYPE.body,
              color: theme.foreground,
              fontFamily: theme.fontBody,
            }}
          >
            {label}
          </Text>
        </View>
        <Text
          style={{
            ...TYPE.body,
            color: theme.accent,
            fontFamily: theme.fontBodyMedium,
            fontVariant: ["tabular-nums"],
          }}
        >
          {displayValue ?? Math.round(value)}
        </Text>
      </View>
      <Slider
        minimumValue={min}
        maximumValue={max}
        step={step}
        value={value}
        onValueChange={onChange}
        onSlidingComplete={() => Haptics.selectionAsync()}
        minimumTrackTintColor={theme.accent}
        maximumTrackTintColor={theme.line}
        thumbTintColor={theme.accent}
        accessibilityLabel={label}
        accessibilityValue={{ min, max, now: Math.round(value) }}
      />
      {hint && (
        <Text style={{ ...TYPE.caption, color: theme.muted, marginTop: -2 }}>
          {hint}
        </Text>
      )}
    </View>
  );
}

const ENGINE_OPTIONS: {
  id: StencilMode;
  label: string;
  hint: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  {
    id: "outline",
    label: "Classic",
    hint: "Clean contour",
    icon: "git-branch-outline",
  },
  {
    id: "centerline",
    label: "Redraw",
    hint: "One line per line",
    icon: "brush-outline",
  },
  {
    id: "fine",
    label: "Fine line",
    hint: "Delicate detail",
    icon: "pencil-outline",
  },
  {
    id: "photocopy",
    label: "Copy",
    hint: "Solid transfer",
    icon: "copy-outline",
  },
  {
    id: "halftone",
    label: "Halftone",
    hint: "Dot shading",
    icon: "ellipsis-horizontal-circle-outline",
  },
  {
    id: "crosshatch",
    label: "Hatch",
    hint: "Tone guides",
    icon: "grid-outline",
  },
];

const LINE_PRESETS = [
  { label: "Fine", value: 0 },
  { label: "Standard", value: 1 },
  { label: "Bold", value: 2 },
  { label: "Heavy", value: 4 },
] as const;

function EngineButton({
  engine,
  active,
  onPress,
}: {
  engine: (typeof ENGINE_OPTIONS)[number];
  active: boolean;
  onPress: () => void;
}) {
  const { theme } = useBrand();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      style={[
        styles.engine,
        {
          borderColor: active ? theme.accent : theme.line,
          backgroundColor: active ? `${theme.accent}18` : theme.surfaceAlt,
        },
      ]}
    >
      <Ionicons
        name={engine.icon}
        size={18}
        color={active ? theme.accent : theme.muted}
      />
      <Text
        style={{
          ...TYPE.caption,
          color: theme.foreground,
          fontFamily: theme.fontBodyMedium,
        }}
      >
        {engine.label}
      </Text>
      <Text
        style={{
          ...TYPE.micro,
          color: theme.muted,
          fontFamily: theme.fontBody,
        }}
      >
        {engine.hint}
      </Text>
    </Pressable>
  );
}

function BenchWaitingPane({ label }: { label: string }) {
  const { theme } = useBrand();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      style={[
        styles.waitingPane,
        { backgroundColor: theme.stock, borderColor: theme.line },
      ]}
    >
      <PaperSubstrate seed={12} />
      <CropMarks color={theme.stockMark} />
      <View style={styles.waitingContent}>
        <Skeleton width="72%" height={SPACE.sm} radius={RADIUS.pill} />
        <Skeleton width="54%" height={SPACE.sm} radius={RADIUS.pill} />
        <Text
          style={[
            styles.waitingLabel,
            { color: theme.stockInk, fontFamily: theme.fontBodyMedium },
          ]}
        >
          {label}
        </Text>
      </View>
    </View>
  );
}

function RevealedResultPane({
  uri,
  sourceUri,
  overlayOpacity,
  reveal,
  replayKey,
}: {
  uri: string | null;
  sourceUri: string | null;
  overlayOpacity: number;
  reveal: RevealTrace | null;
  replayKey: string;
}) {
  const { theme } = useBrand();
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [done, setDone] = useState(false);

  const stage = useMemo(() => {
    if (!reveal || frame.width <= 0 || frame.height <= 0) return null;
    const scale = Math.min(
      frame.width / reveal.width,
      frame.height / reveal.height,
    );
    const width = reveal.width * scale;
    const height = reveal.height * scale;
    return {
      width,
      height,
      left: (frame.width - width) / 2,
      top: (frame.height - height) / 2,
      scale,
    };
  }, [frame.height, frame.width, reveal]);
  const scaledPaths = useMemo(
    () =>
      reveal && stage
        ? reveal.paths.map((path) =>
            path.map((point) => ({
              x: point.x * stage.scale,
              y: point.y * stage.scale,
            })),
          )
        : [],
    [reveal, stage],
  );
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setFrame((current) =>
      current.width === width && current.height === height
        ? current
        : { width, height },
    );
  };

  return (
    <View style={styles.revealPane} onLayout={onLayout}>
      <StockPane
        index={2}
        label="Line art"
        uri={uri}
        overlayUri={sourceUri}
        overlayOpacity={overlayOpacity}
        emptyIcon="git-branch-outline"
        emptyHint="Traced result"
      />
      {!!reveal && !!stage && !done && (
        <View
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={[styles.revealCover, { backgroundColor: theme.stock }]}
        >
          <PaperSubstrate seed={22} />
          <CropMarks color={theme.stockMark} />
          <View
            style={[
              styles.revealStage,
              {
                width: stage.width,
                height: stage.height,
                left: stage.left,
                top: stage.top,
              },
            ]}
          >
            <StencilReveal
              paths={scaledPaths}
              width={stage.width}
              height={stage.height}
              strokeWidth={Math.max(1, stage.scale * 1.4)}
              color={theme.stockInk}
              replayKey={replayKey}
              onDone={() => setDone(true)}
            />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: SPACE.md, paddingTop: SPACE.lg, paddingBottom: SPACE.xxl },
  panes: { flexDirection: "row", gap: SPACE.sm },
  waitingPane: {
    flex: 1,
    aspectRatio: 1,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  waitingContent: { width: "76%", alignItems: "center", gap: SPACE.sm },
  waitingLabel: { ...TYPE.caption, marginTop: SPACE.xs, textAlign: "center" },
  revealPane: { flex: 1, aspectRatio: 1 },
  revealCover: {
    ...StyleSheet.absoluteFill,
    overflow: "hidden",
    borderRadius: RADIUS.md,
  },
  revealStage: { position: "absolute" },
  photoActions: {
    flexDirection: "row",
    gap: SPACE.sm,
    marginTop: SPACE.lg,
    marginBottom: SPACE.sm,
  },
  field: { ...TYPE.micro, marginBottom: SPACE.sm },
  engineRow: { gap: 8, paddingBottom: 2 },
  engine: { width: 96, borderWidth: 1, borderRadius: 12, padding: 10, gap: 4 },
  divider: { height: 1, marginVertical: SPACE.md },
  lineHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: SPACE.sm,
  },
  presetRow: { flexDirection: "row", gap: 7, marginBottom: SPACE.sm },
  preset: {
    flex: 1,
    minHeight: 54,
    borderWidth: 1,
    borderRadius: 10,
    padding: 8,
    justifyContent: "flex-end",
    gap: 7,
  },
  lineSample: { width: "100%", borderRadius: 3 },
  sliderTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sliderLabel: { flexDirection: "row", alignItems: "center", gap: 7 },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    paddingTop: SPACE.sm,
    marginTop: 2,
  },
  switchLabel: { flexDirection: "row", alignItems: "center", gap: 7 },
  switchCopy: { flex: 1, gap: 3, paddingRight: SPACE.sm },
  overlayControl: {
    borderTopWidth: 1,
    paddingTop: SPACE.sm,
    marginTop: SPACE.sm,
  },
  actions: { flexDirection: "row", gap: SPACE.sm, marginTop: SPACE.sm },
});
