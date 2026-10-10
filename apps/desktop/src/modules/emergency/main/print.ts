import type { CardBlock, CardLanguage, CardModel } from "@nexus/core";
import { formatCardDate, languageTag } from "../shared/cardDate.js";
import { CARD_TEXT, SERBIAN_EMERGENCY_NUMBERS } from "../shared/cardText.js";
import type { CardPrintFormat } from "../shared/ipc.js";

/**
 * The card as PAPER: one standalone HTML document per print, built from the same
 * `CardModel` the page draws on screen.
 *
 * **Why a document and not the page's own DOM.** `webContents.printToPDF` prints
 * a webContents, and the one the user is looking at holds the edit form, the
 * sidebar and the app's chrome - none of which belongs on a card somebody reads
 * under stress. So main renders the card into a document of its own and prints
 * that, which also makes the two A6/A4 layouts a stylesheet question rather than
 * a window question.
 *
 * **Why this file declares no colour at all, and why that is the design.** The
 * app has two themes, and neither of them belongs on a printed sheet: Noć would
 * print a black card and Dan a warm-grey one, and the reader is a doctor holding
 * white paper. A printed card is ink on the printer's own white, so the highest
 * contrast available is the absence of a colour declaration - and the tokens
 * gate's rule (no raw colour value outside `packages/tokens`) is satisfied the
 * only way that also happens to be right. Nothing here is styled with a hue;
 * sections are separated by size, weight and a hairline rule.
 *
 * **Why the content is escaped and the markup is not.** Every field below is
 * something a person typed. A name is not markup, and the one document here that
 * is, is this one - so `escapeHtml` is applied to every value and to nothing
 * else. The window that prints it runs with JavaScript off as well, which is the
 * second half of the same refusal.
 */

/** One printing's geometry, in the units Electron's own `printToPDF` takes: page size and margins in INCHES. */
export interface CardPrintLayout {
  /** Page size in INCHES (`PrintToPDFOptions.pageSize`). */
  readonly pageSize: { readonly width: number; readonly height: number };
  /** Margins in INCHES, Electron's other unit, and the four numbers are the same on both formats. */
  readonly margins: {
    readonly top: number;
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
  };
  /** The class that sets this format's base type size; every other size is in `em` off it. */
  readonly bodyClass: string;
}

/** 6 mm, which is what the two layouts use for an unprintable margin. */
const MARGIN_INCHES = 0.236;

const MARGINS = {
  top: MARGIN_INCHES,
  bottom: MARGIN_INCHES,
  left: MARGIN_INCHES,
  right: MARGIN_INCHES,
} as const;

/**
 * The two layouts the user picks between.
 *
 * - `a6` is an A6 sheet (105 × 148 mm) that the card fills: the fridge-door
 *   copy, read at arm's length by somebody who is not holding it.
 * - `card-a4` is the same card at credit-card width (85.6 mm) on A4: the wallet
 *   copy, printed on the sheet the user already has, and cut or folded down to
 *   the card's own width. Its type is smaller because the card is; nothing is
 *   dropped, and the card's height is its content's - a long card continues onto
 *   the next A4 page rather than being clipped.
 */
export const CARD_PRINT_LAYOUTS: Readonly<Record<CardPrintFormat, CardPrintLayout>> = {
  a6: {
    // 105 × 148 mm, written in the inches `printToPDF` measures pages in.
    pageSize: { width: 4.1339, height: 5.8268 },
    margins: MARGINS,
    bodyClass: "card--a6",
  },
  "card-a4": {
    // 210 × 297 mm.
    pageSize: { width: 8.2677, height: 11.6929 },
    margins: MARGINS,
    bodyClass: "card--card-a4",
  },
};

/** Everything the document needs beyond the model: what to call it, and where it is printed. */
export interface CardPrintDocumentInput {
  readonly model: CardModel;
  /** The card's name in both languages - the module's own declared pair. */
  readonly title: { readonly sr: string; readonly en: string };
  readonly format: CardPrintFormat;
}

