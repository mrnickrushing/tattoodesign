import { useEffect, useState } from "react";
import { View, Text, TextInput, StyleSheet, ScrollView, Alert, Linking } from "react-native";
import { File } from "expo-file-system";
import * as Updates from "expo-updates";
import * as Application from "expo-application";
import * as Haptics from "expo-haptics";
import { useBrand } from "@/context/BrandContext";
import { API_BASE_URL } from "@/lib/api";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { ScreenHeader, Card, SectionLabel, Notice } from "@/components/ui";
import type { IconName } from "@/lib/icons";
import { SPACE, TYPE } from "@/lib/theme";
import { getGenerationUsage, getSpendLimit, setSpendLimit, totalEstimatedSpend } from "@/lib/generationUsage";
import { preferences } from "@/lib/preferences";
import { createEncryptedBackup, restoreEncryptedBackup } from "@/lib/encryptedBackup";
import { shareUri } from "@/lib/files";

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
  const [recoveryKey, setRecoveryKey] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  const [prefCount, setPrefCount] = useState(0);

  useEffect(() => {
    Promise.all([getSpendLimit(), getGenerationUsage()]).then(([savedLimit, usage]) => {
      setLimit(savedLimit.toFixed(2));
      setSpend(totalEstimatedSpend(usage));
    });
    preferences.all(brand.id).then((values) => setPrefCount(Object.keys(values).length));
  }, [brand.id]);

  function resetSessionDefaults() {
    Alert.alert(
      "Reset session defaults?",
      "Trace settings, brush, and placement width go back to factory values for this studio.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: async () => {
            await preferences.clear(brand.id);
            setPrefCount(0);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          },
        },
      ]
    );
  }

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

  async function exportBackup() {
    setBackupBusy(true);
    try {
      const backup = await createEncryptedBackup();
      setRecoveryKey(backup.recoveryKey);
      await shareUri(backup.file.uri);
      Alert.alert("Encrypted backup ready", `Protected ${backup.itemCount} records and ${backup.fileCount} artwork files. Save the recovery key separately—it is required on another device.`);
    } catch (e) { Alert.alert("Backup failed", e instanceof Error ? e.message : "Try again."); }
    finally { setBackupBusy(false); }
  }

  async function importBackup() {
    if (!recoveryKey.trim()) return Alert.alert("Recovery key needed", "Paste the recovery key that was shown when the backup was created.");
    setBackupBusy(true);
    try {
      const picked = await File.pickFileAsync({ mimeTypes: ["application/octet-stream", "application/json", "*/*"] });
      if (picked.canceled) return;
      const result = await restoreEncryptedBackup(picked.result, recoveryKey);
      Alert.alert("Backup restored", `Recovered ${result.itemCount} records and ${result.fileCount} artwork files. Restart the app to reload every workspace.`);
    } catch (e) { Alert.alert("Restore failed", e instanceof Error ? e.message : "Check the file and recovery key."); }
    finally { setBackupBusy(false); }
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
        <Row label="App version" value={dash(Application.nativeApplicationVersion)} icon="tag" />
        <Divider />
        <Row label="Build" value={dash(Application.nativeBuildVersion)} icon="tool" />
        <Divider />
        <Row label="Runtime" value={dash(currentlyRunning.runtimeVersion)} icon="layers" />
        <Divider />
        <Row label="Channel" value={dash(currentlyRunning.channel)} icon="branch" />
        <Divider />
        <Row label="Running" value={runningLabel} icon="play" />
        {currentlyRunning.createdAt && (
          <>
            <Divider />
            <Row
              label="Published"
              value={currentlyRunning.createdAt.toLocaleString()}
              icon="history"
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
              <Text style={[TYPE.body, { color: theme.foreground, fontFamily: theme.fontBody, flex: 1 }]}>
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

      <SectionLabel>Session defaults</SectionLabel>
      <Card>
        <Text style={{ color: theme.foreground, fontFamily: theme.fontBody, fontSize: 13, lineHeight: 18 }}>
          {prefCount
            ? `${prefCount} remembered setting${prefCount === 1 ? "" : "s"} for ${brand.name} — trace options, brush, placement width.`
            : `Nothing remembered yet — trace options, brush, and placement width save automatically as you work.`}
        </Text>
        {prefCount > 0 && (
          <Button label="Reset to factory defaults" icon="refresh-outline" onPress={resetSessionDefaults} style={{ marginTop: SPACE.sm }} />
        )}
      </Card>

      <SectionLabel>Encrypted studio backup</SectionLabel>
      <Card>
        <View style={styles.backupHero}>
          <View style={{ flex: 1 }}><Text style={[TYPE.body, { color: theme.foreground, fontFamily: theme.fontBodyMedium }]}>Artwork, layers, sheets & projects</Text><Text style={[TYPE.caption, { color: theme.muted, fontFamily: theme.fontBody }]}>AES-256-GCM encryption protects the portable archive. Keep its recovery key somewhere separate.</Text></View>
          <Icon name="lock" size={TYPE.heading.fontSize + SPACE.xs} color={theme.accent} />
        </View>
        <TextInput value={recoveryKey} onChangeText={setRecoveryKey} autoCapitalize="none" autoCorrect={false} secureTextEntry placeholder="Recovery key for import" placeholderTextColor={theme.muted} accessibilityLabel="Backup recovery key" style={[styles.recoveryInput, { color: theme.foreground, borderColor: theme.line, backgroundColor: theme.surfaceAlt, fontFamily: theme.fontBody }]} />
        <View style={styles.backupActions}><Button label="Export backup" icon="lock-closed-outline" variant="primary" onPress={exportBackup} loading={backupBusy} style={{ flex: 1 }} /><Button label="Restore" icon="cloud-upload-outline" onPress={importBackup} disabled={backupBusy || !recoveryKey.trim()} style={{ flex: 1 }} /></View>
        {!!recoveryKey && <Notice tone="info" icon="key-outline">A recovery key is loaded. Store it separately from the backup file before transferring devices.</Notice>}
      </Card>

      <View style={{ height: SPACE.lg }} />

      <SectionLabel>Backend</SectionLabel>
      <Card>
        <Row
          label="Generator API"
          value={API_BASE_URL.replace(/^https?:\/\//, "")}
          icon="cloudOffline"
          onPress={() => Linking.openURL(API_BASE_URL)}
        />
        <Divider />
        <Row
          label="Studio"
          value={brand.name}
          icon={brand.id === "ink" ? "flash" : "palette"}
        />
      </Card>

      <View style={{ height: SPACE.lg }} />

      <SectionLabel>AI control center</SectionLabel>
      <Card>
        <View style={styles.spendHero}>
          <View>
            <Text style={[TYPE.caption, { color: theme.muted, fontFamily: theme.fontBody }]}>ESTIMATED THIS MONTH</Text>
            <Text style={[TYPE.title, { color: theme.accent, fontFamily: theme.fontDisplay }]}>${spend.toFixed(2)}</Text>
          </View>
          <Icon name="generate" size={TYPE.heading.fontSize + SPACE.sm} color={theme.accent} />
        </View>
        <Text style={[TYPE.caption, { color: theme.foreground, fontFamily: theme.fontBodyMedium, marginTop: SPACE.sm }]}>Monthly spending guard</Text>
        <View style={styles.limitRow}>
          <Text style={[TYPE.heading, { color: theme.muted }]}>$</Text>
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
        <Text style={[TYPE.caption, { color: theme.muted, fontFamily: theme.fontBody }]}>Inkline blocks a generation before its estimate would pass this device-only limit. Set 0 for no guard.</Text>
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
  icon: IconName;
  onPress?: () => void;
}) {
  const { theme } = useBrand();
  return (
    <View style={styles.row} accessibilityRole={onPress ? "button" : undefined}>
      <View style={styles.rowLeft}>
        <Icon name={icon} size={SPACE.md} color={theme.muted} />
        <Text style={[TYPE.caption, { color: theme.muted, fontFamily: theme.fontBody }]}>
          {label}
        </Text>
      </View>
      <Text
        onPress={onPress}
        numberOfLines={1}
        style={{
          color: onPress ? theme.accent : theme.foreground,
          fontFamily: theme.fontBodyMedium,
          ...TYPE.caption,
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
  meta: { ...TYPE.caption, marginTop: SPACE.xs, marginLeft: SPACE.md + SPACE.xs },
  spendHero: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  limitRow: { flexDirection: "row", alignItems: "center", gap: 8, marginVertical: SPACE.sm },
  limitInput: { flex: 1, borderWidth: 1, borderRadius: SPACE.sm + SPACE.xs / 3, minHeight: SPACE.xxl, paddingHorizontal: SPACE.sm, ...TYPE.body },
  backupHero: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, marginBottom: SPACE.sm },
  recoveryInput: { minHeight: 46, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, marginBottom: SPACE.sm },
  backupActions: { flexDirection: "row", gap: SPACE.sm, marginBottom: SPACE.sm },
  footer: {
    ...TYPE.caption,
    textAlign: "center",
    marginTop: SPACE.lg,
    lineHeight: 17,
  },
});
