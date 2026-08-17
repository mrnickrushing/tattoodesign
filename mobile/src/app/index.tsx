import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { BRANDS } from "@/lib/brands";
import { THEMES, NEUTRAL_THEME } from "@/lib/theme";

const doors = [
  {
    brand: BRANDS.ink,
    theme: THEMES.ink,
    tagline: "Tattoo flash & stencils",
    blurb:
      "Generate flash from a prompt, convert photos into stencil linework, and build printable flash sheets.",
  },
  {
    brand: BRANDS.sugar,
    theme: THEMES.sugar,
    tagline: "Cookie, cake pop & topper design",
    blurb:
      "Generate cookie and cake designs from a prompt, convert photos into icing-ready line art, and build printable bake sheets.",
  },
];

export default function StudioPicker() {
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: NEUTRAL_THEME.background }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[styles.eyebrow, { color: NEUTRAL_THEME.accent }]}>
          ONE TOOLKIT, TWO STUDIOS
        </Text>
        <Text
          style={[
            styles.headline,
            { color: NEUTRAL_THEME.foreground, fontFamily: NEUTRAL_THEME.fontDisplay },
          ]}
        >
          Pick your studio
        </Text>
        <Text style={[styles.subhead, { color: NEUTRAL_THEME.muted }]}>
          Same three tools underneath — generate, convert, and build printable
          sheets — themed for whoever&apos;s using them.
        </Text>

        <View style={styles.doors}>
          {doors.map(({ brand, theme, tagline, blurb }) => (
            <Pressable
              key={brand.id}
              onPress={() => router.push(`/${brand.id}`)}
              style={({ pressed }) => [
                styles.door,
                {
                  backgroundColor: theme.paper,
                  borderColor: theme.line,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text style={[styles.doorTag, { color: theme.accent }]}>{tagline}</Text>
              <Text
                style={[
                  styles.doorName,
                  { color: theme.foreground, fontFamily: theme.fontDisplay },
                ]}
              >
                {brand.name}
              </Text>
              <Text style={[styles.doorBlurb, { color: theme.foreground }]}>{blurb}</Text>
              <Text style={[styles.doorCta, { color: theme.accent }]}>
                Enter {brand.name} →
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 24, paddingTop: 40, paddingBottom: 60 },
  eyebrow: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 2,
    marginBottom: 12,
  },
  headline: {
    fontSize: 44,
    lineHeight: 44,
    letterSpacing: 0.5,
    marginBottom: 14,
  },
  subhead: {
    fontSize: 16,
    lineHeight: 22,
    marginBottom: 32,
  },
  doors: { gap: 16 },
  door: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    minHeight: 220,
    justifyContent: "space-between",
  },
  doorTag: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 1.5,
    marginBottom: 10,
    textTransform: "uppercase",
  },
  doorName: { fontSize: 34, marginBottom: 10 },
  doorBlurb: { fontSize: 14, lineHeight: 20, opacity: 0.75 },
  doorCta: { fontSize: 14, fontWeight: "600", marginTop: 18 },
});
