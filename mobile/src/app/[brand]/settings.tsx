import { useEffect, useState } from "react";
import { View, Text, TextInput, StyleSheet, ScrollView, Alert, Linking } from "react-native";
import * as Updates from "expo-updates";
import * as Application from "expo-application";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useBrand } from "@/context/BrandContext";
import { API_BASE_URL } from "@/lib/api";
import { Button } from "@/components/Button";
import { ScreenHeader, Card, SectionLabel, Notice } from "@/components/ui";
import { SPACE } from "@/lib/theme";
import { getGenerationUsage, getSpendLimit, setSpendLimit, totalEstimatedSpend } from "@/lib/generationUsage";

export default function SettingsScreen() {
  const { brand, theme } = useBrand();
  const {
    currentlyRunning,
    availableUpdate,
    isUpdateAvailable,
    isUpdatePending,
    isChecking,
    isDownloading,
    checkError,
    downloadError,
    lastCheckForUpdateTimeSinceRestart,
  } = Updates.useUpdates();

  const [checkedOnce, setCheckedOnce] = useState(false);
  const [limit, setLimit] = useState("10");
  const [spend, setSpend] = useState(0);

  useEffect(() => {
    Promise.all([getSpendLimit(), getGenerationUsage()]).then(([savedLimit, usage]) => {
      setLimit(savedLimit.toFixed(2));
      setSpend(totalEstimatedSpend(usage));
    });
  }, []);

  async function saveLimit() {
    const value = Number(limit);
    if (!Number.isFinite(value) || value < 0) return setLimit("10.00");
    await setSpendLimit(value);
    setLimit(value.toFixed(2));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  async function handleCheck() {
    setCheckedOnce(true);
    try {
      const result = await Updates.checkForUpdateAsync();
      Haptics.notificationAsync(
        result.isAvailable
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning
      );
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }

  async function handleDownload() {
    try {
      await Updates.fetchUpdateAsync();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Download failed", e instanceof Error ? e.message : "Try again.");
    }
  }

  async function handleRestart() {
    // reloadAsync swaps to the downloaded bundle. Confirm first — it throws
    // away whatever the person has on screen in the other tabs.
    Alert.alert(
      "Restart to finish",
      "The app will restart to apply the update. Anything unsaved is lost.",
      [
        { text: "Not now", style: "cancel" },
        {
          text: "Restart",
          style: "destructive",
          onPress: async () => {
            try {
              await Updates.reloadAsync();
            } catch (e) {
              Alert.alert("Couldn't restart", e instanceof Error ? e.message : "Try again.");
            }
          },
        },
      ]
    );
  }

  // In Expo Go / a dev client, updates are disabled — say so plainly rather
  // than showing a Check button that can never do anything.
  const updatesEnabled = Updates.isEnabled;
  const runningLabel = currentlyRunning.isEmbeddedLaunch
    ? "Original build"
    : shortId(currentlyRunning.updateId);

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.scroll}
    >
      <ScreenHeader
        eyebrow="Settings"
        title="App & updates"
        subtitle={`${brand.name} · ${Application.applicationName ?? "Inkline"}`}
      />

      <SectionLabel>Version</SectionLabel>
      <Card>
        <Row label="App version" value={dash(Application.nativeApplicationVersion)} icon="pricetag-outline" />
        <Divider />
        <Row label="Build" value={dash(Application.nativeBuildVersion)} icon="hammer-outline" />
        <Divider />
        <Row label="Runtime" value={dash(currentlyRunning.runtimeVersion)} icon="layers-outline" />
        <Divider />
        <Row label="Channel" value={dash(currentlyRunning.channel)} icon="git-branch-outline" />
        <Divider />
        <Row label="Running" value={runningLabel} icon="play-circle-outline" />
        {currentlyRunning.createdAt && (
          <>
            <Divider />
            <Row
              label="Published"
              value={currentlyRunning.createdAt.toLocaleString()}
              icon="time-outline"
            />
          </>
        )}
      </Card>

      <View style={{ height: SPACE.lg }} />

      <SectionLabel>Updates</SectionLabel>
      <Card>
        {!updatesEnabled ? (
          <Notice tone="info" icon="information-circle-outline">
            Over-the-air updates are off in Expo Go and dev builds. They work in the
            installed build.
          </Notice>
        ) : (
          <>
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor: isUpdatePending
                      ? theme.accent
                      : isUpdateAvailable
                        ? theme.accent
                        : theme.muted,
                  },
                ]}
              />
              <Text style={{ color: theme.foreground, fontFamily: theme.fontBody, fontSize: 14, flex: 1 }}>
                {isUpdatePending
                  ? "Update ready — restart to apply"
                  : isDownloading
                    ? "Downloading update…"
                    : isChecking
                      ? "Checking…"
                      : isUpdateAvailable
                        ? "Update available"
                        : checkedOnce || lastCheckForUpdateTimeSinceRestart
                          ? "You're up to date"
                          : "Tap check to look for a new version"}
              </Text>
            </View>

            {availableUpdate?.createdAt && (
              <Text style={[styles.meta, { color: theme.muted }]}>
                Published {availableUpdate.createdAt.toLocaleString()}
                {availableUpdate.updateId ? ` · ${shortId(availableUpdate.updateId)}` : ""}
              </Text>
            )}

            {(checkError || downloadError) && (
              <View style={{ marginTop: SPACE.sm }}>
                <Notice>{(checkError ?? downloadError)!.message}</Notice>
              </View>
            )}

            <View style={{ marginTop: SPACE.md, gap: SPACE.sm }}>
              {isUpdatePending ? (
                <Button
                  label="Restart to apply"
                  icon="refresh"
                  variant="primary"
                  onPress={handleRestart}
                />
              ) : isUpdateAvailable ? (
                <Button
                  label={isDownloading ? "Downloading" : "Download update"}
                  icon="cloud-download-outline"
                  variant="primary"
                  onPress={handleDownload}
                  loading={isDownloading}
                />
              ) : (
                <Button
                  label={isChecking ? "Checking" : "Check for updates"}
                  icon="sync-outline"
                  variant="primary"
                  onPress={handleCheck}
                  loading={isChecking}
                />
              )}
            </View>
          </>
        )}
      </Card>

      <View style={{ height: SPACE.lg }} />

      <SectionLabel>Backend</SectionLabel>
      <Card>
        <Row
          label="Generator API"
          value={API_BASE_URL.replace(/^https?:\/\//, "")}
          icon="cloud-outline"
          onPress={() => Linking.openURL(API_BASE_URL)}
        />
        <Divider />
        <Row
          label="Studio"
          value={brand.name}
          icon={brand.id === "ink" ? "flash-outline" : "cafe-outline"}
        />
      </Card>

      <View style={{ height: SPACE.lg }} />

      <SectionLabel>AI control center</SectionLabel>
      <Card>
        <View style={styles.spendHero}>
          <View>
            <Text style={{ color: theme.muted, fontFamily: theme.fontBody, fontSize: 11 }}>ESTIMATED THIS MONTH</Text>
            <Text style={{ color: theme.accent, fontFamily: theme.fontDisplay, fontSize: 34 }}>${spend.toFixed(2)}</Text>
          </View>
          <Ionicons name="pulse-outline" size={30} color={theme.accent} />
        </View>
        <Text style={{ color: theme.foreground, fontFamily: theme.fontBodyMedium, fontSize: 13, marginTop: SPACE.sm }}>Monthly spending guard</Text>
        <View style={styles.limitRow}>
          <Text style={{ color: theme.muted, fontSize: 18 }}>$</Text>
          <TextInput
            value={limit}
            onChangeText={setLimit}
            onEndEditing={saveLimit}
            onSubmitEditing={saveLimit}
            keyboardType="decimal-pad"
            accessibilityLabel="Monthly AI spending guard"
            style={[styles.limitInput, { color: theme.foreground, borderColor: theme.line, backgroundColor: theme.surfaceAlt, fontFamily: theme.fontBodyMedium }]}
          />
        </View>
        <Text style={{ color: theme.muted, fontFamily: theme.fontBody, fontSize: 11, lineHeight: 16 }}>Inkline blocks a generation before its estimate would pass this device-only limit. Set 0 for no guard.</Text>
      </Card>

      <Text style={[styles.footer, { color: theme.muted, fontFamily: theme.fontBody }]}>
        Convert and Sheet work offline. Generate needs the API.
      </Text>
    </ScrollView>
  );
}

