import type { ModuleText } from "@nexus/core";
import { declaredText } from "../../../../renderer/src/moduleKit/moduleSurface.js";
import { countUnit, fill } from "../../../../renderer/src/strings.js";

/**
 * The PDF tool set's words, as `{ sr, en }` pairs in one table.
 *
 * **Why pairs here rather than a `copy.sr.ts` / `copy.en.ts` pair.** The kit's
 * convention for a module's page copy is the two-table form, and it is the right
 * one when the copy belongs to the page that carries it. These two tool sets are
 * subtrees of somebody else's page (`renderer/Page.tsx` is another run's file),
 * so their words travel with them: `PdfTools.tsx` is copied into the page and
 * brings its own table, and the panel is deleted by deleting its folder.
 *
 * **Why this is not the shell's `strings.ts` either.** A module-scope read of
 * the shell table is what `check:string-capture` exists to catch, and a leaf of
 * the shell table is part of the startup chunk — a tool nobody opened would be
 * paid for on every launch.
 *
 * The shell's own numeral agreement and interpolation are used rather than
 * re-invented: `countUnit` is CLDR's Serbian rule (1 strana, 2 strane, 5
 * strana) and `fill` is the table's `{name}` form, which is the only
 * interpolation a bilingual table can safely carry — a function leaf would be a
 * `structuredClone` failure for the shell's live table.
 */
