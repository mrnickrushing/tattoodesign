import { View, Text, Pressable, StyleSheet, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useBrand } from "@/context/BrandContext";
import { BrandArtwork } from "@/components/BrandArtwork";
import { RADIUS, SPACE, glow, lift } from "@/lib/theme";

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
  const { brand, theme } = useBrand();
  const heroColors =
    brand.id === "ink"
      ? (["#211715", theme.surface, "#11100f"] as const)
      : (["#ffffff", "#fcebf1", "#faeee7"] as const);

  return (
    <LinearGradient
      colors={heroColors}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        styles.header,
        { borderColor: theme.line },
        brand.id === "ink" ? glow(theme, "sm") : lift("sm"),
      ]}
    >
      <BrandArtwork brand={brand.id} muted style={styles.headerArt} />
      <View style={[styles.headerOrb, { backgroundColor: theme.accentGlow }]} />
      <View style={styles.headerCopy}>
        <View style={styles.eyebrowRow}>
          <View style={[styles.eyebrowRule, { backgroundColor: theme.accent }]} />
          <Text style={[styles.eyebrow, { color: theme.accent, fontFamily: theme.fontBodyMedium }]}>
            {eyebrow.toUpperCase()}
          </Text>
          <View style={[styles.studioChip, { borderColor: theme.line, backgroundColor: `${theme.foreground}08` }]}>
            <Text style={{ color: theme.muted, fontFamily: theme.fontBodyMedium, fontSize: 8, letterSpacing: 1 }}>
              {brand.name.toUpperCase()}
            </Text>
          </View>
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
    </LinearGradient>
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
  const { brand, theme } = useBrand();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.line },
        brand.id === "ink" ? glow(theme, "sm") : lift("sm"),
        style,
      ]}
    >
      <View style={[styles.cardNotch, { backgroundColor: theme.accent }]} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    marginBottom: SPACE.lg,
    borderWidth: 1,
    borderRadius: RADIUS.xl,
    padding: SPACE.md,
    minHeight: 172,
    overflow: "hidden",
    justifyContent: "center",
  },
  headerCopy: { zIndex: 2, maxWidth: "82%" },
  headerArt: { position: "absolute", width: 160, height: 120, right: -46, bottom: -14, opacity: 0.6 },
  headerOrb: { position: "absolute", width: 150, height: 150, borderRadius: 75, right: -65, top: -75, opacity: 0.45 },
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  eyebrowRule: { width: 18, height: 2, borderRadius: 1 },
  eyebrow: { fontSize: 10, letterSpacing: 2 },
  studioChip: { borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: 8, paddingVertical: 4 },
  title: { fontSize: 34, lineHeight: 37, letterSpacing: 0.3 },
  subtitle: { fontSize: 14, lineHeight: 20, marginTop: 8, maxWidth: "86%" },
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
  cardNotch: { position: "absolute", width: 44, height: 3, borderRadius: 2, left: SPACE.md, top: 0 },
});
