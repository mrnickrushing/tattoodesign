import { useCallback, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import Animated, {
  FadeInDown,
  LinearTransition,
  ReduceMotion,
} from "react-native-reanimated";
import { useBrand } from "@/context/BrandContext";
import { EmptyStock } from "@/components/EmptyStock";
import { Icon } from "@/components/Icon";
import {
  ImageViewer,
  type ImageViewerOriginFrame,
} from "@/components/ImageViewer";
import { PaperSubstrate } from "@/components/PaperSubstrate";
import { SkeletonRow } from "@/components/Skeleton";
import { CropMarks } from "@/components/StockPane";
import { ScreenHeader, SectionLabel } from "@/components/ui";
import { getLibrary, type LibraryDesign } from "@/lib/designLibrary";
import {
  getDraft,
  listSheets,
  type SavedSheet,
  type SheetDraft,
} from "@/lib/sheetLibrary";
import { RADIUS, SPACE, TYPE, glow, lift } from "@/lib/theme";
import { useContentBottomInset } from "@/lib/chrome";

const TOOL_ICONS = {
  generate: "generate",
  convert: "convert",
  builder: "sheet",
} as const;

const listTransition = LinearTransition.duration(220).reduceMotion(
  ReduceMotion.System,
);

export default function StudioDashboard() {
  const { brand, theme } = useBrand();
  const bottomInset = useContentBottomInset();
  const [designs, setDesigns] = useState<LibraryDesign[]>([]);
  const [sheets, setSheets] = useState<SavedSheet[]>([]);
  const [draft, setDraft] = useState<SheetDraft | null>(null);
  const [preview, setPreview] = useState<{
    design: LibraryDesign;
    originFrame: ImageViewerOriginFrame | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const thumbnailRefs = useRef<Record<string, View | null>>({});

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      Promise.all([
        getLibrary(brand.id),
        listSheets(brand.id),
        getDraft(brand.id),
      ])
        .then(([nextDesigns, nextSheets, nextDraft]) => {
          if (!active) return;
          setDesigns(nextDesigns);
          setSheets(nextSheets);
          setDraft(nextDraft);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [brand.id]),
  );

  const hasDraft = !!draft?.items.length;
  const resumeLabel = draft?.sheetName ?? "Untitled sheet";
  const recentDesigns = designs.slice(0, 8);
  const recentSheets = sheets.slice(0, 4);

  function go(path: "generate" | "convert" | "builder") {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/${brand.id}/${path}`);
  }

  function openPreview(design: LibraryDesign) {
    const thumbnail = thumbnailRefs.current[design.id];
    if (!thumbnail) {
      setPreview({ design, originFrame: null });
      return;
    }
    thumbnail.measureInWindow((x, y, width, height) => {
      setPreview({ design, originFrame: { x, y, width, height } });
    });
  }

  return (
    <>
      <ScrollView
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]}
      >
        <ScreenHeader
          eyebrow="Studio home"
          title={
            brand.id === "ink"
              ? "Your next piece starts here"
              : "Something sweet starts here"
          }
          subtitle="Resume the work in progress, or jump straight into a fresh idea."
        />

        <Pressable
          onPress={() => go(hasDraft ? "builder" : "generate")}
          accessibilityRole="button"
          accessibilityLabel={
            hasDraft ? `Resume ${resumeLabel}` : brand.home.cards[0].cta
          }
          style={({ pressed }) => [
            styles.resume,
            { borderColor: theme.accent },
            brand.id === "ink" ? glow(theme, "md") : lift("md"),
            pressed && { transform: [{ scale: 0.985 }], opacity: 0.9 },
          ]}
        >
          <LinearGradient
            colors={
              brand.id === "ink"
                ? (["#5f111c", "#241615", theme.surface] as const)
                : (["#f7c9d8", "#fff0f4", theme.surface] as const)
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.resumeIcon, { backgroundColor: theme.accent }]}>
            <Icon
              name={hasDraft ? "arrowForward" : "generate"}
              size={TYPE.heading.fontSize}
              color={theme.accentText}
            />
          </View>
          <View style={styles.resumeCopy}>
            <Text
              style={[
                styles.kicker,
                { color: theme.accent, fontFamily: theme.fontBodyMedium },
              ]}
            >
              {hasDraft ? "CONTINUE WORKING" : "START SOMETHING NEW"}
            </Text>
            <Text
              numberOfLines={1}
              style={[
                styles.resumeTitle,
                { color: theme.foreground, fontFamily: theme.fontDisplay },
              ]}
            >
              {hasDraft ? resumeLabel : brand.home.cards[0].title}
            </Text>
            <Text
              style={[
                styles.resumeMeta,
                { color: theme.muted, fontFamily: theme.fontBody },
              ]}
            >
              {hasDraft
                ? `${draft.items.length} design${draft.items.length === 1 ? "" : "s"} on the active canvas`
                : "Turn a description into clean, printable linework"}
            </Text>
          </View>
          <Icon
            name="chevronForward"
            size={TYPE.heading.fontSize}
            color={theme.foreground}
          />
        </Pressable>

        <Pressable
          onPress={() => router.push(`/${brand.id}/projects`)}
          accessibilityRole="button"
          accessibilityLabel="Open client projects"
          style={({ pressed }) => [
            styles.projectHub,
            { backgroundColor: theme.surface, borderColor: theme.line },
            pressed && { opacity: 0.78 },
          ]}
        >
          <View
            style={[
              styles.projectHubIcon,
              { backgroundColor: `${theme.accent}18` },
            ]}
          >
            <Icon
              name="projects"
              size={SPACE.lg - SPACE.xs}
              color={theme.accent}
            />
          </View>
          <View style={styles.flex}>
            <Text
              style={[
                styles.projectHubTitle,
                { color: theme.foreground, fontFamily: theme.fontBodyMedium },
              ]}
            >
              Client projects & approvals
            </Text>
            <Text
              style={[
                styles.projectHubDetail,
                { color: theme.muted, fontFamily: theme.fontBody },
              ]}
            >
              Organize designs, placement notes, revisions, and sign-off.
            </Text>
          </View>
          <Icon
            name="chevronForward"
            size={SPACE.md + SPACE.xs}
            color={theme.muted}
          />
        </Pressable>

        <View style={styles.section}>
          <SectionLabel>Quick start</SectionLabel>
          <View style={styles.tools}>
            {brand.home.cards.map((card) => (
              <Pressable
                key={card.tool}
                onPress={() => go(card.tool)}
                accessibilityRole="button"
                accessibilityLabel={card.cta}
                style={({ pressed }) => [
                  styles.tool,
                  { backgroundColor: theme.surface, borderColor: theme.line },
                  pressed && { backgroundColor: theme.surfaceAlt },
                ]}
              >
                <View
                  style={[
                    styles.toolIcon,
                    { backgroundColor: `${theme.accent}18` },
                  ]}
                >
                  <Icon
                    name={TOOL_ICONS[card.tool]}
                    size={SPACE.lg - SPACE.xs}
                    color={theme.accent}
                  />
                </View>
                <Text
                  numberOfLines={2}
                  style={[
                    styles.toolTitle,
                    {
                      color: theme.foreground,
                      fontFamily: theme.fontBodyMedium,
                    },
                  ]}
                >
                  {card.title
                    .replace("Stencil Linework ", "")
                    .replace("Flash Sheet ", "")}
                </Text>
                <Icon
                  name="arrowForward"
                  size={SPACE.md - SPACE.xs}
                  color={theme.muted}
                />
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <SectionLabel
            action={{
              label: "Open sheet",
              icon: "grid-outline",
              onPress: () => go("builder"),
            }}
          >
            Recent designs
          </SectionLabel>
          {loading ? (
            <SkeletonRow count={2} height={SPACE.xxl * 3} />
          ) : recentDesigns.length ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.designRow}
            >
              {recentDesigns.map((design, index) => (
                <Animated.View
                  key={design.id}
                  entering={FadeInDown.delay(index * 65)
                    .duration(260)
                    .reduceMotion(ReduceMotion.System)}
                  layout={listTransition}
                >
                  <Pressable
                    onPress={() => openPreview(design)}
                    accessibilityRole="button"
                    accessibilityLabel={`View ${design.title}`}
                    style={({ pressed }) => [
                      styles.designCard,
                      { backgroundColor: theme.stock, borderColor: theme.line },
                      pressed && { opacity: 0.75 },
                    ]}
                  >
                    <View
                      ref={(node) => {
                        thumbnailRefs.current[design.id] = node;
                      }}
                      style={styles.designVisual}
                    >
                      <PaperSubstrate seed={index + 100} />
                      <CropMarks color={theme.stockMark} />
                      <Image
                        source={{ uri: design.uri }}
                        style={styles.designImage}
                        contentFit="contain"
                      />
                    </View>
                    <View
                      style={[
                        styles.designCaption,
                        { backgroundColor: theme.surface },
                      ]}
                    >
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.designTitle,
                          {
                            color: theme.foreground,
                            fontFamily: theme.fontBodyMedium,
                          },
                        ]}
                      >
                        {design.title}
                      </Text>
                      <Text
                        style={[
                          styles.designSource,
                          { color: theme.muted, fontFamily: theme.fontBody },
                        ]}
                      >
                        {design.source}
                      </Text>
                    </View>
                  </Pressable>
                </Animated.View>
              ))}
            </ScrollView>
          ) : (
            <EmptyStock
              icon="image"
              title="No designs yet"
              detail="Generate or convert one and it will stay close at hand."
            />
          )}
        </View>

        <View style={styles.section}>
          <SectionLabel
            action={{
              label: "All sheets",
              icon: "albums-outline",
              onPress: () => go("builder"),
            }}
          >
            Saved sheets
          </SectionLabel>
          {loading ? (
            <SkeletonRow count={3} height={SPACE.xxl + SPACE.md} />
          ) : recentSheets.length ? (
            <Animated.View style={styles.sheetList} layout={listTransition}>
              {recentSheets.map((sheet, index) => (
                <Animated.View
                  key={sheet.id}
                  entering={FadeInDown.delay(index * 65)
                    .duration(260)
                    .reduceMotion(ReduceMotion.System)}
                >
                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: "/[brand]/builder",
                        params: { brand: brand.id, sheet: sheet.id },
                      })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`Resume ${sheet.name}`}
                    style={({ pressed }) => [
                      styles.sheetItem,
                      {
                        backgroundColor: theme.surface,
                        borderColor: theme.line,
                      },
                      pressed && { backgroundColor: theme.surfaceAlt },
                    ]}
                  >
                    <View
                      style={[styles.sheetIcon, { borderColor: theme.line }]}
                    >
                      <Icon
                        name="document"
                        size={SPACE.lg - SPACE.xs}
                        color={theme.accent}
                      />
                    </View>
                    <View style={styles.flex}>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.sheetName,
                          {
                            color: theme.foreground,
                            fontFamily: theme.fontBodyMedium,
                          },
                        ]}
                      >
                        {sheet.name}
                      </Text>
                      <Text
                        style={[
                          styles.sheetMeta,
                          { color: theme.muted, fontFamily: theme.fontBody },
                        ]}
                      >
                        {sheet.items.length} design
                        {sheet.items.length === 1 ? "" : "s"} ·{" "}
                        {new Date(sheet.updatedAt).toLocaleDateString()}
                      </Text>
                    </View>
                    <Icon
                      name="chevronForward"
                      size={SPACE.md + SPACE.xs}
                      color={theme.muted}
                    />
                  </Pressable>
                </Animated.View>
              ))}
            </Animated.View>
          ) : (
            <EmptyStock
              icon="document"
              title="No saved sheets"
              detail="Build a layout once, then resume it from here anytime."
            />
          )}
        </View>
      </ScrollView>

      <ImageViewer
        uri={preview?.design.uri ?? null}
        title={preview?.design.title}
        actions={[
          {
            icon: "grid-outline",
            label: "Open sheet builder",
            onPress: () => go("builder"),
          },
        ]}
        onClose={() => setPreview(null)}
        originFrame={preview?.originFrame ?? null}
      />
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: SPACE.md, paddingTop: SPACE.lg, paddingBottom: SPACE.xxl },
  section: { marginTop: SPACE.xl },
  flex: { flex: 1 },
  resume: {
    minHeight: SPACE.xxl * 3,
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    padding: SPACE.md,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.md,
    overflow: "hidden",
  },
  resumeIcon: {
    width: SPACE.xxl,
    height: SPACE.xxl,
    borderRadius: RADIUS.md,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  resumeCopy: { flex: 1, zIndex: 1 },
  kicker: { ...TYPE.micro, marginBottom: SPACE.xs - 2 },
  resumeTitle: { ...TYPE.display },
  resumeMeta: { ...TYPE.caption, marginTop: SPACE.xs - 3 },
  projectHub: {
    marginTop: SPACE.sm,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACE.md - SPACE.xs + 2,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.sm,
  },
  projectHubIcon: {
    width: SPACE.xxl - SPACE.xs + 2,
    height: SPACE.xxl - SPACE.xs + 2,
    borderRadius: RADIUS.md,
    alignItems: "center",
    justifyContent: "center",
  },
  projectHubTitle: { ...TYPE.body },
  projectHubDetail: { ...TYPE.caption },
  tools: { flexDirection: "row", gap: SPACE.sm },
  tool: {
    flex: 1,
    minHeight: SPACE.xxl * 3,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACE.md - SPACE.xs + 2,
    justifyContent: "space-between",
  },
  toolIcon: {
    width: SPACE.xl + SPACE.xs,
    height: SPACE.xl + SPACE.xs,
    borderRadius: RADIUS.md,
    alignItems: "center",
    justifyContent: "center",
  },
  toolTitle: { ...TYPE.caption },
  designRow: { gap: SPACE.sm, paddingRight: SPACE.md },
  designCard: {
    width: SPACE.xxl * 3 + SPACE.md,
    height: SPACE.xxl * 4 + SPACE.xs,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    overflow: "hidden",
  },
  designVisual: { flex: 1, overflow: "hidden" },
  designImage: { width: "100%", height: "100%" },
  designCaption: {
    paddingHorizontal: SPACE.sm,
    paddingVertical: SPACE.sm - 2,
    gap: SPACE.xs - 4,
  },
  designTitle: { ...TYPE.caption },
  designSource: { ...TYPE.micro },
  sheetList: { gap: SPACE.sm },
  sheetItem: {
    minHeight: SPACE.xxl + SPACE.md + SPACE.xs + 2,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACE.sm + 1,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.sm,
  },
  sheetIcon: {
    width: SPACE.xxl - SPACE.xs + 4,
    height: SPACE.xxl - SPACE.xs + 4,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetName: { ...TYPE.body },
  sheetMeta: { ...TYPE.caption },
});
