// No shebang, for the reason the other gates in `scripts/` have none: this
// module is both imported by `build.mjs` and driven by its own test.
//
// `sources.json`: what these packs are made of, and why it is allowed.
//
// A source without evidence is a source this builder will not use, so every
// entry here carries the URL of the page that states its licence and the exact
// sentence on that page. The sentence is CHECKED against the fetched file at
// build time — the same bytes, with tags off — which is what stops this file
// from becoming a place where a quote is only remembered. A quote that stops
// matching fails the build; a page that changes its terms cannot slip through
// as a stale string.
//
// What the packs are made of, in one sentence each: the Serbian texts are
// public-domain works (Vuk Stefanović Karadžić died in 1864) whose Wikisource
// page text is licensed CC BY-SA 4.0; the English texts are Project Gutenberg
// ebooks that are public domain in the United States, used with the licence
// notice their terms ask for and with the trademark wrapper stripped, as those
// terms allow.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { textOf } from "./wikisource.mjs";

/**
 * Every licence-evidence page, with the file it is cached as.
 *
 * These are fetched once and kept, like any other source, because a quote is
 * only evidence while the bytes it came from are still around to check it
 * against.
 */
export const EVIDENCE_PAGES = [
  {
    packId: "tales-sr",
    file: "licence-wikisource-page.html",
    url: "https://sr.wikisource.org/wiki/Баш-Челик",
  },
  {
    packId: "tales-sr",
    file: "licence-wikimedia-terms.html",
    url: "https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use",
  },
  {
    packId: "tales-en",
    file: "licence-gutenberg-policy.html",
    url: "https://www.gutenberg.org/policy/license.html",
  },
  {
    packId: "tales-en",
    file: "licence-gutenberg-terms.html",
    url: "https://www.gutenberg.org/policy/terms_of_use.html",
  },
  ...[ "5314", "1597", "27200", "11339" ].map((ebook) => ({
    packId: "tales-en",
    file: `licence-gutenberg-ebook-${ebook}.html`,
    url: `https://www.gutenberg.org/ebooks/${ebook}`,
  })),
  {
    packId: "tales-en",
    file: "gutenberg-1597-license.txt",
    url: "https://gutenberg.pglaf.org/1/5/9/1597/LICENSE.txt",
  },
];

/**
 * The licence of the Serbian Wikisource page text, and the sentence that says
 * so, on the page the sentence was read from.
 */
export const WIKISOURCE_LICENCE = {
  spdx: "CC-BY-SA-4.0",
  statement:
    "The page text is licensed by Wikimedia under CC BY-SA 4.0; the works it carries are public domain.",
  url: "https://creativecommons.org/licenses/by-sa/4.0/",
  evidence: [
    {
      // The site's own footer, on an arbitrary page of the same wiki.
      file: "licence-wikisource-page.html",
      url: "https://sr.wikisource.org/wiki/Баш-Челик",
      quote:
        "Текст је доступан под лиценцом Creative Commons Ауторство—Делити под истим условима; могући су и додатни услови.",
    },
    {
      file: "licence-wikimedia-terms.html",
      url: "https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use",
      quote:
        "When you submit text to which you hold the copyright, you agree to license it under: Creative Commons Attribution-ShareAlike 4.0 International License (\"CC BY-SA 4.0\")",
    },
  ],
};

/**
 * The public-domain statement the wiki prints under each of these pages, read
 * from the pages themselves rather than from a policy page: the author, the
 * year he died, and the term the wiki applies.
 *
 * It is a template, so its last clause counts the years since Vuk's death and
 * changes every January — which is exactly why the fetched page is kept beside
 * the quote instead of the quote being trusted on its own.
 */
export const SERBIAN_PD_EVIDENCE = {
  quote:
    "Овај текст је у јавном власништву у Србији, Сједињеним државама и свим осталим земљама са периодом заштите ауторских права од живота аутора плус 70 година јер је његов аутор, Вук Стефановић Караџић, умро 1864, пре 162 године.",
  url: "https://sr.wikisource.org/wiki/Аждаја_и_царев_син",
};

/**
 * Project Gutenberg's licence, and the sentences this build depends on.
 *
 * The first two are the reason the wrapper may be cut and the text may be
 * reformatted into CommonMark; the third is the trademark rule that applies to
 * anyone who keeps the Project Gutenberg name, which is why the name is in the
 * pack's provenance and attribution rather than in the articles.
 */
