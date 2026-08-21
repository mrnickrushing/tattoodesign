import test from "node:test";
import assert from "node:assert/strict";
import {
  aftercareFacts,
  aftercareHtml,
  aftercarePayload,
  aftercareSteps,
  type AftercareSubject,
} from "./aftercare";
import { PLACEMENTS } from "./quote";
import { parseAppointmentDate } from "./appointments";

const SESSION = parseAppointmentDate("2026-09-04")!;

const INK: AftercareSubject = {
  brand: "ink",
  title: "Serpent and rose",
  client: "Sam",
  studioName: "Ink Lab",
  placement: "forearm",
  sizeIn: { width: 4, height: 6 },
  coverage: 0.3,
  sessionAt: SESSION,
};

const SUGAR: AftercareSubject = {
  brand: "sugar",
  title: "Winter box",
  client: "Priya",
  studioName: "Sugar Haus",
  sizeIn: { width: 3, height: 3 },
  coverage: 0.9,
  sessionAt: SESSION,
};

/** The page box the card is laid out in, whatever is on it. */
function pageSize(html: string): string | null {
  return html.match(/@page\{size:([^;}]+)/)?.[1] ?? null;
}

test("the card is the same size for every placement", () => {
  const baseline = pageSize(aftercareHtml(INK));
  assert.ok(baseline, "the card has a page size at all");
  for (const placement of PLACEMENTS) {
    assert.equal(pageSize(aftercareHtml({ ...INK, placement: placement.id })), baseline, placement.id);
  }
  // And for placements the table has never heard of.
  for (const placement of ["earlobe", "", "left-hand side of the neck, sort of"]) {
    assert.equal(pageSize(aftercareHtml({ ...INK, placement })), baseline, `free text: "${placement}"`);
  }
  assert.equal(pageSize(aftercareHtml(SUGAR)), baseline, "and for the bakery card");
});

test("the card is one page whatever is on it", () => {
  // Every step is marked unbreakable, so a long card overflows onto a second
  // page rather than splitting a step across the fold.
  assert.ok(aftercareHtml(INK).includes("page-break-inside:avoid"));
});

