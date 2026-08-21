// The card the client walks out with.
//
// Whatever an artist says at the end of a session, the client is running on
// adrenaline and remembers about a third of it. The healing — or, on the
// bakery side, whether the box is still good on Saturday — is then decided by
// what they half-remember. A card personalised to the actual piece beats a
// generic leaflet, because "wash it twice a day" means something different for
// a hand than for a shoulder, and a fully flooded cookie keeps differently from
// a piped one.
//
// Pure string building, like proofSheet.ts: the layout and the escaping are
// testable, and the screen owns printing and the share sheet. Nothing here
// reaches the network — the card has to survive being opened in a car park.

import type { BrandId } from "./brands";
import { formatAppointmentDate } from "./appointments";
import { findPlacement } from "./quote";
import { escapeHtml } from "./proofSheet";

export type AftercareSubject = {
  brand: BrandId;
  /** What the piece is called on the card. */
  title: string;
  client?: string;
  /** Studio name for the footer. */
  studioName: string;
  /** Where it went, by PlacementId or free text. Ink Lab only. */
  placement?: string;
  /** True finished size, in inches. */
  sizeIn?: { width: number; height: number };
  /**
   * How much of the piece is solid — packed black, or flooded icing — as a
   * fraction. Heavy work weeps longer and keeps differently, and it is the one
   * thing a generic leaflet cannot know.
   */
  coverage?: number;
  /** Local-noon timestamp of the session, same convention as appointments.ts. */
  sessionAt?: number;
};

export type AftercareStep = {
  /** Days after the session this step begins. */
  day: number;
  /** "Today", "Tomorrow", "Day 3", or a real date when the session is known. */
  when: string;
  title: string;
  detail: string;
};

/** Above this fraction of solid work, a piece behaves like heavy blackwork. */
const HEAVY_COVERAGE = 0.45;

function isHeavy(coverage: number | undefined): boolean {
  return (coverage ?? 0) >= HEAVY_COVERAGE;
}

/** Day 0 is the session; anything else is a date when we know the session. */
function whenLabel(day: number, sessionAt?: number): string {
  if (sessionAt) return formatAppointmentDate(sessionAt + day * 86_400_000);
  if (day === 0) return "Today";
  if (day === 1) return "Tomorrow";
  return `Day ${day + 1}`;
}

/**
 * Placement-specific warnings, keyed off the same difficulty table the quote
 * uses. Free text that matches no known placement simply contributes nothing,
 * which is better than guessing advice for a body part we did not recognise.
 */
const PLACEMENT_ADVICE: Partial<Record<string, string>> = {
  hand: "Hands are washed constantly and heal fastest when that does not turn into soaking. Pat dry every time, and keep it out of washing-up water.",
  foot: "Shoes and socks rub. Go loose or barefoot where you can for the first week, and keep it off gym floors and pool decks.",
  ribs: "Ribs sit under a waistband and a bra strap all day. Loose clothing for a week, and sleep on the other side.",
  sternum: "Anything tight across the chest will lift the healing skin. Loose tops, and no bra strap directly over it for a few days.",
  neck: "Collars and hair are the problem here. Tie hair back and keep collars off it while it is peeling.",
  elbow: "The skin stretches every time you bend it, so it will flake sooner than the rest. Moisturise more often, not more heavily.",
  knee: "Same as the elbow: it moves constantly. Expect it to peel early and do not pick at the creases.",
  chest: "It moves with every breath and every seatbelt. Keep a soft layer between it and the belt for the first few days.",
  back: "You cannot see it, so get someone to check it, and do not lie flat on it while it is still weeping.",
  shoulder: "Bag straps land exactly here. Carry on the other side for a week.",
};

/**
 * The healing schedule for a tattoo, personalised to the piece.
 *
 * The days are the ones every artist gives; what changes with the piece is how
 * long the first wrap stays on (heavy work weeps for longer) and what the
 * placement warning says.
 */
