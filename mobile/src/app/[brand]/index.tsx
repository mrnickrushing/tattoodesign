import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { useBrand } from "@/context/BrandContext";
import { generateDesign, checkGeneratorAvailable } from "@/lib/api";
import { stencilize } from "@/lib/stencil";
import { addToLibrary } from "@/lib/designLibrary";
import { saveDataUrlToPhotos } from "@/lib/files";

export default function GenerateScreen() {
  const { brand, theme } = useBrand();
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState(brand.generate.styles[0]?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disabledReason, setDisabledReason] = useState<string | null>(null);
  const [rawUrl, setRawUrl] = useState<string | null>(null);
  const [stencilUrl, setStencilUrl] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    checkGeneratorAvailable().then(setDisabledReason);
  }, []);

  async function handleGenerate() {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError(null);
    setSaved(false);
    const result = await generateDesign(brand.id, prompt, style);
    if (!result.ok) {
      if (result.disabled) setDisabledReason(result.error);
      else setError(result.error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setLoading(false);
      return;
    }
    setRawUrl(result.dataUrl);
    try {
      const stencil = await stencilize(result.dataUrl, {
        threshold: 70,
        lineWeight: 1,
        denoise: 1,
      });
      setStencilUrl(stencil);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setError("Generated, but couldn't clean it up into a stencil.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!stencilUrl) return;
    try {
      await saveDataUrlToPhotos(stencilUrl, `design-${Date.now()}.png`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Saved", "Added to your Photos.");
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Couldn't save", e instanceof Error ? e.message : "Try again.");
    }
  }

  async function handleSend() {
    if (!stencilUrl) return;
    await addToLibrary(brand.id, {
      dataUrl: stencilUrl,
      title: prompt.slice(0, 40) || "Generated design",
      source: "generated",
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSaved(true);
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: theme.foreground, fontFamily: theme.fontDisplay }]}
        >
          {brand.generate.title}
        </Text>
        <Text style={[styles.subtitle, { color: theme.muted, fontFamily: theme.fontBody }]}>
          {brand.generate.subtitle}
        </Text>

        {disabledReason && (
          <View
            accessibilityRole="alert"
            style={[styles.banner, { borderColor: theme.danger }]}
          >
            <Text style={{ color: theme.danger, fontFamily: theme.fontBody, fontSize: 13 }}>
              {disabledReason}
            </Text>
          </View>
        )}

        <View style={styles.previewRow}>
          <ImagePane label="Raw" uri={rawUrl} loading={loading} theme={theme} />
          <ImagePane label="Stencil" uri={stencilUrl} loading={loading} theme={theme} />
        </View>

        <Text style={[styles.label, { color: theme.foreground, fontFamily: theme.fontBodyMedium }]}>
          Prompt
        </Text>
        <TextInput
          value={prompt}
          onChangeText={setPrompt}
          placeholder={brand.generate.promptPlaceholder}
          placeholderTextColor={theme.muted}
          multiline
          accessibilityLabel="Prompt"
          accessibilityHint={brand.generate.promptPlaceholder}
          style={[
            styles.input,
            {
              backgroundColor: theme.paper,
              borderColor: theme.line,
              color: theme.foreground,
              fontFamily: theme.fontBody,
            },
          ]}
        />

        <Text
          style={[
            styles.label,
            { color: theme.foreground, fontFamily: theme.fontBodyMedium, marginTop: 16 },
          ]}
        >
          Style
        </Text>
        <View style={styles.chips} accessibilityRole="radiogroup">
          {brand.generate.styles.map((s) => {
            const active = s.id === style;
            return (
              <Pressable
                key={s.id}
                onPress={() => {
                  Haptics.selectionAsync();
                  setStyle(s.id);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={s.label}
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
                    fontSize: 13,
                  }}
                >
                  {s.label}
                </Text>
              </Pressable>
            );
          })}
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
          onPress={handleGenerate}
          disabled={!prompt.trim() || loading || !!disabledReason}
          accessibilityRole="button"
          accessibilityLabel="Generate"
          accessibilityState={{ disabled: !prompt.trim() || loading || !!disabledReason }}
          style={({ pressed }) => [
            styles.primaryButton,
            {
              backgroundColor: theme.accent,
              opacity: !prompt.trim() || loading || disabledReason ? 0.4 : pressed ? 0.85 : 1,
              transform: [{ scale: pressed ? 0.98 : 1 }],
            },
          ]}
        >
          {loading ? (
            <ActivityIndicator color={theme.accentText} />
          ) : (
            <Text style={{ color: theme.accentText, fontFamily: theme.fontBodyMedium }}>
              Generate
            </Text>
          )}
        </Pressable>

        <Pressable
          onPress={handleSave}
          disabled={!stencilUrl}
          accessibilityRole="button"
          accessibilityLabel="Save to Photos"
          accessibilityState={{ disabled: !stencilUrl }}
          style={({ pressed }) => [
            styles.secondaryButton,
            {
              borderColor: theme.line,
              opacity: !stencilUrl ? 0.4 : pressed ? 0.7 : 1,
              transform: [{ scale: pressed && stencilUrl ? 0.98 : 1 }],
            },
          ]}
        >
          <Text style={{ color: theme.foreground, fontFamily: theme.fontBodyMedium }}>
            Save to Photos
          </Text>
        </Pressable>

        <Pressable
          onPress={handleSend}
          disabled={!stencilUrl}
          accessibilityRole="button"
          accessibilityLabel={saved ? "Added to sheet" : "Send to Sheet Builder"}
          accessibilityState={{ disabled: !stencilUrl }}
          style={({ pressed }) => [
            styles.secondaryButton,
            {
              borderColor: theme.line,
              opacity: !stencilUrl ? 0.4 : pressed ? 0.7 : 1,
              transform: [{ scale: pressed && stencilUrl ? 0.98 : 1 }],
            },
          ]}
        >
          <Text style={{ color: theme.foreground, fontFamily: theme.fontBodyMedium }}>
            {saved ? "Added to Sheet ✓" : "Send to Sheet Builder"}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ImagePane({
  label,
  uri,
  loading,
  theme,
}: {
  label: string;
  uri: string | null;
  loading: boolean;
  theme: ReturnType<typeof useBrand>["theme"];
}) {
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={uri ? label : `${label}, empty`}
      style={[imgStyles.pane, { backgroundColor: "#fff", borderColor: theme.line }]}
    >
      {uri ? (
        <Image source={{ uri }} style={imgStyles.image} contentFit="contain" alt={label} />
      ) : (
        <Text style={{ color: "#00000055", fontSize: 12, textAlign: "center", padding: 12 }}>
          {loading ? "Generating…" : label}
        </Text>
      )}
      {loading && (
        <View style={imgStyles.overlay}>
          <ActivityIndicator color={theme.accent} />
        </View>
      )}
    </View>
  );
}

const imgStyles = StyleSheet.create({
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
});

const styles = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 60 },
  title: { fontSize: 30, marginBottom: 6 },
  subtitle: { fontSize: 14, lineHeight: 20, marginBottom: 16 },
  banner: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  previewRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
  label: { fontSize: 13, marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    minHeight: 80,
    textAlignVertical: "top",
    fontSize: 14,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 44,
    justifyContent: "center",
  },
  primaryButton: {
    marginTop: 20,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
    minHeight: 44,
    justifyContent: "center",
  },
  secondaryButton: {
    marginTop: 10,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    minHeight: 44,
    justifyContent: "center",
  },
});
