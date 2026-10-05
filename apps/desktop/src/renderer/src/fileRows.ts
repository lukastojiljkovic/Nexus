import type { DocAttachmentEntry } from "../../shared/ipc.js";
import { numberFormat } from "./intl.js";

/**
 * „Datoteke"'s pure presentation arithmetic (DOC), kept out of the page so the
 * two things it must not get wrong — the summary's numbers and the mark a
 * non-image card draws — are testable without a DOM.
 */

/**
 * Human-readable file size: whole bytes under 1 KB, otherwise KB/MB with at
 * most one decimal — no fabricated precision beyond what `Intl.NumberFormat`
 * already rounds to. The recipe the three attachment panels each keep locally,
 * shared here because this page formats a SUM as well as a row and both have to
 * read the same way. The number follows the ACTIVE locale (`intl.ts`), so a file
 * of 1,5 MB reads „1,5 MB" in Serbian and „1.5 MB" in English.
 */
export function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  const kb = sizeBytes / 1024;
  const oneDecimal = numberFormat({ maximumFractionDigits: 1 });
  if (kb < 1024) return `${oneDecimal.format(kb)} KB`;
  return `${oneDecimal.format(kb / 1024)} MB`;
}

/** How much the rows on screen weigh, together. Derived from exactly what is drawn — never from a count the page did not measure. */
export function totalFileBytes(entries: readonly DocAttachmentEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.sizeBytes, 0);
}

/** Longest run of characters after the final dot still readable as a type mark. Past this it is not an extension, it is the rest of the name. */
const MAX_EXTENSION_LENGTH = 5;

/**
 * The typographic mark a grid card shows when it has no thumbnail: the file's
 * own extension, uppercased. Deliberately NOT an icon set — the house draws no
 * pictograms, and a bespoke glyph per format would be a second vocabulary
 * nobody asked for — and deliberately read from the NAME rather than the mime,
 * because the name is what the user recognizes („.docx", not
 * „application/zip", which is honestly what that file sniffs as).
 *
 * `null` when there is nothing to show: no dot, an empty or over-long tail, a
 * leading-dot name (a dotfile has no extension, it has a hidden name), or a
 * tail that is not plainly alphanumeric — the card then draws its plain tile,
 * which says "a file" without claiming a type.
 */
export function fileExtensionMark(fileName: string): string | null {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return null;
  const tail = fileName.slice(dot + 1);
  if (tail.length > MAX_EXTENSION_LENGTH || !/^[a-z0-9]+$/i.test(tail)) return null;
  return tail.toUpperCase();
}
