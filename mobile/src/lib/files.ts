// Bridges our base64 data-URL images (the same shape the web app stores in
// its design library) to the filesystem, for saving to Photos, sharing, or
// printing — none of which iOS lets you do straight from a data URL.
//
// The native modules are imported lazily inside each function rather than at
// module scope. Importing them eagerly makes merely *loading* a screen fail
// on any platform without the native module present (the web target can't
// resolve ExpoMediaLibraryNext at all), even when nothing calls them.

import { File, Paths } from "expo-file-system";

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
  // SDK 57 deprecated the top-level saveToLibraryAsync and it now throws at
  // call time. The legacy entrypoint keeps the simple "save this file" API;
  // the new class-based one is built around querying/managing the library,
  // which is more than saving one PNG needs.
  const MediaLibrary = await import("expo-media-library/legacy");
  const permission = await MediaLibrary.requestPermissionsAsync();
  if (!permission.granted) {
    throw new Error("Photo library access was denied.");
  }
  const file = writeDataUrlToTempFile(dataUrl, filename);
  await MediaLibrary.saveToLibraryAsync(file.uri);
}

export async function shareDataUrl(dataUrl: string, filename: string): Promise<void> {
  const Sharing = await import("expo-sharing");
  const file = writeDataUrlToTempFile(dataUrl, filename);
  const available = await Sharing.isAvailableAsync();
  if (!available) throw new Error("Sharing isn't available on this device.");
  await Sharing.shareAsync(file.uri);
}

/** Shares a file that already exists on disk — a saved design, say, which
 *  doesn't need to be re-written to a temp file first. */
export async function shareUri(uri: string): Promise<void> {
  const Sharing = await import("expo-sharing");
  const available = await Sharing.isAvailableAsync();
  if (!available) throw new Error("Sharing isn't available on this device.");
  await Sharing.shareAsync(uri);
}
