import { View, Text, Pressable, StyleSheet, useWindowDimensions } from "react-native";
import { Tabs, useLocalSearchParams, router, Redirect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { getBrand, type BrandId } from "@/lib/brands";
import { RADIUS, SPACE, TYPE, type Theme } from "@/lib/theme";
import { BrandProvider, useBrand } from "@/context/BrandContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { GlassSurface, hasLiquidGlass } from "@/components/GlassSurface";
import { Icon } from "@/components/Icon";
import { isWide } from "@/lib/breakpoints";
import type { IconName } from "@/lib/icons";

/** Wide enough for the longest tab label without wrapping. */
const SIDEBAR_WIDTH = 208;

const tabIcons: Record<string, IconName> = {
  index: "home",
  generate: "generate",
  convert: "convert",
  builder: "sheet",
  settings: "settings",
};

export default function BrandLayout() {
  const { brand: brandParam } = useLocalSearchParams<{ brand: string }>();
  const brand = getBrand(brandParam ?? "");

  if (!brand) return <Redirect href="/" />;

  return (
    <BrandProvider value={{ brand }}>
      <BrandChrome />
    </BrandProvider>
  );
}

function BrandChrome() {
  const { brand, theme, appearance } = useBrand();
  const { width } = useWindowDimensions();
  // On anything laptop-sized the bottom bar is in the wrong place: it is a
  // thumb affordance on a device nobody is holding, and it wastes the one
  // dimension a desktop window has plenty of. Moving it to the side is what
  // stops the app reading as a phone dropped into a browser.
  const wide = isWide(width);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <StatusBar style={appearance === "dark" ? "light" : "dark"} />
      <StudioHeader
        brandId={brand.id}
        wordmark={brand.wordmark}
        wordmarkFont={brand.id === "sugar" ? theme.fontScript : theme.fontDisplay}
        switchTo={brand.switchTo}
        theme={theme}
      />
      {/* Scoped beneath the root boundary in _layout.tsx: a crash in one
          tab's content falls back here, keeping the header and tab bar
          (and the ability to switch tabs or studios) alive. */}
      <ErrorBoundary>
        <Tabs
          screenOptions={({ route }) => ({
            headerShown: false,
            sceneStyle: { backgroundColor: theme.background },
            tabBarPosition: wide ? ("left" as const) : ("bottom" as const),
            tabBarStyle: wide
              ? {
                  backgroundColor: theme.surface,
                  borderRightColor: theme.line,
                  borderRightWidth: 1,
                  width: SIDEBAR_WIDTH,
                  paddingTop: SPACE.md,
                  paddingHorizontal: SPACE.sm,
                }
              : {
                  // An absolute bar lets the liquid layer refract scrolling
                  // content. Older runtimes retain the exact surfaced bar they
                  // shipped with.
                  backgroundColor: hasLiquidGlass ? "transparent" : theme.surface,
                  borderTopColor: theme.line,
                  borderTopWidth: 1,
                  height: SPACE.xxl * 2,
                  paddingTop: SPACE.xs,
                  paddingHorizontal: SPACE.xs,
                  ...(hasLiquidGlass ? { position: "absolute" as const } : {}),
                },
            tabBarBackground: hasLiquidGlass && !wide ? () => <TabBarGlass brandId={brand.id} /> : undefined,
            tabBarItemStyle: wide
              ? {
                  borderRadius: RADIUS.md,
                  marginHorizontal: 0,
                  marginVertical: 2,
                  paddingVertical: SPACE.sm,
                  justifyContent: "flex-start",
                }
              : {
                  borderRadius: RADIUS.lg,
                  marginHorizontal: SPACE.xs - 3,
                  marginVertical: SPACE.xs - 2,
                },
            tabBarActiveBackgroundColor: `${theme.accent}16`,
            tabBarActiveTintColor: theme.accent,
            tabBarInactiveTintColor: theme.muted,
            tabBarHideOnKeyboard: true,
            tabBarLabelStyle: {
              fontFamily: theme.fontBodyMedium,
              ...TYPE.caption,
            },
            tabBarIcon: ({ focused, color, size }) => (
              <Icon
                name={tabIcons[route.name] ?? "home"}
                size={size ?? TYPE.heading.fontSize}
                color={typeof color === "string" ? color : theme.muted}
                weight={focused ? "semibold" : "regular"}
              />
            ),
          })}
        >
          <Tabs.Screen name="index" options={{ title: "Home" }} />
          <Tabs.Screen name="generate" options={{ title: brand.generate.tabLabel }} />
          <Tabs.Screen name="convert" options={{ title: brand.convert.tabLabel }} />
          <Tabs.Screen name="builder" options={{ title: brand.builder.tabLabel }} />
          <Tabs.Screen name="settings" options={{ title: "Settings" }} />
          <Tabs.Screen name="projects" options={{ href: null }} />
        </Tabs>
      </ErrorBoundary>
    </View>
  );
}

