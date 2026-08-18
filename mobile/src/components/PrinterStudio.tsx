import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import Slider from "@react-native-community/slider";
import { Ionicons } from "@expo/vector-icons";
import * as Print from "expo-print";
import * as Haptics from "expo-haptics";
import { useBrand } from "@/context/BrandContext";
import { Button } from "@/components/Button";
import { Card, Chip, Notice, SectionLabel } from "@/components/ui";
import { BLE_PRINTING_AVAILABLE, printEscPosOverBle, requestBlePermission, scanBlePrinters, type BlePrinterDevice } from "@/lib/blePrinter";
import { dataUrlToEscPos } from "@/lib/escpos";
import { calibrationCorrection, PRINTER_PRESETS, profileWarnings, type PrinterProfile } from "@/lib/printerProfiles";
import { RADIUS, SPACE } from "@/lib/theme";

type Props = {
  visible: boolean;
  profile: PrinterProfile;
  pageWidthIn: number;
  pageHeightIn: number;
  onChange: (profile: PrinterProfile) => void;
  onClose: () => void;
  onAirPrint: (profile: PrinterProfile) => Promise<void>;
  renderProof: (profile: Pick<PrinterProfile, "dpi" | "scaleCorrection">) => Promise<string>;
};

export function PrinterStudio({ visible, profile, pageWidthIn, pageHeightIn, onChange, onClose, onAirPrint, renderProof }: Props) {
  const { theme } = useBrand();
  const [proof, setProof] = useState<string | null>(null);
  const [proofing, setProofing] = useState(false);
  const [measured, setMeasured] = useState("");
  const [devices, setDevices] = useState<BlePrinterDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [progress, setProgress] = useState(0);
  const proofSeq = useRef(0);
  const proofDpi = profile.dpi;
  const proofScaleCorrection = profile.scaleCorrection;
  const warnings = useMemo(() => profileWarnings(profile, pageWidthIn), [profile, pageWidthIn]);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    const seq = ++proofSeq.current;
    const timer = setTimeout(() => void (async () => {
      if (active) setProofing(true);
      try {
        const result = await renderProof({ dpi: proofDpi, scaleCorrection: proofScaleCorrection });
        if (active && seq === proofSeq.current) setProof(result);
      } catch (error) {
        if (active && seq === proofSeq.current) Alert.alert("Couldn't build proof", error instanceof Error ? error.message : "Try again.");
      } finally {
        if (active && seq === proofSeq.current) setProofing(false);
      }
    })(), 180);
    return () => { active = false; clearTimeout(timer); };
  }, [visible, proofDpi, proofScaleCorrection, renderProof]);

  function selectPreset(id: string) {
    const preset = PRINTER_PRESETS.find((item) => item.id === id);
    if (preset) onChange({ ...preset });
  }

  async function printCalibration() {
    const corrected = 6 * profile.scaleCorrection;
    const ticks = Array.from({ length: 61 }, (_, index) => {
      const height = index % 10 === 0 ? 30 : index % 5 === 0 ? 20 : 12;
      return `<i style="left:${(index / 10) * profile.scaleCorrection}in;height:${height}px"></i>`;
    }).join("");
    const html = `<html><head><style>@page{size:8.5in 11in;margin:.5in}body{font-family:-apple-system,sans-serif}.ruler{position:relative;width:${corrected}in;height:54px;border-bottom:2px solid #000}.ruler i{position:absolute;bottom:0;border-left:1px solid #000}.labels{width:${corrected}in;display:flex;justify-content:space-between;font-size:11px;margin-top:5px}</style></head><body><h2>Inkline calibration</h2><p>Print at 100% / Actual Size, then measure between 0 and 6.</p><div class="ruler">${ticks}</div><div class="labels"><b>0</b><b>1</b><b>2</b><b>3</b><b>4</b><b>5</b><b>6 in</b></div></body></html>`;
    await Print.printAsync({ html });
  }

  function applyCalibration() {
    const value = Number.parseFloat(measured);
    if (!Number.isFinite(value) || value <= 0) return Alert.alert("Enter the measured length", "Measure the printed 6-inch ruler and enter that number.");
    const next = Math.max(0.9, Math.min(1.1, profile.scaleCorrection * calibrationCorrection(6, value)));
    onChange({ ...profile, scaleCorrection: next });
    setMeasured("");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert("Calibration applied", `Output scale is now ${(next * 100).toFixed(2)}%. Print the ruler once more to verify.`);
  }

  async function scan() {
    if (!BLE_PRINTING_AVAILABLE || Platform.OS === "web") return;
    if (!(await requestBlePermission())) return Alert.alert("Bluetooth permission needed", "Allow nearby-device access to find compatible printers.");
    setDevices([]);
    setScanning(true);
    const stop = scanBlePrinters((device) => setDevices((current) => current.some((item) => item.id === device.id) ? current : [...current, device]));
    setTimeout(() => { stop(); setScanning(false); }, 8000);
  }

  async function printBle(device: BlePrinterDevice) {
    if (!proof) return;
    setPrinting(true);
    setProgress(0);
    try {
      const width = Math.floor(profile.printableWidthIn * profile.dpi);
      const bytes = dataUrlToEscPos(proof, width, profile.density, profile.mirrored);
      await printEscPosOverBle(device.id, bytes, setProgress);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Sent to printer", `${device.name} accepted the complete raster job.`);
    } catch (error) {
      Alert.alert("Bluetooth print failed", error instanceof Error ? error.message : "The printer disconnected.");
    } finally {
      setPrinting(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: theme.background }]}> 
        <View style={[styles.header, { borderBottomColor: theme.line, backgroundColor: theme.surface }]}> 
          <View>
            <Text style={{ color: theme.accent, fontFamily: theme.fontBodyMedium, fontSize: 10, letterSpacing: 1.6 }}>OUTPUT LAB</Text>
            <Text style={{ color: theme.foreground, fontFamily: theme.fontDisplay, fontSize: 29 }}>Printer Studio</Text>
          </View>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close printer studio" style={[styles.close, { backgroundColor: theme.surfaceAlt }]}> 
            <Ionicons name="close" size={22} color={theme.foreground} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.scroll}>
          <SectionLabel>Printer profile</SectionLabel>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.profileRow}>
            {PRINTER_PRESETS.map((preset) => <Chip key={preset.id} label={preset.name} active={profile.id === preset.id} onPress={() => selectPreset(preset.id)} />)}
          </ScrollView>
          <Text style={[styles.detail, { color: theme.muted }]}>{profile.detail}</Text>

          <Card>
            <View style={styles.metricRow}>
              <Metric label="HEAD" value={`${profile.dpi} DPI`} />
              <Metric label="PRINTABLE" value={`${profile.printableWidthIn.toFixed(2)} IN`} />
              <Metric label="SCALE" value={`${(profile.scaleCorrection * 100).toFixed(2)}%`} />
            </View>
            <View style={[styles.settingRow, { borderTopColor: theme.line }]}> 
              <View>
                <Text style={{ color: theme.foreground, fontFamily: theme.fontBodyMedium, fontSize: 13 }}>Mirror transfer</Text>
                <Text style={{ color: theme.muted, fontFamily: theme.fontBody, fontSize: 10 }}>Flips the full proof before output.</Text>
              </View>
              <Switch value={profile.mirrored} onValueChange={(mirrored) => onChange({ ...profile, mirrored })} trackColor={{ true: theme.accent }} />
            </View>
            <Text style={{ color: theme.foreground, fontFamily: theme.fontBodyMedium, fontSize: 13, marginTop: SPACE.sm }}>Thermal density · {profile.density}</Text>
            <Slider minimumValue={1} maximumValue={10} step={1} value={profile.density} onValueChange={(density) => onChange({ ...profile, density })} minimumTrackTintColor={theme.accent} maximumTrackTintColor={theme.line} thumbTintColor={theme.accent} />
          </Card>

          <SectionLabel>Thermal print proof</SectionLabel>
          <View style={[styles.proof, { backgroundColor: theme.stock, borderColor: theme.line, aspectRatio: pageWidthIn / pageHeightIn }]}> 
            {proof && <Image source={{ uri: proof }} resizeMode="contain" style={[StyleSheet.absoluteFill, profile.mirrored && { transform: [{ scaleX: -1 }] }]} />}
            <View pointerEvents="none" style={[styles.printableGuide, { left: `${(profile.marginIn / pageWidthIn) * 100}%`, right: `${(profile.marginIn / pageWidthIn) * 100}%`, borderColor: theme.accent }]} />
            <View style={[styles.proofBadge, { backgroundColor: theme.surface }]}><Text style={{ color: theme.foreground, fontFamily: theme.fontBodyMedium, fontSize: 9 }}>{profile.dpi} DPI · D{profile.density}</Text></View>
            {proofing && <View style={styles.proofLoading}><ActivityIndicator color={theme.accent} /><Text style={{ color: theme.stockInk }}>Building proof</Text></View>}
          </View>
          {warnings.map((warning) => <View key={warning} style={{ marginTop: SPACE.xs }}><Notice tone="info" icon="warning-outline">{warning}</Notice></View>)}

          <SectionLabel>Calibration wizard</SectionLabel>
          <Card>
            <Text style={{ color: theme.foreground, fontFamily: theme.fontBodyMedium, fontSize: 14 }}>1 · Print the six-inch ruler</Text>
            <Text style={[styles.detail, { color: theme.muted }]}>Use Actual Size / 100%. Measure the result with a physical ruler.</Text>
            <Button label="Print calibration ruler" icon="resize-outline" onPress={() => void printCalibration()} />
            <Text style={{ color: theme.foreground, fontFamily: theme.fontBodyMedium, fontSize: 14, marginTop: SPACE.md }}>2 · Enter what printed</Text>
            <View style={styles.measureRow}>
              <TextInput value={measured} onChangeText={setMeasured} keyboardType="decimal-pad" placeholder="5.94" placeholderTextColor={theme.muted} style={[styles.input, { color: theme.foreground, borderColor: theme.line, backgroundColor: theme.surfaceAlt }]} />
              <Text style={{ color: theme.muted }}>inches</Text>
              <Button label="Apply" icon="checkmark" onPress={applyCalibration} style={{ flex: 1 }} />
            </View>
          </Card>

          <SectionLabel>Send output</SectionLabel>
          {profile.transport === "airprint" ? (
            <Button label="Print this proof" icon="print-outline" variant="primary" onPress={() => void onAirPrint(profile)} />
          ) : !BLE_PRINTING_AVAILABLE || Platform.OS === "web" ? (
            <Notice tone="info" icon="phone-portrait-outline">Direct Bluetooth printing is available in the native iOS and Android build. Web can still create and share the proof.</Notice>
          ) : (
            <Card>
              <Notice tone="info" icon="bluetooth-outline">Beta supports BLE printers that accept ESC/POS raster commands. Classic Bluetooth and proprietary tattoo-printer protocols require a matching driver.</Notice>
              <Button label={scanning ? "Scanning nearby…" : "Find BLE printers"} icon="bluetooth-outline" onPress={() => void scan()} disabled={scanning || printing} style={{ marginTop: SPACE.sm }} />
              {devices.map((device) => (
                <Pressable key={device.id} onPress={() => void printBle(device)} disabled={printing} style={[styles.device, { borderColor: theme.line, backgroundColor: theme.surfaceAlt }]}> 
                  <Ionicons name="print-outline" size={18} color={theme.accent} />
                  <View style={{ flex: 1 }}><Text style={{ color: theme.foreground, fontFamily: theme.fontBodyMedium }}>{device.name}</Text><Text style={{ color: theme.muted, fontSize: 10 }}>{device.rssi ? `${device.rssi} dBm · ` : ""}tap to send proof</Text></View>
                  <Ionicons name="chevron-forward" size={17} color={theme.muted} />
                </Pressable>
              ))}
              {printing && <Text style={{ color: theme.accent, fontFamily: theme.fontBodyMedium, marginTop: SPACE.sm }}>{Math.round(progress * 100)}% sent</Text>}
            </Card>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  const { theme } = useBrand();
  return <View style={{ flex: 1 }}><Text style={{ color: theme.muted, fontSize: 8, letterSpacing: 1 }}>{label}</Text><Text style={{ color: theme.foreground, fontFamily: theme.fontBodyMedium, fontSize: 13 }}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: SPACE.md, borderBottomWidth: 1 },
  close: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  scroll: { padding: SPACE.md, paddingBottom: 60 },
  profileRow: { gap: 8, paddingBottom: 2 },
  detail: { fontSize: 11, lineHeight: 16, marginTop: 7, marginBottom: SPACE.sm },
  metricRow: { flexDirection: "row", gap: SPACE.sm },
  settingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1, marginTop: SPACE.md, paddingTop: SPACE.sm },
  proof: { width: "72%", alignSelf: "center", borderWidth: 1, borderRadius: RADIUS.md, overflow: "hidden", marginBottom: SPACE.xs },
  printableGuide: { position: "absolute", top: "3%", bottom: "3%", borderWidth: 1, borderStyle: "dashed" },
  proofBadge: { position: "absolute", top: 7, right: 7, borderRadius: RADIUS.pill, paddingHorizontal: 8, paddingVertical: 5 },
  proofLoading: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "rgba(255,255,255,.88)" },
  measureRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, marginTop: SPACE.xs },
  input: { width: 80, minHeight: 44, borderWidth: 1, borderRadius: RADIUS.sm, paddingHorizontal: 12, fontSize: 16 },
  device: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: SPACE.sm, borderWidth: 1, borderRadius: RADIUS.md, padding: SPACE.sm, marginTop: SPACE.sm },
});