/**
 * The whole printable document: one `<section>` per language the card prints in,
 * each starting a page, each carrying the card's blocks, the emergency numbers
 * and the line that says whose information this is.
 *
 * The `lang` attribute is per SECTION rather than per document, because a card
 * that prints in two languages is two languages in one file, and a document can
 * only claim one of them.
 */
export function buildCardPrintDocument(input: CardPrintDocumentInput): string {
  const layout = CARD_PRINT_LAYOUTS[input.format];
  const first = input.model.passes[0]?.language ?? "sr";
  const passes = input.model.passes
    .map((pass) => printPass(pass.language, pass.blocks, input.title))
    .join("\n");
  return `<!doctype html>
<html lang="${first}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(input.title[first])}</title>
<style>${PRINT_CSS}</style>
</head>
<body class="${layout.bodyClass}">
${passes}
</body>
</html>
`;
}

/** One language's sheet. */
function printPass(
  language: CardLanguage,
  blocks: readonly CardBlock[],
  title: { readonly sr: string; readonly en: string },
): string {
  const head = `<header class="pass__head">
    <h1 class="pass__title">${escapeHtml(title[language])}</h1>
    <span class="pass__lang">${languageTag(language)}</span>
  </header>`;
  const body = blocks.map((block) => printBlock(block, language)).join("\n");
  const numbers = `<section class="numbers">
    <h2 class="block__label">${escapeHtml(CARD_TEXT.emergencyNumbers[language])}</h2>
    <ul class="numbers__list">
${SERBIAN_EMERGENCY_NUMBERS.map(
  (entry) =>
    `      <li class="numbers__item"><span class="numbers__number">${escapeHtml(entry.number)}</span>` +
    `<span class="numbers__label">${escapeHtml(entry.label[language])}</span></li>`,
).join("\n")}
    </ul>
  </section>`;
  const foot = `<footer class="pass__foot">
    <p class="pass__disclaimer">${escapeHtml(CARD_TEXT.disclaimer[language])}</p>
  </footer>`;
  return `<section class="pass" lang="${language}">
${head}
<div class="blocks">
${body}
</div>
${numbers}
${foot}
</section>`;
}

/**
 * One block. The switch is over the model's own keys, so a block the model can
 * produce and this function does not know is a compile error rather than a
 * silently missing section.
 */