export const copy = {
  files: {
    title: { sr: "Fajlovi", en: "Files" },
    add: { sr: "Dodaj PDF-ove", en: "Add PDFs" },
    busyAdd: { sr: "Čitam fajlove…", en: "Reading the files…" },
    addHint: {
      sr: "Najviše 20 fajlova, do 50 MB po fajlu i 200 MB u jednom izboru. Ništa se ne šalje sa računara.",
      en: "At most 20 files, 50 MB per file and 200 MB in one pick. Nothing leaves this computer.",
    },
    empty: { sr: "Nijedan PDF nije dodat.", en: "No PDF has been added yet." },
    sizeLabel: { sr: "Veličina", en: "Size" },
    pagesLabel: { sr: "Strane", en: "Pages" },
    moveUp: { sr: "Pomeri gore", en: "Move up" },
    moveDown: { sr: "Pomeri dole", en: "Move down" },
    remove: { sr: "Ukloni", en: "Remove" },
    rebuild: { sr: "Napravi dokument od ovih fajlova", en: "Build a document from these files" },
    rebuildHint: {
      sr: "Redosled u ovoj listi je redosled strana u dokumentu.",
      en: "The order of this list is the order of the pages in the document.",
    },
    skipped: {
      sr: "Izostavljeno (preveliko ili nepročitano): {count}",
      en: "Left out (too large or unreadable): {count}",
    },
    encrypted: {
      sr: "Zaštićen lozinkom. Alatka ga ne otvara i ne pokušava da obije zaštitu.",
      en: "Password-protected. The tool does not open it and does not attempt to break the protection.",
    },
    unreadable: {
      sr: "Ne može da se pročita kao PDF.",
      en: "This cannot be read as a PDF.",
    },
  },
  pages: {
    title: { sr: "Strane", en: "Pages" },
    empty: {
      sr: "Dodaj PDF-ove pa napravi dokument da bi video strane.",
      en: "Add PDFs and build a document to see its pages.",
    },
    count: { sr: "Ukupno {pages}", en: "{pages} in total" },
    total: { sr: "Ukupna veličina {size}", en: "{size} in total" },
    rotateAll: { sr: "Rotiraj sve", en: "Rotate all" },
    busyEdit: { sr: "Preuređujem strane…", en: "Rearranging the pages…" },
    rotate: { sr: "Rotiraj stranu u desno", en: "Rotate this page right" },
    remove: { sr: "Obriši stranu", en: "Delete this page" },
    moveLeft: { sr: "Pomeri stranu ulevo", en: "Move this page left" },
    moveRight: { sr: "Pomeri stranu udesno", en: "Move this page right" },
    range: { sr: "Opseg strana (npr. 1-3,5,8-)", en: "Page range (for example 1-3,5,8-)" },
    rangeHint: {
      sr: "Zapeta razdvaja opsege, crta spaja početak i kraj. Redosled koji upišeš je redosled strana u izlazu.",
      en: "A comma separates ranges, a dash joins a start and an end. The order you type is the order in the output.",
    },
    keep: { sr: "Zadrži samo ove strane", en: "Keep only these pages" },
    removeRange: { sr: "Obriši ove strane", en: "Delete these pages" },
    rangeEmpty: { sr: "Upiši opseg strana.", en: "Type a page range." },
    rangeSyntax: {
      sr: "Opseg nije ispravan. Primer: 1-3,5,8-",
      en: "That range is not readable. For example: 1-3,5,8-",
    },
    rangeReversed: { sr: "Kraj opsega je pre početka.", en: "A range ends before it starts." },
    rangeOutOfRange: {
      sr: "Opseg pominje stranu koje nema u dokumentu.",
      en: "The range names a page this document does not have.",
    },
    rangeTooLong: { sr: "Opseg je predugačak.", en: "That range is too long." },
    rangeTooMany: {
      sr: "Opseg obuhvata previše strana (najviše 500).",
      en: "That range covers too many pages (at most 500).",
    },
  },
  output: {
    title: { sr: "Izvoz", en: "Export" },
    numbers: { sr: "Brojevi strana", en: "Page numbers" },
    numbersNone: { sr: "Bez brojeva", en: "No numbers" },
    numbersPlain: { sr: "Samo broj", en: "The number alone" },
    numbersOfTotal: { sr: "Broj i ukupno (7 / 12)", en: "Number and total (7 / 12)" },
    position: { sr: "Položaj broja", en: "Number position" },
    bottomCentre: { sr: "Dole, po sredini", en: "Bottom, centred" },
    bottomRight: { sr: "Dole, desno", en: "Bottom, right" },
    save: { sr: "Sačuvaj dokument", en: "Save the document" },
    splitTitle: { sr: "Podeli u fajlove", en: "Split into files" },
    splitEach: { sr: "Svaka strana u svoj fajl", en: "Every page in its own file" },
    splitRanges: { sr: "Svaki opseg u svoj fajl", en: "Every range in its own file" },
    splitRun: { sr: "Podeli", en: "Split" },
    busy: { sr: "Radim… {done}/{total}", en: "Working… {done}/{total}" },
    busySave: { sr: "Pripremam fajl…", en: "Preparing the file…" },
    savedOne: { sr: "Sačuvano: {name}", en: "Saved: {name}" },
    savedBatch: {
      sr: "Sačuvano u fasciklu {folder}: {count}",
      en: "Saved into {folder}: {count}",
    },
    canceled: { sr: "Izbor je otkazan.", en: "The dialog was cancelled." },
    failed: { sr: "Posao nije uspeo: {message}", en: "The job failed: {message}" },
  },
} satisfies Record<string, Record<string, ModuleText>>;

/** One declared pair, in the language being read. */
export function text(value: ModuleText): string {
  return declaredText(value);
}

/** One declared pair with its `{name}` slots filled, through the shell's own interpolation. */
export function sentence(value: ModuleText, values: Readonly<Record<string, string | number>>): string {
  return fill(text(value), values);
}

/** `12 pages` / `12 strana`, with the shell's own numeral agreement. */
export function pageCount(count: number): string {
  return `${count} ${countOf(count, { sr: "strana", en: "page" }, { sr: "strane", en: "pages" }, { sr: "strana", en: "pages" })}`;
}

/** `3 files` / `3 fajla`, the same rule applied to the batch a split writes. */
export function fileCount(count: number): string {
  return `${count} ${countOf(count, { sr: "fajl", en: "file" }, { sr: "fajla", en: "files" }, { sr: "fajlova", en: "files" })}`;
}

/** One counted noun's three forms, read through the shell's CLDR rule. */
function countOf(count: number, one: ModuleText, few: ModuleText, many: ModuleText): string {
  return countUnit(count, text(one), text(few), text(many));
}
