import type { Tray } from "./castingTray";
import type { ProductionFinding } from "./productionTools";
import type { SphereMold } from "./sphereMold";

/**
 * What the export prompts say, worked out apart from the screen that shows it.
 *
 * These used to be assembled inline in `DesignEditor`, and every review finding
 * this app has had in its wiring layer was in code of exactly this shape: a
 * list of options built by hand, an alternative offered when it was not really
 * a question, a summary describing something the tray had not done. None of it
 * is rendering. All of it is data, and it can be checked like data.
 *
 * A prompt is a title, a paragraph, and the ways out. What the caller does with
 * the answer stays with the caller — the point is that *what is offered* can be
 * decided without a device in the room.
 */

export type ExportChoice = {
  /** What comes back when this row is picked. */
  value: number;
  label: string;
  detail?: string;
};

export type ExportPrompt = {
  title: string;
  subtitle: string;
  choices: ExportChoice[];
};

/**
 * Named rather than numbered at the call site.
 *
 * The dispatch is on the value, so two rows sharing one would silently do each
 * other's work — the sort of thing that reads fine and is wrong. Named
 * constants let a test say what it means, and `everyChoiceIsDistinct` below
 * makes the collision an assertion rather than a hope.
 */
export const TRAY_EXPORT = 0;
export const TRAY_KEEP_HOLES = 1;
export const TRAY_CAST_FLAT = 2;
export const MOLD_DESIGNED = 0;
export const MOLD_SMOOTH = 1;

/** The warnings, which decide how a prompt opens and what its action is called. */
export function warningsIn(findings: ProductionFinding[]): ProductionFinding[] {
  return findings.filter((finding) => finding.level === "warn");
}

/** Warnings first, then the numbers, the way somebody about to spend filament reads it. */
function preamble(warnings: ProductionFinding[], summary: string): string {
  if (!warnings.length) return summary;
  return `${warnings.map((finding) => finding.detail).join("\n\n")}\n\n${summary}`;
}

/** How thick the pieces stand. The one number a drawing genuinely cannot supply. */
export function thicknessPrompt(): ExportPrompt {
  return {
    title: "How thick are they?",
    subtitle: "The shapes stand this proud of the tray floor, so it is how deep the finished piece will be.",
    choices: [
      { value: 4, label: "Thin — 4mm", detail: "A flat topper or a thin chocolate." },
      { value: 7, label: "Standard — 7mm", detail: "A cookie you would recognise as a cookie." },
      { value: 12, label: "Chunky — 12mm", detail: "A solid piece with real weight to it." },
    ],
  };
}

/** How many cavities one pour should fill. */
export function cavityPrompt(counts: number[], subject?: string): ExportPrompt {
  return {
    title: subject ? `How many ${subject}s at a time?` : "How many at a time?",
    subtitle: subject
      ? "Each one needs both halves of the mold, so this is what one pair of trays makes."
      : "Each cavity is one piece out of a single pour of silicone.",
    choices: counts.map((copies) => ({
      value: copies,
      label: copies === 1 ? "Just one" : `${copies}`,
      detail: copies === 1 ? `One ${subject ?? "piece"} per pour.` : undefined,
    })),
  };
}

/**
 * The preflight for a flat tray.
 *
 * Two of the three rows are conditional, and the conditions are the whole
 * point. Offering to keep the holes when filling changed nothing puts a choice
 * between two identical trays; offering to cast flat when nothing was raised
 * offers to undo something that never happened. Both read as helpful and are
 * noise, and noise in a preflight is how a real warning gets clicked past.
 */
export function trayPrompt(tray: Tray, shapeMm: number, fillOutlines: boolean): ExportPrompt {
  const warnings = warningsIn(tray.findings);
  const arrangement =
    tray.cavities > 1 ? `${tray.cavities} cavities, ${tray.columns} x ${tray.rows}` : "One cavity";
  const size = `${tray.widthMm.toFixed(0)} x ${tray.depthMm.toFixed(0)}`;
  const summary =
    `${arrangement} on a ${size}mm tray. ` +
    (tray.reliefAppliedMm > 0
      ? `Pieces ${(shapeMm + tray.reliefAppliedMm).toFixed(1)}mm thick, lines and all. `
      : "") +
    `About ${tray.plasticCm3.toFixed(0)}cm³ of filament, and roughly ${tray.siliconeMl.toFixed(
      0
    )}ml of silicone to fill it.`;

  const choices: ExportChoice[] = [];
  // Only when the fill actually changed the shape.
  if (fillOutlines && tray.outlinesFilled) {
    choices.push({
      value: TRAY_KEEP_HOLES,
      label: "Keep the holes",
      detail: "Stand the marks up as they are, instead of filling what they enclose.",
    });
  }
  // Only when there was linework to raise and it was raised.
  if (tray.reliefAppliedMm > 0) {
    choices.push({
      value: TRAY_CAST_FLAT,
      label: "Cast it flat",
      detail: `Drop the raised lines and make a plain ${shapeMm.toFixed(1)}mm silhouette.`,
    });
  }
  choices.push({
    value: TRAY_EXPORT,
    label: warnings.length ? "Export anyway" : "Export",
    detail: `${size}mm STL for the printer.`,
  });

  return {
    title: warnings.length ? "Worth checking before you print" : "Ready to export",
    subtitle: preamble(warnings, summary),
    choices,
  };
}

/**
 * The preflight for a two-part ball mold.
 *
 * Always two ways out, and they are not interchangeable: one tray carries the
 * drawing and one does not, and each is printed on its own. Handing over a pair
 * at once would leave somebody holding two files with nothing to tell them
 * apart but the filename.
 */
export function moldPrompt(mold: SphereMold, subject: string): ExportPrompt {
  const warnings = warningsIn(mold.findings);
  const plastic = mold.designed.plasticCm3 + mold.plain.plasticCm3;
  const silicone = mold.designed.siliconeMl + mold.plain.siliconeMl;
  const summary =
    `${mold.cavities} ${subject}${mold.cavities === 1 ? "" : "s"} a pour, from two trays of ` +
    `${mold.designed.widthMm.toFixed(0)} x ${mold.designed.depthMm.toFixed(0)}mm. ` +
    `About ${plastic.toFixed(0)}cm³ of filament for the pair, and ${silicone.toFixed(
      0
    )}ml of silicone to fill them.`;

  return {
    title: warnings.length ? "Worth checking before you print" : "Two halves to print",
    subtitle: preamble(warnings, summary),
    choices: [
      {
        value: MOLD_DESIGNED,
        label: "Export the half with the drawing",
        detail: "The domes carry the picture. Print this one first.",
      },
      {
        value: MOLD_SMOOTH,
        label: "Export the smooth half",
        detail: "The back of the ball, with the pour holes and the key hollows.",
      },
    ],
  };
}

/**
 * Whether a prompt's rows can be told apart by what they return.
 *
 * The answer dispatches the action, so two rows sharing a value means picking
 * one quietly does the other's job — and it looks perfectly correct on screen,
 * which is the reason to assert it rather than read for it.
 */
export function everyChoiceIsDistinct(prompt: ExportPrompt): boolean {
  return new Set(prompt.choices.map((choice) => choice.value)).size === prompt.choices.length;
}
