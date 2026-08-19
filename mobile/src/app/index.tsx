import { View, Text, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import Animated, {
  FadeInDown,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
} from "react-native-reanimated";
import { BRANDS, type BrandConfig } from "@/lib/brands";
import { THEMES, NEUTRAL_THEME, RADIUS, SPACE, TYPE, glow, lift, type Theme } from "@/lib/theme";
import { BrandProvider } from "@/context/BrandContext";
import { BrandArtwork } from "@/components/BrandArtwork";
import { Icon } from "@/components/Icon";
import { PaperSubstrate } from "@/components/PaperSubstrate";
import type { IconName } from "@/lib/icons";

const DOOR_STAGGER_MS = 96;
const DOOR_DURATION_MS = 420;

type Door = {
  brand: BrandConfig;
  theme: Theme;
  number: string;
  tagline: string;
  note: string;
  icon: IconName;
  gradient: readonly [string, string, string];
};

const doors: readonly Door[] = [
  {
    brand: BRANDS.ink,
    theme: THEMES.ink,
    number: "01",
    tagline: "Tattoo flash & stencils",
    note: "Bold linework. Real-size sheets.",
    icon: "flash",
    gradient: ["#221311", "#120f0e", "#0d0c0b"],
  },
  {
    brand: BRANDS.sugar,
    theme: THEMES.sugar,
    number: "02",
    tagline: "Cookie, cake pop & topper",
    note: "Sweet ideas. Print-ready templates.",
    icon: "palette",
    gradient: ["#fffdfb", "#fff1f5", "#fbe6e0"],
  },
];

export default function StudioPicker() {
  // The picker itself is neutral, so it borrows Ink Lab only to give shared
  // semantic icons their stable fallback color before a studio is chosen.
  return (
    <BrandProvider value={{ brand: BRANDS.ink }}>
      <StudioPickerContent />
    </BrandProvider>
  );
}

function StudioPickerContent() {
  const reduceMotion = useReducedMotion();
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
  });
  const upperOrbStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: reduceMotion ? 0 : scrollY.value * -0.14 }],
  }));
  const lowerOrbStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: reduceMotion ? 0 : scrollY.value * 0.1 }],
  }));

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <LinearGradient
        colors={["#0c0b0a", "#15100f", "#0c0b0a"]}
        locations={[0, 0.48, 1]}
        style={StyleSheet.absoluteFill}
      />
      <Animated.View pointerEvents="none" style={[styles.ambientOne, upperOrbStyle]} />
      <Animated.View pointerEvents="none" style={[styles.ambientTwo, lowerOrbStyle]} />

      <Animated.ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={SPACE.md}
      >
        <View style={styles.masthead}>
          <View style={styles.logoMark}>
            <Icon name="cut" size={TYPE.body.fontSize + SPACE.xs - 4} color={NEUTRAL_THEME.foreground} />
          </View>
          <View style={styles.logoCopy}>
            <Text style={[TYPE.heading, { color: NEUTRAL_THEME.foreground, fontFamily: NEUTRAL_THEME.fontDisplay }]}>INKLINE</Text>
            <Text style={[TYPE.micro, { color: NEUTRAL_THEME.muted, fontFamily: NEUTRAL_THEME.fontBodyMedium }]}>CREATIVE WORKBENCH</Text>
          </View>
          <View style={styles.versionPill}>
            <View style={styles.liveDot} />
            <Text style={[TYPE.micro, { color: NEUTRAL_THEME.muted, fontFamily: NEUTRAL_THEME.fontBodyMedium }]}>2 STUDIOS</Text>
          </View>
        </View>

        <View style={styles.heroCopy}>
          <View style={styles.eyebrowRow}>
            <View style={styles.rule} />
            <Text style={[TYPE.micro, { color: NEUTRAL_THEME.accent, fontFamily: NEUTRAL_THEME.fontBodyMedium }]}>START AT THE BENCH</Text>
          </View>
          <Text style={[TYPE.hero, { color: NEUTRAL_THEME.foreground, fontFamily: NEUTRAL_THEME.fontDisplay }]}>Pick your studio</Text>
          <Text style={[TYPE.body, styles.subhead, { color: NEUTRAL_THEME.muted, fontFamily: NEUTRAL_THEME.fontBody }]}>
            Choose a craft. Turn an idea into clean linework, then build the sheet.
          </Text>
        </View>

        <View style={styles.doors}>
          {doors.map((door, index) => (
            <Animated.View
              key={door.brand.id}
              entering={reduceMotion ? undefined : FadeInDown.delay(index * DOOR_STAGGER_MS).duration(DOOR_DURATION_MS)}
            >
              <StudioDoor door={door} />
            </Animated.View>
          ))}
        </View>

        <Text style={[TYPE.micro, styles.footer, { color: NEUTRAL_THEME.muted, fontFamily: NEUTRAL_THEME.fontBody }]}>
          DESIGN · TRACE · SIZE · PRINT
        </Text>
      </Animated.ScrollView>
    </SafeAreaView>
  );
}

