import { describe, expect, it } from "vitest";
import { pdfWriteTarget } from "./pdfTarget.js";

/**
 * The one thing between a save dialog's answer and `writeFile`.
 *
 * The dialog is Electron's and the window is Electron's, so what can be tested
 * without an Electron runtime is the VALIDATION - and that is the half worth
 * testing, because it is the only code that decides whether a string becomes a
 * file. `saveCardPdf` itself is four statements around these two.
 */
describe("pdfWriteTarget", () => {
  it("accepts a path a save dialog produces, on either platform, whatever the case of the extension", () => {
    expect(pdfWriteTarget("C:\\Users\\Luka\\Documents\\hitna-karta.pdf")).toBe(
      "C:\\Users\\Luka\\Documents\\hitna-karta.pdf",
    );
    expect(pdfWriteTarget("/home/luka/hitna-karta.pdf")).toBe("/home/luka/hitna-karta.pdf");
    expect(pdfWriteTarget("/tmp/HITNA.PDF")).toBe("/tmp/HITNA.PDF");
    // A dot in a directory name is a directory name, not an extension.
    expect(pdfWriteTarget("/home/luka.v2/karta.pdf")).toBe("/home/luka.v2/karta.pdf");
  });

  it("refuses everything a dialog could not have answered", () => {
    // A cancelled dialog answers `undefined`, and a caller that ignored that is
    // the one this net catches.
    expect(() => pdfWriteTarget(undefined)).toThrow(/answered no file name/);
    expect(() => pdfWriteTarget(null)).toThrow(/answered no file name/);
    expect(() => pdfWriteTarget(42)).toThrow(/answered no file name/);
    expect(() => pdfWriteTarget("")).toThrow(/impossible length/);
    expect(() => pdfWriteTarget(`${"a".repeat(4100)}.pdf`)).toThrow(/impossible length/);
    // Outer whitespace would forge a path rather than name one, and a NUL cannot
    // be in a path at all.
    expect(() => pdfWriteTarget(" /tmp/karta.pdf")).toThrow(/not a path/);
    expect(() => pdfWriteTarget("/tmp/karta.pdf ")).toThrow(/not a path/);
    expect(() => pdfWriteTarget("/tmp/kar\0ta.pdf")).toThrow(/not a path/);
    // The extension is the promise the file has to keep: the card exists to be
    // opened by somebody who was handed it.
    expect(() => pdfWriteTarget("/tmp/karta")).toThrow(/saved as a "\.pdf" file/);
    expect(() => pdfWriteTarget("/tmp/karta.pdf.txt")).toThrow(/saved as a "\.pdf" file/);
  });
});