function Row({
  label,
  value,
  icon,
  onPress,
}: {
  label: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
}) {
  const { theme } = useBrand();
  return (
    <View style={styles.row} accessibilityRole={onPress ? "button" : undefined}>
      <View style={styles.rowLeft}>
        <Ionicons name={icon} size={15} color={theme.muted} />
        <Text style={{ color: theme.muted, fontFamily: theme.fontBody, fontSize: 13 }}>
          {label}
        </Text>
      </View>
      <Text
        onPress={onPress}
        numberOfLines={1}
        style={{
          color: onPress ? theme.accent : theme.foreground,
          fontFamily: theme.fontBodyMedium,
          fontSize: 13,
          maxWidth: "58%",
          textAlign: "right",
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function Divider() {
  const { theme } = useBrand();
  return <View style={[styles.divider, { backgroundColor: theme.line }]} />;
}

/** `??` only catches null/undefined; several of these fields come back as an
 *  empty string off-device, which would render as a blank row. */
function dash(v?: string | null) {
  return v && v.trim() ? v : "—";
}

/** Update IDs are UUIDs — show a recognizable head, not 36 characters. */
function shortId(id?: string | null) {
  if (!id) return "—";
  return id.slice(0, 8);
}

const styles = StyleSheet.create({
  scroll: { padding: SPACE.md, paddingTop: SPACE.lg, paddingBottom: SPACE.xxl },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    gap: SPACE.sm,
  },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  divider: { height: StyleSheet.hairlineWidth },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  meta: { fontSize: 11, marginTop: 6, marginLeft: 17 },
  spendHero: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  limitRow: { flexDirection: "row", alignItems: "center", gap: 8, marginVertical: SPACE.sm },
  limitInput: { flex: 1, borderWidth: 1, borderRadius: 12, minHeight: 46, paddingHorizontal: 12, fontSize: 17 },
  footer: {
    fontSize: 12,
    textAlign: "center",
    marginTop: SPACE.lg,
    lineHeight: 17,
  },
});