function TabBarGlass({ brandId }: { brandId: BrandId }) {
  const { theme } = useBrand();

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {brandId === "ink" && <View style={[styles.tabGlow, { backgroundColor: theme.accentGlow }]} />}
      <GlassSurface tint="regular" style={StyleSheet.absoluteFill}>
        <View />
      </GlassSurface>
    </View>
  );
}

function StudioHeader({
  brandId,
  wordmark,
  wordmarkFont,
  switchTo,
  theme,
}: {
  brandId: BrandId;
  wordmark: string;
  wordmarkFont: string;
  switchTo: { id: BrandId; label: string };
  theme: Theme;
}) {
  const content = (
    <HeaderContents
      brandId={brandId}
      wordmark={wordmark}
      wordmarkFont={wordmarkFont}
      switchTo={switchTo}
      theme={theme}
    />
  );

  if (!hasLiquidGlass) {
    return (
      <SafeAreaView
        edges={["top"]}
        style={{ backgroundColor: theme.surface, borderBottomWidth: 1, borderBottomColor: theme.line }}
      >
        <LinearGradient
          colors={brandId === "ink" ? [theme.surface, "#211715"] : [theme.surface, "#fdf0f4"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.header}
        >
          {content}
        </LinearGradient>
      </SafeAreaView>
    );
  }

  // The glass is a backdrop, not a wrapper. Putting the header's only
  // height-bearing content inside an absoluteFill child left this View with
  // nothing to measure, so it collapsed to its 1px border and every screen
  // below it started under the status bar.
  return (
    <View style={[styles.glassHeader, { borderBottomColor: theme.line }]}>
      <GlassSurface tint="regular" style={StyleSheet.absoluteFill} />
      {brandId === "ink" && <View pointerEvents="none" style={[styles.headerGlow, { backgroundColor: theme.accentGlow }]} />}
      <SafeAreaView edges={["top"]}>
        <View style={styles.header}>{content}</View>
      </SafeAreaView>
    </View>
  );
}

function HeaderContents({
  brandId,
  wordmark,
  wordmarkFont,
  switchTo,
  theme,
}: {
  brandId: BrandId;
  wordmark: string;
  wordmarkFont: string;
  switchTo: { id: BrandId; label: string };
  theme: Theme;
}) {
  return (
    <>
      <View style={styles.brandRow}>
        <View style={[styles.brandSeal, { backgroundColor: theme.accent }]}>
          <Icon name={brandId === "ink" ? "flash" : "palette"} size={TYPE.caption.fontSize + SPACE.xs - 3} color={theme.accentText} />
        </View>
        <View>
          <Text accessibilityRole="header" style={[TYPE.heading, { fontFamily: wordmarkFont, color: theme.foreground }]}>
            {wordmark}
          </Text>
          <Text style={[TYPE.micro, { color: theme.muted, fontFamily: theme.fontBodyMedium }]}>
            CREATIVE WORKBENCH
          </Text>
        </View>
      </View>

      <Pressable
        onPress={() => {
          Haptics.selectionAsync();
          router.replace(`/${switchTo.id}`);
        }}
        accessibilityRole="button"
        accessibilityLabel={`Switch to ${switchTo.label}`}
        hitSlop={SPACE.md - SPACE.xs + 2}
        style={({ pressed }) => [
          styles.switch,
          { borderColor: theme.line, backgroundColor: theme.surfaceAlt, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Icon name="swap" size={TYPE.caption.fontSize + 1} color={theme.muted} />
        <Text style={[TYPE.caption, { color: theme.muted, fontFamily: theme.fontBody }]}>
          {switchTo.label}
        </Text>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  glassHeader: { borderBottomWidth: 1, overflow: "hidden" },
  headerGlow: {
    position: "absolute",
    width: SPACE.xxl * 4,
    height: SPACE.xxl * 3,
    borderRadius: RADIUS.pill,
    right: -SPACE.xxl,
    top: -SPACE.xxl * 2,
    opacity: 0.72,
  },
  tabGlow: {
    position: "absolute",
    width: SPACE.xxl * 4,
    height: SPACE.xxl * 2,
    borderRadius: RADIUS.pill,
    right: -SPACE.xxl,
    bottom: -SPACE.xxl,
    opacity: 0.52,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm - 2 },
  brandSeal: {
    width: SPACE.xl,
    height: SPACE.xl,
    borderRadius: RADIUS.md - 2,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotate: "-3deg" }],
  },
  switch: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.xs - 1,
    borderWidth: 1,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACE.sm + 1,
    paddingVertical: SPACE.xs + 1,
  },
});
