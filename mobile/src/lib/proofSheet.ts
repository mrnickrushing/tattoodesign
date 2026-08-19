// The client-facing artifact behind "approved".
//
// A status chip means nothing a client can hold. This builds the proof PDF's
// HTML: the design at true printed size, the agreed dimensions, placement,
// appointment, and a sign-off line — the sheet a client initials before the
// needle or the icing bag comes out.
//
// Pure string building so layout and escaping are testable; the screen owns
// expo-print and the share sheet.

import type { ClientProject } from "./clientProjects";
import { formatAppointmentDate } from "./appointments";

export type ProofDesign = {
  title: string;
  /** data: URL of the artwork PNG. */
  dataUrl: string;
  /** Pixel dimensions, to preserve aspect at true size. */
  width: number;
  height: number;
};

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const STATUS_LABEL: Record<ClientProject["status"], string> = {
  draft: "Draft",
  sent: "In review",
  changes: "Changes requested",
  approved: "Approved",
};

/** Default print width when no size was agreed — matches placement default. */
export const FALLBACK_WIDTH_IN = 3;

/**
 * Renders the proof as printable HTML for expo-print.
 *
 * Every design is drawn at its true printed size: the agreed `sizeIn` when
 * the project has one, otherwise FALLBACK_WIDTH_IN wide with the aspect
 * preserved — and the caption says which of the two it is, because a proof
 * that silently guesses sizes isn't a proof.
 */
export function proofHtml(
  project: ClientProject,
  designs: ProofDesign[],
  brandName: string
): string {
  const rows: string[] = [];
  const facts: [string, string][] = [];
  if (project.client) facts.push(["Client", project.client]);
  if (project.placement) facts.push(["Placement", project.placement]);
  if (project.sizeIn) facts.push(["Size", `${project.sizeIn.width} × ${project.sizeIn.height} in`]);
  if (project.appointmentAt) facts.push(["Appointment", formatAppointmentDate(project.appointmentAt)]);
  facts.push(["Status", STATUS_LABEL[project.status]]);

  for (const design of designs) {
    const aspect = design.width > 0 ? design.height / design.width : 1;
    const agreed = project.sizeIn;
    const widthIn = agreed ? agreed.width : FALLBACK_WIDTH_IN;
    const heightIn = agreed ? agreed.height : widthIn * aspect;
    const sizing = agreed ? "agreed size" : "proof scale";
    rows.push(
      `<figure>` +
        `<img src="${escapeHtml(design.dataUrl)}" style="width:${widthIn}in;height:${heightIn}in"/>` +
        `<figcaption>${escapeHtml(design.title)} · ${widthIn} × ${roundIn(heightIn)} in (${sizing})</figcaption>` +
        `</figure>`
    );
  }

  const body =
    rows.join("") ||
    `<p class="empty">No artwork is attached to this project yet.</p>`;

  return (
    `<html><head><meta charset="utf-8"/><title>${escapeHtml(project.name)} — proof</title><style>` +
    `@page{size:8.5in 11in;margin:0.6in}` +
    `body{font-family:-apple-system,'Helvetica Neue',sans-serif;color:#111;margin:0}` +
    `header{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #111;padding-bottom:8px}` +
    `h1{font-size:20px;margin:0}` +
    `.brand{font-size:11px;letter-spacing:2px;text-transform:uppercase}` +
    `dl{display:grid;grid-template-columns:auto 1fr;gap:2px 14px;font-size:12px;margin:14px 0}` +
    `dt{font-weight:600;text-transform:uppercase;font-size:9px;letter-spacing:1px;align-self:baseline}` +
    `dd{margin:0}` +
    `figure{margin:18px 0;page-break-inside:avoid}` +
    `img{display:block;border:1px solid #ddd;background:#fff}` +
    `figcaption{font-size:10px;color:#555;margin-top:4px}` +
    `.notes{font-size:12px;white-space:pre-wrap;border-left:3px solid #ddd;padding-left:10px;margin:14px 0}` +
    `.empty{font-size:12px;color:#555}` +
    `.signoff{margin-top:36px;font-size:11px;page-break-inside:avoid}` +
    `.line{border-bottom:1px solid #111;height:28px;margin-top:18px;width:60%}` +
    `.printnote{font-size:9px;color:#888;margin-top:20px}` +
    `</style></head><body>` +
    `<header><h1>${escapeHtml(project.name)}</h1><span class="brand">${escapeHtml(brandName)}</span></header>` +
    `<dl>${facts.map(([term, detail]) => `<dt>${escapeHtml(term)}</dt><dd>${escapeHtml(detail)}</dd>`).join("")}</dl>` +
    (project.notes ? `<div class="notes">${escapeHtml(project.notes)}</div>` : "") +
    body +
    `<div class="signoff">Approved as shown — artwork, size, and placement.` +
    `<div class="line"></div>Signature &amp; date</div>` +
    `<p class="printnote">Print at 100% / Actual Size for true dimensions.</p>` +
    `</body></html>`
  );
}

function roundIn(value: number): number {
  return Math.round(value * 100) / 100;
}
