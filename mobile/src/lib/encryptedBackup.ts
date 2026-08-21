import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import { AESKeySize, AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from "expo-crypto";
import { FILE_ROOTS, STORAGE_PREFIXES, parseBackupEnvelope, validateBackupPayload, type BackupPayload } from "./backupArchive";

export { isSafeFilePath, isSafeStorageKey, parseBackupEnvelope, validateBackupPayload } from "./backupArchive";

const KEY_SLOT = "inkline:backup-recovery-key:v1";

function utf8Bytes(value: string) {
  const encoded = unescape(encodeURIComponent(value));
  return Uint8Array.from(encoded, char => char.charCodeAt(0));
}
function utf8String(value: Uint8Array) {
  let raw = "";
  for (const byte of value) raw += String.fromCharCode(byte);
  return decodeURIComponent(escape(raw));
}

async function collect(directory: Directory, prefix: string, output: BackupPayload["files"]) {
  if (!directory.exists) return;
  for (const entry of directory.list()) {
    const path = `${prefix}/${entry.name}`;
    if (entry instanceof Directory) await collect(entry, path, output);
    else output.push({ path, data: await entry.base64() });
  }
}

async function getOrCreateKey() {
  const saved = await SecureStore.getItemAsync(KEY_SLOT);
  if (saved) return { key: await AESEncryptionKey.import(saved, "base64"), encoded: saved };
  const key = await AESEncryptionKey.generate(AESKeySize.AES256);
  const encoded = await key.encoded("base64");
  await SecureStore.setItemAsync(KEY_SLOT, encoded, { requireAuthentication: false });
  return { key, encoded };
}

export async function createEncryptedBackup() {
  const keys = (await AsyncStorage.getAllKeys()).filter(key => STORAGE_PREFIXES.some(prefix => key.startsWith(prefix)));
  const storage = (await AsyncStorage.multiGet(keys)).filter((item): item is [string, string] => item[1] !== null);
  const files: BackupPayload["files"] = [];
  for (const root of FILE_ROOTS) await collect(new Directory(Paths.document, root), root, files);
  const payload: BackupPayload = { version: 1, createdAt: Date.now(), storage, files };
  const { key, encoded } = await getOrCreateKey();
  const sealed = await aesEncryptAsync(utf8Bytes(JSON.stringify(payload)), key, { nonce: { length: 12 }, tagLength: 16 });
  const envelope = JSON.stringify({ format: "inkline-backup", version: 1, cipher: "AES-256-GCM", data: await sealed.combined("base64") });
  const file = new File(Paths.cache, `inkline-backup-${new Date().toISOString().slice(0, 10)}.inkline`);
  if (file.exists) file.delete();
  file.write(envelope);
  return { file, recoveryKey: encoded, itemCount: storage.length, fileCount: files.length };
}

export async function restoreEncryptedBackup(file: File, recoveryKey: string) {
  const envelope = parseBackupEnvelope(await file.text());
  const key = await AESEncryptionKey.import(recoveryKey.trim(), "base64");
  const sealed = AESSealedData.fromCombined(envelope.data, { ivLength: 12, tagLength: 16 });
  const plaintext = await aesDecryptAsync(sealed, key);
  const payload = validateBackupPayload(JSON.parse(utf8String(plaintext)));
  for (const [keyName, value] of payload.storage) {
    await AsyncStorage.setItem(keyName, value);
  }
  for (const saved of payload.files) {
    const segments = saved.path.split("/");
    const directory = new Directory(Paths.document, ...segments.slice(0, -1));
    if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
    const target = new File(directory, segments.at(-1)!);
    if (target.exists) target.delete();
    target.write(saved.data, { encoding: "base64" });
  }
  await SecureStore.setItemAsync(KEY_SLOT, recoveryKey.trim());
  return { itemCount: payload.storage.length, fileCount: payload.files.length, createdAt: payload.createdAt };
}