test("no template token survives into the output", () => {
  const subjects: AftercareSubject[] = [
    INK,
    SUGAR,
    { brand: "ink", title: "Untitled", studioName: "Ink Lab" },
    { ...INK, coverage: 0, sizeIn: undefined, sessionAt: undefined, client: undefined },
    { ...SUGAR, coverage: 1 },
  ];
  for (const placement of [...PLACEMENTS.map((p) => p.id), "earlobe", ""]) {
    subjects.push({ ...INK, placement });
  }
  for (const subject of subjects) {
    const html = aftercareHtml(subject);
    assert.ok(!/\$\{/.test(html), `unresolved interpolation: ${subject.title}`);
    assert.ok(!/\{\{|\}\}/.test(html), `unresolved placeholder: ${subject.title}`);
    assert.ok(!/undefined|NaN|\[object Object\]/.test(html), `leaked value: ${subject.title}`);
  }
});

test("the card carries nothing it would have to fetch", () => {
  for (const subject of [INK, SUGAR]) {
    const { html } = aftercarePayload(subject);
    assert.ok(!/https?:\/\//.test(html), "no remote reference");
    assert.ok(!/<link\b|<script\b/i.test(html), "no external stylesheet or script");
    assert.ok(!/@import|url\(/.test(html), "no fetched font or image");
  }
});

test("the share payload names a file anything will accept", () => {
  assert.deepEqual(
    { filename: aftercarePayload(INK).filename, mimeType: aftercarePayload(INK).mimeType },
    { filename: "serpent-and-rose-aftercare.html", mimeType: "text/html" }
  );
  assert.equal(
    aftercarePayload({ ...INK, title: "  Ámélie's ✨ piece!!  " }).filename,
    "m-lie-s-piece-aftercare.html"
  );
  assert.equal(aftercarePayload({ ...INK, title: "***" }).filename, "aftercare.html", "a title of nothing usable");
  assert.ok(aftercarePayload({ ...INK, title: "x".repeat(200) }).filename.length < 60, "and one far too long");
});

test("client text is escaped rather than trusted", () => {
  const html = aftercareHtml({ ...INK, client: '<script>alert("x")</script>', title: "A & B" });
  assert.ok(!html.includes("<script>alert"), "a name is not markup");
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("A &amp; B"));
});

test("heavy work is told to expect a longer, messier start", () => {
  const light = aftercareSteps({ ...INK, coverage: 0.1 })[0];
  const heavy = aftercareSteps({ ...INK, coverage: 0.8 })[0];
  assert.ok(light.title.includes("2–4 hours"));
  assert.ok(heavy.title.includes("4–6 hours"), "solid black weeps longer");
  assert.ok(heavy.detail.includes("Solid black"));
});

test("a flooded box keeps twice as long as a piped one", () => {
  const piped = aftercareSteps({ ...SUGAR, coverage: 0.1 });
  const flooded = aftercareSteps({ ...SUGAR, coverage: 0.9 });
  const shelfOf = (steps: typeof piped) => steps.find((step) => step.title.startsWith("Best before"))!;
  assert.ok(shelfOf(flooded).day > shelfOf(piped).day);
  assert.ok(shelfOf(piped).title.includes("7 days"));
  assert.ok(shelfOf(flooded).title.includes("14 days"));
});

test("a known placement adds its own warning and an unknown one adds nothing", () => {
  const ribs = aftercareSteps({ ...INK, placement: "ribs" });
  assert.ok(ribs.some((step) => step.detail.includes("waistband")), "ribs get the clothing warning");

  const generic = aftercareSteps({ ...INK, placement: "earlobe" });
  const none = aftercareSteps({ ...INK, placement: undefined });
  assert.equal(generic.length, none.length, "a body part we don't know gets no invented advice");
});

test("free text still finds the placement it names", () => {
  const written = aftercareSteps({ ...INK, placement: "Left hand, outer edge" });
  assert.ok(written.some((step) => step.detail.includes("Shoes and socks")) === false, "not the foot");
  assert.ok(written.some((step) => step.detail.includes("washed constantly")), "the hand advice, from prose");
});

test("dates are real when the session is known and relative when it isn't", () => {
  const dated = aftercareSteps(INK);
  assert.equal(dated[0].when, "Sep 4, 2026");
  assert.ok(
    dated.some((step) => step.when === "Sep 18, 2026"),
    "day 14 lands a fortnight later"
  );

  const undated = aftercareSteps({ ...INK, sessionAt: undefined });
  assert.equal(undated[0].when, "Today");
  assert.ok(undated.some((step) => step.when === "Tomorrow"));
  assert.ok(undated.some((step) => step.when === "Day 4"));
});

test("the facts panel says what makes this card this piece", () => {
  assert.deepEqual(aftercareFacts(INK), [
    ["For", "Sam"],
    ["Placement", "Forearm"],
    ["Size", "4 × 6 in"],
    ["Ink coverage", "30%"],
    ["Session", "Sep 4, 2026"],
  ]);
  assert.deepEqual(aftercareFacts(SUGAR), [
    ["For", "Priya"],
    ["Size", "3 × 3 in"],
    ["Iced", "90%"],
    ["Decorated", "Sep 4, 2026"],
  ]);
  assert.deepEqual(aftercareFacts({ brand: "ink", title: "x", studioName: "Ink Lab" }), [], "nothing known, nothing claimed");
});

test("out-of-range coverage is clamped rather than printed", () => {
  assert.deepEqual(aftercareFacts({ ...INK, client: undefined, placement: undefined, sizeIn: undefined, sessionAt: undefined, coverage: 4 }), [
    ["Ink coverage", "100%"],
  ]);
  assert.deepEqual(aftercareFacts({ ...INK, client: undefined, placement: undefined, sizeIn: undefined, sessionAt: undefined, coverage: Number.NaN }), []);
});

test("each brand gets its own card, not the other's", () => {
  const ink = aftercareHtml(INK);
  const sugar = aftercareHtml(SUGAR);
  assert.ok(ink.includes("Healing it"));
  assert.ok(sugar.includes("Keeping them"));
  assert.ok(!sugar.includes("moisturiser"), "nobody moisturises a cookie");
  assert.ok(!ink.includes("airtight"), "and nobody boxes a forearm");
});
