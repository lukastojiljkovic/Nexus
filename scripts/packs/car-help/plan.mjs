// What the pack contains: five sections, the articles in each, and the span of
// the source every article is cut from.
//
// THE PLAN IS THE ONLY PLACE A CHOICE IS MADE. It names the work, the page or
// heading the span starts at and (usually) the heading it stops before; it never
// paraphrases, never reorders a sentence and never writes a line the source does
// not print. Everything between those two anchors ships whole, which is why a
// span is a pair of headings rather than a list of the paragraphs somebody
// wanted — the second shape has to be kept in step with the source by hand.
//
// Titles ARE the pack's own copy: a heading in the table of contents, not a
// line of the source, and the fidelity test says nothing about them for exactly
// that reason. They are short and descriptive, and they carry no claim the
// article does not make itself.

export const PACK_ID = "car-help";
export const PACK_VERSION = "2026.10.0";

/**
 * The five sections and their articles.
 *
 * `spans` is in reading order. An OCR span names its page (the printed page
 * number, which the corrections table is keyed by, so a span that drifted onto
 * another page would not find its corrections); an HTML span names the two
 * headings the page prints.
 */
export const SECTIONS = [
  {
    id: "stranded",
    title: "I am stranded",
    articles: [
      {
        id: "stranded-breakdowns",
        title: "If your vehicle breaks down",
        source: "fm-21-305",
        spans: [{ page: "11-5", from: "BREAKDOWNS", to: "For Army Only: Make limited repairs" }],
      },
      {
        id: "stranded-warning-devices",
        title: "The highway warning kit",
        source: "fm-21-305",
        declared: ["Highway Warning Kit"],
        spans: [{ page: "13-3", from: "Highway Warning Kit", to: "For Air Force Only : Obtain highway warning kit" }],
      },
      {
        id: "stranded-car-kit",
        title: "The kit to keep in the car",
        source: "ready-car",
        spans: [{ from: "Emergency Kit for the Car", to: "Car Safety Tips" }],
      },
      {
        id: "stranded-car-safety-tips",
        title: "Being stranded or caught by water",
        source: "ready-car",
        spans: [{ from: "Car Safety Tips" }],
      },
    ],
  },
  {
    id: "tyre",
    title: "Tyre",
    articles: [
      {
        id: "tyre-overview",
        title: "What this guidance is",
        source: "nhtsa-tires",
        spans: [{ from: "Overview", to: "The Topic" }],
      },
      {
        id: "tyre-pressure",
        title: "Checking tyre pressure",
        source: "nhtsa-tires",
        spans: [
          { from: "Tire Pressure", to: "Tire Tread" },
          { from: "Maintaining Proper Tire Pressure", to: "Tire Blowouts" },
        ],
      },
      {
        id: "tyre-tread",
        title: "Tread",
        source: "nhtsa-tires",
        spans: [{ from: "Tire Tread", to: "Balance and Alignment" }],
      },
      {
        id: "tyre-blowouts",
        title: "A blowout while driving",
        source: "nhtsa-tires",
        spans: [{ from: "Tire Blowouts", to: "Tire Pressure Monitoring System (TPMS)" }],
      },
      {
        id: "tyre-tpms",
        title: "The tyre pressure monitoring system",
        source: "nhtsa-tires",
        // "The Topic" is the page's own label above the next topic section's
        // heading; ending here keeps the label out of this article's text.
        spans: [{ from: "Tire Pressure Monitoring System (TPMS)", to: "The Topic" }],
      },
      {
        id: "tyre-spare",
        title: "The spare tyre",
        source: "nhtsa-tires",
        spans: [{ from: "Be aware of your spare", to: "The Topic" }],
      },
    ],
  },
  {
    id: "battery",
    title: "Battery",
    articles: [
      {
        id: "battery-jump-starting",
        title: "Jump starting a vehicle",
        source: "fm-21-305",
        declared: ["Using Jumper Cables to Start Engine"],
        spans: [{ page: "17-4", from: "JUMP STARTING VEHICLES" }],
      },
    ],
  },
  {
    id: "overheating",
    title: "Overheating",
    articles: [
      {
        id: "overheating-why",
        title: "Why an engine has to be cooled",
        source: "tm-9-8000",
        declared: ["Section I. COOLING ESSENTIALS", "Section II. LIQUID COOLING SYSTEMS"],
        spans: [{ page: "9-1", from: "ENGINE COOLING SYSTEMS", to: "9-4. Engine WaterJackets" }],
      },
      {
        id: "overheating-extreme-heat",
        title: "What to check when it is hot and dusty",
        source: "fm-21-305",
        spans: [{ page: "21-4", from: "Vehicle Care. In addition", to: "WINTER DRIVING" }],
      },
    ],
  },
  {
    id: "lights",
    title: "Lights on the dashboard",
    articles: [
      {
        id: "lights-oil-pressure",
        title: "The oil pressure warning light",
        source: "tm-9-8000",
        spans: [{ page: "17-8", from: "d. Indicator Lamp", to: "17-5. Temperature Gages" }],
      },
      {
        id: "lights-temperature",
        title: "The temperature warning light",
        source: "tm-9-8000",
        spans: [{ page: "17-10", from: "d. Indicator Lights", to: "17-6. Speedometers and Tachometers" }],
      },
    ],
  },
];

