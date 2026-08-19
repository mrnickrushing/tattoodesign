import { Ionicons } from "@expo/vector-icons";
import { SymbolView, type SymbolWeight } from "expo-symbols";
import { Platform } from "react-native";
import { useBrand } from "@/context/BrandContext";
import { iconFor, type IconName } from "@/lib/icons";

const iosVersion = typeof Platform.Version === "number" ? Platform.Version : Number.parseInt(Platform.Version, 10);
const hasSFSymbols = Platform.OS === "ios" && Number.isFinite(iosVersion) && iosVersion >= 13;

/**
 * Keeps semantic controls native-feeling on iOS without ever sacrificing a
 * readable icon on devices where SF Symbols are unavailable.
 */
export function Icon({
  name,
  size = 24,
  color,
  weight = "regular",
}: {
  name: IconName;
  size?: number;
  color?: string;
  weight?: SymbolWeight;
}) {
  const { theme } = useBrand();
  const definition = iconFor(name);
  const resolvedColor = color ?? theme.foreground;

  if (hasSFSymbols) {
    return (
      <SymbolView
        name={definition.sf as Parameters<typeof SymbolView>[0]["name"]}
        size={size}
        tintColor={resolvedColor}
        weight={weight}
        fallback={<Ionicons name={definition.ion} size={size} color={resolvedColor} />}
      />
    );
  }

  return <Ionicons name={definition.ion} size={size} color={resolvedColor} />;
}
