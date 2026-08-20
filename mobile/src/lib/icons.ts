import { Ionicons } from "@expo/vector-icons";

export type IconName =
  | "home"
  | "generate"
  | "convert"
  | "sheet"
  | "settings"
  | "projects"
  | "print"
  | "share"
  | "save"
  | "edit"
  | "crop"
  | "undo"
  | "redo"
  | "delete"
  | "add"
  | "close"
  | "chevronDown"
  | "chevronForward"
  | "chevronUp"
  | "arrowForward"
  | "checkmark"
  | "alert"
  | "image"
  | "document"
  | "swap"
  | "expand"
  | "collapse"
  | "substrate"
  | "flash"
  | "palette"
  | "contrast"
  | "layers"
  | "visibility"
  | "visibilityOff"
  | "lock"
  | "unlock"
  | "history"
  | "branch"
  | "commit"
  | "brush"
  | "move"
  | "mask"
  | "production"
  | "copy"
  | "upload"
  | "download"
  | "refresh"
  | "cloudOffline"
  | "scan"
  | "cut"
  | "text"
  | "resize"
  | "filter"
  | "wand"
  | "radioOn"
  | "radioOff"
  | "back"
  | "up"
  | "down"
  | "information"
  | "key"
  | "tag"
  | "tool"
  | "play"
  | "bluetooth"
  | "camera"
  | "phone"
  | "send"
  | "water"
  | "favorite"
  | "favoriteFilled"
  | "nodes";

export type IconDefinition = {
  /** SF Symbol availability is version-gated and validated on device. */
  sf: string;
  ion: keyof typeof Ionicons.glyphMap;
};

/** Semantic actions keep the iOS symbol and cross-platform fallback aligned. */
export const ICONS: Record<IconName, IconDefinition> = {
  home: { sf: "house", ion: "home" },
  generate: { sf: "sparkles", ion: "sparkles" },
  convert: { sf: "viewfinder", ion: "scan" },
  sheet: { sf: "square.grid.2x2", ion: "grid" },
  settings: { sf: "gearshape", ion: "settings" },
  projects: { sf: "folder", ion: "folder-open-outline" },
  print: { sf: "printer", ion: "print-outline" },
  share: { sf: "square.and.arrow.up", ion: "share-outline" },
  save: { sf: "bookmark", ion: "bookmark-outline" },
  edit: { sf: "pencil", ion: "pencil-outline" },
  crop: { sf: "crop", ion: "crop-outline" },
  undo: { sf: "arrow.uturn.backward", ion: "arrow-undo" },
  redo: { sf: "arrow.uturn.forward", ion: "arrow-redo" },
  delete: { sf: "trash", ion: "trash-outline" },
  add: { sf: "plus.circle", ion: "add-circle-outline" },
  close: { sf: "xmark", ion: "close" },
  chevronDown: { sf: "chevron.down", ion: "chevron-down" },
  chevronForward: { sf: "chevron.forward", ion: "chevron-forward" },
  chevronUp: { sf: "chevron.up", ion: "chevron-up" },
  arrowForward: { sf: "arrow.right", ion: "arrow-forward" },
  checkmark: { sf: "checkmark.circle", ion: "checkmark-circle" },
  alert: { sf: "exclamationmark.triangle", ion: "alert-circle-outline" },
  image: { sf: "photo", ion: "image-outline" },
  document: { sf: "doc.on.doc", ion: "document-text-outline" },
  swap: { sf: "arrow.left.arrow.right", ion: "swap-horizontal" },
  expand: { sf: "arrow.up.left.and.arrow.down.right", ion: "expand-outline" },
  collapse: { sf: "arrow.down.right.and.arrow.up.left", ion: "contract-outline" },
  substrate: { sf: "circle.dashed", ion: "ellipse-outline" },
  flash: { sf: "bolt.fill", ion: "flash" },
  palette: { sf: "paintpalette", ion: "color-palette" },
  contrast: { sf: "circle.lefthalf.filled", ion: "contrast-outline" },
  layers: { sf: "square.3.layers.3d", ion: "layers-outline" },
  visibility: { sf: "eye", ion: "eye-outline" },
  visibilityOff: { sf: "eye.slash", ion: "eye-off-outline" },
  lock: { sf: "lock.fill", ion: "lock-closed" },
  unlock: { sf: "lock.open", ion: "lock-open-outline" },
  history: { sf: "clock.arrow.circlepath", ion: "time-outline" },
  branch: { sf: "arrow.triangle.branch", ion: "git-branch-outline" },
  commit: { sf: "circle.dotted", ion: "git-commit-outline" },
  brush: { sf: "paintbrush", ion: "brush-outline" },
  move: { sf: "arrow.up.and.down.and.arrow.left.and.right", ion: "move-outline" },
  mask: { sf: "minus.circle", ion: "remove-circle-outline" },
  production: { sf: "checkmark.shield", ion: "shield-checkmark-outline" },
  copy: { sf: "doc.on.clipboard", ion: "copy-outline" },
  upload: { sf: "icloud.and.arrow.up", ion: "cloud-upload-outline" },
  download: { sf: "arrow.down.circle", ion: "download-outline" },
  refresh: { sf: "arrow.clockwise", ion: "refresh" },
  cloudOffline: { sf: "icloud.slash", ion: "cloud-offline-outline" },
  scan: { sf: "doc.viewfinder", ion: "scan-outline" },
  cut: { sf: "scissors", ion: "cut-outline" },
  text: { sf: "textformat", ion: "text-outline" },
  resize: { sf: "arrow.up.left.and.down.right.magnifyingglass", ion: "resize-outline" },
  filter: { sf: "camera.filters", ion: "color-filter-outline" },
  wand: { sf: "wand.and.stars", ion: "color-wand-outline" },
  radioOn: { sf: "record.circle", ion: "radio-button-on" },
  radioOff: { sf: "circle", ion: "radio-button-off" },
  back: { sf: "arrow.left", ion: "arrow-back" },
  up: { sf: "arrow.up", ion: "arrow-up" },
  down: { sf: "arrow.down", ion: "arrow-down" },
  information: { sf: "info.circle", ion: "information-circle-outline" },
  key: { sf: "key", ion: "key-outline" },
  tag: { sf: "tag", ion: "pricetag-outline" },
  tool: { sf: "hammer", ion: "hammer-outline" },
  play: { sf: "play.circle", ion: "play-circle-outline" },
  bluetooth: { sf: "bluetooth", ion: "bluetooth-outline" },
  camera: { sf: "camera", ion: "camera-outline" },
  phone: { sf: "iphone", ion: "phone-portrait-outline" },
  send: { sf: "paperplane", ion: "send-outline" },
  water: { sf: "drop", ion: "water-outline" },
  favorite: { sf: "star", ion: "star-outline" },
  favoriteFilled: { sf: "star.fill", ion: "star" },
  nodes: { sf: "point.topleft.down.curvedto.point.bottomright.up", ion: "git-commit-outline" },
};

/** Returns a usable fallback even if an untyped caller reaches this boundary. */
export function iconFor(name: IconName): IconDefinition {
  return ICONS[name] || ICONS.home;
}
