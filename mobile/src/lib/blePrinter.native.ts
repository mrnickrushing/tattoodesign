import { PermissionsAndroid, Platform } from "react-native";
import { BleManager, type Device, type Characteristic } from "react-native-ble-plx";
import { fromByteArray } from "base64-js";
import type { BlePrinterDevice } from "./blePrinter.types";

export type { BlePrinterDevice } from "./blePrinter.types";
export const BLE_PRINTING_AVAILABLE = true;

let manager: BleManager | null = null;
function getManager() {
  manager ??= new BleManager();
  return manager;
}

export async function requestBlePermission(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  if ((Platform.Version as number) < 31) {
    return (await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION)) === PermissionsAndroid.RESULTS.GRANTED;
  }
  const result = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
  ]);
  return result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.GRANTED &&
    result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED;
}

export function scanBlePrinters(onDevice: (device: BlePrinterDevice) => void): () => void {
  const ble = getManager();
  const seen = new Set<string>();
  ble.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
    if (error || !device || seen.has(device.id)) return;
    const name = device.name ?? device.localName;
    if (!name) return;
    seen.add(device.id);
    onDevice({ id: device.id, name, rssi: device.rssi });
  });
  return () => { void ble.stopDeviceScan(); };
}

async function writableCharacteristic(device: Device): Promise<Characteristic> {
  const services = await device.services();
  for (const service of services) {
    const characteristics = await service.characteristics();
    const writable = characteristics.find((item) => item.isWritableWithoutResponse || item.isWritableWithResponse);
    if (writable) return writable;
  }
  throw new Error("No writable BLE printer channel was found. This device may use a proprietary protocol.");
}

export async function printEscPosOverBle(deviceId: string, bytes: Uint8Array, onProgress?: (progress: number) => void): Promise<void> {
  const ble = getManager();
  await ble.stopDeviceScan();
  const device = await ble.connectToDevice(deviceId, { timeout: 12000 });
  try {
    const ready = await device.discoverAllServicesAndCharacteristics();
    const characteristic = await writableCharacteristic(ready);
    const chunkSize = 180;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize));
      const value = fromByteArray(chunk);
      if (characteristic.isWritableWithoutResponse) {
        await ready.writeCharacteristicWithoutResponseForService(characteristic.serviceUUID, characteristic.uuid, value);
      } else {
        await ready.writeCharacteristicWithResponseForService(characteristic.serviceUUID, characteristic.uuid, value);
      }
      onProgress?.(Math.min(1, (offset + chunk.length) / bytes.length));
    }
  } finally {
    await ble.cancelDeviceConnection(deviceId).catch(() => undefined);
  }
}
