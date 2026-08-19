import { useMemo, useState } from "react";
import { Platform, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import { AlphaType, Canvas, ColorType, Image, Skia } from "@shopify/react-native-skia";
import { useBrand } from "@/context/BrandContext";
import { grainField, vignetteAlpha, type PaperKind } from "@/lib/paper";

type Size = { width: number; height: number };

function safeIntensity(value: number | undefined) {
  if (!Number.isFinite(value)) return 0.45;
  return Math.min(1, Math.max(0, value ?? 0.45));
}

function grainImage(kind: PaperKind, seed: number, size: Size) {
  const fieldSize = Math.max(32, Math.min(128, Math.round(Math.max(size.width, size.height) / 4)));
  const field = grainField(kind, seed, fieldSize);
  const pixels = new Uint8Array(field.width * field.height * 4);

  for (let y = 0; y < field.height; y++) {
    for (let x = 0; x < field.width; x++) {
      const index = (y * field.width + x) * 4;
      const tooth = Math.abs(field.values[y * field.width + x] - 0.5) * 2;
      const edge = vignetteAlpha(x, y, field.width - 1, field.height - 1, 0.055);
      pixels[index] = 72;
      pixels[index + 1] = 57;
      pixels[index + 2] = 42;
      pixels[index + 3] = Math.round(Math.min(0.13, tooth * 0.08 + edge) * 255);
    }
  }

  return Skia.Image.MakeImage(
    {
      width: field.width,
      height: field.height,
      colorType: ColorType.RGBA_8888,
      alphaType: AlphaType.Unpremul,
    },
    Skia.Data.fromBytes(pixels),
    field.width * 4
  );
}

/**
 * Gives every stock surface a fixed physical tooth, so the studio reads as
 * printed paper instead of a collection of flat colour fills.
 */
export function PaperSubstrate({
  kind,
  seed = 0,
  intensity,
  style,
}: {
  kind?: PaperKind;
  seed?: number;
  intensity?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { brand, theme } = useBrand();
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const paperKind = kind ?? (brand.id === "ink" ? "flash" : "parchment");
  const resolvedIntensity = safeIntensity(intensity);
  const shouldRenderSkia = Platform.OS !== "web" && size.width > 0 && size.height > 0;
  const image = useMemo(
    () => (shouldRenderSkia ? grainImage(paperKind, seed, size) : null),
    [paperKind, seed, shouldRenderSkia, size]
  );

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    const next = { width: Math.round(width), height: Math.round(height) };
    setSize((current) => (current.width === next.width && current.height === next.height ? current : next));
  };

  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      onLayout={onLayout}
      style={[styles.substrate, { backgroundColor: theme.stock }, style]}
    >
      {shouldRenderSkia && image && (
        <Canvas pointerEvents="none" style={styles.canvas}>
          <Image image={image} x={0} y={0} width={size.width} height={size.height} fit="fill" opacity={resolvedIntensity} />
        </Canvas>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  substrate: { ...StyleSheet.absoluteFill, overflow: "hidden" },
  canvas: StyleSheet.absoluteFill,
});
