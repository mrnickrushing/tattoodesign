import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  Alert,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { useBrand } from "@/context/BrandContext";
import {
  generateDesign,
  checkGeneratorAvailable,
  getGeneratorStatus,
  IMAGE_PROVIDERS,
  type ImageProvider,
  type ImageQuality,
  type ProviderStatus,
  type ReferenceStrength,
} from "@/lib/api";
import { pickImageFile } from "@/lib/imageImport";
import { getGenerationUsage, getSpendLimit, recordGeneration, totalEstimatedSpend } from "@/lib/generationUsage";
import { stencilize } from "@/lib/stencil";
import { addToLibrary } from "@/lib/designLibrary";
import { saveDataUrlToPhotos } from "@/lib/files";
import {
  clearPrompts,
  forgetPrompt,
  getPrompts,
  rememberPrompt,
  type PromptEntry,
} from "@/lib/promptHistory";
import { StockPane } from "@/components/StockPane";
import { Button } from "@/components/Button";
import { ScreenHeader, Chip, Notice, Card, SectionLabel } from "@/components/ui";
import { RADIUS, SPACE } from "@/lib/theme";

const STYLE_ICONS: Record<string, "flash" | "remove" | "square" | "color-filter" | "brush"> = {
  traditional: "flash",
  fineline: "remove",
  blackwork: "square",
  irezumi: "color-filter",
  cookie: "flash",
  cakepop: "color-filter",
  topper: "square",
  piping: "brush",
};

const PROVIDER_ICONS: Record<ImageProvider, keyof typeof Ionicons.glyphMap> = {
  gemini: "diamond-outline",
  openai: "aperture-outline",
  claude: "color-wand-outline",
};

