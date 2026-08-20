// A phone has no keyboard to listen to, no right button, and nothing to drop
// on it. These are the no-ops that let the screens keep one code path; see
// desktopInput.ts for what the browser build does.

import type { Chord } from "./shortcuts";

export function useShortcut(_chord: Chord, _handler: (() => void) | null): void {}

export function useArrowNudge(
  _handler: ((delta: { x: number; y: number }, coarse: boolean) => void) | null
): void {}

export function useFileDrop(_handler: ((dataUrl: string, name: string) => void) | null): void {}

export function contextMenuProps(_onOpen: () => void) {
  return {};
}

export { isTyping } from "./shortcuts";
