import { View, Text, Pressable, StyleSheet, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useBrand } from "@/context/BrandContext";
import { RADIUS, SPACE } from "@/lib/theme";

/** Screen title block. The rule under the eyebrow echoes the trim line on a
 *  flash sheet, and gives the type somewhere to sit instead of floating. */
export function ScreenHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
}) {
  const { theme } = useBrand();
  return (
    <View style={styles.header}>
      <View style={styles.eyebrowRow}>
        <View style={[styles.eyebrowRule, { backgroundColor: theme.accent }]} />
        <Text style={[styles.eyebrow, { color: theme.accent, fontFamily: theme.fontBodyMedium }]}>
          {eyebrow.toUpperCase()}
        </Text>
      </View>
      <Text
        accessibilityRole="header"
        style={[styles.title, { color: theme.foreground, fontFamily: theme.fontDisplay }]}
      >
        {title}
      </Text>
      {subtitle && (
        <Text style={[styles.subtitle, { color: theme.muted, fontFamily: theme.fontBody }]}>
          {subtitle}
        </Text>
      )}
    </View>
  );
}

/** Selectable chip. Active state is a filled accent pill; inactive is a quiet
 *  recessed well, so the row reads as one control rather than N buttons. */
export function Chip({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  active: boolean;
  onPress: () => void;
}) {
  const { theme } = useBrand();
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: active ? theme.accent : theme.surfaceAlt,
          borderColor: active ? theme.accent : theme.line,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      {icon && (
        <Ionicons name={icon} size={14} color={active ? theme.accentText : theme.muted} />
      )}
      <Text
        style={{
          color: active ? theme.accentText : theme.foreground,
          fontFamily: active ? theme.fontBodyMedium : theme.fontBody,
          fontSize: 13,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Section label with an optional trailing action, e.g. "Your designs · Upload". */
export function SectionLabel({
  children,
  action,
}: {
  children: string;
  action?: { label: string; icon?: keyof typeof Ionicons.glyphMap; onPress: () => void };
}) {
  const { theme } = useBrand();
  return (
    <View style={styles.sectionRow}>
      <Text
        accessibilityRole="header"
        style={[styles.section, { color: theme.foreground, fontFamily: theme.fontBodyMedium }]}
      >
        {children}
      </Text>
      {action && (
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            action.onPress();
          }}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          hitSlop={10}
          style={({ pressed }) => [styles.sectionAction, { opacity: pressed ? 0.6 : 1 }]}
        >
          {action.icon && <Ionicons name={action.icon} size={14} color={theme.accent} />}
          <Text style={{ color: theme.accent, fontFamily: theme.fontBodyMedium, fontSize: 13 }}>
            {action.label}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

/** Inline notice for errors and disabled-capability messages. */
export function Notice({
  children,
  tone = "danger",
  icon = "alert-circle-outline",
}: {
  children: string;
  tone?: "danger" | "info";
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const { theme } = useBrand();
  const color = tone === "danger" ? theme.danger : theme.muted;
  return (
    <View
      accessibilityRole="alert"
      style={[styles.notice, { borderColor: `${color}55`, backgroundColor: `${color}12` }]}
    >
      <Ionicons name={icon} size={16} color={color} style={{ marginTop: 1 }} />
      <Text style={[styles.noticeText, { color, fontFamily: theme.fontBody }]}>{children}</Text>
    </View>
  );
}

/** Groups controls onto a raised card so a screen isn't one flat column. */
export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const { theme } = useBrand();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.line },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: SPACE.lg },
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  eyebrowRule: { width: 18, height: 2, borderRadius: 1 },
  eyebrow: { fontSize: 10, letterSpacing: 2 },
  title: { fontSize: 34, lineHeight: 37, letterSpacing: 0.3 },
  subtitle: { fontSize: 14, lineHeight: 20, marginTop: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 14,
    minHeight: 44,
  },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: SPACE.sm,
  },
  section: { fontSize: 15 },
  sectionAction: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 4 },
  notice: {
    flexDirection: "row",
    gap: 8,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: 12,
  },
  noticeText: { flex: 1, fontSize: 13, lineHeight: 18 },
  card: {
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    padding: SPACE.md,
  },
});
