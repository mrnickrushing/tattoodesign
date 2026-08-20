// Saving and sharing, on a laptop.
//
// The native versions hand a file to Photos or to the share sheet. A browser
// has neither. What it has is a download, and — where the browser supports it
// — the Web Share API, which on a Mac opens the same share sheet the phone
// would. So: share if we can, download if we cannot, and never pretend to have
// done something that did not happen.
//
// See files.ts for the native shape.

export function stripDataUrlPrefix(dataUrl: string): string {
  const idx = dataUrl.indexOf(",");
  return idx >= 0 && dataUrl.slice(0, idx).includes("base64") ? dataUrl.slice(idx + 1) : dataUrl;
}

function toBlob(dataUrl: string): Blob {
  const base64 = stripDataUrlPrefix(dataUrl);
  const type = dataUrl.startsWith("data:") ? dataUrl.slice(5, dataUrl.indexOf(";")) : "image/png";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: type || "image/png" });
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on the next tick rather than immediately: Safari cancels the
  // download if the URL dies before it has finished reading it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** No Photos library in a browser, so this saves to the downloads folder. */
export async function saveDataUrlToPhotos(dataUrl: string, filename: string): Promise<void> {
  download(toBlob(dataUrl), filename);
}

export async function shareDataUrl(dataUrl: string, filename: string): Promise<void> {
  const blob = toBlob(dataUrl);
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (error) {
      // A cancelled share is a choice, not a failure, and must not fall
      // through to silently downloading something the person just declined.
      if (error instanceof Error && error.name === "AbortError") return;
    }
  }
  download(blob, filename);
}

export async function shareUri(uri: string): Promise<void> {
  if (uri.startsWith("data:")) {
    await shareDataUrl(uri, `inkline-${Date.now()}.png`);
    return;
  }
  // A blob: or http: URL has to be fetched back before it can be shared.
  const blob = await fetch(uri).then((response) => response.blob());
  const filename = `inkline-${Date.now()}.${blob.type.split("/")[1] || "png"}`;
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
    }
  }
  download(blob, filename);
}

/** Native callers use this to stage a file on disk; a browser has no disk. */
export function writeDataUrlToTempFile(): never {
  throw new Error("Writing temporary files isn't available in a browser.");
}
