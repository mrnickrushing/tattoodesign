import { Modal, View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";
import { useBrand } from "@/context/BrandContext";
import { SPACE, RADIUS } from "@/lib/theme";

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
                <Ionicons name={action.icon} size={19} color={color} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color, fontFamily: theme.fontBody, fontSize: 15 }}>
                    {action.label}
                  </Text>
                  {action.hint && (
                    <Text
                      style={{ color: theme.muted, fontFamily: theme.fontBody, fontSize: 11 }}
                      numberOfLines={1}
                    >
                      {action.hint}
                    </Text>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={15} color={theme.muted} />
              </Pressable>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
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
  grip: { alignSelf: "center", width: 38, height: 4, borderRadius: 2, marginBottom: SPACE.md },
  head: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, marginBottom: SPACE.sm },
  thumb: {
    width: 46,
    height: 46,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    overflow: "hidden",
  },
  thumbImage: { width: "100%", height: "100%" },
  title: { flex: 1, fontSize: 16 },
  list: { flexGrow: 0 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.sm,
    paddingVertical: 13,
    minHeight: 54,
  },
});
