// The normaliser: the exact, listed set of repairs that undo what PDF
// extraction does to a page's text, and nothing else.
//
// WHY IT EXISTS, AND WHY IT IS SO NARROW. The pack ships the source's own words
// (see `docs/packs/survival.md`), and the fidelity test proves it: the
// converter's Markdown, with its markup stripped and whitespace collapsed, is
// the source span with whitespace collapsed. A repair in here therefore moves
// BOTH sides of that test, which is what makes a repair safe to write down â€”
// and also why every rule is a rule about extraction, never about meaning.
//
// The rules are the four the brief allows and no more:
//
//   R1  glyph mapping    a glyph the extraction keeps as one character that is
//                        not the character the reader sees. Two instances, one
//                        rule: a ligature (`ï¬ï¬‚ï¬ƒ` for the letters it draws)
//                        and the sources' Symbol-font bullet, which comes back
//                        as a lone `z` in front of every list item.
//   R2  letter spacing   a heading the source sets with tracking comes back as
//                        `F O O D  P R O C U R E M E N T`.
//   R3  running heads    and page numbers: the same furniture repeated at the
//                        top and the bottom of every page, which is a fact
//                        about the page, not about the section (see
//                        {@link MARGIN_BAND}).
//   R4  line-end hyphen  `contamina-\ntion` is one word the compositor broke.
//   R5  invisible runs   text the page does not draw. The ATP 4-02.11 is a Word
//                        export whose headings carry the Word bookmark label as
//                        a run drawn at a point of an eleven-point heading
//                        (`322B`, measured height 1.0 against 11.0; the page
//                        renders without it), and without this rule every
//                        heading of that source ships with `322B` glued to its
//                        first word. The brief names four families of repair
//                        and this is a fifth; `docs/packs/survival.md` says so
//                        and says why.
//
// Nothing here rewrites a word, fixes an OCR slip, or "cleans up" grammar. A
// malformed run that is not one of the four (the ATP's cover date, whose font
// prints `6HSWHPEHU` for `SEPTEMBER`) is left exactly as extracted â€” it is
// furniture, so R3 removes it from the text, but the rule that removes it is
// the margin, never a guess about which letters it "meant".

/**
 * Ligature glyphs, and the non-breaking space, which is whitespace.
 *
 * Nothing else is in this table on purpose. Typographic punctuation (`â€™`, `â€”`)
 * is what the source PRINTS, so it stays exactly as it is; folding it to ASCII
 * would be the pack editing the source rather than undoing an extraction.
 */
export const LIGATURES = new Map([
  ["\uFB00", "ff"],
  ["\uFB01", "fi"],
  ["\uFB02", "fl"],
  ["\uFB03", "ffi"],
  ["\uFB04", "ffl"],
  ["\uFB05", "st"],
  ["\uFB06", "st"],
  ["\u00A0", " "],
]);

/**
 * R1 (c). A control character is not a character.
 *
 * Measured: the ATP's running footers carry the mis-decoded glyphs of their
 * broken font as `U+0003`, `U+0014` and `U+001B`, so a footer line reads
 * `2-6 ATP 3-50.21 \u0003\u0014\u001B6HSWHPEHU...` and neither the running-head
 * vocabulary nor a reader can recognise it. The reader sees spaces there, and
 * the replacement is what lets the furniture rule see them too; the same
 * characters would otherwise ship inside an article, where they are invisible
 * and hostile to anything that copies the text out.
 */
export function foldControlCharacters(text) {
  // eslint-disable-next-line no-control-regex -- the pattern IS the control characters.
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ");
}

/**
 * R1 (a). Every ligature glyph becomes the letters it draws; a non-breaking
 * space becomes a space. Applied before anything looks at the text, so a heading
 * cannot be missed because it carries a `ï¬` where the reader sees `ï¬‚`.
 */
export function foldLigatures(text) {
  let folded = "";
  for (const character of text) folded += LIGATURES.get(character) ?? character;
  return folded;
}

