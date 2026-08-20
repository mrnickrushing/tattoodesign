// What kind of image a pile of base64 actually is.
//
// Kept free of the native pickers that need it so the rule can be tested; the
// same split spacing.ts and tone.ts use for the same reason.

/**
 * The image type the bytes actually are, read from their own magic number.
 *
 * Every picker in the app used to label its result `image/jpeg` regardless.
 * On a phone that is usually true by luck — the camera roll hands back JPEG —
 * but a browser hands back whatever was chosen, and a PNG announced as a JPEG
 * is a data URL no browser will decode. The picture simply fails to appear,
 * with nothing logged, because a data URL is not a request that can 404.
 *
 * Sniffing beats trusting a field that may be absent, and the base64 prefixes
 * are distinctive enough to be unambiguous.
 */
export function sniffImageType(base64: string): string {
  if (base64.startsWith("iVBORw0KGgo")) return "image/png";
  if (base64.startsWith("/9j/")) return "image/jpeg";
  if (base64.startsWith("UklGR")) return "image/webp";
  if (base64.startsWith("R0lGOD")) return "image/gif";
  return "image/jpeg";
}

/** A data URL that states the type its bytes really are. */
export function imageDataUrl(base64: string, declared?: string | null | undefined): string {
  const sniffed = sniffImageType(base64);
  // A declared type is only trusted when it agrees with the bytes; a picker
  // that says jpeg about a png is the whole reason this exists.
  const mimeType = declared && declared === sniffed ? declared : sniffed;
  return `data:${mimeType};base64,${base64}`;
}