function printBlock(block: CardBlock, language: CardLanguage): string {
  switch (block.key) {
    case "identity": {
      // The name leads the card and is the one line with nothing beside it: a
      // reader looks for the person before anything else on the sheet. A card
      // with no name prints none: `null` prints nothing (`cardFields.ts`), and a
      // placeholder would be the card inventing a fact about its subject.
      const name =
        block.fullName === null
          ? ""
          : `<p class="identity__name">${escapeHtml(block.fullName)}</p>`;
      const birthday =
        block.dateOfBirth === null
          ? ""
          : field(CARD_TEXT.dateOfBirth[language], formatCardDate(block.dateOfBirth, language));
      return `<section class="block block--identity">${name}${birthday}</section>`;
    }
    case "bloodType":
      return `<section class="block block--blood">
  ${label(CARD_TEXT.bloodType[language])}
  <p class="blood__value">${escapeHtml(
    block.bloodType === "unknown" ? CARD_TEXT.bloodTypeUnknown[language] : block.bloodType,
  )}</p>
</section>`;
    case "allergies":
      return listBlock(
        language,
        CARD_TEXT.allergies,
        block.allergies.map((allergy) => ({
          primary: allergy.label,
          note: allergy.severity === null ? null : severityWord(allergy.severity, language),
        })),
        CARD_TEXT.allergiesNone,
      );
    case "conditions":
      return listBlock(
        language,
        CARD_TEXT.conditions,
        block.conditions.map((condition) => ({ primary: condition, note: null })),
        CARD_TEXT.conditionsNone,
      );
    case "medications":
      return listBlock(
        language,
        CARD_TEXT.medications,
        block.medications.map((medication) => ({
          primary: medication.name,
          note: medication.dose,
        })),
        CARD_TEXT.medicationsNone,
      );
    case "organDonor":
      return `<section class="block">
  ${label(CARD_TEXT.organDonor[language])}
  ${value(block.organDonor === "yes" ? CARD_TEXT.yes[language] : CARD_TEXT.no[language])}
</section>`;
    case "contacts":
      return listBlock(
        language,
        CARD_TEXT.contacts,
        block.contacts.map((contact) => ({
          // A dangling reference says so instead of printing an empty line: a
          // silently shortened list is the one outcome this module refuses
          // (`cardModel.ts`).
          primary: contact.missing
            ? CARD_TEXT.contactMissing[language]
            : (contact.name ?? ""),
          note: [contact.relation, contact.phone].filter((part) => part !== null).join(" · "),
        })),
        null,
      );
    case "doctor":
      return `<section class="block">
  ${label(CARD_TEXT.doctor[language])}
  ${
    block.name === null
      ? ""
      : value(block.name)
  }
  ${
    block.phone === null
      ? ""
      : `<p class="block__note">${escapeHtml(block.phone)}</p>`
  }
</section>`;
    case "insurance":
      return `<section class="block">
  ${label(CARD_TEXT.insurance[language])}
  ${value(block.number)}
</section>`;
    case "documents":
      return listBlock(
        language,
        CARD_TEXT.documents,
        block.documents.map((document) => ({
          primary: document.missing
            ? CARD_TEXT.documentMissing[language]
            : (document.label ?? ""),
          note:
            document.expiryDate === null ? null : formatCardDate(document.expiryDate, language),
        })),
        null,
      );
    case "notes":
      return `<section class="block">
  ${label(CARD_TEXT.notes[language])}
  <p class="block__prose">${escapeHtml(block.notes)}</p>
</section>`;
  }
}

/** The severity of an allergy in the pass's language. */
function severityWord(severity: "mild" | "severe" | "anaphylaxis", language: CardLanguage): string {
  if (severity === "mild") return CARD_TEXT.severityMild[language];
  if (severity === "severe") return CARD_TEXT.severitySevere[language];
  return CARD_TEXT.severityAnaphylaxis[language];
}

/** One labelled scalar: the date of birth, the doctor's number, the insurance number. */
function field(name: string, text: string): string {
  return `<p class="field"><span class="field__label">${escapeHtml(name)}</span>` +
    `<span class="field__value">${escapeHtml(text)}</span></p>`;
}

/** A block's heading. */
function label(text: string): string {
  return `<h2 class="block__label">${escapeHtml(text)}</h2>`;
}

/** A block's single value. */
function value(text: string): string {
  return `<p class="block__value">${escapeHtml(text)}</p>`;
}

/** One block that is a list of rows, with the sentence an ANSWERED-EMPTY list prints (`cardFields.ts`). */
function listBlock(
  language: CardLanguage,
  heading: { readonly sr: string; readonly en: string },
  rows: readonly { readonly primary: string; readonly note: string | null }[],
  empty: { readonly sr: string; readonly en: string } | null,
): string {
  const body =
    rows.length === 0
      ? empty === null
        ? ""
        : `<p class="block__empty">${escapeHtml(empty[language])}</p>`
      : `<ul class="block__list">
${rows
  .map(
    (row) =>
      `    <li class="row"><span class="row__primary">${escapeHtml(row.primary)}</span>` +
      (row.note === null || row.note === ""
        ? ""
        : `<span class="row__note">${escapeHtml(row.note)}</span>`) +
      `</li>`,
  )
  .join("\n")}
  </ul>`;
  return `<section class="block">
  ${label(heading[language])}
  ${body}
</section>`;
}

/**
 * The document's whole stylesheet.
 *
 * **No `@page` rule, deliberately.** `printToPDF` is handed the page size and the
 * margins in Electron's own units (`CARD_PRINT_LAYOUTS`), and a second `@page`
 * here would be a second opinion about the same sheet - the copy that loses is
 * whichever one Chromium consults first, which is no way to decide a page size.
 *
 * **Every size is `em` off the format's base font size**, so the two layouts are
 * one set of rules at two scales rather than two stylesheets, and a section's
 * proportions cannot drift between the fridge copy and the wallet copy. Sizes
 * are in millimetres because the sheet is physical: `4mm` of type is 4mm on
 * paper, whatever the renderer's zoom happens to be.
 */
