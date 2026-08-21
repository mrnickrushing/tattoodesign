import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Two rules about the screens, checked by reading them.
 *
 * Both have been broken here before, and both were caught by somebody sweeping
 * the source by hand — one of them four separate times in a single afternoon.
 * A rule that needs a manual sweep to hold is a rule that will lapse, so these
 * do the sweep.
 *
 * Reading source is a blunt way to test a component and it is the honest one
 * for these two: neither is about what a screen renders, both are about the
 * shape of what it was handed. Rendering would not catch either.
 */

function screens(): { path: string; source: string }[] {
  const found: { path: string; source: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith(".tsx")) found.push({ path, source: readFileSync(path, "utf8") });
    }
  };
  walk(join(process.cwd(), "src"));
  return found;
}

/** Where the tag that starts at `from` stops, and whether it closed itself. */
function openingTag(source: string, from: number): { end: number; selfClosing: boolean } {
  let braces = 0;
  for (let i = from; i < source.length; i++) {
    if (source[i] === "{") braces++;
    else if (source[i] === "}") braces--;
    else if (source[i] === ">" && braces === 0) return { end: i, selfClosing: source[i - 1] === "/" };
  }
  return { end: source.length, selfClosing: true };
}

/** A whole call, from its opening bracket to the one that closes it. */
function call(source: string, from: number): string {
  const open = source.indexOf("(", from);
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if ("([{".includes(source[i])) depth++;
    else if (")]}".includes(source[i])) {
      depth--;
      if (depth === 0) return source.slice(from, i + 1);
    }
  }
  return source.slice(from);
}

/** Everything between an element's angle brackets, self-closing or not. */
function element(source: string, from: number, tag: string): string {
  const { end, selfClosing } = openingTag(source, from);
  if (selfClosing) return source.slice(from, end + 1);
  let depth = 1;
  let i = end + 1;
  while (i < source.length && depth > 0) {
    if (source.startsWith(`<${tag}`, i)) depth++;
    else if (source.startsWith(`</${tag}>`, i)) depth--;
    i++;
  }
  return source.slice(from, i);
}

test("the source this reads is actually there", () => {
  // A scan that found nothing would pass both rules below without checking
  // anything at all, which is the one way a test like this fails silently.
  const files = screens();
  assert.ok(files.length > 20, `only found ${files.length} screens to read — wrong working directory?`);
  assert.ok(
    files.some((file) => file.path.endsWith("DesignEditor.tsx")),
    "the biggest screen in the app is not among them"
  );
});

test("no alert offers more than Android will show", () => {
  // `Alert.alert` takes at most three buttons on Android — it maps them onto
  // the platform's negative, neutral and positive slots and drops the rest
  // without a word. A fourth button is not a squeezed button; it is a button
  // that does not exist, on one platform only, with nothing on screen to say
  // so. ChoicePrompt is the way out when a decision genuinely has four ways.
  const over: string[] = [];
  for (const { path, source } of screens()) {
    for (const match of source.matchAll(/Alert\.alert\(/g)) {
      const whole = call(source, match.index!);
      const buttons = /\[([\s\S]*)\]\s*,?\s*\)\s*$/.exec(whole);
      if (!buttons) continue;
      let depth = 0;
      let count = 0;
      for (const character of buttons[1]) {
        if (character === "{" && depth === 0) count++;
        if ("([{".includes(character)) depth++;
        else if (")]}".includes(character)) depth--;
      }
      const spreads = (buttons[1].match(/\.\.\./g) ?? []).length;
      if (count + spreads > 3) {
        over.push(`${path}:${source.slice(0, match.index).split("\n").length} has ${count + spreads}`);
      }
    }
  }
  assert.deepEqual(over, [], `alerts Android would silently truncate:\n${over.join("\n")}`);
});

test("nothing is tappable without something to announce", () => {
  // React Native reads a control's own text, so most need no label of their
  // own and giving them one would only add noise. What it cannot read is a
  // button made of an icon: to a screen reader those are unlabelled buttons,
  // and this app had three of them sitting in a row together.
  const silent: string[] = [];
  for (const { path, source } of screens()) {
    for (const match of source.matchAll(/<(Pressable|TouchableOpacity)\b/g)) {
      const body = element(source, match.index!, match[1]);
      if (body.includes("accessibilityLabel")) continue;
      if (/<Text[\s>]/.test(body)) continue;
      silent.push(`${path}:${source.slice(0, match.index).split("\n").length}`);
    }
  }
  assert.deepEqual(silent, [], `tappable with nothing to announce:\n${silent.join("\n")}`);
});
