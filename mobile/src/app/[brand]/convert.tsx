import { useCallback, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Switch,
  Alert,
} from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import Slider from "@react-native-community/slider";
import * as Haptics from "expo-haptics";
import { useBrand } from "@/context/BrandContext";
import { DEFAULT_STENCIL_OPTIONS, stencilize, type StencilOptions } from "@/lib/stencil";
import { addToLibrary } from "@/lib/designLibrary";
import { saveDataUrlToPhotos } from "@/lib/files";

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
      const result = await stencilize(src, options);
      setResultUrl(result);
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
      <Text
        accessibilityRole="header"
        style={[styles.title, { color: theme.foreground, fontFamily: theme.fontDisplay }]}
      >
        {brand.convert.title}
      </Text>
      <Text style={[styles.subtitle, { color: theme.muted, fontFamily: theme.fontBody }]}>
        {brand.convert.subtitle}
      </Text>

      <View style={styles.previewRow}>
        <Pressable
          onPress={pickImage}
          accessibilityRole="button"
          accessibilityLabel={sourceUrl ? "Change reference photo" : "Choose a reference photo"}
          style={({ pressed }) => [
            styles.pane,
            { borderColor: theme.line, backgroundColor: theme.paper, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          {sourceUrl ? (
            <Image
              source={{ uri: sourceUrl }}
              style={styles.image}
              contentFit="contain"
              alt="Selected reference photo"
            />
          ) : (
            <Text style={{ color: theme.muted, fontSize: 12, textAlign: "center", padding: 12 }}>
              Tap to choose a photo
            </Text>
          )}
        </Pressable>

        <View
          accessibilityLabel={resultUrl ? "Converted line art" : "Result"}
          style={[styles.pane, { borderColor: theme.line, backgroundColor: "#fff" }]}
        >
          {resultUrl ? (
            <Image
              source={{ uri: resultUrl }}
              style={styles.image}
              contentFit="contain"
              alt="Converted line art"
            />
          ) : (
            <Text style={{ color: "#00000055", fontSize: 12, textAlign: "center", padding: 12 }}>
              {processing ? "Processing…" : "Result"}
            </Text>
          )}
          {processing && (
            <View style={styles.overlay}>
              <ActivityIndicator color={theme.accent} />
            </View>
          )}
        </View>
      </View>

      <SliderRow
        label="Sensitivity"
        hint="Lower = more detail picked up as lines"
        value={opts.threshold ?? 60}
        min={10}
        max={180}
        theme={theme}
        onChange={(v) => updateOpts({ threshold: v })}
      />
      <SliderRow
        label="Line weight"
        value={opts.lineWeight ?? 1}
        min={0}
        max={4}
        theme={theme}
        onChange={(v) => updateOpts({ lineWeight: v })}
      />
      <SliderRow
        label="Denoise"
        value={opts.denoise ?? 1}
        min={0}
        max={4}
        theme={theme}
        onChange={(v) => updateOpts({ denoise: v })}
      />

      <View style={styles.switchRow}>
        <Text style={{ color: theme.foreground, fontFamily: theme.fontBody }}>Invert</Text>
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
        <Text
          accessibilityRole="alert"
          style={{ color: theme.danger, marginTop: 12, fontFamily: theme.fontBody }}
        >
          {error}
        </Text>
      )}

      <Pressable
        onPress={handleSave}
        disabled={!resultUrl}
        accessibilityRole="button"
        accessibilityLabel="Save to Photos"
        accessibilityState={{ disabled: !resultUrl }}
        style={({ pressed }) => [
          styles.primaryButton,
          {
            backgroundColor: theme.accent,
            opacity: !resultUrl ? 0.4 : pressed ? 0.85 : 1,
            transform: [{ scale: pressed && resultUrl ? 0.98 : 1 }],
          },
        ]}
      >
        <Text style={{ color: theme.accentText, fontFamily: theme.fontBodyMedium }}>
          Save to Photos
        </Text>
      </Pressable>

      <Pressable
        onPress={handleSend}
        disabled={!resultUrl}
        accessibilityRole="button"
        accessibilityLabel={saved ? "Added to sheet" : "Send to Sheet Builder"}
        accessibilityState={{ disabled: !resultUrl }}
        style={({ pressed }) => [
          styles.secondaryButton,
          {
            borderColor: theme.line,
            opacity: !resultUrl ? 0.4 : pressed ? 0.7 : 1,
            transform: [{ scale: pressed && resultUrl ? 0.98 : 1 }],
          },
        ]}
      >
        <Text style={{ color: theme.foreground, fontFamily: theme.fontBodyMedium }}>
          {saved ? "Added to Sheet ✓" : "Send to Sheet Builder"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

function SliderRow({
  label,
  hint,
  value,
  min,
  max,
  theme,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  theme: ReturnType<typeof useBrand>["theme"];
  onChange: (v: number) => void;
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <View style={styles.sliderLabelRow}>
        <Text style={{ color: theme.foreground, fontFamily: theme.fontBody, fontSize: 13 }}>
          {label}
        </Text>
        <Text style={{ color: theme.muted, fontSize: 12 }}>{Math.round(value)}</Text>
      </View>
      <Slider
        minimumValue={min}
        maximumValue={max}
        value={value}
        onValueChange={onChange}
        onSlidingComplete={() => Haptics.selectionAsync()}
        minimumTrackTintColor={theme.accent}
        thumbTintColor={theme.accent}
        accessibilityLabel={label}
        accessibilityValue={{ min, max, now: Math.round(value) }}
      />
      {hint && (
        <Text style={{ color: theme.muted, fontSize: 11, marginTop: 2 }}>{hint}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 60 },
  title: { fontSize: 30, marginBottom: 6 },
  subtitle: { fontSize: 14, lineHeight: 20, marginBottom: 16 },
  previewRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
  pane: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  image: { width: "100%", height: "100%" },
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff99",
  },
  sliderLabelRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  primaryButton: { marginTop: 8, borderRadius: 999, paddingVertical: 14, alignItems: "center" },
  secondaryButton: {
    marginTop: 10,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
  },
});