/**
 * What the pack does NOT carry, and why — the list both the build and
 * `docs/packs/car-help.md` print, so the two cannot drift.
 *
 * The safety rules ask for this list by name: material that is dangerous out of
 * context, or outside what the sources can stand behind, is left out and said
 * out loud rather than silently absent.
 */
export const OMITTED = [
  {
    what: "High-voltage and EV batteries",
    why: "no competent open source for driver-level high-voltage procedure was found (the research run reached the same conclusion); only the 12-volt jumper-cable procedure ships",
  },
  {
    what: "The NHTSA page's images and the two NHTSA tyre brochures (PDF)",
    why: "a federal page's figures are the usual third-party exception to 17 U.S.C. 105 and their rights are not stated in the page, so no image ships; the brochures are separate PDFs whose text is not part of the page the pack is pinned to",
  },
  {
    what: "The NHTSA recall snapshot",
    why: "the recall lookup is a US-only service reachable only online (api.nhtsa.gov), and the pack must work with the network off",
  },
  {
    what: "Wikibooks' Automobile Repair pages",
    why: "their licence (CC BY-SA 4.0) allows a verbatim reprint, but the research run found the Flat tyre page unsafe wording and the warning-light page garbled, and this pack ships text it can prove is the source's own — so nothing from them is used",
  },
  {
    what: "FM 21-305's NATO slave-cable procedure, and its Army/Air Force reporting paragraphs",
    why: "military-only equipment and reporting chains; the pages themselves are named in `sources.json` so a reader can go and read them",
  },
  {
    what: "FM 21-305 chapter 22's field repairs (a punctured radiator, a fan belt made from rope)",
    why: "a rope drive belt is a combat expedient, not something to hand a driver who can telephone for help",
  },
  {
    what: "Serbian and EU breakdown law (the warning triangle, the reflective vest, the hard shoulder)",
    why: "the research run found no openly licensed Serbian source (the road-safety agency's site is all rights reserved), so every procedure here follows US practice and none of it is localised",
  },
];

/** The article's own bibliography line, outside the fidelity test: the pack's attribution, not the source's text. */
export function sourceLine(source, article) {
  // The URL stays plain text: this is a line of a document the reader copies,
  // and the pages that draw a link do it through the app's one door (ADR-107).
  return `*Source: ${source.credit}. Section: ${article.title}. ${source.url}*`;
}

/**
 * The provenance article that closes a section.
 *
 * It is the pack's own copy — attribution and licence, generated from
 * `sources.json` so a digest or a licence sentence cannot drift from the bytes
 * the build actually hashed — and for that reason it is NOT part of the fidelity
 * test: nothing in it claims to be the source's words.
 */
export function provenanceMarkdown(section, articles, sources, fetched) {
  const lines = [
    `# Sources`,
    ``,
    `Every article in this section is the source's own text, verbatim. The conversion changes markup only — a heading, a list item and a paragraph break — and the build proves it: each article's Markdown, with the markup stripped, is the source span it was cut from.`,
    ``,
  ];
  const seen = new Set();
  for (const article of articles) {
    if (seen.has(article.source)) continue;
    seen.add(article.source);
    const source = sources.get(article.source);
    const pages = articles
      .filter((candidate) => candidate.source === article.source)
      .flatMap((candidate) => candidate.spans.map((span) => span.page))
      .filter((page) => page !== undefined);
    lines.push(
      `## ${source.title}`,
      ``,
      `Licence: ${source.licence}.`,
      ``,
      `Licence evidence: ${source.licenceUrl}`,
      ``,
      `> ${source.licenceQuote}`,
      ``,
      `Source file: ${source.url}`,
      ``,
      `Fetched ${fetched}. ${source.bytes} bytes, SHA-256 ${source.sha256}.`,
      ``,
    );
    if (pages.length > 0) {
      lines.push(`Pages used: ${[...new Set(pages)].join(", ")}. Scans: ${source.scanUrl ?? ""}.`, ``);
    }
  }
  lines.push(
    `The pack is a reference, not a manual for other cars: every procedure follows the source's own vehicle and the practice of its country of origin, and a qualified mechanic must review it before the pack is signed. See docs/packs/car-help.md.`,
    ``,
  );
  return lines.join("\n");
}
