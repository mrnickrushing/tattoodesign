// Remix verbs: the adjustments people actually ask for after seeing a result.
//
// A remix starts from an existing design as the reference image; these verbs
// bolt focused direction onto the prompt without making anyone re-describe
// the piece. Pure string work, so the composition rules are testable.

export type RemixVerb = {
  id: string;
  label: string;
  /** Appended to the prompt as its own sentence. */
  direction: string;
};

export const REMIX_VERBS: RemixVerb[] = [
  {
    id: "simpler",
    label: "Simpler",
    direction: "Simplify the design: fewer elements, cleaner negative space, keep only what defines it.",
  },
  {
    id: "bolder",
    label: "Bolder lines",
    direction: "Redraw with bolder, heavier line weight throughout.",
  },
  {
    id: "finer",
    label: "Finer detail",
    direction: "Increase fine detail and delicate line variation while keeping the composition.",
  },
  {
    id: "pose",
    label: "Another pose",
    direction: "Keep the subject and style, but pose it differently — a clearly distinct stance or angle.",
  },
  {
    id: "symmetry",
    label: "More symmetrical",
    direction: "Rework the composition to be strongly symmetrical around a vertical axis.",
  },
  {
    id: "flow",
    label: "More flow",
    direction: "Give the composition more movement and flow, with elements leading into each other.",
  },
];

const DIRECTIONS = new Set(REMIX_VERBS.map((verb) => verb.direction));

/**
 * Appends a verb's direction to the prompt. Idempotent per verb — tapping a
 * chip twice removes it again, so chips behave as toggles.
 */
export function applyRemixVerb(prompt: string, verbId: string): string {
  const verb = REMIX_VERBS.find((item) => item.id === verbId);
  if (!verb) return prompt;
  if (hasRemixVerb(prompt, verbId)) {
    return prompt
      .split("\n")
      .filter((line) => line.trim() !== verb.direction)
      .join("\n")
      .replace(/\n+$/, "");
  }
  const base = prompt.replace(/\n+$/, "");
  return base ? `${base}\n${verb.direction}` : verb.direction;
}

export function hasRemixVerb(prompt: string, verbId: string): boolean {
  const verb = REMIX_VERBS.find((item) => item.id === verbId);
  if (!verb) return false;
  return prompt.split("\n").some((line) => line.trim() === verb.direction);
}

/** Strips every verb line — used when the reference is removed. */
export function stripRemixVerbs(prompt: string): string {
  return prompt
    .split("\n")
    .filter((line) => !DIRECTIONS.has(line.trim()))
    .join("\n")
    .replace(/\n+$/, "");
}
