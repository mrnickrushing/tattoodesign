// Getting from a colour on screen to drops in a bowl.
//
// The app can already show a design in any icing colour. What it could not do
// is the only step that matters at the bench: what to actually put in the
// icing to get that colour. Picking a swatch and then guessing at the gel
// bottle is where the digital part stops being useful.
//
// This is a starting point, not a formula, and it says so. Three things make
// exactness impossible and all of them are real:
//
//   - Royal icing deepens as it sits. A colour mixed to look right is too pale
//     an hour later, which is why bakers under-tint and wait.
//   - Gel brands differ, and so do batches within a brand.
//   - The base is never the same white twice — meringue powder, fresh egg
//     white and store-bought icing all start from a different place.
//
// So the output is "start here, let it sit, adjust" rather than a number
// pretending to be a measurement.
//
// Pure colour maths, no Skia, so the mixing model can be checked off-device.

export type Gel = {
  id: string;
  name: string;
  /** Roughly what the gel looks like at full strength. */
  hex: string;
};

/**
 * A standard soft-gel set. Deliberately small: a working shelf, not a
 * catalogue. Every extra bottle makes the suggestion harder to act on.
 */
export const GELS: Gel[] = [
  { id: "super-red", name: "Super Red", hex: "#ed2939" },
  { id: "deep-pink", name: "Deep Pink", hex: "#e3006d" },
  { id: "soft-pink", name: "Soft Pink", hex: "#f4a6c0" },
  { id: "orange", name: "Orange", hex: "#f58220" },
  { id: "lemon-yellow", name: "Lemon Yellow", hex: "#fff200" },
  { id: "egg-yellow", name: "Egg Yellow", hex: "#fdb913" },
  { id: "leaf-green", name: "Leaf Green", hex: "#4c9f38" },
  { id: "mint", name: "Mint", hex: "#7fc9a9" },
  { id: "sky-blue", name: "Sky Blue", hex: "#6ec6e8" },
  { id: "royal-blue", name: "Royal Blue", hex: "#0033a0" },
  { id: "regal-purple", name: "Regal Purple", hex: "#6a2c91" },
  { id: "violet", name: "Violet", hex: "#8b5fbf" },
  { id: "warm-brown", name: "Warm Brown", hex: "#8b5e3c" },
  { id: "chocolate", name: "Chocolate Brown", hex: "#5a3a22" },
  { id: "black", name: "Super Black", hex: "#1a1a1a" },
];

export type Rgb = { r: number; g: number; b: number };

export function parseHex(hex: string): Rgb | null {
  const cleaned = hex.trim().replace(/^#/, "");
  const full =
    cleaned.length === 3
      ? cleaned
          .split("")
          .map((c) => c + c)
          .join("")
      : cleaned;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/** How far apart two colours are, weighted the way an eye weights them. */
export function colourDistance(a: Rgb, b: Rgb): number {
  // Green dominates perceived brightness and blue barely registers, so an
  // unweighted RGB distance calls two greens "closer" than they look and two
  // blues "further".
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);
}

/** Distance from white, 0..1 — how much tinting the colour needs at all. */
export function tintStrength(target: Rgb): number {
  const white = { r: 255, g: 255, b: 255 };
  const max = colourDistance({ r: 0, g: 0, b: 0 }, white);
  return Math.min(1, colourDistance(target, white) / max);
}

export type Recipe = {
  /** Gels to use, strongest first. */
  parts: { gel: Gel; drops: number }[];
  /** Cups of icing the drop counts assume. */
  perCups: number;
  /** How confident the match is, 0..1 — drives how the UI hedges. */
  closeness: number;
  note: string;
};

/** Below this a colour is close enough to white to need almost nothing. */
const BARELY_TINTED = 0.06;

/**
 * Drops for a given strength.
 *
 * Not linear. The first drops move the colour a long way and later ones barely
 * register, which is exactly why "just add more" produces mud — so the curve
 * is steep at the start and flattens, and deep shades are called out as
 * needing time rather than more gel.
 */
function dropsFor(strength: number, perCups: number): number {
  const drops = Math.pow(strength, 1.7) * 26 * perCups;
  return Math.max(1, Math.round(drops * 2) / 2);
}

/**
 * How to mix a target colour.
 *
 * One gel when a bottle is genuinely close. Two when the target sits between
 * them — and never three, because a third bottle is where colour mixing stops
 * being repeatable and starts being luck.
 */
export function recipeFor(hex: string, perCups = 1): Recipe | null {
  const target = parseHex(hex);
  if (!target) return null;

  const strength = tintStrength(target);
  if (strength < BARELY_TINTED) {
    return {
      parts: [],
      perCups,
      closeness: 1,
      note: "Near enough to white to leave untinted — a drop of anything will show.",
    };
  }

  // Rank gels by how close their hue is once both are pushed to full strength,
  // so a pale target is matched on colour rather than on how pale it is.
  const scored = GELS.map((gel) => {
    const gelRgb = parseHex(gel.hex)!;
    return { gel, gelRgb, distance: colourDistance(saturate(target), saturate(gelRgb)) };
  }).sort((a, b) => a.distance - b.distance);

  const best = scored[0];
  const second = scored[1];
  const closeness = Math.max(0, 1 - best.distance / 260);

  const totalDrops = dropsFor(strength, perCups);

  // A clearly-nearest bottle is one bottle. A target sitting between two is
  // two, split by how much closer each one is.
  const useSecond = second && second.distance < best.distance * 1.35;
  const parts = useSecond
    ? (() => {
        const weight = second.distance / (best.distance + second.distance);
        const first = Math.max(0.5, Math.round(totalDrops * weight * 2) / 2);
        const rest = Math.max(0.5, Math.round((totalDrops - first) * 2) / 2);
        return [
          { gel: best.gel, drops: first },
          { gel: second.gel, drops: rest },
        ];
      })()
    : [{ gel: best.gel, drops: totalDrops }];

  return {
    parts,
    perCups,
    closeness,
    note:
      strength > 0.72
        ? "Deep shades keep developing — mix it lighter than you want and give it an hour before adding more."
        : "Let it sit 15 minutes before judging; royal icing darkens as it rests.",
  };
}

/** Pushes a colour to full saturation so hues can be compared fairly. */
function saturate(colour: Rgb): Rgb {
  const max = Math.max(colour.r, colour.g, colour.b);
  const min = Math.min(colour.r, colour.g, colour.b);
  if (max === min) return colour;
  const scale = 255 / (max - min);
  return {
    r: Math.round((colour.r - min) * scale),
    g: Math.round((colour.g - min) * scale),
    b: Math.round((colour.b - min) * scale),
  };
}

/** A one-line rendering, e.g. "6 drops Deep Pink + 2 Soft Pink per cup". */
export function describeRecipe(recipe: Recipe): string {
  if (!recipe.parts.length) return "No tint needed";
  const cups = recipe.perCups === 1 ? "cup" : `${recipe.perCups} cups`;
  const body = recipe.parts
    .map((part, index) =>
      index === 0 ? `${part.drops} drops ${part.gel.name}` : `${part.drops} ${part.gel.name}`
    )
    .join(" + ");
  return `${body} per ${cups}`;
}
