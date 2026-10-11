import type { TranslatorEntryView } from "../shared/ipc.js";

/**
 * The two pieces of pure formatting the page does, in one file so both are
 * testable without a DOM.
 *
 * **Why the labels are arguments.** `entryText` is what the „Kopiraj reč"
 * button puts on the clipboard, and the words in it are the interface's — so
 * they arrive from `copy` at the call site, and this function stays free of any
 * locale. A function that read the copy table itself would be a module-scope
 * read of a live table (`check:string-capture`'s subject) and it would format in
 * whatever language was active when its chunk loaded.
 */

/**
 * The address as it is SHOWN, which is not always the address as it is stored.
 *
 * The entry's URL comes from the pack, and the pack's URLs are Wiktionary page
 * addresses. Showing the whole `https://en.wiktionary.org/wiki/…` in a row costs
 * a line for a prefix the reader already knows, so the shown form drops the
 * scheme and the `www`. The COPY button writes the full URL, because an address
 * that arrives on a clipboard without its scheme does not open anything.
 *
 * A URL that does not parse is shown as it came: a pack with a strange address
 * should not stop a page from drawing that row, and inventing a host for it
 * would be worse than showing what the file says.
 */
export function sourceLine(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

/**
 * One entry as plain text: the headword, its part of speech, its translations,
 * its meanings and where it came from.
 *
 * Deliberately the same information the row shows, in the same order — a copy
 * button that produced a different shape from the row it sits in would be a
 * second answer to „what is this entry", and the one a reader cannot see is the
 * one that would drift.
 */
export function entryText(
  entry: TranslatorEntryView,
  labels: { readonly translations: string; readonly meanings: string },
): string {
  const lines = [entry.pos === "" ? entry.word : `${entry.word} · ${entry.pos}`];
  if (entry.latin !== null) lines.push(entry.latin);
  if (entry.glosses.length > 0) lines.push(`${labels.meanings}: ${entry.glosses.join("; ")}`);
  if (entry.translations.length > 0) {
    lines.push(`${labels.translations}: ${entry.translations.join(", ")}`);
  }
  lines.push(entry.url);
  return lines.join("\n");
}