/**
 * R2. A tracked heading comes back with a space between every letter. The
 * repair is a property of the SHAPE of the line (single characters, single
 * spaces, at least three of them), never of a word list: `F O O D` collapses,
 * an ordinary sentence with a stray double space does not.
 */
export function foldLetterSpacing(text) {
  // A wider gap is a word boundary: `F O O D  P R O C U R E M E N T` is two
  // words the compositor tracked out, and closing the gap between them would
  // invent a word the source does not have.
  const words = text.trim().split(/\s{2,}/);
  const joined = [];
  for (const word of words) {
    const letters = word.split(/\s+/).filter((part) => part !== "");
    if (letters.length < 2) return text;
    for (const part of letters) {
      if (!/^[A-Za-z0-9&.,:'"()-]$/.test(part)) return text;
    }
    joined.push(letters.join(""));
  }
  return joined.join(" ");
}

/**
 * R3. How much of a page is margin.
 *
 * `top` is where every source in this pack prints its running head: measured,
 * the closest body line to the top of a page is 53 points down (FEMA's guide,
 * page 8) and the furniture sits between 21 and 45 points down, so 50 is the
 * band that separates them. `bottom` is much smaller, because the Army manuals
 * print body text as close as 42 points to the bottom edge while their page
 * labels sit between 14 and 44 (FM 21-76 page B-8's label is 25 points up, its
 * text reaches 42) â€” the bottom is handled by the page-label pattern and
 * {@link FURNITURE_STRIP} instead, and the band is only the last resort for a
 * label the pattern cannot name.
 */
export const MARGIN_BAND = { top: 50, bottom: 22 };
/** How far into the page a line may sit and still be named as furniture by its text. */
export const FURNITURE_STRIP = { top: 80, bottom: 65 };

/** A page label: `2-6`, `B-8`, `A-1`, `Glossary-1`, `43`, `iv`, `E-27`. */
export const PAGE_LABEL = /^(?:[A-Z][a-z]+-\d{1,3}|[A-Z]{1,2}-\d{1,3}|\d{1,3}(?:-\d{1,3})?|[ivxlc]{1,6})$/;

/** The same labels, anywhere in a line, for the composition rule below. */
const PAGE_LABEL_ANYWHERE = /(?:^|\s)(?:[A-Z][a-z]+-\d{1,3}|[A-Z]{1,2}-\d{1,3}|\d{1,3}(?:-\d{1,3})?|[ivxlc]{1,6})(?=\s|$)/g;

/** R5. Under two points a run cannot be read at arm's length. */
export const INVISIBLE_SIZE = 2;

/**
 * R1 (b). The bullet glyph, as the sources' Symbol font hands it over.
 *
 * The ATP sets every list item's bullet in a symbol font whose encoding maps
 * the glyph onto `z`, so the extraction produces `z Look for the chest to rise
 * and fall.` The `z` is a bullet drawn as a character, which is the same kind
 * of fact as a ligature: the reader sees a marker, not a letter. The repair
 * moves it into `bullet: true` and out of the text â€” it has to leave the TEXT
 * rather than the Markdown, or the fidelity test (whose source side is this
 * normaliser) would see the converter delete a character.
 */
const BULLET_GLYPH = /^(?:z|[â€¢Â·â—¦â–ª])\s+/;

export function foldBulletGlyph(text) {
  const match = BULLET_GLYPH.exec(text);
  if (match === null) return { text, bullet: false };
  return { text: text.slice(match[0].length), bullet: true };
}

/**
 * The tokens a page's furniture is made of, each named so that a dropped line
 * can be traced back to the rule that dropped it. `publication` is the
 * publication's own number (`ATP 3-50.21`), `date` is its date as extracted
 * (the ATP's broken cover font prints `6HSWHPEHU` for `SEPTEMBER`, and the line
 * is furniture whichever letters it carries).
 */
export function isFurniture(text, vocabulary, runningTitle) {
  const trimmed = text.trim();
  if (trimmed === "") return true;
  if (PAGE_LABEL.test(trimmed)) return true;
  for (const token of vocabulary) {
    if (trimmed === token) return true;
  }
  // A running head is a COMPOSITION, and this is the rule that reads it: the
  // publication's own tokens, its page labels, and nothing else. Measured, the
  // ATP's footer is `2-6 ATP 3-50.21 <six mis-decoded glyphs>6HSWHPEHU`, and a
  // rule that only compared the whole line against one token let it through
  // into the water articles.
  if (vocabulary.length > 0) {
    let rest = trimmed;
    for (const token of vocabulary) rest = rest.split(token).join(" ");
    rest = rest.replace(PAGE_LABEL_ANYWHERE, " ");
    if (rest.replace(/[\s:.,;()Â·â€¢\-â€“]/g, "") === "") return true;
  }
  // The last resort for the one source whose text layer sits at an uneven
  // height: a line that carries the book's running title at one end and no more
  // than a few words at the other. Measured on FEMA's guide, both orders occur
  // on one page ("Are You Ready? Winter Storms and Extreme Cold 2.5" and
  // "2.5 Winter Storms and Extreme Cold Are You Ready?").
  if (runningTitle !== undefined && trimmed.includes(runningTitle)) {
    const at = trimmed.indexOf(runningTitle);
    const rest = `${trimmed.slice(0, at)} ${trimmed.slice(at + runningTitle.length)}`.trim();
    if (rest.split(/\s+/).filter((word) => word !== "").length <= 6) return true;
  }
  return false;
}

/**
 * The items of one page whose y is close enough to be one line. `tolerance`
 * absorbs the sub-point differences between runs on a baseline.
 */
export function groupIntoLines(items, tolerance = 2.5) {
  const rows = [];
  for (const item of items) {
    if (typeof item.text !== "string" || item.text.trim() === "") continue;
    const row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= tolerance);
    if (row === undefined) rows.push({ y: item.y, items: [item] });
    else row.items.push(item);
  }
  for (const row of rows) row.items.sort((a, b) => a.x - b.x);
  // Top of the page first: PDF user space counts y upwards, so the highest y is
  // the first line a reader meets.
  rows.sort((a, b) => b.y - a.y);
  return rows.map((row) => ({
    y: row.y,
    x: row.items[0].x,
    ...joinRow(row.items),
  }));
}

/**
 * The text of one line, from its items left to right.
 *
 * A gap of more than a point between two runs is a space the extraction did
 * not hand over as its own item (both sources drop the space glyphs of some
 * fonts); anything closer is the same word split across runs by a kerns or a
 * style change.
 */
function joinRow(items) {
  let text = "";
  let right = null;
  let edge = 0;
  let size = 0;
  for (const item of items) {
    if (right !== null && item.x - right > 1) text += " ";
    // R1 (c) first, so the collapse below sees the spaces the reader sees.
    text += foldControlCharacters(item.text);
    right = item.x + (item.width ?? 0);
    edge = Math.max(edge, right);
    size = Math.max(size, item.size ?? 0);
  }
  return { text: text.replace(/\s+/g, " ").trim(), size, right: edge, items };
}

/**
 * R3 applied to one page: the lines that survive, and the lines that were
 * furniture (each with the rule that took it, which the build prints).
 *
 * `height` is the page's height in points; `vocabulary` is the source's own
 * running-head tokens. A line is furniture when it sits in the margin band, or
 * when it sits in the wider head/foot strip AND is one of the vocabulary
 * tokens â€” the second half is what catches a label on a page whose body text
 * comes closer to the edge than the band.
 */
export function normalisePage(page, options) {
  const band = options.band ?? MARGIN_BAND;
  const visible = [];
  const invisible = [];
  for (const item of page.items ?? []) {
    if ((item.height ?? 0) < INVISIBLE_SIZE) invisible.push(item);
    else visible.push(item);
  }
  const rows = groupIntoLines(visible);
  const kept = [];
  const dropped = invisible.map((item) => ({
    text: item.text,
    rule: "invisible-run",
    fromTop: page.height - item.y,
    fromBottom: item.y,
  }));
  let bareLabel = null;
  let printedLabel = null;
  let numberLabel = null;
  for (const row of rows) {
    const folded = row.text;
    const fromTop = page.height - row.y;
    const fromBottom = row.y;
    const inBand = fromTop <= band.top || fromBottom <= band.bottom;
    const inStrip = fromTop <= FURNITURE_STRIP.top || fromBottom <= FURNITURE_STRIP.bottom;
    const furniture = isFurniture(folded, options.vocabulary, options.runningTitle);
    if (inBand || (inStrip && furniture)) {
      dropped.push({ text: folded, rule: "running-head", fromTop, fromBottom });
      // The page's label, wherever in its furniture it sits: the ATP's footer
      // is one line holding the label, the publication number and the date
      // together. A line that is a label and NOTHING ELSE wins over a number
      // inside somebody else's line â€” the page's own running head "Chapter 2"
      // holds a `2`, and that is not the page's label.
      if (PAGE_LABEL.test(folded.trim())) bareLabel ??= folded.trim();
      else {
        // A match inside somebody else's line is weaker evidence, and the two
        // kinds are not equal: the ATP's running head "Chapter 2" holds a bare
        // `2` and its footer holds the printed label `2-6`, and the printed one
        // is the page's own.
        const found = folded.match(PAGE_LABEL_ANYWHERE)?.[0]?.trim() ?? null;
        if (found !== null && found.includes("-")) printedLabel ??= found;
        else if (found !== null) numberLabel ??= found;
      }
      continue;
    }
    const written = foldBulletGlyph(foldLetterSpacing(foldLigatures(folded)));
    if (written.text.trim() === "") continue;
    kept.push({
      text: written.text,
      bullet: written.bullet,
      size: row.size,
      x: row.x,
      right: row.right,
      y: row.y,
      page: page.index,
      pageHeight: page.height,
    });
  }
  return { lines: kept, dropped, label: bareLabel ?? printedLabel ?? numberLabel };
}

/**
 * A dropped line that reads like prose is a refusal, not a repair.
 *
 * The margin band is a measured claim about where the sources put their
 * furniture, and a claim that silently eats a paragraph is the exact failure
 * mode this check exists for: the build prints what each rule dropped, and an
 * assertion here means a source whose margins moved is a loud failure rather
 * than a section with a sentence missing.
 */
export function assertFurnitureOnly(dropped, sourceId, vocabulary = [], runningTitle) {
  for (const line of dropped) {
    const words = line.text.split(/\s+/).filter((word) => word !== "");
    // A line the source's own furniture rule NAMES is furniture even when it
    // reads like prose: ATP 4-02.11's chapter titles are whole sentences
    // ("Secondary Injury Assessment Using Pain, Antibiotics, ...") printed at
    // the top of every page of the chapter, and FEMA's guide prints "1.3
    // Assemble a Disaster Supplies Kit Are You Ready?" as a running head. What
    // this check refuses is prose dropped by the MARGIN alone, which is the one
    // way a section could lose a sentence without anybody deciding to.
    if (isFurniture(line.text, vocabulary, runningTitle)) continue;
    if (line.text.length > 60 || words.length > 8) {
      throw new Error(
        `${sourceId}: the running-head rule would drop a line that reads like prose: ` +
          `${JSON.stringify(line.text)} (${String(line.fromBottom)} from the bottom)`,
      );
    }
  }
}

/**
 * R4. A line that ends in a hyphen and is followed by a lower-case word is one
 * word the compositor broke. Applied to the joined text of a paragraph, so the
 * repair is visible in one place and the same on both sides of the fidelity
 * test.
 */
export function joinHyphenated(text) {
  return text.replace(/([A-Za-z])-\s+([a-z])/g, "$1$2");
}

/** Whitespace collapsed the one way both sides of the fidelity test use it. */
export function collapse(text) {
  return text.replace(/\s+/g, " ").trim();
}

/** A kebab-case id, unique inside a pack. */
export function slugify(text) {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['â€™]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "entry" : slug.slice(0, 60).replace(/-+$/, "");
}
