import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { BRANDS } from "@/lib/brands";
import { THEMES, NEUTRAL_THEME, SPACE, RADIUS } from "@/lib/theme";

const doors = [
  {
    brand: BRANDS.ink,
    theme: THEMES.ink,
    tagline: "Tattoo flash & stencils",
    icon: "flash" as const,
    // A tattoo shop reads as deep ink washing up into crimson.
    gradient: ["#161412", "#241413"] as const,
  },
  {
    brand: BRANDS.sugar,
    theme: THEMES.sugar,
    tagline: "Cookie, cake pop & topper",
    icon: "cafe" as const,
    gradient: ["#ffffff", "#fdeef2"] as const,
  },
];

export default function StudioPicker() {
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: NEUTRAL_THEME.background }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.eyebrowRow}>
          <View style={[styles.rule, { backgroundColor: NEUTRAL_THEME.accent }]} />
          <Text
            style={[
              styles.eyebrow,
              { color: NEUTRAL_THEME.accent, fontFamily: NEUTRAL_THEME.fontBodyMedium },
            ]}
          >
            TWO STUDIOS, ONE BENCH
          </Text>
        </View>

        <Text
          style={[
            styles.headline,
            { color: NEUTRAL_THEME.foreground, fontFamily: NEUTRAL_THEME.fontDisplay },
          ]}
        >
          Pick your studio
        </Text>
        <Text
          style={[styles.subhead, { color: NEUTRAL_THEME.muted, fontFamily: NEUTRAL_THEME.fontBody }]}
        >
          Draw it, trace it, lay it out on a sheet you can print.
        </Text>

        <View style={styles.doors}>
          {doors.map(({ brand, theme, tagline, icon, gradient }) => (
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
                { borderColor: theme.line, transform: [{ scale: pressed ? 0.985 : 1 }] },
              ]}
            >
              <LinearGradient colors={gradient} style={styles.door}>
                <View style={styles.doorTop}>
                  <View style={[styles.badge, { backgroundColor: theme.accent }]}>
                    <Ionicons name={icon} size={17} color={theme.accentText} />
                  </View>
                  <Ionicons name="arrow-forward" size={17} color={theme.muted} />
                </View>

                <View>
                  <Text
                    style={[
                      styles.doorName,
                      {
                        color: theme.foreground,
                        fontFamily:
                          brand.id === "sugar" ? theme.fontScript : theme.fontDisplay,
                        fontSize: brand.id === "sugar" ? 40 : 36,
                      },
                    ]}
                  >
                    {brand.name}
                  </Text>
                  <Text
                    style={[styles.doorTag, { color: theme.accent, fontFamily: theme.fontBodyMedium }]}
                  >
                    {tagline.toUpperCase()}
                  </Text>
                </View>

                {/* The three tools, stated as a row of marks rather than prose. */}
                <View style={[styles.tools, { borderTopColor: theme.line }]}>
                  {(
                    [
                      ["sparkles-outline", brand.generate.tabLabel],
                      ["scan-outline", brand.convert.tabLabel],
                      ["grid-outline", brand.builder.tabLabel],
                    ] as const
                  ).map(([ic, label]) => (
                    <View key={label} style={styles.tool}>
                      <Ionicons name={ic} size={14} color={theme.muted} />
                      <Text
                        style={{ color: theme.muted, fontSize: 11, fontFamily: theme.fontBody }}
                      >
                        {label}
                      </Text>
                    </View>
                  ))}
                </View>
              </LinearGradient>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: SPACE.lg, paddingTop: SPACE.xl, paddingBottom: SPACE.xl },
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  rule: { width: 18, height: 2, borderRadius: 1 },
  eyebrow: { fontSize: 10, letterSpacing: 2 },
  headline: { fontSize: 46, lineHeight: 48, letterSpacing: 0.5 },
  subhead: { fontSize: 15, lineHeight: 21, marginTop: 10, marginBottom: SPACE.xl },
  doors: { gap: SPACE.md },
  doorWrap: { borderRadius: RADIUS.xl, borderWidth: 1, overflow: "hidden" },
  door: { padding: SPACE.lg, gap: SPACE.lg },
  doorTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  badge: { width: 38, height: 38, borderRadius: RADIUS.md, alignItems: "center", justifyContent: "center" },
  doorName: { letterSpacing: 0.3 },
  doorTag: { fontSize: 10, letterSpacing: 1.6, marginTop: 4 },
  tools: { flexDirection: "row", gap: SPACE.md, borderTopWidth: 1, paddingTop: SPACE.sm },
  tool: { flexDirection: "row", alignItems: "center", gap: 5 },
});
