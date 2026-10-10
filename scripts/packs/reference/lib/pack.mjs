// The pack as files: articles, the table of contents, and the two metadata
// documents a build produces.
//
// WHAT A PACK IS, ONE MORE TIME. A signed folder (ADR-091) whose manifest is
// written by `scripts/pack-sign.mjs` from a metadata file this module produces.
// The folder's own content for a pack of kind `content` is `content.json`, the
// articles it lists, and nothing else; `pack.json` and `pack.json.sig` are added
// by the signing tool afterwards, and the app refuses a folder that carries a
// file the manifest does not list — which is why nothing else is written here.

import { slug } from "./convert.mjs";

/** The layout version this builder writes. One version, and this build reads it. */
export const CONTENT_LAYOUT = 1;

/**
 * The provenance block a Serbian official text carries.
 *
 * THREE LINES, ALL THREE OF THEM ABOUT TIME. A law in a pack is a copy of a
 * moving thing: the reader has to be able to see which gazette numbers this copy
 * is made of and where to check for later ones, and the pack has to say when it
 * last looked. The date is the build date unless the source entry names one,
 * because the honest claim a pack can make is "on this day, the text was this".
 */
export function provenanceBlock(document, buildDate) {
  const gazette = document.gazette;
  if (gazette === undefined) return null;
  const stateAsOf = gazette.stateAsOf ?? formatSerbianDate(buildDate);
  return [
    "> Proveri izmene i dopune u Službenom glasniku.",
    `> Stanje na dan ${stateAsOf}.`,
    `> Obuhvaćeni brojevi: ${gazette.numbers.join("; ")}.`,
  ].join("\n");
}

/**
 * `2026-10-10` as Serbian writes a date: `10. 10. 2026`, without leading
 * zeroes on the day and the month, which is how a Serbian citation line is
 * printed ("4. 4. 2011").
 */
export function formatSerbianDate(isoDate) {
  const [year, month, day] = isoDate.split("-");
  return `${String(Number(day))}. ${String(Number(month))}. ${year}`;
}

/**
 * The caveat every EU article carries.
 *
 * The sentence is this pack's own, not a quotation: the rule it states is the
 * one EUR-Lex's legal notice makes, and that notice could not be read from the
 * build environment (see `sources.mjs`), so nothing here pretends to quote it.
 */
export const AUTHENTICITY_NOTE =
  "> Only the Official Journal of the European Union is authentic. This is a convenience copy, for reference.";

/** The line that ends every article: the work, its section, and its URL. */
export function sourceLine(pack, document, sectionTitle) {
  const label = pack.language === "sr" ? "Izvor" : "Source";
  const url = document.canonical ?? document.url;
  const section = sectionTitle === document.title ? document.section : sectionTitle;
  return `*${label}: ${document.title} — ${section}. ${url}*`;
}

/**
 * One article file's text, and the body the fidelity check compares.
 *
 * The generated lines around the body — the provenance block, the authenticity
 * caveat, the Source line — are the pack talking about the document. They are
 * not the document, so they are returned separately and the check runs on the
 * body alone; anything else would have the check compare the source against
 * sentences this repository wrote.
 */
export function renderArticle(pack, document, section, buildDate) {
  const body = section.markdown;
  const above = [];
  const provenance = provenanceBlock(document, buildDate);
  if (provenance !== null) above.push(provenance);
  if (document.authenticity === true) above.push(AUTHENTICITY_NOTE);
  const source = sourceLine(pack, document, section.title);
  return {
    body,
    source,
    text: [...above, body, source].join("\n\n") + "\n",
  };
}

/**
 * The article ids, in reading order.
 *
 * An id opens with the document's position (`07-iccpr`), which is the
 * convention the Reader's own table of contents already reads as an order key
 * (`readerDisplayName` takes up to four leading digits), so a reader that learns
 * the pack from its paths alone sorts it the way this file's table of contents
 * reads.
 */
export function articleId(documentIndex, document, sectionTitle, sectionCount) {
  const prefix = String(documentIndex + 1).padStart(2, "0");
  const base = slug(document.id);
  if (sectionCount === 1) return `${prefix}-${base}`;
  return `${prefix}-${base}-${slug(sectionTitle)}`;
}

/**
 * One id per article, even where two sections are called the same thing.
 *
 * The Official Journal repeats "Chapter 1" under several TITLES, and two
 * sections whose titles slug to one id would be one file with two articles in
 * it — a pack whose table of contents lists two entries that are the same
 * article, with the second overwriting the first. A numeric suffix is the
 * honest fix: the ids stay kebab-case, the table of contents stays ordered, and
 * nothing about the source's own numbering is invented.
 */
export function uniqueArticleId(base, used) {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${String(suffix)}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

/** `content.json`: the layout, the language, and the tree of what is inside. */
export function contentJson(pack, toc) {
  return { layout: CONTENT_LAYOUT, language: pack.language, toc };
}

/**
 * The metadata `scripts/pack-sign.mjs` takes: the manifest without `files`.
 *
 * The key order is the tool's own (`META_KEYS`), and there are exactly those
 * keys: the tool refuses an unknown one, which is the check that keeps a pack
 * whose meaning this build only half-knows from ever being signed.
 */
export function packMetadata(pack) {
  return {
    format: 1,
    id: pack.id,
    version: pack.version,
    kind: "content",
    title: pack.title,
    description: pack.description,
    licence: pack.licence,
    source: pack.source,
    minAppVersion: pack.minAppVersion,
  };
}

/**
 * A pack's `sources.json`: every document, with the bytes it was built from.
 *
 * The date, the digest and the size are the ones the fetch produced, and the
 * licence and its evidence are the ones the source table states — so the file
 * answers, for any article in the pack, "which bytes, from where, on what day,
 * and on what basis may this be shipped".
 */
export function sourcesJson(pack, fetches) {
  return {
    pack: pack.id,
    language: pack.language,
    built: new Date().toISOString().slice(0, 10),
    documents: pack.documents.map((document) => {
      const fetch = fetches.get(document.id);
      return {
        id: document.id,
        work: document.title,
        section: document.section,
        url: fetch.url,
        canonical: document.canonical ?? fetch.url,
        fetched: fetch.fetched,
        // The size, not the bytes: this file is the record of what was taken
        // and how it can be checked, and a copy of every source in the
        // repository is neither.
        bytes: fetch.bytes.byteLength,
        sha256: fetch.sha256,
        format: document.kind,
        licence: {
          spdx: document.licence.spdx,
          name: document.licence.name,
          url: document.licence.url,
          ...(document.licence.note === undefined ? {} : { note: document.licence.note }),
          evidence: document.licence.evidence,
        },
        ...(document.translation === undefined ? {} : { translation: document.translation }),
      };
    }),
  };
}
