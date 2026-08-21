// Schema for the encrypted backup archive, kept free of native imports so it
// can be checked with `tsx --test` the same way the rest of the app's pure
// logic is. The AES-256-GCM sealing itself lives in encryptedBackup.ts, next
// to the expo-crypto/expo-file-system calls that only resolve inside the
// Expo runtime.

export const STORAGE_PREFIXES = ["inkline:"];
export const FILE_ROOTS = ["designs", "editable-projects"];

export type BackupPayload = {
  version: 1;
  createdAt: number;
  storage: [string, string][];
  files: { path: string; data: string }[];
};

export type BackupEnvelope = { format: string; version: number; cipher: string; data: string };

export function isSafeStorageKey(key: string): boolean {
  return STORAGE_PREFIXES.some(prefix => key.startsWith(prefix));
}

export function isSafeFilePath(path: string): boolean {
  const segments = path.split("/");
  return FILE_ROOTS.includes(segments[0]) && segments.every(segment => segment && segment !== "." && segment !== "..");
}

/** Checks the outer envelope before any decryption happens, so a corrupt or foreign file fails fast. */
export function parseBackupEnvelope(raw: string): BackupEnvelope {
  let envelope: Partial<BackupEnvelope>;
  try {
    envelope = JSON.parse(raw);
  } catch {
    throw new Error("That file is not a readable backup archive.");
  }
  if (envelope.format !== "inkline-backup" || typeof envelope.data !== "string" || !envelope.data) {
    throw new Error("That is not an Inkline encrypted backup.");
  }
  return envelope as BackupEnvelope;
}

/**
 * Checks the decrypted payload eagerly, before anything is written to disk —
 * a malformed or tampered archive fails whole, not partway through a restore
 * that has already overwritten some of the library.
 */
export function validateBackupPayload(payload: unknown): BackupPayload {
  const candidate = payload as Partial<BackupPayload> | null;
  if (!candidate || typeof candidate !== "object" || candidate.version !== 1 || !Array.isArray(candidate.storage) || !Array.isArray(candidate.files)) {
    throw new Error("This backup version is not supported.");
  }
  for (const [keyName] of candidate.storage) {
    if (!isSafeStorageKey(keyName)) throw new Error("Backup contains an unsafe storage key.");
  }
  for (const saved of candidate.files) {
    if (!isSafeFilePath(saved.path)) throw new Error("Backup contains an unsafe file path.");
  }
  return candidate as BackupPayload;
}
