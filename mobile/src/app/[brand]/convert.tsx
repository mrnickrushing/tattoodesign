import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Switch, Alert, Pressable } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { pickImageFile } from "@/lib/imageImport";
import Slider from "@react-native-community/slider";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useBrand } from "@/context/BrandContext";
import { DEFAULT_STENCIL_OPTIONS, stencilize, type StencilMode, type StencilOptions } from "@/lib/stencil";
import { addToLibrary } from "@/lib/designLibrary";
import { saveDataUrlToPhotos } from "@/lib/files";
import { cropImage, isFullCrop, type CropRect } from "@/lib/crop";
import { StockPane } from "@/components/StockPane";
import { CropTool } from "@/components/CropTool";
import { Button } from "@/components/Button";
import { ScreenHeader, Notice, Card } from "@/components/ui";
import { SPACE } from "@/lib/theme";

export default function ConvertScreen() {
  const { brand, theme } = useBrand();
  /** The photo as picked. Crops are always taken from this, so re-cropping
   *  never compounds — the second crop isn't a crop of the first. */
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null);
  const [cropped, setCropped] = useState<{ uri: string; rect: CropRect } | null>(null);
  const [cropping, setCropping] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [opts, setOpts] = useState<StencilOptions>(DEFAULT_STENCIL_OPTIONS);
  const [overlayOpacity, setOverlayOpacity] = useState(0);
  const pipelineSeq = useRef(0);

  const runPipeline = useCallback(async (src: string, options: StencilOptions, seq: number) => {
    setProcessing(true);
    setError(null);
    try {
      const next = await stencilize(src, options);
      if (seq === pipelineSeq.current) setResultUrl(next);
    } catch {
      if (seq === pipelineSeq.current) setError("Couldn't process that image. Try a different photo.");
    } finally {
      if (seq === pipelineSeq.current) setProcessing(false);
    }
  }, []);

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
    },
    [opts]
  );

  async function pickImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Photo access needed", "Allow photo access to pick a reference image.");
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
      Alert.alert("Couldn't crop", e instanceof Error ? e.message : "Try again.");
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
      Alert.alert("Couldn't save", e instanceof Error ? e.message : "Try again.");
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

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.scroll}
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
        <StockPane
          index={2}
          label="Line art"
          uri={resultUrl}
          overlayUri={workingSource}
          overlayOpacity={overlayOpacity}
          loading={processing}
          loadingLabel="Tracing"
          emptyIcon="git-branch-outline"
          emptyHint="Traced result"
        />
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
          label={cropped ? "Re-crop" : "Crop"}
          icon="crop-outline"
          onPress={() => setCropping(true)}
          disabled={!sourceUrl || !sourceSize}
          style={{ flex: 1 }}
        />
      </View>

      <Card>
        <Text style={[styles.field, { color: theme.muted, fontFamily: theme.fontBodyMedium }]}>
          STENCIL ENGINE
        </Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.engineRow}>
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
            <Text style={{ color: theme.foreground, fontFamily: theme.fontBodyMedium, fontSize: 15 }}>Pro line weight</Text>
            <Text style={{ color: theme.muted, fontFamily: theme.fontBody, fontSize: 11 }}>Tune transfer lines for the needle grouping and printer.</Text>
          </View>
          <Pressable onPress={() => setOpts(DEFAULT_STENCIL_OPTIONS)} accessibilityRole="button">
            <Text style={{ color: theme.accent, fontFamily: theme.fontBodyMedium, fontSize: 12 }}>Reset</Text>
          </Pressable>
        </View>

        <View style={styles.presetRow}>
          {LINE_PRESETS.map((preset) => (
            <Pressable
              key={preset.label}
              onPress={() => updateOpts({ lineWeight: preset.value })}
              accessibilityRole="button"
              accessibilityState={{ selected: Math.round(opts.lineWeight ?? 1) === preset.value }}
              style={[
                styles.preset,
                {
                  borderColor: Math.round(opts.lineWeight ?? 1) === preset.value ? theme.accent : theme.line,
                  backgroundColor: Math.round(opts.lineWeight ?? 1) === preset.value ? `${theme.accent}18` : theme.surfaceAlt,
                },
              ]}
            >
              <View style={[styles.lineSample, { height: preset.value + 1, backgroundColor: theme.foreground }]} />
              <Text style={{ color: theme.foreground, fontFamily: theme.fontBodyMedium, fontSize: 11 }}>{preset.label}</Text>
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
            <Text style={{ color: theme.foreground, fontFamily: theme.fontBody, fontSize: 14 }}>
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
              <Text style={{ color: theme.foreground, fontFamily: theme.fontBody, fontSize: 14 }}>Isolate background</Text>
            </View>
            <Text style={{ color: theme.muted, fontFamily: theme.fontBody, fontSize: 10 }}>Removes flat paper and wall colors locally.</Text>
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
              hint={overlayOpacity === 0 ? "Slide to check registration against the source." : `${Math.round(overlayOpacity * 100)}% original over stencil`}
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
      </View>

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
        <Text style={{ color: theme.muted, fontSize: 11, marginTop: -2 }}>{hint}</Text>
      )}
    </View>
  );
}

