// Wiring a laptop's inputs to an app built for a finger.
//
// These are no-ops on a phone — there is no keyboard to listen to, no right
// button to press, and no file to drop — so the native build resolves this to
// desktopInput.native.ts and the screens keep one code path either way.

import { useEffect } from "react";
import { arrowDelta, isTyping, matches, type Chord, type KeyEventLike } from "./shortcuts";
import { imageDataUrl } from "./imageType";

/**
 * Runs `handler` when the chord is pressed anywhere outside a text field.
 *
 * `handler` is intentionally not in the dependency list — screens define these
 * inline, so a new function identity every render would tear down and rebuild
 * the listener on every keystroke. The ref keeps the latest one without that.
 */
export function useShortcut(chord: Chord, handler: (() => void) | null): void {
  useEffect(() => {
    if (!handler) return;
    const onKey = (event: KeyboardEvent) => {
      if (!matches(event as unknown as KeyEventLike, chord)) return;
      event.preventDefault();
      handler();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chord, handler]);
}

/** Arrow keys, with the direction and how far. Shift means coarse. */
export function useArrowNudge(
  handler: ((delta: { x: number; y: number }, coarse: boolean) => void) | null
): void {
  useEffect(() => {
    if (!handler) return;
    const onKey = (event: KeyboardEvent) => {
      const delta = arrowDelta(event as unknown as KeyEventLike);
      if (!delta) return;
      event.preventDefault();
      handler(delta, event.shiftKey);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handler]);
}

/**
 * Files dropped anywhere on the page.
 *
 * Both dragover and drop have to be prevented, or the browser navigates away
 * to display the image — which looks exactly like the app crashing.
 */
export function useFileDrop(handler: ((dataUrl: string, name: string) => void) | null): void {
  useEffect(() => {
    if (!handler) return;

    const allow = (event: DragEvent) => {
      if (!event.dataTransfer?.types?.includes("Files")) return;
      event.preventDefault();
    };

    const onDrop = (event: DragEvent) => {
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      event.preventDefault();
      if (!file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result !== "string") return;
        // Re-derive the type from the bytes rather than trusting file.type,
        // which is guessed from the extension and is wrong often enough.
        const base64 = result.slice(result.indexOf(",") + 1);
        handler(imageDataUrl(base64), file.name);
      };
      reader.readAsDataURL(file);
    };

    window.addEventListener("dragover", allow);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", allow);
      window.removeEventListener("drop", onDrop);
    };
  }, [handler]);
}

/**
 * Props that make a pressable open its menu on right-click too.
 *
 * Long-press is the phone gesture and stays; with a mouse it is
 * press-and-wait-and-hope, so the right button gets the same job.
 */
export function contextMenuProps(onOpen: () => void) {
  return {
    onContextMenu: (event: { preventDefault: () => void }) => {
      event.preventDefault();
      onOpen();
    },
  };
}

export { isTyping };