export default function GenerateScreen() {
  const { brand, theme } = useBrand();
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState(brand.generate.styles[0]?.id ?? "");
  const [provider, setProvider] = useState<ImageProvider>("gemini");
  const [quality, setQuality] = useState<ImageQuality>("standard");
  const [referenceStrength, setReferenceStrength] = useState<ReferenceStrength>("balanced");
  const [reference, setReference] = useState<{ dataUrl: string; data: string; mimeType: string; name: string } | null>(null);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus[]>([]);
  const [monthlySpend, setMonthlySpend] = useState(0);
  const [spendLimit, setSpendLimitState] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disabledReason, setDisabledReason] = useState<string | null>(null);
  const [rawUrl, setRawUrl] = useState<string | null>(null);
  const [stencilUrl, setStencilUrl] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [history, setHistory] = useState<PromptEntry[]>([]);

  useEffect(() => {
    let active = true;
    checkGeneratorAvailable(provider).then((reason) => {
      if (active) setDisabledReason(reason);
    });
    return () => {
      active = false;
    };
  }, [provider]);

  useEffect(() => {
    Promise.all([getGeneratorStatus(), getGenerationUsage(), getSpendLimit()]).then(([status, usage, limit]) => {
      setProviderStatus(status);
      setMonthlySpend(totalEstimatedSpend(usage));
      setSpendLimitState(limit);
    });
  }, []);

  useEffect(() => {
    let active = true;
    getPrompts(brand.id).then((entries) => {
      if (active) setHistory(entries);
    });
    return () => {
      active = false;
    };
  }, [brand.id]);

  function recall(entry: PromptEntry) {
    Haptics.selectionAsync();
    setPrompt(entry.prompt);
    // The style is half of what made the result, so it comes back too — but
    // only if it still exists for this brand.
    if (brand.generate.styles.some((s) => s.id === entry.style)) setStyle(entry.style);
  }

  function promptOptions(entry: PromptEntry) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(entry.prompt, undefined, [
      { text: "Use this prompt", onPress: () => recall(entry) },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => setHistory(await forgetPrompt(brand.id, entry.prompt)),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  function confirmClearHistory() {
    Alert.alert("Clear prompt history?", "The designs you already made are kept.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: async () => setHistory(await clearPrompts(brand.id)),
      },
    ]);
  }

  async function handleGenerate() {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError(null);
    setSaved(false);
    const estimate = providerStatus.find((entry) => entry.id === provider)?.estimates[quality] ?? 0;
    if (spendLimit > 0 && monthlySpend + estimate > spendLimit) {
      setError(`This generation would pass the $${spendLimit.toFixed(2)} monthly guard. Raise it in Settings first.`);
      setLoading(false);
      return;
    }
    const result = await generateDesign(brand.id, prompt, style, provider, {
      quality,
      reference: reference ? { data: reference.data, mimeType: reference.mimeType, strength: referenceStrength } : undefined,
    });
    if (!result.ok) {
      if (result.disabled) setDisabledReason(result.error);
      else setError(result.error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setLoading(false);
      return;
    }
    setRawUrl(result.dataUrl);
    const usage = await recordGeneration({ provider, quality, estimatedCost: estimate });
    setMonthlySpend(totalEstimatedSpend(usage));
    // Only prompts that actually produced something are worth keeping.
    setHistory(await rememberPrompt(brand.id, prompt, style));
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

  async function chooseReferenceFromPhotos() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return Alert.alert("Photo access needed", "Allow photo access to choose a reference.");
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], base64: true, quality: 0.8 });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset?.base64) return;
    const mimeType = asset.mimeType || "image/jpeg";
    setReference({ dataUrl: `data:${mimeType};base64,${asset.base64}`, data: asset.base64, mimeType, name: asset.fileName || "Photo reference" });
  }

  async function chooseReferenceFromFiles() {
    const file = await pickImageFile();
    if (!file) return;
    const data = file.dataUrl.slice(file.dataUrl.indexOf(",") + 1);
    setReference({ dataUrl: file.dataUrl, data, mimeType: file.mimeType, name: file.name });
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
    setSaved(true);
  }

  const canGenerate = !!prompt.trim() && !loading && !disabledReason;

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
        <ScreenHeader
          eyebrow={brand.generate.tabLabel}
          title={brand.generate.title}
          subtitle={brand.generate.subtitle}
        />

        {disabledReason && (
          <View style={{ marginBottom: SPACE.md }}>
            <Notice icon="cloud-offline-outline">{disabledReason}</Notice>
          </View>
        )}

        <View style={styles.panes}>
          <StockPane
            index={1}
            label="Raw"
            uri={rawUrl}
            loading={loading}
            loadingLabel="Drawing"
            emptyIcon="sparkles-outline"
            emptyHint="AI draft lands here"
          />
          <StockPane
            index={2}
            label="Stencil"
            uri={stencilUrl}
            loading={loading}
            loadingLabel="Cleaning"
            emptyIcon="git-branch-outline"
            emptyHint="Cleaned linework"
          />
        </View>

        <Card style={{ marginTop: SPACE.lg }}>
          <Text style={[styles.field, { color: theme.muted, fontFamily: theme.fontBodyMedium }]}>
            WHAT ARE WE MAKING
          </Text>
          <TextInput
            value={prompt}
            onChangeText={setPrompt}
            placeholder={brand.generate.promptPlaceholder}
            placeholderTextColor={theme.muted}
            multiline
            accessibilityLabel="Prompt"
            style={[
              styles.input,
              {
                backgroundColor: theme.surfaceAlt,
                borderColor: theme.line,
                color: theme.foreground,
                fontFamily: theme.fontBody,
              },
            ]}
          />

          <Text
            style={[
              styles.field,
              { color: theme.muted, fontFamily: theme.fontBodyMedium, marginTop: SPACE.md },
            ]}
          >
            IMAGE ENGINE
          </Text>
          <View style={styles.providers} accessibilityRole="radiogroup">
            {IMAGE_PROVIDERS.map((engine) => {
              const active = engine.id === provider;
              return (
                <Pressable
                  key={engine.id}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setDisabledReason(null);
                    setProvider(engine.id);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${engine.label}: ${engine.detail}`}
                  style={({ pressed }) => [
                    styles.provider,
                    {
                      borderColor: active ? theme.accent : theme.line,
                      backgroundColor: active ? `${theme.accent}14` : theme.surfaceAlt,
                      opacity: pressed ? 0.75 : 1,
                    },
                  ]}
                >
                  <View style={[styles.providerIcon, { backgroundColor: active ? theme.accent : theme.surface }]}> 
                    <Ionicons
                      name={PROVIDER_ICONS[engine.id]}
                      size={17}
                      color={active ? theme.accentText : theme.muted}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.foreground, fontFamily: theme.fontBodyMedium, fontSize: 13 }}>
                      {engine.label}
                    </Text>
                    <Text style={{ color: theme.muted, fontFamily: theme.fontBody, fontSize: 10, lineHeight: 14 }}>
                      {providerStatus.find((entry) => entry.id === engine.id)?.available === false
                        ? "Setup needed"
                        : `${providerStatus.find((entry) => entry.id === engine.id)?.speed ?? "Checking"} · ${engine.detail}`}
                    </Text>
                  </View>
                  <Ionicons
                    name={active ? "radio-button-on" : "radio-button-off"}
                    size={17}
                    color={active ? theme.accent : theme.muted}
                  />
                </Pressable>
              );
            })}
          </View>

          <View style={styles.controlSplit}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.field, { color: theme.muted, fontFamily: theme.fontBodyMedium }]}>QUALITY</Text>
              <View style={styles.compactChips} accessibilityRole="radiogroup">
                {(["draft", "standard", "best"] as ImageQuality[]).map((value) => (
                  <Chip key={value} label={value[0].toUpperCase() + value.slice(1)} active={quality === value} onPress={() => setQuality(value)} />
                ))}
              </View>
            </View>
            <View style={[styles.costTile, { backgroundColor: theme.surfaceAlt, borderColor: theme.line }]}>
              <Text style={{ color: theme.muted, fontFamily: theme.fontBody, fontSize: 10 }}>ESTIMATE</Text>
              <Text style={{ color: theme.accent, fontFamily: theme.fontDisplay, fontSize: 24 }}>
                ${(providerStatus.find((entry) => entry.id === provider)?.estimates[quality] ?? 0).toFixed(2)}
              </Text>
              <Text style={{ color: theme.muted, fontFamily: theme.fontBody, fontSize: 9 }}>${monthlySpend.toFixed(2)} this month</Text>
            </View>
          </View>

          <Text style={[styles.field, { color: theme.muted, fontFamily: theme.fontBodyMedium, marginTop: SPACE.md }]}>REFERENCE IMAGE · OPTIONAL</Text>
          {reference ? (
            <View style={[styles.referenceCard, { borderColor: theme.accent, backgroundColor: `${theme.accent}10` }]}>
              <Image source={{ uri: reference.dataUrl }} style={styles.referenceImage} contentFit="cover" />
              <View style={{ flex: 1, gap: 4 }}>
                <Text numberOfLines={1} style={{ color: theme.foreground, fontFamily: theme.fontBodyMedium, fontSize: 13 }}>{reference.name}</Text>
                <Text style={{ color: theme.muted, fontFamily: theme.fontBody, fontSize: 10 }}>Composition guide attached</Text>
              </View>
              <Pressable onPress={() => setReference(null)} accessibilityLabel="Remove reference"><Ionicons name="close-circle" size={24} color={theme.muted} /></Pressable>
            </View>
          ) : (
            <View style={styles.referenceActions}>
              <Button label="Choose photo" icon="images-outline" onPress={chooseReferenceFromPhotos} style={{ flex: 1 }} />
              <Button label="Open Files" icon="folder-open-outline" onPress={chooseReferenceFromFiles} style={{ flex: 1 }} />
            </View>
          )}
          {reference && (
            <View style={[styles.compactChips, { marginTop: SPACE.sm }]} accessibilityRole="radiogroup">
              {(["loose", "balanced", "faithful"] as ReferenceStrength[]).map((value) => (
                <Chip key={value} label={value[0].toUpperCase() + value.slice(1)} active={referenceStrength === value} onPress={() => setReferenceStrength(value)} />
              ))}
            </View>
          )}

          <Text
            style={[
              styles.field,
              { color: theme.muted, fontFamily: theme.fontBodyMedium, marginTop: SPACE.md },
            ]}
          >
            STYLE
          </Text>
          <View style={styles.chips} accessibilityRole="radiogroup">
            {brand.generate.styles.map((s) => (
              <Chip
                key={s.id}
                label={s.label}
                icon={STYLE_ICONS[s.id]}
                active={s.id === style}
                onPress={() => setStyle(s.id)}
              />
            ))}
          </View>

          {error && (
            <View style={{ marginTop: SPACE.md }}>
              <Notice>{error}</Notice>
            </View>
          )}

          <Button
            label={loading ? "Generating" : "Generate"}
            icon="sparkles"
            variant="primary"
            onPress={handleGenerate}
            disabled={!canGenerate}
            loading={loading}
            style={{ marginTop: SPACE.md }}
          />
        </Card>

        <View style={styles.actions}>
          <Button
            label="Save to Photos"
            icon="download-outline"
            onPress={handleSave}
            disabled={!stencilUrl}
            style={{ flex: 1 }}
          />
          <Button
            label={saved ? "On the sheet" : "Add to sheet"}
            icon={saved ? "checkmark" : "add"}
            onPress={handleSend}
            disabled={!stencilUrl}
            style={{ flex: 1 }}
          />
        </View>

        {history.length > 0 && (
          <View style={{ marginTop: SPACE.xl }}>
            <SectionLabel
              action={{ label: "Clear", icon: "trash-outline", onPress: confirmClearHistory }}
            >
              Recent prompts
            </SectionLabel>
            <View style={[styles.history, { borderColor: theme.line }]}>
              {history.map((entry, i) => {
                const styleLabel = brand.generate.styles.find((s) => s.id === entry.style)?.label;
                return (
                  <Pressable
                    key={entry.prompt}
                    onPress={() => recall(entry)}
                    onLongPress={() => promptOptions(entry)}
                    accessibilityRole="button"
                    accessibilityLabel={`Use prompt: ${entry.prompt}`}
                    accessibilityHint="Long press to remove it"
                    style={({ pressed }) => [
                      styles.historyRow,
                      i > 0 && { borderTopWidth: 1, borderTopColor: theme.line },
                      pressed && { backgroundColor: theme.surfaceAlt },
                    ]}
                  >
                    <View style={styles.historyText}>
                      <Text
                        numberOfLines={1}
                        style={{
                          color: theme.foreground,
                          fontFamily: theme.fontBody,
                          fontSize: 14,
                        }}
                      >
                        {entry.prompt}
                      </Text>
                      {styleLabel && (
                        <Text
                          style={{ color: theme.muted, fontFamily: theme.fontBody, fontSize: 11 }}
                        >
                          {styleLabel}
                        </Text>
                      )}
                    </View>
                    <Ionicons name="return-down-back-outline" size={16} color={theme.muted} />
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: SPACE.md, paddingTop: SPACE.lg, paddingBottom: SPACE.xxl },
  panes: { flexDirection: "row", gap: SPACE.sm },
  field: { fontSize: 10, letterSpacing: 1.5, marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: 12,
    minHeight: 84,
    textAlignVertical: "top",
    fontSize: 15,
    lineHeight: 21,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  providers: { gap: 8 },
  provider: {
    minHeight: 58,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  providerIcon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  controlSplit: { flexDirection: "row", alignItems: "flex-end", gap: SPACE.sm, marginTop: SPACE.md },
  compactChips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  costTile: { width: 104, borderWidth: 1, borderRadius: RADIUS.md, padding: 10 },
  referenceActions: { flexDirection: "row", gap: SPACE.sm },
  referenceCard: { minHeight: 72, borderWidth: 1, borderRadius: RADIUS.md, padding: 8, flexDirection: "row", alignItems: "center", gap: 10 },
  referenceImage: { width: 56, height: 56, borderRadius: RADIUS.sm },
  actions: { flexDirection: "row", gap: SPACE.sm, marginTop: SPACE.sm },
  history: { borderWidth: 1, borderRadius: RADIUS.md, overflow: "hidden" },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.sm,
    paddingHorizontal: 12,
    paddingVertical: 11,
    minHeight: 52,
  },
  historyText: { flex: 1, gap: 2 },
});
