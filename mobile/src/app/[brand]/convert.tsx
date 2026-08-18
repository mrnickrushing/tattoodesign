import { useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, Switch, Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import Slider from "@react-native-community/slider";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useBrand } from "@/context/BrandContext";
import { DEFAULT_STENCIL_OPTIONS, stencilize, type StencilOptions } from "@/lib/stencil";
import { addToLibrary } from "@/lib/designLibrary";
import { saveDataUrlToPhotos } from "@/lib/files";
import { StockPane } from "@/components/StockPane";
import { Button } from "@/components/Button";
import { ScreenHeader, Notice, Card } from "@/components/ui";
import { SPACE } from "@/lib/theme";

export default function ConvertScreen() {
  const { brand, theme } = useBrand();
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [opts, setOpts] = useState<StencilOptions>(DEFAULT_STENCIL_OPTIONS);

  const runPipeline = useCallback(async (src: string, options: StencilOptions) => {
    setProcessing(true);
    setError(null);
    try {
      setResultUrl(await stencilize(src, options));
    } catch {
      setError("Couldn't process that image. Try a different photo.");
    } finally {
      setProcessing(false);
    }
  }, []);

  const updateOpts = useCallback(
    (patch: Partial<StencilOptions>) => {
      const next = { ...opts, ...patch };
      setOpts(next);
      if (sourceUrl) runPipeline(sourceUrl, next);
    },
    [opts, sourceUrl, runPipeline]
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
    const dataUrl = `data:image/jpeg;base64,${result.assets[0].base64}`;
    setSourceUrl(dataUrl);
    setSaved(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    runPipeline(dataUrl, opts);
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
        <Pressable onPress={pickImage} style={{ flex: 1 }} accessibilityRole="button"
          accessibilityLabel={sourceUrl ? "Change reference photo" : "Choose a reference photo"}>
          <StockPane
            index={1}
            label="Source"
            uri={sourceUrl}
            emptyIcon="image-outline"
            emptyHint="Tap to pick a photo"
          />
        </Pressable>
        <StockPane
          index={2}
          label="Line art"
          uri={resultUrl}
          loading={processing}
          loadingLabel="Tracing"
          emptyIcon="git-branch-outline"
          emptyHint="Traced result"
        />
      </View>

      <Card style={{ marginTop: SPACE.lg }}>
        <Text style={[styles.field, { color: theme.muted, fontFamily: theme.fontBodyMedium }]}>
          TRACE CONTROLS
        </Text>

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
  onChange,
}: {
  label: string;
  hint?: string;
  icon: keyof typeof Ionicons.glyphMap;
  value: number;
  min: number;
  max: number;
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
          {Math.round(value)}
        </Text>
      </View>
      <Slider
        minimumValue={min}
        maximumValue={max}
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

const styles = StyleSheet.create({
  scroll: { padding: SPACE.md, paddingTop: SPACE.lg, paddingBottom: SPACE.xxl },
  panes: { flexDirection: "row", gap: SPACE.sm },
  field: { fontSize: 10, letterSpacing: 1.5, marginBottom: SPACE.sm },
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
  actions: { flexDirection: "row", gap: SPACE.sm, marginTop: SPACE.sm },
});
