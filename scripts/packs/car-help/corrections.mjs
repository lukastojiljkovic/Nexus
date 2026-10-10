// The OCR corrections, and the one place they are applied.
//
// WHY A TABLE AND NOT A PROOFREADER. FM 21-305 and TM 9-8000 exist only as
// scans with an OCR text layer, and the safety rules say the pack ships the
// OCR's text — corrected ONLY through an explicit table that a human can check
// against the scan, applied before the fidelity test, and listed in
// `docs/packs/car-help.md`. This is that table. Nothing else in this builder
// changes a word.
//
// WHAT AN ENTRY IS. `wrong` is the OCR's own lines, exactly as the extractor
// handed them over; `right` is what the page prints, read off the scan image at
// `scan` (the Internet Archive page-image URL the build records). `page` is the
// printed page number, and the applier asserts it against the page's own
// detected label, so a correction can never be applied to the wrong page. An
// entry whose `wrong` is not found stops the build: a table that no longer
// matches its source is a table nobody is checking.
//
// The `note` is for the reader of `docs/packs/car-help.md`, and every note is a
// measurable statement (what the scan prints, or the arithmetic that shows a
// figure is wrong) rather than a claim about intent.

/**
 * Every correction, grouped by the source it belongs to.
 *
 * The list is short on purpose: the spans this pack ships were chosen where the
 * OCR is legible, and the entries below are the places where it is not. Each one
 * was read off the page image at `docs/packs/car-help.md`'s scan URL.
 *
 * Non-ASCII characters are written as escapes so the table survives a tool that
 * mangles UTF-8: `\u0430` is the Cyrillic a the OCR produced for a Latin one,
 * and `\u00B0` is the degree sign the OCR dropped.
 */
