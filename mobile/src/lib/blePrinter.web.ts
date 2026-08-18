import type { BlePrinterDevice } from "./blePrinter.types";
export type { BlePrinterDevice } from "./blePrinter.types";
export const BLE_PRINTING_AVAILABLE = false;
export async function requestBlePermission(): Promise<boolean> { return false; }
export function scanBlePrinters(_onDevice: (device: BlePrinterDevice) => void): () => void { return () => undefined; }
export async function printEscPosOverBle(_deviceId: string, _bytes: Uint8Array, _onProgress?: (progress: number) => void): Promise<void> {
  throw new Error("Direct Bluetooth printing requires the native Inkline app.");
}
