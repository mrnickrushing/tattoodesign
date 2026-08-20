import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";

export type ImportedImage = {
  dataUrl: string;
  uri: string;
  name: string;
  mimeType: string;
};

/** Opens the native Files surface (including iCloud Drive on iOS). */
export async function pickImageFile(): Promise<ImportedImage | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ["image/png", "image/jpeg", "image/webp"],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  const mimeType = asset.mimeType || "image/jpeg";
  const base64 = asset.base64 || (await new File(asset.uri).base64());
  return {
    dataUrl: `data:${mimeType};base64,${base64}`,
    uri: asset.uri,
    name: asset.name,
    mimeType,
  };
}


export { imageDataUrl, sniffImageType } from "./imageType";
