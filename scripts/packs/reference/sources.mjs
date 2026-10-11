// What each reference pack contains, and where every word of it comes from.
//
// THIS FILE IS THE LICENCE FILE. For each document it names the URL the bytes
// were fetched from, the element of that page which is the document and which
// parts of it are the site around it, the licence the text travels under, and
// the sentence on a real page that states that licence. `build.mjs` turns the
// same entries into `sources.reference-en.json` / `sources.reference-sr.json`
// (adding the fetch date, the SHA-256 and the size of the bytes it actually
// took) and into each article's Source line. A document with no licence
// evidence is not a document this table can describe, and the build refuses it.
//
// WHY THE SELECTORS ARE DATA AND NOT CODE. Three families of source are in
// here — a government transcription, a UN page, and an XML file the EU
// Publications Office serves for one act of the Official Journal — and no two of
// them mark up a paragraph the same way. Writing that knowledge as selectors
// beside the licence, rather than as branches inside the converter, is what lets
// a maintainer add a document by describing a page instead of editing the
// converter.

/**
 * The licences the documents in these packs travel under, each with the page
 * that says so and the sentence on it, quoted verbatim.
 *
 * A NOTE ON WHAT "EVIDENCE" MEANS HERE. It is not a legal opinion: it is the
 * statement a licence review can check in one click, which is why every quote
 * below was read on the live page while this pack was built and why the URL
 * beside it is the page and not a search result. Where a document's freedom
 * comes from a fact about the work rather than from a licence (a translation
 * published in 1914), the evidence is the edition's own page, which states the
 * translator, the year and the book it was printed in.
 */
export const LICENCES = {
  usGovernment: {
    spdx: "LicenseRef-US-Government-Work",
    name: "Work of the United States Government — no copyright (17 U.S.C. § 105)",
    url: "https://www.govinfo.gov/content/pkg/USCODE-2023-title17/html/USCODE-2023-title17-chap1-sec105.htm",
    evidence: [
      {
        url: "https://www.govinfo.gov/content/pkg/USCODE-2023-title17/html/USCODE-2023-title17-chap1-sec105.htm",
        quote: "Copyright protection under this title is not available for any work of the United States Government",
      },
    ],
  },
  unPublicDomain: {
    spdx: "LicenseRef-UN-Public-Domain",
    name: "United Nations document — left in the public domain by the UN's own policy (ST/AI/189/Add.9/Rev.2)",
    url: "https://en.wikisource.org/wiki/Administrative_Instruction_ST/AI/189/Add.9/Rev.2",
    evidence: [
      {
        url: "https://en.wikisource.org/wiki/Administrative_Instruction_ST/AI/189/Add.9/Rev.2",
        quote: "The following categories of material will, as at present, be left in the public domain",
      },
      {
        url: "https://www.un.org/en/about-us/copyright",
        quote: "None of the materials provided on this web site may be used, reproduced or transmitted, in whole or in part",
      },
    ],
    note:
      "The UN's website notice claims copyright in the site; its own administrative instruction carves Official Records and " +
      "documents issued under a UN symbol out of that claim, and every document taken from a UN page here is one of those. " +
      "The UN's own commentary on the page is not taken.",
  },
  euReuse: {
    spdx: "CC-BY-4.0",
    name: "European Union document — reuse under Commission Decision 2011/833/EU and CC BY 4.0",
    url: "https://commission.europa.eu/legal-notice_en",
    evidence: [
      {
        url: "https://commission.europa.eu/legal-notice_en",
        quote: "This means that reuse is allowed, provided appropriate credit is given and changes are indicated.",
      },
    ],
    note:
      "EUR-Lex's own legal notice states the same in the negative — the legal documents published there may be re-used for " +
      "commercial or non-commercial purposes unless otherwise specified — and adds the caveat this pack repeats in each EU " +
      "article: only the Official Journal is authentic. That notice could not be read from this build environment (EUR-Lex " +
      "answers every path with its “today's Official Journal” shell), which is why the quote above is the Commission's " +
      "reuse notice and the documents are taken from the Publications Office's Cellar, the store EUR-Lex itself serves from.",
  },
  wikisource: {
    spdx: "CC-BY-SA-4.0",
    name: "Wikisource transcription — CC BY-SA 4.0",
    url: "https://creativecommons.org/licenses/by-sa/4.0/",
    evidence: [
      {
        url: "https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use",
        quote: "Please note that these licenses do allow commercial uses of your contributions, as long as such uses are compliant with the terms of the respective licenses.",
      },
      {
        url: "https://en.wikisource.org/wiki/Convention_on_the_Rights_of_the_Child",
        quote: "This work is excerpted from an official document of the United Nations.",
      },
    ],
    note:
      "The transcription is the work; the document transcribed under it is older and freer than the site. Both are named, " +
      "because share-alike attaches to the transcription and nothing in this pack modifies one.",
  },
  serbianOfficial: {
    spdx: "LicenseRef-Serbian-Official-Text",
    name: "Official text — not a work of authorship (Art. 6, Zakon o autorskom i srodnim pravima)",
    url: "https://www.wipo.int/wipolex/en/legislation/details/19376",
    evidence: [
      {
        url: "https://www.wipo.int/wipolex/en/legislation/details/19376",
        quote: "Ne smatraju se autorskim delom: 1) zakoni, podzakonski akti i drugi propisi; 2) službeni materijali državnih organa i organa koji obavljaju javnu funkciju",
      },
    ],
    note:
      "Serbian law is not protected as a work of authorship, so the text itself may be reproduced; what a publisher can own " +
      "is a consolidated collection of it (the database right in Art. 137–140a), which is why no consolidated or commercial " +
      "text is a source here. WIPO Lex is cited as the page where the exclusion could be read, not as a supply of text.",
  },
};