function inkSteps(subject: AftercareSubject): AftercareStep[] {
  const heavy = isHeavy(subject.coverage);
  const steps: AftercareStep[] = [
    {
      day: 0,
      when: whenLabel(0, subject.sessionAt),
      title: heavy ? "Leave the wrap on for 4–6 hours" : "Leave the wrap on for 2–4 hours",
      detail: heavy
        ? "Solid black weeps plasma and ink for longer than linework does. Do not be alarmed by what comes off in the first wash — that is the excess, not your tattoo."
        : "Then take it off, wash it once, and let it air dry. Do not re-wrap it unless you were told to.",
    },
    {
      day: 0,
      when: whenLabel(0, subject.sessionAt),
      title: "First wash",
      detail:
        "Clean hands, lukewarm water, unscented soap. Wash with your fingers rather than a cloth, rinse, and pat dry with kitchen roll — not a bath towel.",
    },
    {
      day: 1,
      when: whenLabel(1, subject.sessionAt),
      title: "Wash twice a day, moisturise thinly",
      detail:
        "A thin layer of unscented moisturiser after each wash. Thin is the whole instruction: a thick layer suffocates it and pulls ink out as it heals.",
    },
    {
      day: 3,
      when: whenLabel(3, subject.sessionAt),
      title: "It will start to flake",
      detail:
        "Flaking and itching are the piece healing, not going wrong. Do not scratch it and do not pick the flakes — that is how a line ends up patchy.",
    },
    {
      day: 14,
      when: whenLabel(14, subject.sessionAt),
      title: "Surface healed",
      detail:
        "The top layer is closed. Baths, swimming and the gym are fine again. It will still look slightly cloudy — that is normal and it settles.",
    },
    {
      day: 30,
      when: whenLabel(30, subject.sessionAt),
      title: "Fully settled — send a photo",
      detail:
        "The colour has come back up and this is what it will look like from here. Sunscreen on it for the rest of its life is the single thing that keeps it sharp.",
    },
  ];

  const advice = subject.placement ? PLACEMENT_ADVICE[normalisePlacement(subject.placement)] : undefined;
  if (advice) {
    steps.push({
      day: 0,
      when: "Throughout",
      title: `Because of where it is`,
      detail: advice,
    });
  }
  return steps;
}

/** Matches free-text placement back to a known id where it can. */
function normalisePlacement(placement: string): string {
  const cleaned = placement.trim().toLowerCase();
  const direct = findPlacement(cleaned);
  if (direct) return direct.id;
  const matched = Object.keys(PLACEMENT_ADVICE).find(
    (id) => cleaned === id.toLowerCase() || cleaned.includes(id.toLowerCase())
  );
  return matched ?? cleaned;
}

/**
 * Storage and serving for decorated cookies.
 *
 * Shelf life turns on whether the piece is flooded: royal icing seals the
 * surface, and a fully flooded cookie keeps around twice as long as a piped
 * one that is still open to the air.
 */
function sugarSteps(subject: AftercareSubject): AftercareStep[] {
  const flooded = isHeavy(subject.coverage);
  const shelfDays = flooded ? 14 : 7;
  return [
    {
      day: 0,
      when: whenLabel(0, subject.sessionAt),
      title: "Let them finish drying",
      detail: flooded
        ? "Flooded icing is dry to the touch in an hour and hard all the way through in 8–12. Leave them uncovered and flat until then, or they will dent in the box."
        : "Piped detail sets within a couple of hours. Leave them uncovered and flat until it is hard to the touch.",
    },
    {
      day: 0,
      when: whenLabel(0, subject.sessionAt),
      title: "Box them airtight, at room temperature",
      detail:
        "Airtight container, one layer, baking paper between layers if you must stack. Never the fridge — they sweat coming out, and the colours bleed.",
    },
    {
      day: 1,
      when: whenLabel(1, subject.sessionAt),
      title: "Keep them out of the light",
      detail:
        "Direct sun fades icing colour within a day, and reds and purples go first. A cupboard is better than a windowsill.",
    },
    {
      day: shelfDays,
      when: whenLabel(shelfDays, subject.sessionAt),
      title: `Best before — about ${shelfDays} days`,
      detail: flooded
        ? "Fully flooded icing seals the surface, so these hold their texture for a fortnight in a sealed box."
        : "Open piping leaves the surface exposed, so eat these inside a week while the cookie is still soft.",
    },
    {
      day: shelfDays,
      when: "To freeze",
      title: "Freezing, if you need longer",
      detail:
        "Freeze fully dried, in a single layer, sealed. Thaw sealed and at room temperature — opening the box cold is what puts water on the icing.",
    },
  ];
}

export function aftercareSteps(subject: AftercareSubject): AftercareStep[] {
  return subject.brand === "sugar" ? sugarSteps(subject) : inkSteps(subject);
}

