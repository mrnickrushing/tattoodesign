// Bridges our base64 data-URL images (the same shape the web app stores in
// its design library) to the filesystem, for saving to Photos, sharing, or
// printing — none of which iOS lets you do straight from a data URL.

import { File, Paths } from "expo-file-system";
import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";

export function stripDataUrlPrefix(dataUrl: string): string {
  const idx = dataUrl.indexOf(",");
  return idx >= 0 && dataUrl.slice(0, idx).includes("base64") ? dataUrl.slice(idx + 1) : dataUrl;
}

export function writeDataUrlToTempFile(dataUrl: string, filename: string): File {
  const base64 = stripDataUrlPrefix(dataUrl);
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.write(base64, { encoding: "base64" });
  return file;
}

export async function saveDataUrlToPhotos(dataUrl: string, filename: string): Promise<void> {
  const permission = await MediaLibrary.requestPermissionsAsync();
  if (!permission.granted) {
    throw new Error("Photo library access was denied.");
  }
  const file = writeDataUrlToTempFile(dataUrl, filename);
  await MediaLibrary.saveToLibraryAsync(file.uri);
}

export async function shareDataUrl(dataUrl: string, filename: string): Promise<void> {
  const file = writeDataUrlToTempFile(dataUrl, filename);
  const available = await Sharing.isAvailableAsync();
  if (!available) throw new Error("Sharing isn't available on this device.");
  await Sharing.shareAsync(file.uri);
}
