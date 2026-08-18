import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { BRANDS } from "@/lib/brands";
import { THEMES, NEUTRAL_THEME, SPACE, RADIUS, glow, lift } from "@/lib/theme";
import { BrandArtwork } from "@/components/BrandArtwork";

const doors = [
  {
    brand: BRANDS.ink,
    theme: THEMES.ink,
    number: "01",
    tagline: "Tattoo flash & stencils",
    note: "Bold linework. Real-size sheets.",
    icon: "flash" as const,
    gradient: ["#221311", "#120f0e", "#0d0c0b"] as const,
  },
  {
    brand: BRANDS.sugar,
    theme: THEMES.sugar,
    number: "02",
    tagline: "Cookie, cake pop & topper",
    note: "Sweet ideas. Print-ready templates.",
    icon: "color-palette" as const,
    gradient: ["#fffdfb", "#fff1f5", "#fbe6e0"] as const,
  },
];

export default function StudioPicker() {
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <LinearGradient
        colors={["#0c0b0a", "#15100f", "#0c0b0a"]}
        locations={[0, 0.48, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={styles.ambientOne} />
      <View pointerEvents="none" style={styles.ambientTwo} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.masthead}>
          <View style={styles.logoMark}>
            <Ionicons name="cut-outline" size={17} color="#fff" />
          </View>
          <View style={styles.logoCopy}>
            <Text style={[styles.logo, { fontFamily: NEUTRAL_THEME.fontDisplay }]}>INKLINE</Text>
            <Text style={[styles.logoMeta, { fontFamily: NEUTRAL_THEME.fontBodyMedium }]}>CREATIVE WORKBENCH</Text>
          </View>
          <View style={styles.versionPill}>
            <View style={styles.liveDot} />
            <Text style={[styles.versionText, { fontFamily: NEUTRAL_THEME.fontBodyMedium }]}>2 STUDIOS</Text>
          </View>
        </View>

        <View style={styles.heroCopy}>
          <View style={styles.eyebrowRow}>
            <View style={styles.rule} />
            <Text style={[styles.eyebrow, { fontFamily: NEUTRAL_THEME.fontBodyMedium }]}>START AT THE BENCH</Text>
          </View>
          <Text style={[styles.headline, { fontFamily: NEUTRAL_THEME.fontDisplay }]}>Pick your studio</Text>
          <Text style={[styles.subhead, { fontFamily: NEUTRAL_THEME.fontBody }]}>Choose a craft. Turn an idea into clean linework, then build the sheet.</Text>
        </View>

        <View style={styles.doors}>
          {doors.map(({ brand, theme, number, tagline, note, icon, gradient }) => (
            <Pressable
              key={brand.id}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                router.push(`/${brand.id}`);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Enter ${brand.name}`}
              accessibilityHint={tagline}
              style={({ pressed }) => [
                styles.doorWrap,
                brand.id === "ink" ? glow(theme, "sm") : lift("sm"),
                { borderColor: brand.id === "ink" ? "#4a2223" : "#f0cfd9" },
                pressed && styles.pressed,
              ]}
            >
              <LinearGradient colors={gradient} style={styles.door}>
                <View style={styles.doorTop}>
                  <View style={styles.studioMeta}>
                    <Text style={[styles.studioNumber, { color: theme.accent, fontFamily: theme.fontDisplay }]}>{number}</Text>
                    <View>
                      <Text style={[styles.studioLabel, { color: theme.muted, fontFamily: theme.fontBodyMedium }]}>STUDIO</Text>
                      <Text style={[styles.studioNote, { color: theme.foreground, fontFamily: theme.fontBody }]}>{note}</Text>
                    </View>
                  </View>
                  <View style={[styles.enterPill, { backgroundColor: theme.accent }]}>
                    <Text style={[styles.enterText, { color: theme.accentText, fontFamily: theme.fontBodyMedium }]}>ENTER</Text>
                    <Ionicons name="arrow-forward" size={14} color={theme.accentText} />
                  </View>
                </View>

                <View style={styles.artStage}>
                  <Text
                    style={[
                      styles.doorName,
                      {
                        color: theme.foreground,
                        fontFamily: brand.id === "sugar" ? theme.fontScript : theme.fontDisplay,
                        fontSize: 40,
                      },
                    ]}
                  >
                    {brand.name}
                  </Text>
                  <Text style={[styles.doorTag, { color: theme.accent, fontFamily: theme.fontBodyMedium }]}>{tagline.toUpperCase()}</Text>
                  <BrandArtwork
                    brand={brand.id}
                    style={[styles.artwork, brand.id === "sugar" && styles.sugarArtwork]}
                  />
                  <View style={[styles.iconSeal, { backgroundColor: theme.accent }]}>
                    <Ionicons name={icon} size={17} color={theme.accentText} />
                  </View>
                </View>

                <View style={[styles.tools, { borderTopColor: theme.line }]}>
                  {(
                    [
                      ["sparkles-outline", brand.generate.tabLabel],
                      ["scan-outline", brand.convert.tabLabel],
                      ["grid-outline", brand.builder.tabLabel],
                    ] as const
                  ).map(([toolIcon, label]) => (
                    <View key={label} style={[styles.tool, { backgroundColor: `${theme.foreground}0a` }]}>
                      <Ionicons name={toolIcon} size={14} color={theme.accent} />
                      <Text style={{ color: theme.foreground, fontSize: 11, fontFamily: theme.fontBodyMedium }}>{label}</Text>
                    </View>
                  ))}
                </View>
              </LinearGradient>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.footer, { fontFamily: NEUTRAL_THEME.fontBody }]}>DESIGN · TRACE · SIZE · PRINT</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: NEUTRAL_THEME.background },
  ambientOne: { position: "absolute", width: 260, height: 260, borderRadius: 130, backgroundColor: "rgba(218,27,46,0.10)", top: -150, right: -100 },
  ambientTwo: { position: "absolute", width: 240, height: 240, borderRadius: 120, backgroundColor: "rgba(209,72,122,0.07)", bottom: 60, left: -170 },
  scroll: { padding: SPACE.lg, paddingTop: SPACE.md, paddingBottom: SPACE.xl },
  masthead: { flexDirection: "row", alignItems: "center", marginBottom: SPACE.xl },
  logoMark: { width: 38, height: 38, borderRadius: 13, backgroundColor: NEUTRAL_THEME.accent, alignItems: "center", justifyContent: "center", transform: [{ rotate: "-4deg" }] },
  logoCopy: { marginLeft: 10, flex: 1 },
  logo: { color: NEUTRAL_THEME.foreground, fontSize: 23, lineHeight: 24, letterSpacing: 1 },
  logoMeta: { color: NEUTRAL_THEME.muted, fontSize: 7, letterSpacing: 1.8 },
  versionPill: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: NEUTRAL_THEME.line, borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: "rgba(255,255,255,0.03)" },
  liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "#49c379" },
  versionText: { color: NEUTRAL_THEME.muted, fontSize: 8, letterSpacing: 1 },
  heroCopy: { marginBottom: SPACE.lg },
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  rule: { width: 22, height: 2, borderRadius: 1, backgroundColor: NEUTRAL_THEME.accent },
  eyebrow: { color: NEUTRAL_THEME.accent, fontSize: 9, letterSpacing: 2 },
  headline: { color: NEUTRAL_THEME.foreground, fontSize: 48, lineHeight: 49, letterSpacing: 0.6 },
  subhead: { color: "#aaa19b", fontSize: 14, lineHeight: 20, marginTop: 8, maxWidth: 330 },
  doors: { gap: SPACE.md },
  doorWrap: { borderRadius: RADIUS.xl, borderWidth: 1, overflow: "hidden" },
  pressed: { transform: [{ scale: 0.985 }], opacity: 0.94 },
  door: { padding: SPACE.md, paddingBottom: 14 },
  doorTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", zIndex: 2 },
  studioMeta: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  studioNumber: { fontSize: 27, lineHeight: 28, opacity: 0.9 },
  studioLabel: { fontSize: 7, letterSpacing: 1.6 },
  studioNote: { fontSize: 10, marginTop: 1 },
  enterPill: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: RADIUS.pill, paddingHorizontal: 11, paddingVertical: 7 },
  enterText: { fontSize: 8, letterSpacing: 1.2 },
  artStage: { minHeight: 126, justifyContent: "center", overflow: "hidden" },
  artwork: { position: "absolute", width: 180, height: 136, right: -13, top: -2 },
  sugarArtwork: { width: 155, right: -15 },
  iconSeal: { position: "absolute", width: 34, height: 34, borderRadius: 17, right: 4, bottom: 5, alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: "rgba(255,255,255,0.68)" },
  doorName: { letterSpacing: 0.3, maxWidth: "58%", zIndex: 2 },
  doorTag: { fontSize: 8, letterSpacing: 1.45, marginTop: 3, maxWidth: "55%", zIndex: 2 },
  tools: { flexDirection: "row", gap: 7, borderTopWidth: 1, paddingTop: 11 },
  tool: { flex: 1, minHeight: 33, borderRadius: 11, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingHorizontal: 5 },
  footer: { color: NEUTRAL_THEME.muted, fontSize: 8, letterSpacing: 2.1, textAlign: "center", marginTop: SPACE.lg },
});
