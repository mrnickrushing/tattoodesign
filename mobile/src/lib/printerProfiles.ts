import AsyncStorage from "@react-native-async-storage/async-storage";
import type { BrandId } from "./brands";

export type PrinterTransport = "airprint" | "ble-escpos";

export type PrinterProfile = {
  id: string;
  name: string;
  detail: string;
  transport: PrinterTransport;
  dpi: 203 | 300;
  paperWidthIn: number;
  printableWidthIn: number;
  /** Usable length of one sheet. A roll is fed in chunks of this size. */
  printableHeightIn: number;
  marginIn: number;
  density: number;
  scaleCorrection: number;
  mirrored: boolean;
};

export const PRINTER_PRESETS: PrinterProfile[] = [
  {
    id: "airprint-300",
    name: "Studio AirPrint",
    detail: "300 DPI · full-sheet inkjet or laser",
    transport: "airprint",
    dpi: 300,
    paperWidthIn: 8.5,
    printableWidthIn: 8,
    printableHeightIn: 10.5,
    marginIn: 0.25,
    density: 5,
    scaleCorrection: 1,
    mirrored: false,
  },
  {
    id: "thermal-letter-203",
    name: "Letter Thermal",
    detail: "203 DPI · 8.5-inch transfer sheet",
    transport: "airprint",
    dpi: 203,
    paperWidthIn: 8.5,
    printableWidthIn: 8.1,
    printableHeightIn: 10.6,
    marginIn: 0.2,
    density: 6,
    scaleCorrection: 1,
    mirrored: true,
  },
  {
    id: "thermal-a4-203",
    name: "A4 Thermal",
    detail: "203 DPI · 210 mm transfer sheet",
    transport: "airprint",
    dpi: 203,
    paperWidthIn: 8.27,
    printableWidthIn: 7.87,
    printableHeightIn: 11.29,
    marginIn: 0.2,
    density: 6,
    scaleCorrection: 1,
    mirrored: true,
  },
  {
    id: "ble-escpos-203",
    name: "BLE ESC/POS Roll",
    detail: "203 DPI · compatible Bluetooth roll printer",
    transport: "ble-escpos",
    dpi: 203,
    paperWidthIn: 3.15,
    printableWidthIn: 2.83,
    printableHeightIn: 8,
    marginIn: 0.16,
    density: 6,
    scaleCorrection: 1,
    mirrored: true,
  },
];

const storageKey = (brand: BrandId) => `inkline:printer-profile:${brand}`;

export async function getPrinterProfile(brand: BrandId): Promise<PrinterProfile> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(brand));
    if (!raw) return PRINTER_PRESETS[0];
    const parsed = JSON.parse(raw) as Partial<PrinterProfile>;
    const base = PRINTER_PRESETS.find((preset) => preset.id === parsed.id) ?? PRINTER_PRESETS[0];
    return { ...base, ...parsed };
  } catch {
    return PRINTER_PRESETS[0];
  }
}

export async function savePrinterProfile(brand: BrandId, profile: PrinterProfile): Promise<void> {
  await AsyncStorage.setItem(storageKey(brand), JSON.stringify(profile));
}

export function calibrationCorrection(expectedIn: number, measuredIn: number): number {
  if (!Number.isFinite(expectedIn) || !Number.isFinite(measuredIn) || measuredIn <= 0) return 1;
  return Math.max(0.9, Math.min(1.1, expectedIn / measuredIn));
}

export function profileWarnings(profile: PrinterProfile, pageWidthIn: number, lineWeightPx?: number): string[] {
  const warnings: string[] = [];
  if (pageWidthIn > profile.printableWidthIn + 0.01) warnings.push(`${(pageWidthIn - profile.printableWidthIn).toFixed(2)}in may clip across the printable width.`);
  if (lineWeightPx !== undefined && lineWeightPx * (profile.dpi / 1200) < 0.35) warnings.push("The finest lines may break up at this printer DPI.");
  if (Math.abs(profile.scaleCorrection - 1) > 0.025) warnings.push("Large calibration correction is active; print a second ruler to confirm it.");
  return warnings;
}