export const CORRECTIONS = [
  // --- FM 21-305, page 11-5: breakdowns. ----------------------------------
  {
    source: "fm-21-305",
    leaf: 62,
    page: "11-5",
    wrong: ["necessary to avoid greater came When your"],
    right: ["necessary to avoid greater danger. When your"],
    note: "the scan reads “greater danger.” — the OCR dropped the word's tail and the full stop with it.",
  },
  {
    source: "fm-21-305",
    leaf: 62,
    page: "11-5",
    wrong: ["vehicle is disabled at night, always leave yee parking"],
    right: ["vehicle is disabled at night, always leave your parking"],
    note: "the scan prints “your”.",
  },
  // --- FM 21-305, page 13-3: the highway warning kit. ---------------------
  {
    source: "fm-21-305",
    leaf: 73,
    page: "13-3",
    wrong: ["where warning is necessary (Figure he All Air"],
    right: ["where warning is necessary (Figure 13-1). All Air"],
    note: "the scan prints “(Figure 13-1).”; the OCR lost the figure number and the closing bracket.",
  },
  {
    source: "fm-21-305",
    leaf: 73,
    page: "13-3",
    wrong: ["highway warning kits. Vehicles of lesser capacit"],
    right: ["highway warning kits. Vehicles of lesser capacity"],
    note: "the scan prints “capacity” — the OCR dropped the final letter at the line break.",
  },
  {
    source: "fm-21-305",
    leaf: 73,
    page: "13-3",
    wrong: ["ways. Additional kits ar\u00E9 stored in post/base"],
    right: ["ways. Additional kits are stored in post/base"],
    note: "the scan prints “are”; the OCR read a Latin e with an acute accent.",
  },
  {
    source: "fm-21-305",
    leaf: 73,
    page: "13-3",
    wrong: ["lace a reflector in the obstructed lane, or on"],
    right: ["place a reflector in the obstructed lane, or on"],
    note: "the scan prints “place”; the OCR lost the initial p.",
  },
  {
    source: "fm-21-305",
    leaf: 73,
    page: "13-3",
    wrong: ["reflectors\u2019 as follows:"],
    right: ["reflectors as follows:"],
    note: "the scan prints no apostrophe after “reflectors”.",
  },
  {
    source: "fm-21-305",
    leaf: 73,
    page: "13-3",
    wrong: ["if the direction of traffic approaching in that", "ane."],
    right: ["in the direction of traffic approaching in that", "lane."],
    note: "the scan prints “in the direction of traffic approaching in that lane.”; the OCR read the n as an f and dropped the initial l of the short final line.",
  },
  {
    source: "fm-21-305",
    leaf: 73,
    page: "13-3",
    wrong: ["Ifthe motor vehicle is stopped within 300"],
    right: ["If the motor vehicle is stopped within 300"],
    note: "the scan prints “If the”.",
  },
  {
    source: "fm-21-305",
    leaf: 73,
    page: "13-3",
    wrong: ["pace 0 feet behind the vehicle will have no"],
    right: ["placed 20 feet behind the vehicle will have no"],
    note: "the scan prints “placed 20 feet”; the OCR produced “pace 0”.",
  },
  {
    source: "fm-21-305",
    leaf: 73,
    page: "13-3",
    wrong: ["ag mounted on it.)"],
    right: ["flag mounted on it.)"],
    note: "the scan prints “flag mounted on it.)”.",
  },
  {
    source: "fm-21-305",
    leaf: 73,
    page: "13-3",
    wrong: ["flares in the kit. However, vehicles transportin"],
    right: ["flares in the kit. However, vehicles transporting"],
    note: "the scan prints “transporting”.",
  },
  // --- FM 21-305, page 17-4: jump starting. -------------------------------
  {
    source: "fm-21-305",
    leaf: 91,
    page: "17-4",
    wrong: ["responsible for the arall of your troops, both on and"],
    right: ["responsible for the safety of your troops, both on and"],
    note: "the scan prints “safety”; the research run recorded the same slip (its evidence E27).",
  },
  {
    source: "fm-21-305",
    leaf: 91,
    page: "17-4",
    wrong: ["connect the negative terminal of the jum"],
    right: ["connect the negative terminal of the jump"],
    note: "the scan prints “jump”; the OCR lost the final letter at the line break.",
  },
  {
    source: "fm-21-305",
    leaf: 91,
    page: "17-4",
    wrong: ["terminal (1) of the ump starting vehicle and the"],
    right: ["terminal (1) of the jump starting vehicle and the"],
    note: "the scan prints “jump”; the OCR lost the first letter after the column break.",
  },
  {
    source: "fm-21-305",
    leaf: 91,
    page: "17-4",
    wrong: [
      "tact other jumper cable clamps or ter-",
      "ailure to do so may cause",
      "minals.",
      "batteries to explode, injuring or killing",
    ],
    right: [
      "tact other jumper cable clamps or ter-",
      "minals. Failure to do so may cause",
      "batteries to explode, injuring or killing",
    ],
    note: "the scan reads “...clamps or terminals. Failure to do so may cause batteries to explode...”; the OCR read the box's second column out of order, so the sentence arrived split across four lines.",
  },
  // --- TM 9-8000, page 9-1: the cooling system. ---------------------------
  {
    source: "tm-9-8000",
    leaf: 235,
    page: "9-1",
    wrong: ["\u0421\u041D\u0410\u0420\u0422\u0415\u041D 9"],
    right: ["CHAPTER 9"],
    note: "the scan prints “CHAPTER 9”; the OCR produced four Cyrillic letters and read the A as an A.",
  },
  {
    source: "tm-9-8000",
    leaf: 235,
    page: "9-1",
    wrong: ["Section |. COOLING ESSENTIALS"],
    right: ["Section I. COOLING ESSENTIALS"],
    note: "the scan prints “Section I.”; the OCR read the capital I as a pipe.",
  },
  {
    source: "tm-9-8000",
    leaf: 235,
    page: "9-1",
    wrong: ["Section Il. LIQUID COOLING SYSTEMS"],
    right: ["Section II. LIQUID COOLING SYSTEMS"],
    note: "the scan prints “Section II.”; the OCR read the second capital I as a lower-case l.",
  },
  {
    source: "tm-9-8000",
    leaf: 235,
    page: "9-1",
    wrong: ["b. \u0410\u0448. Air cooling is most practical for small"],
    right: ["b. Air. Air cooling is most practical for small"],
    note: "the scan prints “b. Air.”; the OCR produced a Cyrillic A and sh.",
  },
  {
    source: "tm-9-8000",
    leaf: 235,
    page: "9-1",
    wrong: ["the air through radiation from \u045B\u0435 engine."],
    right: ["the air through radiation from the engine."],
    note: "the scan prints “the engine”; the OCR produced a Cyrillic tshe and e.",
  },
  {
    source: "tm-9-8000",
    leaf: 235,
    page: "9-1",
    wrong: ["9-3. Flow of Coolant [(\u0415\u0457\u0430. 9-1). A simple liquid-cooled"],
    right: ["9-3. Flow of Coolant (Fig. 9-1). A simple liquid-cooled"],
    note: "the scan prints “(Fig. 9-1).”; the OCR produced three Cyrillic letters and a stray bracket.",
  },
  {
    source: "tm-9-8000",
    leaf: 235,
    page: "9-1",
    wrong: ["which the coolant circulates. Some engines \u0430\u0433\u0435"],
    right: ["which the coolant circulates. Some engines are"],
    note: "the scan prints “are”; the OCR produced three Cyrillic letters.",
  },
  // --- TM 9-8000, page 17-8: the oil pressure warning light. --------------
  {
    source: "tm-9-8000",
    leaf: 389,
    page: "17-8",
    wrong: ["d. Indicator Lamp The oil pressure"],
    right: ["d. Indicator Lamp (Fig. 17-12). The oil pressure"],
    note: "the scan prints “d. Indicator Lamp (Fig. 17-12).”; the OCR dropped the figure reference.",
  },
  {
    source: "tm-9-8000",
    leaf: 389,
    page: "17-8",
    wrong: ["warning light Is used In place of a gage on many"],
    right: ["warning light is used in place of a gage on many"],
    note: "the scan prints lower-case “is” and “in”; the OCR read the lower-case l as a capital I.",
  },
  {
    source: "tm-9-8000",
    leaf: 389,
    page: "17-8",
    wrong: ["indicator, Is valuable because of Its high visibility in the"],
    right: ["indicator, is valuable because of its high visibility in the"],
    note: "the scan prints lower-case “is” and “its”.",
  },
  {
    source: "tm-9-8000",
    leaf: 389,
    page: "17-8",
    wrong: ["often Is used as a backup for a gage to attract Instant"],
    right: ["often is used as a backup for a gage to attract instant"],
    note: "the scan prints lower-case “is” and “instant”.",
  },
  {
    source: "tm-9-8000",
    leaf: 389,
    page: "17-8",
    wrong: ["The sender switch consists of \u0430 pressure-sensitive"],
    right: ["The sender switch consists of a pressure-sensitive"],
    note: "the scan prints a Latin “a”; the OCR produced a Cyrillic a.",
  },
  // --- TM 9-8000, page 17-10: the temperature warning light. --------------
  {
    source: "tm-9-8000",
    leaf: 391,
    page: "17-10",
    wrong: ["d. Indicator Lights The tem- perature"],
    right: ["d. Indicator Lights (Fig. 17-15). The temperature"],
    note: "the scan prints “d. Indicator Lights (Fig. 17-15).” and sets “temperature” whole; the OCR dropped the figure reference and broke the word.",
  },
  {
    source: "tm-9-8000",
    leaf: 391,
    page: "17-10",
    wrong: ["gage, Is valuable because of its high visibility in the event"],
    right: ["gage, is valuable because of its high visibility in the event"],
    note: "the scan prints lower-case “is”.",
  },
  {
    source: "tm-9-8000",
    leaf: 391,
    page: "17-10",
    wrong: ["to attract Instant attention to a malfunction. The warning"],
    right: ["to attract instant attention to a malfunction. The warning"],
    note: "the scan prints lower-case “instant”.",
  },
  {
    source: "tm-9-8000",
    leaf: 391,
    page: "17-10",
    wrong: ["2300F (1100C). Some models also utilize \u0430 cold"],
    right: ["230\u00B0F (110\u00B0C). Some models also utilize a cold"],
    note: "the scan prints “230 degrees F (110 degrees C)”; the OCR read the degree sign as a zero. The arithmetic confirms it: (230 - 32) / 1.8 = 110.",
  },
  {
    source: "tm-9-8000",
    leaf: 391,
    page: "17-10",
    wrong: ["1500F (65.60C). The strip then will open the cold light"],
    right: ["150\u00B0F (65.6\u00B0C). The strip then will open the cold light"],
    note: "the scan prints “150 degrees F (65.6 degrees C)”; the OCR read the degree sign as a zero and the decimal point as another zero. (150 - 32) / 1.8 = 65.6.",
  },
  {
    source: "tm-9-8000",
    leaf: 391,
    page: "17-10",
    wrong: ["circuit. As long as the temperature of the engine Is"],
    right: ["circuit. As long as the temperature of the engine is"],
    note: "the scan prints lower-case “is”.",
  },
];

