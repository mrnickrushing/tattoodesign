import { View, Text, Pressable, StyleSheet, type ViewStyle } from "react-native";
import type { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useBrand } from "@/context/BrandContext";
import { BrandArtwork } from "@/components/BrandArtwork";
import { Icon } from "@/components/Icon";
import { PaperSubstrate } from "@/components/PaperSubstrate";
import { ICONS, type IconName } from "@/lib/icons";
import { RADIUS, SPACE, TYPE, glow, lift } from "@/lib/theme";

type LegacyIconName = keyof typeof Ionicons.glyphMap;
type IconProp = IconName | LegacyIconName;

const LEGACY_ICON_MAP: Partial<Record<LegacyIconName, IconName>> = {
  "alert-circle-outline": "alert",
  "albums-outline": "projects",
  "cloud-offline-outline": "cloudOffline",
  "cloud-upload-outline": "upload",
  "grid-outline": "sheet",
  "information-circle-outline": "information",
  "key-outline": "key",
  "phone-portrait-outline": "phone",
  "warning-outline": "alert",
};

function semanticIcon(name: IconProp): IconName {
  const legacyIcon = LEGACY_ICON_MAP[name as LegacyIconName];
  if (legacyIcon) return legacyIcon;
  return name in ICONS ? (name as IconName) : "information";
}

/** Screen title block. The rule under the eyebrow echoes the trim line on a
 *  flash sheet, and gives the type somewhere to sit instead of floating. */
export function ScreenHeader({
  eyebrow,
  title,
  subtitle,
  size = "title",
  ground = false,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  /** Lets especially editorial screens promote the title without changing today’s default hierarchy. */
  size?: "title" | "display";
  /** Adds a quiet physical-paper layer while retaining the established header gradient by default. */
  ground?: boolean;
}) {
  const { brand, theme } = useBrand();
  const titleType = size === "display" ? TYPE.display : TYPE.title;
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
      {ground && (
        <PaperSubstrate
          seed={brand.id === "ink" ? 11 : 17}
          intensity={brand.id === "ink" ? 0.18 : 0.3}
          style={{ opacity: brand.id === "ink" ? 0.2 : 0.34 }}
        />
      )}
      <BrandArtwork brand={brand.id} muted style={styles.headerArt} />
      <View style={[styles.headerOrb, { backgroundColor: theme.accentGlow }]} />
      <View style={styles.headerCopy}>
        <View style={styles.eyebrowRow}>
          <View style={[styles.eyebrowRule, { backgroundColor: theme.accent }]} />
          <Text style={[styles.eyebrow, TYPE.micro, { color: theme.accent, fontFamily: theme.fontBodyMedium }]}>
            {eyebrow.toUpperCase()}
          </Text>
          <View style={[styles.studioChip, { borderColor: theme.line, backgroundColor: `${theme.foreground}08` }]}>
            <Text style={[TYPE.micro, { color: theme.muted, fontFamily: theme.fontBodyMedium }]}>
              {brand.name.toUpperCase()}
            </Text>
          </View>
        </View>
        <Text
          accessibilityRole="header"
          style={[styles.title, titleType, { color: theme.foreground, fontFamily: theme.fontDisplay }]}
        >
          {title}
        </Text>
        {subtitle && (
          <Text style={[styles.subtitle, TYPE.body, { color: theme.muted, fontFamily: theme.fontBody }]}>
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
  /** Legacy Ionicons names remain valid; semantic IconName values are additive. */
  icon?: IconProp;
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
        <Icon name={semanticIcon(icon)} size={TYPE.caption.fontSize} color={active ? theme.accentText : theme.muted} />
      )}
      <Text
        style={[TYPE.body, {
          color: active ? theme.accentText : theme.foreground,
          fontFamily: active ? theme.fontBodyMedium : theme.fontBody,
        }]}
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
  action?: { label: string; icon?: IconProp; onPress: () => void };
}) {
  const { theme } = useBrand();
  return (
    <View style={styles.sectionRow}>
      <Text
        accessibilityRole="header"
        style={[styles.section, TYPE.body, { color: theme.foreground, fontFamily: theme.fontBodyMedium }]}
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
          {action.icon && <Icon name={semanticIcon(action.icon)} size={TYPE.caption.fontSize} color={theme.accent} />}
          <Text style={[TYPE.body, { color: theme.accent, fontFamily: theme.fontBodyMedium }]}>
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
  icon?: IconProp;
}) {
  const { theme } = useBrand();
  const color = tone === "danger" ? theme.danger : theme.muted;
  return (
    <View
      accessibilityRole="alert"
      style={[styles.notice, { borderColor: `${color}55`, backgroundColor: `${color}12` }]}
    >
      <View style={styles.noticeIcon}>
        <Icon name={semanticIcon(icon)} size={TYPE.body.fontSize} color={color} />
      </View>
      <Text style={[styles.noticeText, TYPE.body, { color, fontFamily: theme.fontBody }]}>{children}</Text>
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
  headerOrb: {
    position: "absolute",
    width: SPACE.xxl * 3 + SPACE.sm,
    height: SPACE.xxl * 3 + SPACE.sm,
    borderRadius: RADIUS.pill,
    right: -SPACE.xxl - SPACE.lg,
    top: -SPACE.xxl * 2 + SPACE.sm + SPACE.xs,
    opacity: 0.45,
  },
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, marginBottom: SPACE.sm },
  eyebrowRule: { width: SPACE.lg - SPACE.xs, height: 2, borderRadius: RADIUS.pill },
  eyebrow: {},
  studioChip: { borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: SPACE.sm - SPACE.xs, paddingVertical: SPACE.xs - 2 },
  title: {},
  subtitle: { marginTop: SPACE.sm - 2, maxWidth: "86%" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.xs,
    borderWidth: 1,
    borderRadius: RADIUS.pill,
    paddingHorizontal: RADIUS.md,
    minHeight: SPACE.xxl,
  },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: SPACE.sm,
  },
  section: {},
  sectionAction: { flexDirection: "row", alignItems: "center", gap: SPACE.xs - 1, paddingVertical: SPACE.xs - 2 },
  notice: {
    flexDirection: "row",
    gap: SPACE.sm - 2,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACE.md - SPACE.xs,
  },
  noticeIcon: { marginTop: SPACE.xs - 5 },
  noticeText: { flex: 1 },
  card: {
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    padding: SPACE.md,
  },
  cardNotch: { position: "absolute", width: SPACE.xxl, height: SPACE.xs - 3, borderRadius: RADIUS.pill, left: SPACE.md, top: 0 },
});
