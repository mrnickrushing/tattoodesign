import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PACK, hasOverlap, packItems, type PackInput, type PackOptions } from "./autopack";

const LETTER: PackOptions = { widthIn: 8.5, heightIn: 11, ...DEFAULT_PACK };

function items(sizes: [number, number][]): PackInput[] {
  return sizes.map(([wIn, hIn], index) => ({ id: `d${index}`, wIn, hIn }));
}

function inBounds(result: ReturnType<typeof packItems>, options: PackOptions): boolean {
  return result.placed.every(
    (p) =>
      p.xIn >= options.edgeIn - 1e-9 &&
      p.yIn >= options.edgeIn - 1e-9 &&
      p.xIn + p.wIn <= options.widthIn - options.edgeIn + 1e-9 &&
      p.yIn + p.hIn <= options.heightIn - options.edgeIn + 1e-9
  );
}

test("a handful of designs pack onto one sheet with no overlaps", () => {
  const result = packItems(items([[3, 4], [2, 2], [3, 3], [2, 3], [1.5, 1.5]]), LETTER);
  assert.equal(result.overflow.length, 0);
  assert.equal(result.placed.length, 5);
  assert.ok(inBounds(result, LETTER), "everything inside the printable area");
  assert.equal(hasOverlap(result.placed, LETTER.gutterIn), false);
});

test("packing arranges, never scales", () => {
  const input = items([[3, 4], [2, 2]]);
  const result = packItems(input, LETTER);
  for (const placement of result.placed) {
    const original = input.find((item) => item.id === placement.id)!;
    const dims = [placement.wIn, placement.hIn].sort();
    assert.deepEqual(dims, [original.wIn, original.hIn].sort(), "size preserved (possibly rotated)");
  }
});

test("rotation is used only when it helps", () => {
  // 7in wide sheet interior; a 6x2 lies flat, but a 2x6 must rotate to share.
  const tight: PackOptions = { widthIn: 7.4, heightIn: 5, ...DEFAULT_PACK };
  const result = packItems(items([[6, 2], [2, 6]]), tight);
  assert.equal(result.overflow.length, 0);
  const flat = result.placed.find((p) => p.id === "d0")!;
  const turned = result.placed.find((p) => p.id === "d1")!;
  assert.equal(flat.rotated, false, "the item that fits upright stays upright");
  assert.equal(turned.rotated, true, "the tall one turns to fit the sheet");
  assert.equal(hasOverlap(result.placed, tight.gutterIn), false);
});

test("rotation off means tall items overflow instead of turning", () => {
  const tight: PackOptions = { widthIn: 7.4, heightIn: 5, ...DEFAULT_PACK, allowRotate: false };
  const result = packItems(items([[2, 6]]), tight);
  assert.deepEqual(result.overflow, ["d0"]);
});

test("what cannot fit is reported, never dropped or shrunk", () => {
  const result = packItems(items([[3, 3], [20, 20], [2, 2]]), LETTER);
  assert.deepEqual(result.overflow, ["d1"], "the oversized item overflows in input order");
  assert.equal(result.placed.length, 2);
});

test("a full sheet overflows the extras", () => {
  // 3.8in squares on letter: interior 8.1×10.6, so 3.8+0.2+3.8 = 7.8 fits two
  // per shelf, and two shelves (0.2–4.0, 4.2–8.0) fit before a third would
  // run past 10.8. Four place, two overflow.
  const result = packItems(items(Array.from({ length: 6 }, () => [3.8, 3.8] as [number, number])), LETTER);
  assert.equal(result.placed.length, 4);
  assert.equal(result.overflow.length, 2);
  assert.equal(hasOverlap(result.placed, LETTER.gutterIn), false);
});

test("packing is deterministic", () => {
  const input = items([[3, 4], [2, 2], [3, 3], [2, 3], [1.5, 1.5], [4, 2]]);
  const first = packItems(input, LETTER);
  const second = packItems(input, LETTER);
  assert.deepEqual(first, second);
});

test("bigger items claim shelves first", () => {
  const result = packItems(items([[1, 1], [4, 5]]), LETTER);
  const big = result.placed.find((p) => p.id === "d1")!;
  const small = result.placed.find((p) => p.id === "d0")!;
  assert.ok(big.yIn <= small.yIn, "the big design anchors the top of the sheet");
});

test("degenerate inputs behave", () => {
  assert.deepEqual(packItems([], LETTER), { placed: [], overflow: [] });
  const noRoom = packItems(items([[1, 1]]), { ...LETTER, widthIn: 0.3, heightIn: 0.3 });
  assert.deepEqual(noRoom.overflow, ["d0"]);
});

test("the gutter genuinely separates neighbours", () => {
  const result = packItems(items([[2, 2], [2, 2], [2, 2]]), LETTER);
  const [a, b] = [result.placed[0], result.placed[1]];
  const horizontalGap = Math.abs(b.xIn - (a.xIn + a.wIn));
  assert.ok(horizontalGap >= LETTER.gutterIn - 1e-9, `gap ${horizontalGap} >= gutter`);
});

test("hasOverlap catches violations", () => {
  assert.equal(
    hasOverlap(
      [
        { id: "a", xIn: 0, yIn: 0, wIn: 2, hIn: 2, rotated: false },
        { id: "b", xIn: 1.9, yIn: 0, wIn: 2, hIn: 2, rotated: false },
      ],
      0.2
    ),
    true
  );
  assert.equal(
    hasOverlap(
      [
        { id: "a", xIn: 0, yIn: 0, wIn: 2, hIn: 2, rotated: false },
        { id: "b", xIn: 2.3, yIn: 0, wIn: 2, hIn: 2, rotated: false },
      ],
      0.2
    ),
    false
  );
});