/** The corrections a source needs, in table order. */
export function correctionsFor(source) {
  return CORRECTIONS.filter((entry) => entry.source === source);
}

/**
 * One page's entries, applied in place.
 *
 * A page is `{ leaf, label, lines }` and a line is any object carrying `text`;
 * the replacement keeps the geometry of the line it lands on (its position and
 * size), because the text is what changed and the layout is what the page still
 * says. `right` may carry fewer lines than `wrong` — the box that came out of
 * reading order had one line too many — in which case the surviving lines
 * share the replaced range's positions.
 */
export function applyPageCorrections(page, source, log = () => {}) {
  for (const entry of correctionsFor(source)) {
    if (entry.leaf !== page.leaf) continue;
    if (page.label !== entry.page) {
      throw new Error(
        `corrections: ${source} leaf ${String(page.leaf)} is page ${JSON.stringify(page.label)}, and the table ` +
          `says ${JSON.stringify(entry.page)}.`,
      );
    }
    applyOne(page, entry);
    log(`  corrected ${source} ${entry.page}: ${JSON.stringify(entry.wrong[0])} -> ${JSON.stringify(entry.right[0])}`);
  }
}

/**
 * The whole table applied to one source's pages.
 *
 * Every leaf the table names has to be among `pages`: a table entry whose page
 * the source no longer has is a table nobody is checking, and the build stops
 * rather than shipping the uncorrected text.
 */
