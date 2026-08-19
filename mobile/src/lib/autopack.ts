// One tap between "ten traced designs" and "a printable flash sheet".
//
// Shelf packing at real physical sizes: sort by height, fill rows left to
// right, start a new shelf when a row is full, rotate an item 90° when that's
// the difference between fitting and not. Deterministic — same input, same
// layout — and honest about overflow: anything that can't fit is returned,
// never silently dropped.

export type PackInput = {
  id: string;
  wIn: number;
  hIn: number;
};

export type PackPlacement = {
  id: string;
  xIn: number;
  yIn: number;
  /** True when the item was turned 90° to fit; the caller applies rotation. */
  rotated: boolean;
  wIn: number;
  hIn: number;
};

export type PackOptions = {
  /** Sheet interior the layout may use, in inches. */
  widthIn: number;
  heightIn: number;
  /** Space between neighbouring items. */
  gutterIn: number;
  /** Space kept clear at every sheet edge. */
  edgeIn: number;
  /** Whether 90° rotation may be used to fit an item. */
  allowRotate: boolean;
};

export const DEFAULT_PACK: Pick<PackOptions, "gutterIn" | "edgeIn" | "allowRotate"> = {
  gutterIn: 0.2,
  edgeIn: 0.2,
  allowRotate: true,
};

export type PackResult = {
  placed: PackPlacement[];
  /** Ids that could not fit anywhere, in input order. */
  overflow: string[];
};

/**
 * Packs items into shelves, biggest area first (ties: taller first, then
 * input order, so the result is deterministic).
 *
 * Items keep their physical size — packing arranges, it never scales. An item
 * larger than the usable area in both orientations goes straight to overflow.
 */
export function packItems(items: PackInput[], options: PackOptions): PackResult {
  const usableW = options.widthIn - options.edgeIn * 2;
  const usableH = options.heightIn - options.edgeIn * 2;
  const result: PackResult = { placed: [], overflow: [] };
  if (usableW <= 0 || usableH <= 0) {
    result.overflow = items.map((item) => item.id);
    return result;
  }

  const order = items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        b.item.wIn * b.item.hIn - a.item.wIn * a.item.hIn ||
        b.item.hIn - a.item.hIn ||
        a.index - b.index
    );

  // Shelves: y offset + height of the tallest occupant + next free x.
  const shelves: { yIn: number; heightIn: number; nextX: number }[] = [];
  const overflowByIndex: { id: string; index: number }[] = [];

  const orientationsFor = (item: PackInput): { wIn: number; hIn: number; rotated: boolean }[] => {
    const upright = { wIn: item.wIn, hIn: item.hIn, rotated: false };
    if (!options.allowRotate || item.wIn === item.hIn) return [upright];
    return [upright, { wIn: item.hIn, hIn: item.wIn, rotated: true }];
  };

  const shelfBottom = () => {
    const last = shelves.at(-1);
    return last ? last.yIn + last.heightIn + options.gutterIn : options.edgeIn;
  };

  for (const { item, index } of order) {
    let placed = false;

    // Existing shelves first, upright before rotated, so rotation is used
    // only when it actually helps.
    for (const orientation of orientationsFor(item)) {
      if (placed) break;
      if (orientation.wIn > usableW || orientation.hIn > usableH) continue;
      for (const shelf of shelves) {
        if (orientation.hIn > shelf.heightIn) continue;
        if (shelf.nextX + orientation.wIn > options.edgeIn + usableW + 1e-9) continue;
        result.placed.push({ id: item.id, xIn: shelf.nextX, yIn: shelf.yIn, rotated: orientation.rotated, wIn: orientation.wIn, hIn: orientation.hIn });
        shelf.nextX += orientation.wIn + options.gutterIn;
        placed = true;
        break;
      }
    }

    // A new shelf, sized by this item.
    if (!placed) {
      for (const orientation of orientationsFor(item)) {
        if (orientation.wIn > usableW || orientation.hIn > usableH) continue;
        const yIn = shelfBottom();
        if (yIn + orientation.hIn > options.edgeIn + usableH + 1e-9) continue;
        shelves.push({ yIn, heightIn: orientation.hIn, nextX: options.edgeIn + orientation.wIn + options.gutterIn });
        result.placed.push({ id: item.id, xIn: options.edgeIn, yIn, rotated: orientation.rotated, wIn: orientation.wIn, hIn: orientation.hIn });
        placed = true;
        break;
      }
    }

    if (!placed) overflowByIndex.push({ id: item.id, index });
  }

  result.overflow = overflowByIndex.sort((a, b) => a.index - b.index).map(({ id }) => id);
  return result;
}

/** True when any two placements overlap, gutter included — a layout invariant. */
export function hasOverlap(placements: PackPlacement[], gutterIn: number): boolean {
  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      const a = placements[i];
      const b = placements[j];
      const gap = gutterIn - 1e-9;
      if (
        a.xIn < b.xIn + b.wIn + gap &&
        b.xIn < a.xIn + a.wIn + gap &&
        a.yIn < b.yIn + b.hIn + gap &&
        b.yIn < a.yIn + a.hIn + gap
      ) {
        return true;
      }
    }
  }
  return false;
}
