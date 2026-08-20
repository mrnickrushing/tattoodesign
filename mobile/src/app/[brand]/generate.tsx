import { useEffect, useMemo, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { File } from "expo-file-system";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  Alert,
  Pressable,
  KeyboardAvoidingView,
  type LayoutChangeEvent,
  Platform,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { useBrand } from "@/context/BrandContext";
import { SHADING_VOCABULARY } from "@/lib/brands";
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
import { REMIX_VERBS, applyRemixVerb, hasRemixVerb, stripRemixVerbs } from "@/lib/remix";
import { getLibrary } from "@/lib/designLibrary";
import {
  getGenerationUsage,
  getSpendLimit,
  recordGeneration,
  totalEstimatedSpend,
} from "@/lib/generationUsage";
import { stencilMask, stencilize } from "@/lib/stencil";
import { DEFAULT_TRACE, skeletonize, tracePolylines } from "@/lib/vectorize";
import type { Point } from "@/lib/designProject";
import {
  addToLibrary,
  replaceInLibrary,
  type LibraryDesign,
} from "@/lib/designLibrary";
import { saveDataUrlToPhotos } from "@/lib/files";
import {
  clearPrompts,
  forgetPrompt,
  getPrompts,
  rememberPrompt,
  type PromptEntry,
} from "@/lib/promptHistory";
import { CropMarks, StockPane } from "@/components/StockPane";
import { DesignEditor } from "@/components/DesignEditor";
import { Button } from "@/components/Button";
import { PaperSubstrate } from "@/components/PaperSubstrate";
import { Skeleton } from "@/components/Skeleton";
import { StencilReveal } from "@/components/StencilReveal";
import {
  ScreenHeader,
  Chip,
  Notice,
  Card,
  SectionLabel,
} from "@/components/ui";
import { RADIUS, SPACE, TYPE } from "@/lib/theme";
import { useContentBottomInset, useContentWidth } from "@/lib/chrome";

const STYLE_ICONS: Record<
  string,
  "flash" | "remove" | "square" | "color-filter" | "brush"
> = {
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

type RevealTrace = { paths: Point[][]; width: number; height: number };

const REVEAL_MAX_DIMENSION = 280;
const REVEAL_MAX_PROCESSING_MS = 420;

/**
 * Trace a deliberately small copy of the generated stencil. A reveal may be
 * charming, but it must never make a finished design wait for a large bitmap.
 */
async function traceGeneratedStencil(
  source: string,
): Promise<RevealTrace | null> {
  const startedAt = Date.now();
  try {
    const { mask, width, height } = await stencilMask(source, {
      threshold: 70,
      lineWeight: 1,
      denoise: 1,
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
    // Dense imagery can still make a poor SVG. Keep the finished PNG as the
    // dependable result when tracing takes too long or finds no useful lines.
    if (Date.now() - startedAt > REVEAL_MAX_PROCESSING_MS || paths.length === 0)
      return null;
    return { paths, width, height };
  } catch {
    return null;
  }
}

export default function GenerateScreen() {
  const { brand, theme } = useBrand();
  const bottomInset = useContentBottomInset();
  const contentWidth = useContentWidth("canvas");
  const { remix: remixId } = useLocalSearchParams<{ remix?: string }>();
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState(brand.generate.styles[0]?.id ?? "");
  const [shading, setShading] = useState(SHADING_VOCABULARY[0].id);
  const [provider, setProvider] = useState<ImageProvider>("gemini");
  const [quality, setQuality] = useState<ImageQuality>("standard");
  const [referenceStrength, setReferenceStrength] =
    useState<ReferenceStrength>("balanced");
  const [reference, setReference] = useState<{
    dataUrl: string;
    data: string;
    mimeType: string;
    name: string;
  } | null>(null);
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
  const [editing, setEditing] = useState<LibraryDesign | null>(null);
  const [editingTarget, setEditingTarget] = useState<"raw" | "stencil" | null>(
    null,
  );
  const [rawDesign, setRawDesign] = useState<LibraryDesign | null>(null);
  const [stencilDesign, setStencilDesign] = useState<LibraryDesign | null>(
    null,
  );
  const [variationCount, setVariationCount] = useState<1 | 2 | 4>(1);
  const [variations, setVariations] = useState<
    { raw: string; stencil: string; reveal: RevealTrace | null }[]
  >([]);
  const [selectedVariation, setSelectedVariation] = useState(0);

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
    Promise.all([
      getGeneratorStatus(),
      getGenerationUsage(),
      getSpendLimit(),
    ]).then(([status, usage, limit]) => {
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
    if (brand.generate.styles.some((s) => s.id === entry.style))
      setStyle(entry.style);
  }

  function promptOptions(entry: PromptEntry) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(entry.prompt, undefined, [
      { text: "Use this prompt", onPress: () => recall(entry) },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () =>
          setHistory(await forgetPrompt(brand.id, entry.prompt)),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  function confirmClearHistory() {
    Alert.alert(
      "Clear prompt history?",
      "The designs you already made are kept.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => setHistory(await clearPrompts(brand.id)),
        },
      ],
    );
  }

  async function handleGenerate() {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError(null);
    setSaved(false);
    setRawDesign(null);
    setStencilDesign(null);
    const estimate =
      providerStatus.find((entry) => entry.id === provider)?.estimates[
        quality
      ] ?? 0;
    const estimatedBatch = estimate * variationCount;
    if (spendLimit > 0 && monthlySpend + estimatedBatch > spendLimit) {
      setError(
        `This generation would pass the $${spendLimit.toFixed(2)} monthly guard. Raise it in Settings first.`,
      );
      setLoading(false);
      return;
    }
    try {
      const batch: {
        raw: string;
        stencil: string;
        reveal: RevealTrace | null;
      }[] = [];
      let usage = await getGenerationUsage();
      for (let index = 0; index < variationCount; index++) {
        const variationPrompt =
          variationCount === 1
            ? prompt
            : `${prompt}\nVariation ${index + 1} of ${variationCount}: keep the brief, but explore a clearly distinct professional composition.`;
        const result = await generateDesign(
          brand.id,
          variationPrompt,
          style,
          provider,
          {
            quality,
            shading: brand.generate.offersShading ? shading : "none",
            reference: reference
              ? {
                  data: reference.data,
                  mimeType: reference.mimeType,
                  strength: referenceStrength,
                }
              : undefined,
          },
        );
        if (!result.ok) throw new Error(result.error);
        // A shaded render is not flat line art, and tracing it at the settings
        // tuned for flat line art finds every edge inside the shading too —
        // the stencil comes back as mush. Ask for less: a higher gradient
        // threshold keeps only the contours that hold the drawing together,
        // and more blur stops stipple and hatching registering as structure.
        const tonal = shading !== "none";
        const stencil = await stencilize(result.dataUrl, {
          threshold: tonal ? 110 : 70,
          lineWeight: 1,
          denoise: tonal ? 2 : 1,
        });
        batch.push({
          raw: result.dataUrl,
          stencil,
          reveal: await traceGeneratedStencil(result.dataUrl),
        });
        usage = await recordGeneration({
          provider,
          quality,
          estimatedCost: estimate,
        });
      }
      setVariations(batch);
      setSelectedVariation(0);
      setRawUrl(batch[0].raw);
      setStencilUrl(batch[0].stencil);
      setMonthlySpend(totalEstimatedSpend(usage));
      setHistory(await rememberPrompt(brand.id, prompt, style));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The variation board couldn't be completed.",
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!remixId) return;
    let active = true;
    (async () => {
      try {
        const design = (await getLibrary(brand.id)).find((item) => item.id === remixId);
        if (!design || !active) return;
        const data = await new File(design.uri).base64();
        if (!active) return;
        setReference({
          dataUrl: `data:image/png;base64,${data}`,
          data,
          mimeType: "image/png",
          name: design.title,
        });
        setReferenceStrength("balanced");
        if (!prompt.trim()) setPrompt(design.title);
        Haptics.selectionAsync();
      } catch {
        // The design may have been deleted since the link was made; the
        // screen still works as plain Generate.
      }
    })();
    return () => {
      active = false;
    };
    // Seeding depends only on which design was requested.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remixId, brand.id]);

  function clearReference() {
    setReference(null);
    // Verb lines direct a remix of the reference; without it they dangle.
    setPrompt((current) => stripRemixVerbs(current));
  }

  async function chooseReferenceFromPhotos() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted)
      return Alert.alert(
        "Photo access needed",
        "Allow photo access to choose a reference.",
      );
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      base64: true,
      quality: 0.8,
    });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset?.base64) return;
    const mimeType = asset.mimeType || "image/jpeg";
    setReference({
      dataUrl: `data:${mimeType};base64,${asset.base64}`,
      data: asset.base64,
      mimeType,
      name: asset.fileName || "Photo reference",
    });
  }

  async function chooseReferenceFromFiles() {
    const file = await pickImageFile();
    if (!file) return;
    const data = file.dataUrl.slice(file.dataUrl.indexOf(",") + 1);
    setReference({
      dataUrl: file.dataUrl,
      data,
      mimeType: file.mimeType,
      name: file.name,
    });
  }

  async function handleSave() {
    if (!stencilUrl) return;
    try {
      await saveDataUrlToPhotos(stencilUrl, `design-${Date.now()}.png`);
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
    if (!stencilUrl) return;
    await addToLibrary(brand.id, {
      dataUrl: stencilUrl,
      title: prompt.slice(0, 40) || "Generated design",
      source: "generated",
    });
    setSaved(true);
  }

  async function openEditor(target: "raw" | "stencil") {
    const dataUrl = target === "raw" ? rawUrl : stencilUrl;
    if (!dataUrl) return;
    const existing = target === "raw" ? rawDesign : stencilDesign;
    const design =
      existing ??
      (await addToLibrary(brand.id, {
        dataUrl,
        title: `${prompt.slice(0, 36) || "Generated design"}${target === "raw" ? " · original" : " · stencil"}`,
        source: "generated",
      }));
    if (target === "raw") setRawDesign(design);
    else setStencilDesign(design);
    setEditingTarget(target);
    setEditing(design);
  }

  const canGenerate = !!prompt.trim() && !loading && !disabledReason;

  function chooseVariation(index: number) {
    const choice = variations[index];
    if (!choice) return;
    setSelectedVariation(index);
    setRawUrl(choice.raw);
    setStencilUrl(choice.stencil);
    setRawDesign(null);
    setStencilDesign(null);
    setSaved(false);
    Haptics.selectionAsync();
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset, width: "100%", ...contentWidth }]}
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
          {loading ? (
            <BenchWaitingPane label="Drawing your concept" seed={1} />
          ) : (
            <StockPane
              index={1}
              label="Raw"
              uri={rawUrl}
              emptyIcon="sparkles-outline"
              emptyHint="AI draft lands here"
            />
          )}
          {loading ? (
            <BenchWaitingPane label="Preparing clean linework" seed={2} />
          ) : (
            <RevealedStencilPane
              key={`${selectedVariation}-${stencilUrl ?? "empty"}`}
              uri={stencilUrl}
              reveal={variations[selectedVariation]?.reveal ?? null}
              replayKey={`${selectedVariation}-${stencilUrl ?? "empty"}`}
            />
          )}
        </View>

        {variations.length > 1 && (
          <View style={{ marginTop: SPACE.md }}>
            <SectionLabel>Variation board</SectionLabel>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.variationRow}
            >
              {variations.map((variation, index) => (
                <Pressable
                  key={index}
                  onPress={() => chooseVariation(index)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: selectedVariation === index }}
                  style={[
                    styles.variationCard,
                    {
                      backgroundColor: theme.stock,
                      borderColor:
                        selectedVariation === index ? theme.accent : theme.line,
                    },
                  ]}
                >
                  <PaperSubstrate seed={index + 30} intensity={0.55} />
                  <CropMarks color={theme.stockMark} />
                  <Image
                    source={{ uri: variation.raw }}
                    style={styles.variationImage}
                    contentFit="contain"
                  />
                  <View
                    style={[
                      styles.variationLabel,
                      {
                        backgroundColor:
                          selectedVariation === index
                            ? theme.accent
                            : `${theme.stock}e8`,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.variationText,
                        {
                          color:
                            selectedVariation === index
                              ? theme.accentText
                              : theme.stockInk,
                          fontFamily: theme.fontBodyMedium,
                        },
                      ]}
                    >
                      CONCEPT {index + 1}
                    </Text>
                    {selectedVariation === index && (
                      <Ionicons
                        name="checkmark-circle"
                        size={14}
                        color={theme.accentText}
                      />
                    )}
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        <Card style={{ marginTop: SPACE.lg }}>
          <Text
            style={[
              styles.field,
              { color: theme.muted, fontFamily: theme.fontBodyMedium },
            ]}
          >
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
              {
                color: theme.muted,
                fontFamily: theme.fontBodyMedium,
                marginTop: SPACE.md,
              },
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
                      backgroundColor: active
                        ? `${theme.accent}14`
                        : theme.surfaceAlt,
                      opacity: pressed ? 0.75 : 1,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.providerIcon,
                      {
                        backgroundColor: active ? theme.accent : theme.surface,
                      },
                    ]}
                  >
                    <Ionicons
                      name={PROVIDER_ICONS[engine.id]}
                      size={17}
                      color={active ? theme.accentText : theme.muted}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        ...TYPE.body,
                        color: theme.foreground,
                        fontFamily: theme.fontBodyMedium,
                      }}
                    >
                      {engine.label}
                    </Text>
                    <Text
                      style={{
                        ...TYPE.caption,
                        color: theme.muted,
                        fontFamily: theme.fontBody,
                      }}
                    >
                      {providerStatus.find((entry) => entry.id === engine.id)
                        ?.available === false
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
              <Text
                style={[
                  styles.field,
                  { color: theme.muted, fontFamily: theme.fontBodyMedium },
                ]}
              >
                QUALITY
              </Text>
              <View style={styles.compactChips} accessibilityRole="radiogroup">
                {(["draft", "standard", "best"] as ImageQuality[]).map(
                  (value) => (
                    <Chip
                      key={value}
                      label={value[0].toUpperCase() + value.slice(1)}
                      active={quality === value}
                      onPress={() => setQuality(value)}
                    />
                  ),
                )}
              </View>
            </View>
            <View
              style={[
                styles.costTile,
                { backgroundColor: theme.surfaceAlt, borderColor: theme.line },
              ]}
            >
              <Text
                style={{
                  ...TYPE.caption,
                  color: theme.muted,
                  fontFamily: theme.fontBody,
                }}
              >
                ESTIMATE
              </Text>
              <Text
                style={{
                  ...TYPE.heading,
                  color: theme.accent,
                  fontFamily: theme.fontDisplay,
                }}
              >
                $
                {(
                  providerStatus.find((entry) => entry.id === provider)
                    ?.estimates[quality] ?? 0
                ).toFixed(2)}
              </Text>
              <Text
                style={{
                  ...TYPE.micro,
                  color: theme.muted,
                  fontFamily: theme.fontBody,
                }}
              >
                ${monthlySpend.toFixed(2)} this month
              </Text>
            </View>
          </View>

          <Text
            style={[
              styles.field,
              {
                color: theme.muted,
                fontFamily: theme.fontBodyMedium,
                marginTop: SPACE.md,
              },
            ]}
          >
            CONCEPT BOARD
          </Text>
          <View style={styles.compactChips} accessibilityRole="radiogroup">
            {([1, 2, 4] as const).map((count) => (
              <Chip
                key={count}
                label={count === 1 ? "Single" : `${count} concepts`}
                active={variationCount === count}
                onPress={() => setVariationCount(count)}
              />
            ))}
          </View>
          <Text
            style={{
              ...TYPE.caption,
              color: theme.muted,
              fontFamily: theme.fontBody,
              marginTop: 5,
            }}
          >
            Creates {variationCount} complete options · estimated batch $
            {(
              variationCount *
              (providerStatus.find((entry) => entry.id === provider)?.estimates[
                quality
              ] ?? 0)
            ).toFixed(2)}
          </Text>

          <Text
            style={[
              styles.field,
              {
                color: theme.muted,
                fontFamily: theme.fontBodyMedium,
                marginTop: SPACE.md,
              },
            ]}
          >
            REFERENCE IMAGE · OPTIONAL
          </Text>
          {reference ? (
            <View
              style={[
                styles.referenceCard,
                {
                  borderColor: theme.accent,
                  backgroundColor: `${theme.accent}10`,
                },
              ]}
            >
              <Image
                source={{ uri: reference.dataUrl }}
                style={styles.referenceImage}
                contentFit="cover"
              />
              <View style={{ flex: 1, gap: 4 }}>
                <Text
                  numberOfLines={1}
                  style={{
                    ...TYPE.body,
                    color: theme.foreground,
                    fontFamily: theme.fontBodyMedium,
                  }}
                >
                  {reference.name}
                </Text>
                <Text
                  style={{
                    ...TYPE.caption,
                    color: theme.muted,
                    fontFamily: theme.fontBody,
                  }}
                >
                  Composition guide attached
                </Text>
              </View>
              <Pressable
                onPress={clearReference}
                accessibilityLabel="Remove reference"
              >
                <Ionicons name="close-circle" size={24} color={theme.muted} />
              </Pressable>
            </View>
          ) : (
            <View style={styles.referenceActions}>
              <Button
                label="Choose photo"
                icon="images-outline"
                onPress={chooseReferenceFromPhotos}
                style={{ flex: 1 }}
              />
              <Button
                label="Open Files"
                icon="folder-open-outline"
                onPress={chooseReferenceFromFiles}
                style={{ flex: 1 }}
              />
            </View>
          )}
          {reference && (
            <View
              style={[styles.compactChips, { marginTop: SPACE.sm }]}
              accessibilityRole="radiogroup"
            >
              {(["loose", "balanced", "faithful"] as ReferenceStrength[]).map(
                (value) => (
                  <Chip
                    key={value}
                    label={value[0].toUpperCase() + value.slice(1)}
                    active={referenceStrength === value}
                    onPress={() => setReferenceStrength(value)}
                  />
                ),
              )}
            </View>
          )}
          {reference && (
            <>
              <Text
                style={{
                  color: theme.muted,
                  fontFamily: theme.fontBodyMedium,
                  fontSize: 10,
                  letterSpacing: 1,
                  marginTop: SPACE.sm,
                }}
              >
                REMIX DIRECTION
              </Text>
              <View style={[styles.compactChips, { marginTop: SPACE.xs }]}>
                {REMIX_VERBS.map((verb) => (
                  <Chip
                    key={verb.id}
                    label={verb.label}
                    active={hasRemixVerb(prompt, verb.id)}
                    onPress={() => {
                      setPrompt((current) => applyRemixVerb(current, verb.id));
                      Haptics.selectionAsync();
                    }}
                  />
                ))}
              </View>
            </>
          )}

          <Text
            style={[
              styles.field,
              {
                color: theme.muted,
                fontFamily: theme.fontBodyMedium,
                marginTop: SPACE.md,
              },
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

          {brand.generate.offersShading && (
          <>
          <Text
            style={[
              styles.field,
              {
                color: theme.muted,
                fontFamily: theme.fontBodyMedium,
                marginTop: SPACE.md,
              },
            ]}
          >
            SHADING
          </Text>
          <View style={styles.chips} accessibilityRole="radiogroup">
            {SHADING_VOCABULARY.map((item) => (
              <Chip
                key={item.id}
                label={item.label}
                active={item.id === shading}
                onPress={() => {
                  setShading(item.id);
                  Haptics.selectionAsync();
                }}
              />
            ))}
          </View>
          <Text
            style={[
              TYPE.caption,
              { color: theme.muted, fontFamily: theme.fontBody, marginTop: SPACE.xs },
            ]}
          >
            {SHADING_VOCABULARY.find((item) => item.id === shading)?.caption}
            {shading === "none"
              ? ""
              : " · The render comes back shaded; the stencil beside it is still pure line."}
          </Text>
          </>
          )}

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
            style={styles.actionPill}
          />
          <Button
            label={saved ? "On the sheet" : "Add to sheet"}
            icon={saved ? "checkmark" : "add"}
            onPress={handleSend}
            disabled={!stencilUrl}
            style={styles.actionPill}
          />
          <Button
            label="Edit stencil"
            icon="brush-outline"
            onPress={() => openEditor("stencil")}
            disabled={!stencilUrl}
            style={styles.actionPill}
          />
        </View>
        <Button
          label="Edit original artwork"
          icon="color-wand-outline"
          onPress={() => openEditor("raw")}
          disabled={!rawUrl}
          style={{ marginTop: SPACE.sm }}
        />

        {history.length > 0 && (
          <View style={{ marginTop: SPACE.xl }}>
            <SectionLabel
              action={{
                label: "Clear",
                icon: "trash-outline",
                onPress: confirmClearHistory,
              }}
            >
              Recent prompts
            </SectionLabel>
            <View style={[styles.history, { borderColor: theme.line }]}>
              {history.map((entry, i) => {
                const styleLabel = brand.generate.styles.find(
                  (s) => s.id === entry.style,
                )?.label;
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
                      i > 0 && {
                        borderTopWidth: 1,
                        borderTopColor: theme.line,
                      },
                      pressed && { backgroundColor: theme.surfaceAlt },
                    ]}
                  >
                    <View style={styles.historyText}>
                      <Text
                        numberOfLines={1}
                        style={{
                          ...TYPE.body,
                          color: theme.foreground,
                          fontFamily: theme.fontBody,
                        }}
                      >
                        {entry.prompt}
                      </Text>
                      {styleLabel && (
                        <Text
                          style={{
                            ...TYPE.caption,
                            color: theme.muted,
                            fontFamily: theme.fontBody,
                          }}
                        >
                          {styleLabel}
                        </Text>
                      )}
                    </View>
                    <Ionicons
                      name="return-down-back-outline"
                      size={16}
                      color={theme.muted}
                    />
                  </Pressable>
                );
              })}
            </View>
          </View>
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
                    "That generated project is no longer available.",
                  );
                if (editingTarget === "raw") {
                  setRawUrl(dataUrl);
                  setRawDesign(updated);
                } else {
                  setStencilUrl(dataUrl);
                  setStencilDesign(updated);
                }
                return { id: updated.id, title: updated.title };
              }
              const added = await addToLibrary(brand.id, {
                dataUrl,
                title: `${editing.title} (edited)`,
                source: "generated",
              });
              return { id: added.id, title: added.title };
            }}
            onClose={() => {
              setEditing(null);
              setEditingTarget(null);
            }}
          />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function BenchWaitingPane({ label, seed }: { label: string; seed: number }) {
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
      <PaperSubstrate seed={seed} />
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

function RevealedStencilPane({
  uri,
  reveal,
  replayKey,
}: {
  uri: string | null;
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
        label="Stencil"
        uri={uri}
        emptyIcon="git-branch-outline"
        emptyHint="Cleaned linework"
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
  variationRow: { gap: SPACE.sm, paddingRight: SPACE.md },
  variationCard: {
    width: 132,
    height: 154,
    borderWidth: 2,
    borderRadius: RADIUS.md,
    overflow: "hidden",
  },
  variationImage: { width: "100%", flex: 1 },
  variationLabel: {
    minHeight: 30,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  variationText: { ...TYPE.micro },
  field: { ...TYPE.micro, marginBottom: SPACE.sm - 2 },
  input: {
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: 12,
    minHeight: 84,
    textAlignVertical: "top",
    ...TYPE.body,
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
  providerIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  controlSplit: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: SPACE.sm,
    marginTop: SPACE.md,
  },
  compactChips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  costTile: {
    width: 104,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: 10,
  },
  referenceActions: { flexDirection: "row", gap: SPACE.sm },
  referenceCard: {
    minHeight: 72,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  referenceImage: { width: 56, height: 56, borderRadius: RADIUS.sm },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm, marginTop: SPACE.sm },
  actionPill: { flexGrow: 1, flexBasis: "46%" },
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
