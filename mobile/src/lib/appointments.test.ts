import test from "node:test";
import assert from "node:assert/strict";
import {
  describeAppointment,
  formatAppointmentDate,
  parseAppointmentDate,
  parseSizeIn,
  sortByAppointment,
} from "./appointments";

// A fixed "now": June 15, 2026, 10:00 local.
const NOW = new Date(2026, 5, 15, 10, 0, 0, 0).getTime();

function dayOf(timestamp: number | null): string {
  assert.ok(timestamp !== null, "expected a parsed date");
  const date = new Date(timestamp!);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

test("ISO dates parse to local noon", () => {
  const parsed = parseAppointmentDate("2026-09-04", NOW);
  assert.equal(dayOf(parsed), "2026-9-4");
  assert.equal(new Date(parsed!).getHours(), 12, "noon keeps the date stable across DST");
});

test("US slash dates parse, including two-digit years", () => {
  assert.equal(dayOf(parseAppointmentDate("9/4/2026", NOW)), "2026-9-4");
  assert.equal(dayOf(parseAppointmentDate("12/31/26", NOW)), "2026-12-31");
});

test("month-day shorthand lands on the next occurrence", () => {
  assert.equal(dayOf(parseAppointmentDate("9/4", NOW)), "2026-9-4", "future month stays this year");
  assert.equal(dayOf(parseAppointmentDate("2/14", NOW)), "2027-2-14", "past month rolls to next year");
  assert.equal(dayOf(parseAppointmentDate("6/15", NOW)), "2026-6-15", "today counts as upcoming");
});

test("month names parse, abbreviated or full, with or without a year", () => {
  assert.equal(dayOf(parseAppointmentDate("sep 4", NOW)), "2026-9-4");
  assert.equal(dayOf(parseAppointmentDate("September 4, 2027", NOW)), "2027-9-4");
  assert.equal(dayOf(parseAppointmentDate("jan 2", NOW)), "2027-1-2", "january has passed");
});

test("garbage is refused rather than guessed", () => {
  for (const junk of ["", "  ", "soon", "2026-13-01", "2026-02-31", "0/0", "40/40/2026", "xyz 4"]) {
    assert.equal(parseAppointmentDate(junk, NOW), null, `"${junk}" should not parse`);
  }
});

test("rollover typos like February 31 are rejected, not rolled to March", () => {
  assert.equal(parseAppointmentDate("2026-02-31", NOW), null);
  assert.equal(parseAppointmentDate("2/30/2026", NOW), null);
});

test("formatting reads back naturally", () => {
  const parsed = parseAppointmentDate("2026-09-04", NOW)!;
  assert.equal(formatAppointmentDate(parsed), "Sep 4, 2026");
});

test("relative descriptions match the calendar, not 24-hour windows", () => {
  const today = parseAppointmentDate("6/15", NOW)!;
  const tomorrow = parseAppointmentDate("6/16", NOW)!;
  assert.equal(describeAppointment(today, NOW), "Today");
  assert.equal(describeAppointment(tomorrow, NOW), "Tomorrow");
  assert.equal(describeAppointment(parseAppointmentDate("6/25", NOW)!, NOW), "In 10 days");
  assert.equal(describeAppointment(parseAppointmentDate("2026-06-14", NOW)!, NOW), "Yesterday");
  assert.equal(describeAppointment(parseAppointmentDate("2026-06-05", NOW)!, NOW), "10 days ago");
});

test("projects sort upcoming-first, undated in the middle, past last", () => {
  const projects = [
    { id: "past", appointmentAt: parseAppointmentDate("2026-06-01", NOW)!, updatedAt: 5 },
    { id: "later", appointmentAt: parseAppointmentDate("2026-07-20", NOW)!, updatedAt: 1 },
    { id: "undated-old", updatedAt: 2 },
    { id: "soon", appointmentAt: parseAppointmentDate("2026-06-16", NOW)!, updatedAt: 3 },
    { id: "undated-new", updatedAt: 9 },
    { id: "long-past", appointmentAt: parseAppointmentDate("2026-05-01", NOW)!, updatedAt: 8 },
  ];
  assert.deepEqual(
    sortByAppointment(projects, NOW).map((project) => project.id),
    ["soon", "later", "undated-new", "undated-old", "past", "long-past"]
  );
});

test("sizes parse from the ways people actually type them", () => {
  assert.deepEqual(parseSizeIn("3 x 5"), { width: 3, height: 5 });
  assert.deepEqual(parseSizeIn("3x5"), { width: 3, height: 5 });
  assert.deepEqual(parseSizeIn("3.5 × 5.25"), { width: 3.5, height: 5.25 });
  assert.equal(parseSizeIn("large"), null);
  assert.equal(parseSizeIn("0 x 5"), null);
  assert.equal(parseSizeIn("300 x 5"), null, "a 300-inch tattoo is a typo");
  assert.equal(parseSizeIn(""), null);
});