export function applyCorrections(pages, source, log = () => {}) {
  const leaves = new Set(pages.map((page) => page.leaf));
  for (const entry of correctionsFor(source)) {
    if (!leaves.has(entry.leaf)) {
      throw new Error(`corrections: ${source} has no leaf ${String(entry.leaf)}.`);
    }
  }
  for (const page of pages) applyPageCorrections(page, source, log);
}

function applyOne(page, entry) {
  const lines = page.lines;
  const joined = lines.map((line) => line.text).join("\n");
  const wrong = entry.wrong.join("\n");
  const at = joined.indexOf(wrong);
  if (at < 0) {
    throw new Error(
      `corrections: ${entry.source} ${entry.page}: the table's wrong text is not on the page:\n` +
        `  ${JSON.stringify(entry.wrong)}`,
    );
  }
  // An entry that matched twice would fix one occurrence and silently leave the
  // other, so the table has to name text that occurs once on its page.
  if (joined.indexOf(wrong, at + 1) >= 0) {
    throw new Error(
      `corrections: ${entry.source} ${entry.page}: the table's wrong text occurs more than once:\n` +
        `  ${JSON.stringify(entry.wrong)}`,
    );
  }
  const from = lineAt(lines, at);
  const to = lineAt(lines, at + wrong.length - 1);
  const head = lines[from];
  const tail = lines[to];
  // The replacement lines keep the replaced range's own geometry, spread
  // evenly from the first line to the last. Taking the tail's position for
  // every line after the first would leave a paragraph-sized gap in the middle
  // of a box whose page shows none, and the block builder would then break the
  // paragraph exactly there.
  const replacement = entry.right.map((text, offset) => ({
    ...head,
    text,
    top: entry.right.length === 1 ? head.top : head.top + ((tail.top - head.top) * offset) / (entry.right.length - 1),
  }));
  lines.splice(from, to - from + 1, ...replacement);
}

/** The index of the line an absolute offset into the page's joined text falls on. */
function lineAt(lines, offset) {
  let at = 0;
  for (const [index, line] of lines.entries()) {
    const end = at + line.text.length;
    if (offset <= end) return index;
    at = end + 1;
  }
  return lines.length - 1;
}

/**
 * The table as the Markdown of `docs/packs/car-help.md`, so the document's copy
 * is generated from the table the build actually applies rather than retyped
 * beside it. `pageUrl` is where a human opens the scan to check an entry.
 */
export function correctionsTable(source, pageUrl) {
  const rows = correctionsFor(source).map(
    (entry) =>
      `| ${entry.page} | \`${entry.wrong.join(" ⏎ ")}\` | \`${entry.right.join(" ⏎ ")}\` | ${entry.note} |`,
  );
  return [
    `| Page | The OCR text | What the scan prints | How it was checked |`,
    `| --- | --- | --- | --- |`,
    ...rows,
    ``,
    `Scans: ${pageUrl} (replace the leaf number in the URL to open another page).`,
  ].join("\n");
}
