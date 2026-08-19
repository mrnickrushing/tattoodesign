import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { Icon } from "@/components/Icon";
import { PaperSubstrate } from "@/components/PaperSubstrate";
import { useBrand } from "@/context/BrandContext";
import type { IconName } from "@/lib/icons";
import { RADIUS, SPACE, TYPE } from "@/lib/theme";

function CropMarks({ color }: { color: string }) {
  const corners = [
    styles.topLeftMark,
    styles.topRightMark,
    styles.bottomLeftMark,
    styles.bottomRightMark,
  ];
  return (
    <>
      {corners.map((corner, index) => (
        <View
          key={index}
          accessible={false}
          accessibilityElementsHidden
          pointerEvents="none"
          style={[styles.mark, { borderColor: color }, corner]}
        />
      ))}
    </>
  );
}

function DotGrid({ color }: { color: string }) {
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={styles.dotGrid}
    >
      {Array.from({ length: 49 }, (_, index) => {
        const row = Math.floor(index / 7);
        const column = index % 7;
        return (
          <View
            key={index}
            style={[
              styles.dot,
              { backgroundColor: color, top: `${12 + row * 12.5}%`, left: `${12 + column * 12.5}%` },
            ]}
          />
        );
      })}
    </View>
  );
}

/**
 * Turns an empty collection into a prepared piece of stock, so the next
 * meaningful action feels like starting a sheet rather than repairing a void.
 */
export function EmptyStock({
  icon,
  title,
  detail,
  action,
}: {
  icon: IconName;
  title: string;
  detail: string;
  action?: { label: string; onPress: () => void };
}) {
  const { theme } = useBrand();

  return (
    <View
      style={[styles.stock, { backgroundColor: theme.stock, borderColor: theme.stockMark }]}
      accessibilityRole={action ? "summary" : undefined}
    >
      <PaperSubstrate />
      <CropMarks color={theme.stockMark} />
      <DotGrid color={theme.stockGrid} />
      <View
        accessible={false}
        accessibilityElementsHidden
        pointerEvents="none"
        style={styles.ghost}
      >
        <Icon name={icon} size={SPACE.xxl + SPACE.md} color={`${theme.stockInk}10`} />
      </View>
      <View style={styles.content}>
        <View style={[styles.iconWell, { borderColor: theme.stockMark, backgroundColor: `${theme.stock}cc` }]}>
          <Icon name={icon} size={SPACE.xl} color={theme.stockInk} />
        </View>
        <Text style={[styles.title, { color: theme.stockInk, fontFamily: theme.fontBodyMedium }]}>{title}</Text>
        <Text style={[styles.detail, { color: theme.stockMark, fontFamily: theme.fontBody }]}>{detail}</Text>
        {action && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={() => {
              Haptics.selectionAsync();
              action.onPress();
            }}
            style={({ pressed }) => [
              styles.action,
              { backgroundColor: theme.stockInk, opacity: pressed ? 0.78 : 1 },
            ]}
          >
            <Text style={[styles.actionLabel, { color: theme.stock }]}>{action.label}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stock: {
    minHeight: SPACE.xxl * 4,
    overflow: "hidden",
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    alignItems: "center",
    justifyContent: "center",
    padding: SPACE.lg,
  },
  mark: { position: "absolute", width: SPACE.md - SPACE.xs, height: SPACE.md - SPACE.xs },
  topLeftMark: { top: SPACE.sm, left: SPACE.sm, borderTopWidth: 1, borderLeftWidth: 1 },
  topRightMark: { top: SPACE.sm, right: SPACE.sm, borderTopWidth: 1, borderRightWidth: 1 },
  bottomLeftMark: { bottom: SPACE.sm, left: SPACE.sm, borderBottomWidth: 1, borderLeftWidth: 1 },
  bottomRightMark: { bottom: SPACE.sm, right: SPACE.sm, borderBottomWidth: 1, borderRightWidth: 1 },
  dotGrid: StyleSheet.absoluteFill,
  dot: { position: "absolute", width: 1.5, height: 1.5, borderRadius: RADIUS.pill },
  ghost: { position: "absolute", opacity: 1 },
  content: { alignItems: "center", maxWidth: "84%", gap: SPACE.sm },
  iconWell: {
    alignItems: "center",
    justifyContent: "center",
    width: SPACE.xxl + SPACE.md,
    height: SPACE.xxl + SPACE.md,
    borderWidth: 1,
    borderRadius: RADIUS.pill,
    marginBottom: SPACE.xs,
  },
  title: { ...TYPE.heading, textAlign: "center" },
  detail: { ...TYPE.body, textAlign: "center" },
  action: { marginTop: SPACE.sm, minHeight: SPACE.xxl, paddingHorizontal: SPACE.md, borderRadius: RADIUS.pill, justifyContent: "center" },
  actionLabel: { ...TYPE.caption, fontWeight: "600" },
});
