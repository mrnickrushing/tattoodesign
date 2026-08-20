// The browser half. See imageSource.ts for why this exists.
//
// A library image is a blob: URL here, which has to be fetched back before its
// bytes can be handed to Skia.

import { stripDataUrlPrefix } from "./files";

export function isDataUrl(uri: string): boolean {
  return uri.startsWith("data:");
}

export async function readImageBase64(uri: string): Promise<string> {
  if (isDataUrl(uri)) return stripDataUrlPrefix(uri);
  const blob = await fetch(uri).then((response) => response.blob());
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  // Chunked: spreading a whole image into String.fromCharCode blows the
  // argument limit on anything larger than a thumbnail.
  for (let i = 0; i < buffer.length; i += 0x8000) {
    binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export async function readImageDataUrl(uri: string): Promise<string> {
  if (isDataUrl(uri)) return uri;
  return `data:image/png;base64,${await readImageBase64(uri)}`;
}