function StudioDoor({ door }: { door: Door }) {
  const { brand, theme, number, tagline, note, icon, gradient } = door;
  const toolRows: readonly [IconName, string][] = [
    ["generate", brand.generate.tabLabel],
    ["convert", brand.convert.tabLabel],
    ["sheet", brand.builder.tabLabel],
  ];

  return (
    <BrandProvider value={{ brand }}>
      <Pressable
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
          <PaperSubstrate
            seed={brand.id === "ink" ? 101 : 202}
            intensity={brand.id === "ink" ? 0.54 : 0.38}
            style={{ opacity: brand.id === "ink" ? 0.16 : 0.28 }}
          />
          <View style={styles.doorTop}>
            <View style={styles.studioMeta}>
              <Text style={[TYPE.heading, { color: theme.accent, fontFamily: theme.fontDisplay }]}>{number}</Text>
              <View>
                <Text style={[TYPE.micro, { color: theme.muted, fontFamily: theme.fontBodyMedium }]}>STUDIO</Text>
                <Text style={[TYPE.caption, styles.studioNote, { color: theme.foreground, fontFamily: theme.fontBody }]}>{note}</Text>
              </View>
            </View>
            <View style={[styles.enterPill, { backgroundColor: theme.accent }]}>
              <Text style={[TYPE.micro, { color: theme.accentText, fontFamily: theme.fontBodyMedium }]}>ENTER</Text>
              <Icon name="arrowForward" size={TYPE.caption.fontSize} color={theme.accentText} />
            </View>
          </View>

          <View style={styles.artStage}>
            <Text
              style={[
                TYPE.hero,
                styles.doorName,
                {
                  color: theme.foreground,
                  fontFamily: brand.id === "sugar" ? theme.fontScript : theme.fontDisplay,
                },
              ]}
            >
              {brand.name}
            </Text>
            <Text style={[TYPE.micro, styles.doorTag, { color: theme.accent, fontFamily: theme.fontBodyMedium }]}>
              {tagline.toUpperCase()}
            </Text>
            <BrandArtwork
              brand={brand.id}
              animated
              style={[styles.artwork, brand.id === "sugar" && styles.sugarArtwork]}
            />
            <View style={[styles.iconSeal, { backgroundColor: theme.accent }]}>
              <Icon name={icon} size={TYPE.body.fontSize + SPACE.xs - 4} color={theme.accentText} />
            </View>
          </View>

          <View style={[styles.tools, { borderTopColor: theme.line }]}>
            {toolRows.map(([toolIcon, label]) => (
              <View key={label} style={[styles.tool, { backgroundColor: `${theme.foreground}0a` }]}>
                <Icon name={toolIcon} size={TYPE.caption.fontSize} color={theme.accent} />
                <Text style={[TYPE.caption, { color: theme.foreground, fontFamily: theme.fontBodyMedium }]}>{label}</Text>
              </View>
            ))}
          </View>
        </LinearGradient>
      </Pressable>
    </BrandProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: NEUTRAL_THEME.background },
  ambientOne: {
    position: "absolute",
    width: SPACE.xxl * 6,
    height: SPACE.xxl * 6,
    borderRadius: RADIUS.pill,
    backgroundColor: "rgba(218,27,46,0.10)",
    top: -SPACE.xxl * 3,
    right: -SPACE.xxl * 2,
  },
  ambientTwo: {
    position: "absolute",
    width: SPACE.xxl * 5 + SPACE.sm,
    height: SPACE.xxl * 5 + SPACE.sm,
    borderRadius: RADIUS.pill,
    backgroundColor: "rgba(209,72,122,0.07)",
    bottom: SPACE.xxl + SPACE.md,
    left: -SPACE.xxl * 4,
  },
  scroll: { padding: SPACE.lg, paddingTop: SPACE.md, paddingBottom: SPACE.xl },
  masthead: { flexDirection: "row", alignItems: "center", marginBottom: SPACE.xl },
  logoMark: {
    width: SPACE.xl + SPACE.xs,
    height: SPACE.xl + SPACE.xs,
    borderRadius: RADIUS.md - 1,
    backgroundColor: NEUTRAL_THEME.accent,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotate: "-4deg" }],
  },
  logoCopy: { marginLeft: SPACE.sm, flex: 1 },
  versionPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.xs,
    borderWidth: 1,
    borderColor: NEUTRAL_THEME.line,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACE.sm,
    paddingVertical: SPACE.xs + 1,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  liveDot: { width: SPACE.xs - 1, height: SPACE.xs - 1, borderRadius: RADIUS.pill, backgroundColor: "#49c379" },
  heroCopy: { marginBottom: SPACE.lg },
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm - 2, marginBottom: SPACE.sm },
  rule: { width: SPACE.lg - SPACE.xs, height: SPACE.xs - 4, borderRadius: RADIUS.pill, backgroundColor: NEUTRAL_THEME.accent },
  subhead: { marginTop: SPACE.sm - 2, maxWidth: SPACE.xxl * 7 + SPACE.md },
  doors: { gap: SPACE.md },
  doorWrap: { borderRadius: RADIUS.xl, borderWidth: 1, overflow: "hidden" },
  pressed: { transform: [{ scale: 0.985 }], opacity: 0.94 },
  door: { padding: SPACE.md, paddingBottom: RADIUS.md },
  doorTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", zIndex: 2 },
  studioMeta: { flexDirection: "row", alignItems: "center", gap: SPACE.sm - 2, flex: 1 },
  studioNote: { marginTop: SPACE.xs - 5 },
  enterPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.xs - 1,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACE.sm + 1,
    paddingVertical: SPACE.xs + 1,
  },
  artStage: { minHeight: SPACE.xxl * 3, justifyContent: "center", overflow: "hidden" },
  artwork: { position: "absolute", width: SPACE.xxl * 4, height: SPACE.xxl * 3, right: -SPACE.sm - SPACE.xs + 3, top: -SPACE.xs + 4 },
  sugarArtwork: { width: SPACE.xxl * 3 + SPACE.xl, right: -SPACE.md },
  iconSeal: {
    position: "absolute",
    width: SPACE.xl + SPACE.xs - SPACE.xs + 2,
    height: SPACE.xl + SPACE.xs - SPACE.xs + 2,
    borderRadius: RADIUS.pill,
    right: SPACE.xs - 2,
    bottom: SPACE.xs - 1,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: SPACE.xs - 3,
    borderColor: "rgba(255,255,255,0.68)",
  },
  doorName: { maxWidth: "86%", zIndex: 2, marginLeft: -SPACE.xs },
  doorTag: { marginTop: SPACE.xs - 3, maxWidth: "56%", zIndex: 2 },
  tools: { flexDirection: "row", gap: SPACE.xs + 1, borderTopWidth: 1, paddingTop: SPACE.sm + 1 },
  tool: {
    flex: 1,
    minHeight: SPACE.xl + 1,
    borderRadius: RADIUS.md - 3,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: SPACE.xs - 1,
    paddingHorizontal: SPACE.xs - 1,
  },
  footer: { textAlign: "center", marginTop: SPACE.lg },
});
