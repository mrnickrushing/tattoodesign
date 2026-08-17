import { useMemo } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Tabs, useLocalSearchParams, router, Redirect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { getBrand } from "@/lib/brands";
import { THEMES } from "@/lib/theme";
import { BrandProvider } from "@/context/BrandContext";

export default function BrandLayout() {
  const { brand: brandParam } = useLocalSearchParams<{ brand: string }>();
  const brand = getBrand(brandParam ?? "");
  const theme = brand ? THEMES[brand.id] : null;
  const value = useMemo(
    () => (brand && theme ? { brand, theme } : null),
    [brand, theme]
  );

  if (!brand || !theme || !value) return <Redirect href="/" />;

  return (
    <BrandProvider value={value}>
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        <StudioHeader
          wordmark={brand.wordmark}
          wordmarkFont={brand.id === "sugar" ? theme.fontScript : theme.fontDisplay}
          switchTo={brand.switchTo}
          theme={theme}
        />
        <Tabs
          screenOptions={{
            headerShown: false,
            sceneStyle: { backgroundColor: theme.background },
            tabBarStyle: {
              backgroundColor: theme.paper,
              borderTopColor: theme.line,
            },
            tabBarActiveTintColor: theme.accent,
            tabBarInactiveTintColor: theme.muted,
            tabBarLabelStyle: { fontFamily: theme.fontBodyMedium, fontSize: 12 },
          }}
        >
          <Tabs.Screen name="index" options={{ title: brand.generate.tabLabel }} />
          <Tabs.Screen name="convert" options={{ title: brand.convert.tabLabel }} />
          <Tabs.Screen name="builder" options={{ title: brand.builder.tabLabel }} />
        </Tabs>
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
      style={{ backgroundColor: theme.paper, borderBottomWidth: 1, borderBottomColor: theme.line }}
    >
      <View style={styles.header}>
        <Text
          style={{
            fontFamily: wordmarkFont,
            fontSize: 24,
            color: theme.foreground,
          }}
        >
          {wordmark}
        </Text>
        <Pressable onPress={() => router.replace(`/${switchTo.id}`)}>
          <Text style={{ color: theme.muted, fontSize: 12, fontFamily: theme.fontBody }}>
            {switchTo.label} →
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
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
});
