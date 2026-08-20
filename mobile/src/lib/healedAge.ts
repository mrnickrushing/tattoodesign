// How healing is described, kept apart from where the photos are stored.
//
// The storage half imports the platform image store, which pulls in native
// modules; these are the rules about time, and they are the part worth
// testing. Same split spacing.ts and tone.ts use for the same reason.

export type HealedRecord = {
  id: string;
  designId: string;
  /** Basename in the image store. */
  file: string;
  /** When the photo was taken. */
  at: number;
  /** When the piece was done, so age is a fact rather than an assumption. */
  inkedAt: number;
  note?: string;
};

/** Records for one design, oldest first — a timeline reads forwards. */
export function recordsFor(records: HealedRecord[], designId: string): HealedRecord[] {
  return records
    .filter((record) => record.designId === designId)
    .sort((a, b) => a.at - b.at);
}

const DAY = 86_400_000;

/**
 * How old the piece was when the photo was taken.
 *
 * The unit shifts with the age because that is how healing is talked about:
 * days in the first fortnight when it changes daily, then weeks, then months,
 * then years once it barely moves.
 */
export function healedAge(record: HealedRecord): string {
  const elapsed = Math.max(0, record.at - record.inkedAt);
  const days = Math.floor(elapsed / DAY);
  if (days < 1) return "the same day";
  if (days === 1) return "1 day after";
  if (days < 21) return `${days} days after`;
  const weeks = Math.round(days / 7);
  if (days < 90) return `${weeks} weeks after`;
  const months = Math.round(days / 30);
  if (months < 24) return `${months} months after`;
  const years = Math.round(months / 12);
  return `${years} years after`;
}

/**
 * The stage of healing a photo falls in.
 *
 * Matches the ages the simulation offers, so a real photo and a simulated one
 * can eventually be put side by side and disagreed with.
 */
export function healingStage(record: HealedRecord): "fresh" | "settled" | "aged" {
  const days = (record.at - record.inkedAt) / DAY;
  if (days < 30) return "fresh";
  if (days < 730) return "settled";
  return "aged";
}
