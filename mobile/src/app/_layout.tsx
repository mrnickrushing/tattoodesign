import { useEffect, useCallback } from "react";
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

  const onLayoutRootView = useCallback(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  useEffect(() => {
    onLayoutRootView();
  }, [onLayoutRootView]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="[brand]" />
        </Stack>
      </View>
    </GestureHandlerRootView>
  );
}