const PRINT_CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
  line-height: 1.35;
  font-variant-numeric: tabular-nums;
}
.card--a6 { font-size: 4mm; }
/* Credit-card width at a size the card can hold; the height is the content's. */
.card--card-a4 { font-size: 2.6mm; }
.card--card-a4 .pass { width: 85.6mm; }
.pass { page-break-inside: auto; }
.pass + .pass { break-before: page; page-break-before: always; }
.pass__head { display: flex; align-items: baseline; justify-content: space-between; gap: 4mm;
  border-bottom: 0.4mm solid; padding-bottom: 1.2mm; margin-bottom: 3mm; }
.pass__title { font-size: 1.5em; font-weight: 700; margin: 0; letter-spacing: -0.01em; }
.pass__lang { font-size: 0.7em; letter-spacing: 0.14em; }
.block { margin: 0 0 3mm; break-inside: avoid; page-break-inside: avoid; }
.block__label { font-size: 0.72em; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.1em; margin: 0 0 0.8mm; }
.identity__name { font-size: 2.1em; font-weight: 700; margin: 0; line-height: 1.15; }
.blood__value { font-size: 2.6em; font-weight: 700; margin: 0; line-height: 1.1; }
.block__value { font-size: 1.3em; font-weight: 600; margin: 0; }
.block__note { font-size: 1em; margin: 0.4mm 0 0; }
.block__prose { font-size: 1em; margin: 0; white-space: pre-wrap; }
.block__empty { font-size: 1em; margin: 0; }
.block__list { list-style: none; margin: 0; padding: 0; }
.row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 2mm;
  padding: 0.4mm 0; border-bottom: 0.2mm solid; break-inside: avoid; }
.row:last-child { border-bottom: 0; }
.row__primary { font-size: 1.15em; font-weight: 600; }
.row__note { font-size: 0.95em; }
.field { margin: 0.6mm 0 0; }
.field__label { font-size: 0.95em; }
.field__value { font-size: 1.15em; font-weight: 600; margin-left: 1.5mm; }
.numbers { border-top: 0.4mm solid; padding-top: 2mm; margin-top: 4mm; break-inside: avoid; }
.numbers__list { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 1mm 5mm; }
.numbers__item { display: flex; align-items: baseline; gap: 1.5mm; }
.numbers__number { font-size: 1.5em; font-weight: 700; }
.numbers__label { font-size: 0.85em; }
.pass__foot { margin-top: 4mm; border-top: 0.2mm solid; padding-top: 1.5mm; }
.pass__disclaimer { font-size: 0.85em; margin: 0; }
`;

/**
 * A string as HTML text.
 *
 * Five characters and no library: the document this escapes into is built here,
 * and every value in it is something the user typed. `'` is escaped as well as
 * `"` because nothing here knows which quote an attribute will use next.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The name a save dialog opens on: `hitna-karta.pdf`, or the holder's own name
 * folded into the file name when the card carries one.
 *
 * The name is folded to plain ASCII (`Pera Perić` → `pera-peric`) because a file
 * name is a file name on somebody else's filesystem, and a Serbian name with
 * diacritics is exactly where a wrong encoding shows up. It is a SUGGESTION the
 * user can overwrite in the dialog - never a path this module writes to.
 */
export function cardFileName(fullName: string | null): string {
  const folded = (fullName ?? "")
    .toLowerCase()
    // `đ` is a base letter of its own in Unicode and does NOT decompose under
    // NFD, so it needs its own line: without it a name like „Đurić" loses the
    // letter to a separator and the file name reads „uri".
    .replace(/đ/g, "d")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return folded.length === 0 ? "hitna-karta.pdf" : `hitna-karta-${folded}.pdf`;
}
