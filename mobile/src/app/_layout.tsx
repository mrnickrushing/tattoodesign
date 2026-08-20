import { useCallback, useEffect, useState } from "react";
import { Stack } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import { View } from "react-native";
import { BebasNeue_400Regular } from "@expo-google-fonts/bebas-neue";
import { Sora_400Regular, Sora_600SemiBold } from "@expo-google-fonts/sora";
import { PlayfairDisplay_700Bold } from "@expo-google-fonts/playfair-display";
import { Caveat_600SemiBold } from "@expo-google-fonts/caveat";
import { Inter_400Regular, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { loadSkia } from "@/lib/skiaReady";

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
