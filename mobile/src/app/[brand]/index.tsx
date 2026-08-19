import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import { useBrand } from "@/context/BrandContext";
import { ScreenHeader, SectionLabel } from "@/components/ui";
import { ImageViewer } from "@/components/ImageViewer";
import { getLibrary, type LibraryDesign } from "@/lib/designLibrary";
import { getDraft, listSheets, type SavedSheet, type SheetDraft } from "@/lib/sheetLibrary";
import { RADIUS, SPACE, glow, lift } from "@/lib/theme";

const TOOL_ICONS = {
  generate: "sparkles-outline",
  convert: "scan-outline",
  builder: "grid-outline",
} as const;

export default function StudioDashboard() {
  const { brand, theme } = useBrand();
  const [designs, setDesigns] = useState<LibraryDesign[]>([]);
  const [sheets, setSheets] = useState<SavedSheet[]>([]);
  const [draft, setDraft] = useState<SheetDraft | null>(null);
  const [preview, setPreview] = useState<LibraryDesign | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      Promise.all([getLibrary(brand.id), listSheets(brand.id), getDraft(brand.id)]).then(
        ([nextDesigns, nextSheets, nextDraft]) => {
          if (!active) return;
          setDesigns(nextDesigns);
          setSheets(nextSheets);
          setDraft(nextDraft);
        }
      );
      return () => {
        active = false;
      };
    }, [brand.id])
  );

  const hasDraft = !!draft?.items.length;
  const resumeLabel = draft?.sheetName ?? "Untitled sheet";
  const recentDesigns = designs.slice(0, 8);
  const recentSheets = sheets.slice(0, 4);

  function go(path: "generate" | "convert" | "builder") {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/${brand.id}/${path}`);
  }

  return (
    <>
      <ScrollView
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.scroll}
      >
        <ScreenHeader
          eyebrow="Studio home"
          title={brand.id === "ink" ? "Your next piece starts here" : "Something sweet starts here"}
          subtitle="Resume the work in progress, or jump straight into a fresh idea."
        />

        <Pressable
          onPress={() => go(hasDraft ? "builder" : "generate")}
          accessibilityRole="button"
          accessibilityLabel={hasDraft ? `Resume ${resumeLabel}` : brand.home.cards[0].cta}
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
            <Ionicons name={hasDraft ? "arrow-forward" : "sparkles"} size={21} color={theme.accentText} />
          </View>
          <View style={styles.resumeCopy}>
            <Text style={[styles.kicker, { color: theme.accent, fontFamily: theme.fontBodyMedium }]}>
              {hasDraft ? "CONTINUE WORKING" : "START SOMETHING NEW"}
            </Text>
            <Text numberOfLines={1} style={[styles.resumeTitle, { color: theme.foreground, fontFamily: theme.fontDisplay }]}>
              {hasDraft ? resumeLabel : brand.home.cards[0].title}
            </Text>
            <Text style={[styles.resumeMeta, { color: theme.muted, fontFamily: theme.fontBody }]}>
              {hasDraft
                ? `${draft.items.length} design${draft.items.length === 1 ? "" : "s"} on the active canvas`
                : "Turn a description into clean, printable linework"}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color={theme.foreground} />
        </Pressable>

        <Pressable
          onPress={() => router.push(`/${brand.id}/projects`)}
          accessibilityRole="button"
          accessibilityLabel="Open client projects"
          style={({ pressed }) => [styles.projectHub, { backgroundColor: theme.surface, borderColor: theme.line }, pressed && { opacity: 0.78 }]}
        >
          <View style={[styles.projectHubIcon, { backgroundColor: `${theme.accent}18` }]}><Ionicons name="folder-open-outline" size={20} color={theme.accent} /></View>
          <View style={{ flex: 1 }}><Text style={{ color: theme.foreground, fontFamily: theme.fontBodyMedium, fontSize: 14 }}>Client projects & approvals</Text><Text style={{ color: theme.muted, fontFamily: theme.fontBody, fontSize: 11 }}>Organize designs, placement notes, revisions, and sign-off.</Text></View>
          <Ionicons name="chevron-forward" size={18} color={theme.muted} />
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
                <View style={[styles.toolIcon, { backgroundColor: `${theme.accent}18` }]}>
                  <Ionicons name={TOOL_ICONS[card.tool]} size={20} color={theme.accent} />
                </View>
                <Text numberOfLines={2} style={[styles.toolTitle, { color: theme.foreground, fontFamily: theme.fontBodyMedium }]}>
                  {card.title.replace("Stencil Linework ", "").replace("Flash Sheet ", "")}
                </Text>
                <Ionicons name="arrow-forward" size={14} color={theme.muted} />
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <SectionLabel action={{ label: "Open sheet", icon: "grid-outline", onPress: () => go("builder") }}>
            Recent designs
          </SectionLabel>
          {recentDesigns.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.designRow}>
              {recentDesigns.map((design) => (
                <Pressable
                  key={design.id}
                  onPress={() => setPreview(design)}
                  accessibilityRole="button"
                  accessibilityLabel={`View ${design.title}`}
                  style={({ pressed }) => [styles.designCard, { backgroundColor: theme.stock, borderColor: theme.line }, pressed && { opacity: 0.75 }]}
                >
                  <Image source={{ uri: design.uri }} style={styles.designImage} contentFit="contain" />
                  <View style={[styles.designCaption, { backgroundColor: theme.surface }]}>
                    <Text numberOfLines={1} style={{ color: theme.foreground, fontFamily: theme.fontBodyMedium, fontSize: 12 }}>
                      {design.title}
                    </Text>
                    <Text style={{ color: theme.muted, fontFamily: theme.fontBody, fontSize: 10 }}>
                      {design.source}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <EmptyRow icon="images-outline" title="No designs yet" detail="Generate or convert one and it will stay close at hand." />
          )}
        </View>

        <View style={styles.section}>
          <SectionLabel action={{ label: "All sheets", icon: "albums-outline", onPress: () => go("builder") }}>
            Saved sheets
          </SectionLabel>
          {recentSheets.length ? (
            <View style={styles.sheetList}>
              {recentSheets.map((sheet) => (
                <Pressable
                  key={sheet.id}
                  onPress={() => router.push({ pathname: "/[brand]/builder", params: { brand: brand.id, sheet: sheet.id } })}
                  accessibilityRole="button"
                  accessibilityLabel={`Resume ${sheet.name}`}
                  style={({ pressed }) => [styles.sheetItem, { backgroundColor: theme.surface, borderColor: theme.line }, pressed && { backgroundColor: theme.surfaceAlt }]}
                >
                  <View style={[styles.sheetIcon, { borderColor: theme.line }]}>
                    <Ionicons name="document-text-outline" size={19} color={theme.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ color: theme.foreground, fontFamily: theme.fontBodyMedium, fontSize: 14 }}>{sheet.name}</Text>
                    <Text style={{ color: theme.muted, fontFamily: theme.fontBody, fontSize: 11 }}>
                      {sheet.items.length} design{sheet.items.length === 1 ? "" : "s"} · {new Date(sheet.updatedAt).toLocaleDateString()}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={17} color={theme.muted} />
                </Pressable>
              ))}
            </View>
          ) : (
            <EmptyRow icon="document-outline" title="No saved sheets" detail="Build a layout once, then resume it from here anytime." />
          )}
        </View>
      </ScrollView>

      <ImageViewer
        uri={preview?.uri ?? null}
        title={preview?.title}
        actions={[{ icon: "grid-outline", label: "Open sheet builder", onPress: () => go("builder") }]}
        onClose={() => setPreview(null)}
      />
    </>
  );
}

function EmptyRow({ icon, title, detail }: { icon: keyof typeof Ionicons.glyphMap; title: string; detail: string }) {
  const { theme } = useBrand();
  return (
    <View style={[styles.empty, { backgroundColor: theme.surface, borderColor: theme.line }]}>
      <Ionicons name={icon} size={22} color={theme.muted} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.foreground, fontFamily: theme.fontBodyMedium, fontSize: 13 }}>{title}</Text>
        <Text style={{ color: theme.muted, fontFamily: theme.fontBody, fontSize: 11, lineHeight: 16 }}>{detail}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: SPACE.md, paddingTop: SPACE.lg, paddingBottom: SPACE.xxl },
  section: { marginTop: SPACE.xl },
  resume: { minHeight: 112, borderWidth: 1, borderRadius: RADIUS.lg, padding: SPACE.md, flexDirection: "row", alignItems: "center", gap: SPACE.md, overflow: "hidden" },
  resumeIcon: { width: 46, height: 46, borderRadius: 16, alignItems: "center", justifyContent: "center", zIndex: 1 },
  resumeCopy: { flex: 1, zIndex: 1 },
  kicker: { fontSize: 9, letterSpacing: 1.6, marginBottom: 4 },
  resumeTitle: { fontSize: 25, lineHeight: 28 },
  resumeMeta: { fontSize: 11, marginTop: 3 },
  projectHub: { marginTop: SPACE.sm, borderWidth: 1, borderRadius: RADIUS.md, padding: 12, flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  projectHubIcon: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  tools: { flexDirection: "row", gap: SPACE.sm },
  tool: { flex: 1, minHeight: 132, borderWidth: 1, borderRadius: RADIUS.md, padding: 12, justifyContent: "space-between" },
  toolIcon: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  toolTitle: { fontSize: 12, lineHeight: 17 },
  designRow: { gap: SPACE.sm, paddingRight: SPACE.md },
  designCard: { width: 148, height: 180, borderWidth: 1, borderRadius: RADIUS.md, overflow: "hidden" },
  designImage: { width: "100%", flex: 1 },
  designCaption: { paddingHorizontal: 10, paddingVertical: 8, gap: 2 },
  sheetList: { gap: SPACE.sm },
  sheetItem: { minHeight: 68, borderWidth: 1, borderRadius: RADIUS.md, padding: 11, flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  sheetIcon: { width: 42, height: 42, borderWidth: 1, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  empty: { minHeight: 74, borderWidth: 1, borderRadius: RADIUS.md, padding: 13, flexDirection: "row", alignItems: "center", gap: SPACE.sm },
});
