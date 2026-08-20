// Printing from a browser. See printing.ts for the native shape.
//
// A browser prints a document, not a string, so the sheet is given a document
// of its own — an offscreen iframe — and that is what gets printed. An iframe
// rather than a new window because a popup blocker will silently eat the
// window and the print dialogue simply never appears, with nothing to explain
// why.

export type PrintSize = { width: number; height: number };

export async function printHtml(html: string, size?: PrintSize): Promise<void> {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  // Off-screen rather than display:none: a hidden iframe does not always lay
  // out, and an unlaid-out document prints blank.
  frame.style.position = "fixed";
  frame.style.right = "100%";
  frame.style.bottom = "100%";
  frame.style.width = size ? `${size.width}px` : "816px";
  frame.style.height = size ? `${size.height}px` : "1056px";
  frame.style.border = "0";
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  const view = frame.contentWindow;
  if (!doc || !view) {
    frame.remove();
    throw new Error("This browser wouldn't open a print view.");
  }

  doc.open();
  doc.write(html);
  doc.close();

  await new Promise<void>((resolve) => {
    // Images inside the sheet have to finish loading, or the page prints with
    // gaps where the designs should be.
    if (doc.readyState === "complete") resolve();
    else view.addEventListener("load", () => resolve(), { once: true });
    setTimeout(resolve, 4000);
  });

  view.focus();
  view.print();
  // Kept alive briefly: some browsers return from print() before the dialogue
  // has finished reading the document.
  setTimeout(() => frame.remove(), 60_000);
}

/**
 * There is no "save as PDF" a page can perform on the viewer's behalf; that
 * choice belongs to the browser's own print dialogue.
 */
export async function htmlToPdf(): Promise<string> {
  throw new Error("Choose \"Save as PDF\" in the print dialogue to make a PDF here.");
}
