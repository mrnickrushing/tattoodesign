// Getting a sheet onto paper.
//
// Native hands the HTML to the OS print controller. A browser has its own, and
// it prints the current document rather than an arbitrary string — so the web
// version has to give the HTML a document of its own first. Same call, same
// result on paper; see printing.web.ts.

import * as Print from "expo-print";

export type PrintSize = { width: number; height: number };

export async function printHtml(html: string, size?: PrintSize): Promise<void> {
  await Print.printAsync(size ? { html, ...size } : { html });
}

/** A PDF of the same HTML, as a file URI. */
export async function htmlToPdf(html: string, size?: PrintSize): Promise<string> {
  const { uri } = await Print.printToFileAsync(size ? { html, ...size } : { html });
  return uri;
}