const ENGINE_OPTIONS: { id: StencilMode; label: string; hint: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: "outline", label: "Classic", hint: "Clean contour", icon: "git-branch-outline" },
  { id: "fine", label: "Fine line", hint: "Delicate detail", icon: "pencil-outline" },
  { id: "photocopy", label: "Copy", hint: "Solid transfer", icon: "copy-outline" },
  { id: "halftone", label: "Halftone", hint: "Dot shading", icon: "ellipsis-horizontal-circle-outline" },
  { id: "crosshatch", label: "Hatch", hint: "Tone guides", icon: "grid-outline" },
];

const LINE_PRESETS = [
  { label: "Fine", value: 0 },
  { label: "Standard", value: 1 },
  { label: "Bold", value: 2 },
  { label: "Heavy", value: 4 },
] as const;

function EngineButton({ engine, active, onPress }: { engine: (typeof ENGINE_OPTIONS)[number]; active: boolean; onPress: () => void }) {
  const { theme } = useBrand();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      style={[styles.engine, { borderColor: active ? theme.accent : theme.line, backgroundColor: active ? `${theme.accent}18` : theme.surfaceAlt }]}
    >
      <Ionicons name={engine.icon} size={18} color={active ? theme.accent : theme.muted} />
      <Text style={{ color: theme.foreground, fontFamily: theme.fontBodyMedium, fontSize: 12 }}>{engine.label}</Text>
      <Text style={{ color: theme.muted, fontFamily: theme.fontBody, fontSize: 9 }}>{engine.hint}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: SPACE.md, paddingTop: SPACE.lg, paddingBottom: SPACE.xxl },
  panes: { flexDirection: "row", gap: SPACE.sm },
  photoActions: { flexDirection: "row", gap: SPACE.sm, marginTop: SPACE.lg, marginBottom: SPACE.sm },
  field: { fontSize: 10, letterSpacing: 1.5, marginBottom: SPACE.sm },
  engineRow: { gap: 8, paddingBottom: 2 },
  engine: { width: 96, borderWidth: 1, borderRadius: 12, padding: 10, gap: 4 },
  divider: { height: 1, marginVertical: SPACE.md },
  lineHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: SPACE.sm },
  presetRow: { flexDirection: "row", gap: 7, marginBottom: SPACE.sm },
  preset: { flex: 1, minHeight: 54, borderWidth: 1, borderRadius: 10, padding: 8, justifyContent: "flex-end", gap: 7 },
  lineSample: { width: "100%", borderRadius: 3 },
  sliderTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
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
  overlayControl: { borderTopWidth: 1, paddingTop: SPACE.sm, marginTop: SPACE.sm },
  actions: { flexDirection: "row", gap: SPACE.sm, marginTop: SPACE.sm },
});