/**
 * The parts of a Wikisource page that are the wiki rather than the work.
 *
 * Named once because six of the documents here are Wikisource transcriptions and
 * each of them carries the same four pieces of site furniture: the header block
 * with its "related portals" note, the licence box at the foot, a maintenance
 * banner when the community has doubts about a transcription, and the wiki's own
 * floating table of contents. None of them is the document, and a reader who
 * asked for the Convention on the Rights of the Child did not ask for the
 * Wikisource community's opinion of its own transcription.
 */
const WIKISOURCE_FURNITURE = [
  { class: "ws-noexport" },
  { class: "licenseContainer" },
  { class: "ambox" },
  { class: "tocright" },
];

/**
 * The two packs.
 *
 * `documents` is in reading order, and the order is the table of contents: the
 * article ids are prefixed with the document's position, so a pack's files sort
 * the way its table of contents reads even to a reader that only knows the
 * paths.
 */
export const PACKS = {
  "reference-en": {
    id: "reference-en",
    language: "en",
    version: "2026.10.0",
    minAppVersion: "1.5.0",
    title: {
      sr: "Reference: povelje, ustavi i deklaracije",
      en: "Reference: charters, constitutions and declarations",
    },
    description: {
      sr:
        "Tekstovi koji se najčešće traže: Deklaracija nezavisnosti Sjedinjenih Američkih Država, Ustav SAD i Povelja o pravima, " +
        "Povelja Ujedinjenih nacija, Opšta deklaracija o pravima čoveka, Međunarodni pakt o građanskim i političkim pravima, " +
        "Međunarodni pakt o ekonomskim, socijalnim i kulturnim pravima, Konvencija o genocidu, Konvencija o pravima deteta, " +
        "Povelja EU o osnovnim pravima, konsolidovani Ugovor o Evropskoj uniji i Ugovor o funkcionisanju Evropske unije, " +
        "Velika povelja sloboda i Deklaracija o pravima čoveka i građanina. Svaki tekst je izvorni, bez prepričavanja.",
      en:
        "The texts people look for most: the United States Declaration of Independence, the Constitution and the Bill of " +
        "Rights, the Charter of the United Nations, the Universal Declaration of Human Rights, the ICCPR, the ICESCR, the " +
        "Genocide Convention, the Convention on the Rights of the Child, the EU Charter of Fundamental Rights, the " +
        "consolidated Treaty on European Union and Treaty on the Functioning of the European Union, Magna Carta and the " +
        "Declaration of the Rights of Man and of the Citizen. Every text is the source's own, not a summary.",
    },
    licence: {
      spdx: "CC-BY-SA-4.0",
      attribution:
        "United States National Archives and Records Administration; United Nations; Wikisource contributors (CC BY-SA 4.0); " +
        "European Union (CC BY 4.0, Decision 2011/833/EU); G. R. C. McKechnie and Frank Maloy Anderson (public-domain translations).",
      url: "https://creativecommons.org/licenses/by-sa/4.0/",
    },
    source: {
      name: "Multiple published sources — one entry each in scripts/packs/reference/sources.reference-en.json",
      url: "https://github.com/lukastojiljkovic/Nexus",
    },
    documents: [
      {
        id: "us-declaration-of-independence",
        title: "Declaration of Independence",
        section: "The unanimous Declaration of the thirteen united States of America",
        url: "https://www.archives.gov/founding-docs/declaration-transcript",
        kind: "html",
        container: { tag: "section", id: "block-system-main" },
        prune: [{ class: "ncallout" }, { class: "printMe" }],
        startAt: "In Congress, July 4, 1776",
        endAt: "Back to Main Declaration Page",
        licence: LICENCES.usGovernment,
      },
      {
        id: "us-constitution",
        title: "Constitution of the United States",
        section: "Articles I–VII",
        url: "https://www.archives.gov/founding-docs/constitution-transcript",
        kind: "html",
        container: { tag: "section", id: "block-system-main" },
        prune: [{ class: "ncallout" }, { class: "printMe" }],
        startAt: "We the People",
        endAt: "For biographies of the non-signing delegates",
        licence: LICENCES.usGovernment,
      },
      {
        id: "us-bill-of-rights",
        title: "Bill of Rights",
        section: "Amendments I–X",
        url: "https://www.archives.gov/founding-docs/bill-of-rights-transcript",
        kind: "html",
        container: { tag: "section", id: "block-system-main" },
        prune: [{ class: "ncallout" }, { class: "printMe" }],
        startAt: "Amendment I",
        endAt: "Back to Main Bill of Rights Page",
        licence: LICENCES.usGovernment,
      },
      {
        id: "un-charter",
        title: "Charter of the United Nations",
        section: "Preamble and Chapters I–XIX",
        url: "https://www.un.org/en/about-us/un-charter/full-text",
        kind: "html",
        container: { class: "field-item" },
        startAt: "Preamble",
        endAt: "Note on Amendments to Articles",
        licence: LICENCES.unPublicDomain,
      },
      {
        id: "udhr",
        title: "Universal Declaration of Human Rights",
        section: "Preamble and Articles 1–30",
        url: "https://www.un.org/en/about-us/universal-declaration-of-human-rights",
        kind: "html",
        container: { class: "article-body" },
        startAt: "Preamble",
        licence: LICENCES.unPublicDomain,
      },
      {
        id: "iccpr",
        title: "International Covenant on Civil and Political Rights",
        section: "Preamble, Parts I–VI and the footnotes of the printed text",
        url: "https://en.wikisource.org/w/api.php?action=parse&page=International%20Covenant%20on%20Civil%20and%20Political%20Rights&prop=text&format=json&formatversion=2",
        canonical: "https://en.wikisource.org/wiki/International_Covenant_on_Civil_and_Political_Rights",
        kind: "wikisource-parse",
        container: { class: "mw-parser-output" },
        headingClasses: { "wst-center": 2 },
        prune: WIKISOURCE_FURNITURE,
        licence: LICENCES.wikisource,
      },
      {
        id: "icescr",
        title: "International Covenant on Economic, Social and Cultural Rights",
        section: "Preamble and Parts I–V",
        url: "https://en.wikisource.org/w/api.php?action=parse&page=International%20Covenant%20on%20Economic%2C%20Social%20and%20Cultural%20Rights&prop=text&format=json&formatversion=2",
        canonical: "https://en.wikisource.org/wiki/International_Covenant_on_Economic,_Social_and_Cultural_Rights",
        kind: "wikisource-parse",
        container: { class: "mw-parser-output" },
        headingClasses: { "wst-center": 2 },
        prune: WIKISOURCE_FURNITURE,
        licence: LICENCES.wikisource,
      },
      {
        id: "genocide-convention",
        title: "Convention on the Prevention and Punishment of the Crime of Genocide",
        section: "Articles I–XIX",
        url: "https://en.wikisource.org/w/api.php?action=parse&page=Convention%20on%20the%20Prevention%20and%20Punishment%20of%20the%20Crime%20of%20Genocide&prop=text&format=json&formatversion=2",
        canonical: "https://en.wikisource.org/wiki/Convention_on_the_Prevention_and_Punishment_of_the_Crime_of_Genocide",
        kind: "wikisource-parse",
        container: { class: "mw-parser-output" },
        headingClasses: { "wst-center": 2 },
        prune: WIKISOURCE_FURNITURE,
        licence: LICENCES.wikisource,
      },
      {
        id: "crc",
        title: "Convention on the Rights of the Child",
        section: "Preamble and Articles 1–54",
        url: "https://en.wikisource.org/w/api.php?action=parse&page=Convention%20on%20the%20Rights%20of%20the%20Child&prop=text&format=json&formatversion=2",
        canonical: "https://en.wikisource.org/wiki/Convention_on_the_Rights_of_the_Child",
        kind: "wikisource-parse",
        container: { class: "mw-parser-output" },
        headingClasses: { "wst-center": 2 },
        prune: WIKISOURCE_FURNITURE,
        licence: LICENCES.wikisource,
      },
      {
        id: "eu-charter",
        title: "Charter of Fundamental Rights of the European Union",
        section: "The Charter as proclaimed on 12 December 2007 (2007/C 303/01)",
        url: "https://publications.europa.eu/resource/cellar/c0c63e95-a752-49e4-a88c-6120f5b8230b.0007.03/DOC_1",
        canonical: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:12012P/TXT",
        kind: "xhtml",
        accept: "application/xhtml+xml",
        container: null,
        headingClasses: { "doc-ti": 1, "ti-tbl": 2, "ti-section-1": 2, "ti-section-2": 3, "ti-art": 4, "sti-art": 4 },
        prune: [{ class: "hd-date" }, { class: "hd-lg" }, { class: "hd-ti" }, { class: "hd-oj" }],
        authenticity: true,
        licence: LICENCES.euReuse,
      },
      {
        id: "eu-teu",
        title: "Consolidated version of the Treaty on European Union",
        section: "Official Journal C 202 of 7 June 2016, pages 1–46",
        url: "https://publications.europa.eu/resource/cellar/2021d50a-3468-11e6-969e-01aa75ed71a1.0005.01/DOC_1",
        canonical: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:12016M/TXT",
        kind: "xhtml",
        accept: "application/xhtml+xml",
        container: null,
        headingClasses: { "doc-ti": 1, "ti-tbl": 2, "ti-section-1": 2, "ti-section-2": 3, "ti-art": 4, "sti-art": 4 },
        prune: [{ class: "hd-date" }, { class: "hd-lg" }, { class: "hd-ti" }, { class: "hd-oj" }],
        splitOn: "ti-section-1",
        frontMatterTitle: "Table of contents",
        authenticity: true,
        licence: LICENCES.euReuse,
      },
      {
        id: "eu-tfeu",
        title: "Consolidated version of the Treaty on the Functioning of the European Union",
        section: "Official Journal C 202 of 7 June 2016, pages 47–388",
        url: "https://publications.europa.eu/resource/cellar/f1bcba61-0d85-4e7f-b41e-a72c42eb5c49.0005.01/DOC_1",
        canonical: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:12016E/TXT",
        kind: "xhtml",
        accept: "application/xhtml+xml",
        container: null,
        headingClasses: { "doc-ti": 1, "ti-tbl": 2, "ti-section-1": 2, "ti-section-2": 3, "ti-art": 4, "sti-art": 4 },
        prune: [{ class: "hd-date" }, { class: "hd-lg" }, { class: "hd-ti" }, { class: "hd-oj" }],
        splitOn: "ti-section-1",
        frontMatterTitle: "Table of contents",
        authenticity: true,
        licence: LICENCES.euReuse,
      },
      {
        id: "magna-carta",
        title: "Magna Carta",
        section: "The translation by William Sharp McKechnie (1914), as printed in Source Problems in English History (1915)",
        url: "https://en.wikisource.org/w/api.php?action=parse&page=Source%20Problems%20in%20English%20History/Appendix/Magna%20Carta.%201215&prop=text&format=json&formatversion=2",
        canonical: "https://en.wikisource.org/wiki/Source_Problems_in_English_History/Appendix/Magna_Carta._1215",
        kind: "wikisource-parse",
        container: { class: "mw-parser-output" },
        headingClasses: { "wst-center": 2 },
        prune: WIKISOURCE_FURNITURE,
        startAt: "MAGNA CARTA. 1215",
        translation: "William Sharp McKechnie (1914), in Albert Beebe White and Wallace Notestein, Source Problems in English History (1915)",
        licence: LICENCES.wikisource,
      },
      {
        id: "declaration-of-the-rights-of-man",
        title: "Declaration of the Rights of Man and of the Citizen",
        section: "The translation by Frank Maloy Anderson (1908)",
        url: "https://en.wikisource.org/w/api.php?action=parse&page=The%20Constitutions%20and%20Other%20Select%20Documents%20Illustrative%20of%20the%20History%20of%20France%2C%201789%E2%80%931907/15&prop=text&format=json&formatversion=2",
        canonical: "https://en.wikisource.org/wiki/The_Constitutions_and_Other_Select_Documents_Illustrative_of_the_History_of_France,_1789%E2%80%931907/15",
        kind: "wikisource-parse",
        container: { class: "mw-parser-output" },
        headingClasses: { "wst-center": 2 },
        prune: WIKISOURCE_FURNITURE,
        startAt: "Declaration of the Rights of Man and Citizen.",
        endAt: "French Constitution.",
        translation: "Frank Maloy Anderson (1908), The Constitutions and Other Select Documents Illustrative of the History of France, 1789–1907",
        licence: LICENCES.wikisource,
      },
    ],
  },

  "reference-sr": {
    id: "reference-sr",
    language: "sr",
    version: "2026.10.0",
    minAppVersion: "1.5.0",
    title: {
      sr: "Reference: Ustav Srbije i Opšta deklaracija o pravima čoveka",
      en: "Reference: the Serbian Constitution and the Universal Declaration of Human Rights",
    },
    description: {
      sr:
        "Ustav Republike Srbije, kako ga objavljuje Ustavni sud, i Opšta deklaracija o pravima čoveka na srpskom jeziku. " +
        "Oba teksta su izvorna, bez prepričavanja i bez spajanja izmena u prečišćeni tekst.",
      en:
        "The Constitution of the Republic of Serbia as published by the Constitutional Court, and the Universal Declaration " +
        "of Human Rights in Serbian. Both texts are the source's own, with no consolidation of amendments into a single text.",
    },
    licence: {
      spdx: "CC-BY-SA-4.0",
      attribution:
        "Уставни суд Републике Србије (званични текст); Викизворник на српском (CC BY-SA 4.0); Уједињене нације (јавно добро). " +
        "Ustavni sud Republike Srbije (official text); Serbian Wikisource (CC BY-SA 4.0); United Nations (public domain).",
      url: "https://creativecommons.org/licenses/by-sa/4.0/",
    },
    source: {
      name: "Multiple published sources — one entry each in scripts/packs/reference/sources.reference-sr.json",
      url: "https://github.com/lukastojiljkovic/Nexus",
    },
    documents: [
      {
        id: "udhr-sr",
        title: "Општа декларација о правима човека",
        section: "Увод и чланови 1–30",
        url: "https://sr.wikisource.org/w/api.php?action=parse&page=%D0%9E%D0%BF%D1%88%D1%82%D0%B0%20%D0%B4%D0%B5%D0%BA%D0%BB%D0%B0%D1%80%D0%B0%D1%86%D0%B8%D1%98%D0%B0%20%D0%BE%20%D0%BF%D1%80%D0%B0%D0%B2%D0%B8%D0%BC%D0%B0%20%D1%87%D0%BE%D0%B2%D0%B5%D0%BA%D0%B0&prop=text&format=json&formatversion=2",
        canonical: "https://sr.wikisource.org/wiki/%D0%9E%D0%BF%D1%88%D1%82%D0%B0_%D0%B4%D0%B5%D0%BA%D0%BB%D0%B0%D1%80%D0%B0%D1%86%D0%B8%D1%98%D0%B0_%D0%BE_%D0%BF%D1%80%D0%B0%D0%B2%D0%B8%D0%BC%D0%B0_%D1%87%D0%BE%D0%B2%D0%B5%D0%BA%D0%B0",
        kind: "wikisource-parse",
        container: null,
        // The Serbian Wikisource page carries none of the furniture the English
        // ones do: its licence notice is in the site footer, which the parse API
        // does not return, and its only extra is the "[уреди]" edit link, which
        // the converter removes for every source.
        prune: [],
        endAt: "Спољашње везе",
        licence: LICENCES.wikisource,
      },
      {
        id: "ustav-republike-srbije",
        title: "Устав Републике Србије",
        section: "Проглашен 2006. године; текст који објављује Уставни суд",
        url: "https://www.ustavni.sud.rs/ustav-rs-i-propisi/ustav-republike-srbije",
        kind: "html",
        container: { class: "text-content" },
        headingClasses: { "text-center": 4 },
        licence: LICENCES.serbianOfficial,
        gazette: {
          numbers: [
            "„Сл. гласник РС” бр. 98/2006",
            "„Сл. гласник РС” бр. 115/2021 (одлука о проглашењу)",
            "„Сл. гласник РС” бр. 16/2022 (Уставни закон, амандмани I–XXIX)",
          ],
          note:
            "Ustavni sud objavljuje tekst Ustava sa naznačenim brojevima glasnika; tekst nije sastavljan ni spajan od strane " +
            "paketa. Ako se Ustav bude menjao, broj novog glasnika se dodaje ovde i paket se ponovo gradi.",
        },
      },
    ],
  },
};
