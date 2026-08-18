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
import * as Haptics from "expo-haptics";
import { useBrand } from "@/context/BrandContext";
import { generateDesign, checkGeneratorAvailable } from "@/lib/api";
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
  const [history, setHistory] = useState<PromptEntry[]>([]);

  useEffect(() => {
    checkGeneratorAvailable().then(setDisabledReason);
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
    const result = await generateDesign(brand.id, prompt, style);
    if (!result.ok) {
      if (result.disabled) setDisabledReason(result.error);
      else setError(result.error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setLoading(false);
      return;
    }
    setRawUrl(result.dataUrl);
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
