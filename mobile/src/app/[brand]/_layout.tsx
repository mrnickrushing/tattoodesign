import { useMemo } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Tabs, useLocalSearchParams, router, Redirect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { getBrand } from "@/lib/brands";
import { THEMES, SPACE, RADIUS } from "@/lib/theme";
import { BrandProvider } from "@/context/BrandContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export default function BrandLayout() {
  const { brand: brandParam } = useLocalSearchParams<{ brand: string }>();
  const brand = getBrand(brandParam ?? "");
  const theme = brand ? THEMES[brand.id] : null;
  const value = useMemo(
    () => (brand && theme ? { brand, theme } : null),
    [brand, theme]
  );

  if (!brand || !theme || !value) return <Redirect href="/" />;

  const icons = {
    index: ["sparkles", "sparkles-outline"],
    convert: ["scan", "scan-outline"],
    builder: ["grid", "grid-outline"],
  } as const;

  return (
    <BrandProvider value={value}>
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        <StudioHeader
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
              tabBarStyle: {
                backgroundColor: theme.surface,
                borderTopColor: theme.line,
                height: 88,
                paddingTop: 8,
              },
              tabBarActiveTintColor: theme.accent,
              tabBarInactiveTintColor: theme.muted,
              tabBarLabelStyle: {
                fontFamily: theme.fontBodyMedium,
                fontSize: 11,
                letterSpacing: 0.3,
              },
              tabBarIcon: ({ focused, color, size }) => {
                const pair = icons[route.name as keyof typeof icons] ?? icons.index;
                return (
                  <Ionicons name={focused ? pair[0] : pair[1]} size={size ?? 22} color={color} />
                );
              },
            })}
          >
            <Tabs.Screen name="index" options={{ title: brand.generate.tabLabel }} />
            <Tabs.Screen name="convert" options={{ title: brand.convert.tabLabel }} />
            <Tabs.Screen name="builder" options={{ title: brand.builder.tabLabel }} />
          </Tabs>
        </ErrorBoundary>
      </View>
    </BrandProvider>
  );
}

function StudioHeader({
  wordmark,
  wordmarkFont,
  switchTo,
  theme,
}: {
  wordmark: string;
  wordmarkFont: string;
  switchTo: { id: string; label: string };
  theme: (typeof THEMES)["ink"];
}) {
  return (
    <SafeAreaView
      edges={["top"]}
      style={{
        backgroundColor: theme.surface,
        borderBottomWidth: 1,
        borderBottomColor: theme.line,
      }}
    >
      <View style={styles.header}>
        <View style={styles.brandRow}>
          {/* A small ink-dot lockup so the wordmark isn't floating alone. */}
          <View style={[styles.dot, { backgroundColor: theme.accent }]} />
          <Text
            accessibilityRole="header"
            style={{ fontFamily: wordmarkFont, fontSize: 25, color: theme.foreground }}
          >
            {wordmark}
          </Text>
        </View>

        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            router.replace(`/${switchTo.id}`);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Switch to ${switchTo.label}`}
          hitSlop={12}
          style={({ pressed }) => [
            styles.switch,
            { borderColor: theme.line, backgroundColor: theme.surfaceAlt, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Ionicons name="swap-horizontal" size={13} color={theme.muted} />
          <Text style={{ color: theme.muted, fontSize: 12, fontFamily: theme.fontBody }}>
            {switchTo.label}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  switch: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
});
