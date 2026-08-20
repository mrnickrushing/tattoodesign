// Keyboard on a device that has one.
//
// Every control in this app was built for a finger: long-press to open a
// menu, pinch to resize, drag to nudge. On a laptop those are the wrong
// gestures — a long-press with a mouse is press-and-wait-and-hope, and pinch
// does not exist at all. Meanwhile the keyboard, which is right there, does
// nothing.
//
// Kept as a pure matcher so the bindings can be verified without a DOM. The
// listener that feeds it lives in the component that owns the state.

export type Chord = {
  key: string;
  /** Cmd on a Mac, Ctrl elsewhere — matched as "either" rather than guessing. */
  mod?: boolean;
  shift?: boolean;
};

export type KeyEventLike = {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  target?: { tagName?: string; isContentEditable?: boolean } | null;
};

/**
 * Whether the keystroke belongs to something the person is typing into.
 *
 * Without this, pressing Delete while renaming a design deletes the design,
 * and Cmd+Z in a text field undoes the canvas instead of the word — both of
 * which feel like the app fighting you.
 */
export function isTyping(event: KeyEventLike): boolean {
  const target = event.target;
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = (target.tagName || "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function matches(event: KeyEventLike, chord: Chord): boolean {
  if (isTyping(event)) return false;
  if (event.key.toLowerCase() !== chord.key.toLowerCase()) return false;
  const mod = !!(event.metaKey || event.ctrlKey);
  if (!!chord.mod !== mod) return false;
  if (!!chord.shift !== !!event.shiftKey) return false;
  // Alt is never part of a binding here, so a keystroke carrying it is
  // someone reaching for an accent or an OS shortcut, not for this app.
  return !event.altKey;
}

/** How far an arrow key moves something, in the units the caller works in. */
export function nudgeStep(event: KeyEventLike, fine: number, coarse: number): number {
  return event.shiftKey ? coarse : fine;
}

/** Which way an arrow points, or null if the key is not an arrow. */
export function arrowDelta(event: KeyEventLike): { x: number; y: number } | null {
  if (isTyping(event)) return null;
  switch (event.key) {
    case "ArrowLeft":
      return { x: -1, y: 0 };
    case "ArrowRight":
      return { x: 1, y: 0 };
    case "ArrowUp":
      return { x: 0, y: -1 };
    case "ArrowDown":
      return { x: 0, y: 1 };
    default:
      return null;
  }
}

export const SHORTCUTS = {
  undo: { key: "z", mod: true } as Chord,
  redo: { key: "z", mod: true, shift: true } as Chord,
  save: { key: "s", mod: true } as Chord,
  close: { key: "Escape" } as Chord,
  remove: { key: "Backspace" } as Chord,
  removeAlt: { key: "Delete" } as Chord,
} as const;
