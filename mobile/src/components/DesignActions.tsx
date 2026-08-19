import { Modal, View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { Image } from "expo-image";
import type { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";
import { useBrand } from "@/context/BrandContext";
import { Icon } from "@/components/Icon";
import { PaperSubstrate } from "@/components/PaperSubstrate";
import { ICONS, type IconName } from "@/lib/icons";
import { SPACE, RADIUS, TYPE } from "@/lib/theme";

export type DesignAction = {
  key: string;
  label: string;
  hint?: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone?: "danger";
  onPress: () => void;
};

/**
 * What you can do with one design.
 *
 * This started as an Alert with three buttons, which is fine for three and
 * unreadable at seven — and a system alert can't show the design you're
 * acting on. A sheet can, and has room to say what each action does.
 */
export function DesignActions({
  title,
  uri,
  actions,
  onClose,
}: {
  title: string;
  uri: string;
  actions: DesignAction[];
  onClose: () => void;
}) {
  const { theme } = useBrand();

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Dismiss" />
      <SafeAreaView
        edges={["bottom"]}
        style={[styles.sheet, { backgroundColor: theme.surface, borderColor: theme.line }]}
      >
        <View style={[styles.grip, { backgroundColor: theme.line }]} />

        <View style={styles.head}>
          <View style={[styles.thumb, { backgroundColor: theme.stock, borderColor: theme.line }]}>
            <PaperSubstrate seed={title.length} intensity={0.42} />
            <Image source={{ uri }} style={styles.thumbImage} contentFit="contain" alt={title} />
          </View>
          <Text
            accessibilityRole="header"
            numberOfLines={2}
            style={[styles.title, { color: theme.foreground, fontFamily: theme.fontBodyMedium }]}
          >
            {title}
          </Text>
        </View>

        <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: SPACE.sm }}>
          {actions.map((action, i) => {
            const color = action.tone === "danger" ? theme.danger : theme.foreground;
            return (
              <Pressable
                key={action.key}
                onPress={() => {
                  Haptics.selectionAsync();
                  onClose();
                  action.onPress();
                }}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                accessibilityHint={action.hint}
                style={({ pressed }) => [
                  styles.row,
                  i > 0 && { borderTopWidth: 1, borderTopColor: theme.line },
                  pressed && { backgroundColor: theme.surfaceAlt },
                ]}
              >
                <Icon name={iconNameFor(action.icon)} size={SPACE.md + SPACE.xs} color={color} />
                <View style={{ flex: 1 }}>
                  <Text style={[TYPE.body, { color, fontFamily: theme.fontBody }]}>
                    {action.label}
                  </Text>
                  {action.hint && (
                    <Text
                      style={[TYPE.caption, { color: theme.muted, fontFamily: theme.fontBody }]}
                      numberOfLines={1}
                    >
                      {action.hint}
                    </Text>
                  )}
                </View>
                <Icon name="chevronForward" size={SPACE.md} color={theme.muted} />
              </Pressable>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function iconNameFor(icon: keyof typeof Ionicons.glyphMap): IconName {
  return (Object.keys(ICONS) as IconName[]).find((name) => ICONS[name].ion === icon) ?? "document";
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(8,7,7,0.55)" },
  sheet: {
    borderTopWidth: 1,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    paddingHorizontal: SPACE.md,
    paddingTop: SPACE.sm,
    maxHeight: "78%",
  },
  grip: { alignSelf: "center", width: SPACE.xl + SPACE.xs, height: StyleSheet.hairlineWidth * 3, borderRadius: RADIUS.pill, marginBottom: SPACE.md },
  head: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, marginBottom: SPACE.sm },
  thumb: {
    width: 46,
    height: 46,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    overflow: "hidden",
  },
  thumbImage: { width: "100%", height: "100%" },
  title: { flex: 1, ...TYPE.body },
  list: { flexGrow: 0 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.sm,
    paddingVertical: 13,
    minHeight: 54,
  },
});