/** The facts panel: what makes this card about this piece and no other. */
export function aftercareFacts(subject: AftercareSubject): [string, string][] {
  const facts: [string, string][] = [];
  if (subject.client) facts.push(["For", subject.client]);
  if (subject.brand !== "sugar" && subject.placement) {
    const known = findPlacement(normalisePlacement(subject.placement));
    facts.push(["Placement", known?.label ?? subject.placement]);
  }
  if (subject.sizeIn) {
    facts.push(["Size", `${roundIn(subject.sizeIn.width)} × ${roundIn(subject.sizeIn.height)} in`]);
  }
  if (subject.coverage !== undefined && Number.isFinite(subject.coverage)) {
    const percent = Math.round(Math.min(1, Math.max(0, subject.coverage)) * 100);
    facts.push([subject.brand === "sugar" ? "Iced" : "Ink coverage", `${percent}%`]);
  }
  if (subject.sessionAt) {
    facts.push([subject.brand === "sugar" ? "Decorated" : "Session", formatAppointmentDate(subject.sessionAt)]);
  }
  return facts;
}

/**
 * The card as printable, shareable HTML.
 *
 * One A6 card whatever the piece is — the page size does not move with the
 * placement or the number of steps, because a client filing these wants them
 * all the same shape. Self-contained: no stylesheet, no font, no image fetched
 * from anywhere, so it opens on a phone with no signal.
 */
export function aftercareHtml(subject: AftercareSubject): string {
  const steps = aftercareSteps(subject);
  const facts = aftercareFacts(subject);
  const heading = subject.brand === "sugar" ? "Keeping them" : "Healing it";

  return (
    `<html><head><meta charset="utf-8"/><title>${escapeHtml(subject.title)} — aftercare</title><style>` +
    `@page{size:4.1in 5.8in;margin:0.35in}` +
    `body{font-family:-apple-system,'Helvetica Neue',sans-serif;color:#111;margin:0;font-size:9px;line-height:1.45}` +
    `header{border-bottom:2px solid #111;padding-bottom:6px}` +
    `h1{font-size:14px;margin:0 0 2px}` +
    `.kicker{font-size:8px;letter-spacing:2px;text-transform:uppercase;color:#555}` +
    `dl{display:grid;grid-template-columns:auto 1fr;gap:1px 10px;margin:8px 0;font-size:8px}` +
    `dt{font-weight:600;text-transform:uppercase;font-size:7px;letter-spacing:1px;color:#555}` +
    `dd{margin:0}` +
    `h2{font-size:9px;text-transform:uppercase;letter-spacing:1px;margin:10px 0 4px;border-top:1px solid #ddd;padding-top:6px}` +
    `ol{margin:0;padding:0;list-style:none}` +
    `li{margin:0 0 6px;page-break-inside:avoid}` +
    `.when{font-size:7px;letter-spacing:1px;text-transform:uppercase;color:#555}` +
    `.step{font-weight:600}` +
    `footer{margin-top:10px;border-top:1px solid #ddd;padding-top:5px;font-size:7px;color:#555}` +
    `</style></head><body>` +
    `<header><h1>${escapeHtml(subject.title)}</h1>` +
    `<div class="kicker">${escapeHtml(subject.studioName)} — aftercare</div></header>` +
    (facts.length
      ? `<dl>${facts
          .map(([term, detail]) => `<dt>${escapeHtml(term)}</dt><dd>${escapeHtml(detail)}</dd>`)
          .join("")}</dl>`
      : "") +
    `<h2>${escapeHtml(heading)}</h2>` +
    `<ol>${steps
      .map(
        (step) =>
          `<li><div class="when">${escapeHtml(step.when)}</div>` +
          `<div class="step">${escapeHtml(step.title)}</div>` +
          `<div>${escapeHtml(step.detail)}</div></li>`
      )
      .join("")}</ol>` +
    `<footer>Anything that looks wrong — hot to the touch, spreading redness, or still weeping after three days — message ${escapeHtml(
      subject.studioName
    )} rather than the internet.</footer>` +
    `</body></html>`
  );
}

export type SharePayload = {
  /** Safe on every filesystem the share sheet might land on. */
  filename: string;
  mimeType: string;
  html: string;
};

/**
 * What the screen hands to expo-sharing.
 *
 * Everything the client needs is inside `html`, which is why the card works
 * offline: there is nothing to fetch when they open it.
 */
export function aftercarePayload(subject: AftercareSubject): SharePayload {
  const slug = subject.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return {
    // A title of nothing usable — emoji, punctuation — leaves the bare name
    // rather than "aftercare-aftercare".
    filename: slug ? `${slug}-aftercare.html` : "aftercare.html",
    mimeType: "text/html",
    html: aftercareHtml(subject),
  };
}

function roundIn(value: number): number {
  return Math.round(value * 100) / 100;
}
