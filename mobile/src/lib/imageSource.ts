// Getting bytes out of whatever kind of image reference you were handed.
//
// The Skia libraries all decode base64: they take what the code calls a
// "dataUrl" and hand it straight to Skia.Data.fromBase64. That is fine for
// something freshly generated, and wrong for anything that came out of the
// library — which is a file:// path on a phone and a blob: URL in a browser.
// Neither is base64, so the decode fails and the feature it belonged to breaks
// with no useful message.
//
// It went unnoticed because the paths that hit it are the ones you reach from
// a saved design rather than from a fresh one.

import { File } from "expo-file-system";
import { stripDataUrlPrefix } from "./files";

/** True for something Skia can already decode without going to storage. */
export function isDataUrl(uri: string): boolean {
  return uri.startsWith("data:");
}

/** Base64 for any image reference, whatever kind it is. */
export async function readImageBase64(uri: string): Promise<string> {
  if (isDataUrl(uri)) return stripDataUrlPrefix(uri);
  return await new File(uri).base64();
}

/** The same, re-wrapped as a data URL for the libraries that expect one. */
export async function readImageDataUrl(uri: string): Promise<string> {
  if (isDataUrl(uri)) return uri;
  return `data:image/png;base64,${await readImageBase64(uri)}`;
}
