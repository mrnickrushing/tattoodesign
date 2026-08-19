import test from "node:test";
import assert from "node:assert/strict";
import { FALLBACK_WIDTH_IN, escapeHtml, proofHtml, type ProofDesign } from "./proofSheet";
import type { ClientProject } from "./clientProjects";

function project(patch: Partial<ClientProject> = {}): ClientProject {
  return {
    id: "p1",
    name: "Botanical half sleeve",
    client: "Allison",
    placement: "Outer forearm",
    notes: "",
    designIds: ["d1"],
    status: "sent",
    createdAt: 1,
    updatedAt: 2,
    ...patch,
  };
}

function design(patch: Partial<ProofDesign> = {}): ProofDesign {
  return {
    title: "Fern & dagger",
    dataUrl: "data:image/png;base64,AAAA",
    width: 1000,
    height: 500,
    ...patch,
  };
}

test("the proof carries the facts a client signs against", () => {
  const html = proofHtml(
    project({
      sizeIn: { width: 4, height: 6 },
      appointmentAt: new Date(2026, 8, 4, 12).getTime(),
    }),
    [design()],
    "Ink Lab"
  );
  assert.match(html, /Botanical half sleeve/);
  assert.match(html, /Allison/);
  assert.match(html, /Outer forearm/);
  assert.match(html, /4 × 6 in/);
  assert.match(html, /Sep 4, 2026/);
  assert.match(html, /In review/);
  assert.match(html, /Ink Lab/);
  assert.match(html, /Signature/);
  assert.match(html, /Print at 100%/);
});

test("agreed size drives the printed dimensions exactly", () => {
  const html = proofHtml(project({ sizeIn: { width: 4, height: 6 } }), [design()], "Ink Lab");
  assert.match(html, /width:4in;height:6in/);
  assert.match(html, /agreed size/);
});

test("without an agreed size the design prints at proof scale with aspect kept", () => {
  const html = proofHtml(project(), [design({ width: 1000, height: 500 })], "Ink Lab");
  assert.match(html, new RegExp(`width:${FALLBACK_WIDTH_IN}in;height:${FALLBACK_WIDTH_IN * 0.5}in`));
  assert.match(html, /proof scale/, "the caption must admit the size is not agreed");
});

test("every user-supplied string is escaped", () => {
  const html = proofHtml(
    project({
      name: '<script>bad()</script>',
      client: 'A & B "quotes"',
      placement: "<img onerror=x>",
      notes: "1 < 2 & 3 > 2",
    }),
    [design({ title: "<b>bold</b>", dataUrl: 'data:image/png;base64,AA"onerror="x' })],
    "<Ink>"
  );
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<img onerror/);
  assert.doesNotMatch(html, /<b>bold/);
  assert.doesNotMatch(html, /"onerror="x/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /A &amp; B/);
});

test("a project with no artwork still renders a signable sheet", () => {
  const html = proofHtml(project(), [], "Ink Lab");
  assert.match(html, /No artwork is attached/);
  assert.match(html, /Signature/);
});

test("optional facts only appear when present", () => {
  const bare = proofHtml(project({ client: "", placement: "", notes: "" }), [design()], "Ink Lab");
  assert.doesNotMatch(bare, /<dt>Client<\/dt>/);
  assert.doesNotMatch(bare, /<dt>Placement<\/dt>/);
  assert.doesNotMatch(bare, /<dt>Appointment<\/dt>/);
  assert.doesNotMatch(bare, /class="notes"/);
  assert.match(bare, /<dt>Status<\/dt>/, "status always shows");
});

test("notes preserve line structure through pre-wrap", () => {
  const html = proofHtml(project({ notes: "line one\nline two" }), [design()], "Ink Lab");
  assert.match(html, /line one\nline two/);
});

test("multiple designs each get a figure that avoids page breaks", () => {
  const html = proofHtml(project(), [design(), design({ title: "Second" })], "Ink Lab");
  assert.equal(html.split("<figure>").length - 1, 2);
  assert.match(html, /page-break-inside:avoid/);
});

test("escapeHtml handles the characters that matter", () => {
  assert.equal(escapeHtml('<a href="x">&</a>'), "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  assert.equal(escapeHtml(""), "");
});