export const GUTENBERG_LICENCE = {
  spdx: "LicenseRef-Public-Domain",
  statement:
    "Public domain in the United States, per each ebook's own licence notice and landing page; the Project Gutenberg trademark and licence terms are not public domain.",
  url: "https://www.gutenberg.org/policy/license.html",
  evidence: [
    {
      file: "licence-gutenberg-policy.html",
      url: "https://www.gutenberg.org/policy/license.html",
      quote:
        "If you strip the Project Gutenberg license and all references to Project Gutenberg from the text, you are left with a text unrestricted by U.S. intellectual property law.",
    },
    {
      file: "licence-gutenberg-policy.html",
      url: "https://www.gutenberg.org/policy/license.html",
      quote:
        "you may only distribute verbatim copies of the ebooks. No changes are allowed to the ebook contents. (Though reformatting the ebook to a different file format is considered okay).",
    },
  ],
};

/** The per-ebook notice of the two ebooks that ship one as a separate file. */
export const GUTENBERG_EBOOK_LICENCES = {
  "1597": {
    file: "gutenberg-1597-license.txt",
    url: "https://gutenberg.pglaf.org/1/5/9/1597/LICENSE.txt",
    quote:
      "This book, including all associated images, markup, improvements, metadata, and any other content or labor, has been confirmed to be in the PUBLIC DOMAIN IN THE UNITED STATES.",
  },
};

/** The landing page's own words, for every ebook in the pack. */
export const GUTENBERG_LANDING_QUOTE = "Public domain in the USA.";

/**
 * Checks one quoted sentence against the file it came from.
 *
 * The comparison is on the file's text with tags off and whitespace normalised,
 * because that is what a quote from a web page is: its words. Formatting is
 * what the pack builder changes, and a quote must survive exactly that.
 */
export function quoteAppears(fileText, quote) {
  const flat = (text) => text.replace(/\s+/gu, " ").trim();
  return flat(fileText).includes(flat(quote));
}

/** A cached file's text, tags off when it is HTML. */
export function readEvidence(cacheDir, file) {
  const raw = readFileSync(join(cacheDir, file), "utf8");
  return file.endsWith(".html") ? textOf(raw) : raw;
}

/**
 * `sources.json`'s body: one record per pack, one entry per source.
 *
 * Numbers that can be measured are measured here and nowhere else — the byte
 * counts and SHA-256s come from the bytes on disk, the dates from the run, the
 * quotes from the fetched pages.
 */
export function buildSources({ date, en, sr }) {
  return {
    generated: date,
    note:
      "Every source with the URL it was fetched from, the date, its SHA-256, its licence, and the exact sentence the licence page states. " +
      "The builder checks every quote against the fetched bytes on every run, so a page that changed its terms fails the build.",
    packs: {
      "tales-sr": {
        licence: WIKISOURCE_LICENCE,
        sources: [
          {
            id: "wikisource-tales-1870",
            name: "Викизворник — Српске народне приповијетке, друго умножено издање (Беч, 1870)",
            url: sr.categoryUrl,
            fetched: date,
            work: "Vuk Stefanović Karadžić, Српске народне приповијетке, друго умножено издање (Vienna, 1870)",
            licence: WIKISOURCE_LICENCE,
            evidence: [
              ...WIKISOURCE_LICENCE.evidence,
              { url: SERBIAN_PD_EVIDENCE.url, quote: SERBIAN_PD_EVIDENCE.quote },
            ],
            bytes: sr.tales.bytes,
            sha256: sr.tales.sha256,
            pages: sr.tales.pages,
          },
          {
            id: "wikisource-proverbs-1900",
            name: "Викизворник — Српске народне пословице (Београд, 1900)",
            url: sr.proverbs.url,
            fetched: date,
            work: "Vuk Stefanović Karadžić, Српске народне пословице и друге различне као оне у обичају узете речи (Belgrade, 1900)",
            licence: WIKISOURCE_LICENCE,
            evidence: WIKISOURCE_LICENCE.evidence,
            bytes: sr.proverbs.bytes,
            sha256: sr.proverbs.sha256,
            revid: sr.proverbs.revid,
          },
        ],
      },
      "tales-en": {
        licence: GUTENBERG_LICENCE,
        sources: en.books.map((book) => ({
          id: `gutenberg-${book.ebook}`,
          name: book.title,
          url: `https://www.gutenberg.org/ebooks/${book.ebook}`,
          fetched: date,
          work: book.credit,
          licence: GUTENBERG_LICENCE,
          evidence: [
            {
              file: `licence-gutenberg-ebook-${book.ebook}.html`,
              url: `https://www.gutenberg.org/ebooks/${book.ebook}`,
              quote: GUTENBERG_LANDING_QUOTE,
            },
            ...(GUTENBERG_EBOOK_LICENCES[book.ebook] === undefined
              ? []
              : [{ ...GUTENBERG_EBOOK_LICENCES[book.ebook] }]),
          ],
          bytes: book.bytes,
          sha256: book.sha256,
          articles: book.articles,
        })),
      },
    },
  };
}
