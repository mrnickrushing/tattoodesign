import { useCallback, useEffect, useState } from "react";
import { Stack } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import { View } from "react-native";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { loadSkia } from "@/lib/skiaReady";

// Required by exact path, not imported from the package root. A root import
// pulls in every weight and style the package ships — Inter alone is eighteen
// weights in two styles — and asset requires are not tree-shaken, so all of
// them end up in the bundle. This is 11MB of fonts against about 1MB.
const BebasNeue_400Regular = require("@expo-google-fonts/bebas-neue/400Regular/BebasNeue_400Regular.ttf");
const Sora_400Regular = require("@expo-google-fonts/sora/400Regular/Sora_400Regular.ttf");
const Sora_600SemiBold = require("@expo-google-fonts/sora/600SemiBold/Sora_600SemiBold.ttf");
const PlayfairDisplay_700Bold = require("@expo-google-fonts/playfair-display/700Bold/PlayfairDisplay_700Bold.ttf");
const Caveat_600SemiBold = require("@expo-google-fonts/caveat/600SemiBold/Caveat_600SemiBold.ttf");
const Inter_400Regular = require("@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf");
const Inter_600SemiBold = require("@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf");

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    BebasNeue_400Regular,
    Sora_400Regular,
    Sora_600SemiBold,
    PlayfairDisplay_700Bold,
    Caveat_600SemiBold,
    Inter_400Regular,
    Inter_600SemiBold,
  });

  // In a browser Skia is WebAssembly that has to be fetched before the first
  // call. Waiting here costs a moment on first load; not waiting means every
  // tool that touches pixels fails the moment it is pressed.
  const [skiaReady, setSkiaReady] = useState(false);
  useEffect(() => {
    let active = true;
    loadSkia()
      .catch(() => {
        // A design tool that will not open is worse than one whose pixel work
        // errors when used, so a failed load still lets the app start.
      })
      .finally(() => {
        if (active) setSkiaReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const onLayoutRootView = useCallback(() => {
    if (fontsLoaded && skiaReady) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded, skiaReady]);

  if (!fontsLoaded || !skiaReady) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
        <ErrorBoundary>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="[brand]" />
          </Stack>
        </ErrorBoundary>
      </View>
    </GestureHandlerRootView>
  );
}
