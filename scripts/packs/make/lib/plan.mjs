// What the pack contains, and where each article comes from.
//
// The structure answers Luka's ask — mending clothes, making candles and soap,
// simple tools and their care, clay and fire — and stops where the Survival pack
// already is: FM 21-76's chapter 12 (clay pots, utensils, cordage) and its fire
// and shelter chapters are that pack's, so nothing here is cut from them. What
// is here instead is the material the Armed Forces manuals do not carry: the
// Department of Agriculture's home-economics bulletins on mending, a 1940
// circular on candles, a 1919 needlework book, a 1914 carpentry course, a 1922
// pottery course, a 1922 soap manual's materials chapters, and the Wikibooks
// pages that say a thing better than a 1919 page can — each in its own labelled
// chapter, because those are CC BY-SA and the share-alike boundary is a folder.
//
// An article is a SPAN OF THE SOURCE between two of the source's own printed
// headings, found by their text. Nothing here is a page number: a span that
// follows the source's words survives a re-print, and a heading that cannot be
// found stops the build instead of quietly shifting every article after it. The
// text between two spans is not shipped, which is how the omissions this pack
// documents happen.

/** One article: an id, the title the table of contents draws it under, and where it starts. */
function article(id, title, source, options = {}) {
  return { id, title, source, ...options };
}

/** One article of a whole-document source (an OCR bulletin): the document is the article. */
const whole = (id, title, source) => article(id, title, source);

/** One article of a Wikibooks page: the page is the article. */
const page = (id, title, source) => article(id, title, source);

/** One chapter of an HTML book: from `heading` to the next heading of its own level. */
const chapter = (id, title, source, heading, options = {}) =>
  article(id, title, source, { at: heading, ...options });

export const PLAN = [
  {
    id: "01-mending",
    title: "Mending clothes",
    children: [
      whole("abcs-of-mending", "ABC's of Mending", "farmers-bulletin-1925"),
      whole("mending-mens-suits", "Mending Men's Suits", "miscellaneous-publication-482"),
      chapter("darning", "Darning", "textiles-and-clothing", "DARNING"),
      chapter("patching", "Patching", "textiles-and-clothing", "PATCHING"),
      chapter("repairing", "Repairing", "textiles-and-clothing", "REPAIRING"),
      chapter(
        "to-re-sole-cashmere-stockings",
        "To Re-sole Cashmere Stockings",
        "needlework-economies",
        "To Re-sole Cashmere Stockings.",
      ),
      chapter("re-footing-made-easy", "Re-footing Made Easy", "needlework-economies", "Re-footing made Easy."),
      chapter(
        "how-to-re-heel-a-worn-sock",
        "How to Re-heel a Worn Sock",
        "needlework-economies",
        "How to Re-heel a Worn Sock.",
      ),
      chapter("mending-a-mans-shirt", "Mending a Man's Shirt", "needlework-economies", "Mending a Man\u2019s Shirt."),
      chapter("mending-a-collar", "Mending a Collar", "needlework-economies", "Mending a Collar."),
      chapter(
        "utilizing-partly-worn-garments",
        "Utilizing Partly-Worn Garments",
        "needlework-economies",
        "Utilizing Partly-Worn Garments.",
      ),
      chapter(
        "the-wisdom-of-preventive-mending",
        "The Wisdom of Preventive Mending",
        "needlework-economies",
        "The Wisdom of Preventive Mending.",
      ),
      chapter("mending-a-sheet", "Mending a Sheet", "needlework-economies", "Mending a Sheet."),
      chapter("repairing-table-linen", "Repairing Table Linen", "needlework-economies", "Repairing Table Linen."),
      chapter(
        "to-finish-the-hems-of-blankets",
        "To Finish the Hems of Blankets",
        "needlework-economies",
        "To Finish the Hems of Blankets.",
      ),
    ],
  },
  {
    id: "02-candles-and-soap",
    title: "Candles and soap",
    children: [
      whole("candle-making", "Candle Making", "acs-27-candle-making"),
      chapter("what-soap-is", "What Soap Is", "soap-making-manual", "SAPONIFICATION DEFINED."),
      chapter("fats-and-oils", "Fats and Oils", "soap-making-manual", "FATS AND OILS USED IN SOAP MANUFACTURE.", {
        until: "FOOTNOTES:",
      }),
      chapter("the-alkalies", "The Alkalies", "soap-making-manual", "ALKALIS.", {
        until: "ADDITIONAL MATERIAL USED IN SOAP MAKING.",
      }),
      chapter("other-materials", "Other Materials", "soap-making-manual", "ADDITIONAL MATERIAL USED IN SOAP MAKING.", {
        until: "FOOTNOTES:",
      }),
    ],
  },
  {
    id: "03-tools-and-wood",
    title: "Tools and wood",
    children: [
      chapter("tools-and-their-uses", "Tools and Their Uses", "carpentry-for-boys", "CHAPTER I"),
      chapter("how-to-grind-and-sharpen-tools", "How to Grind and Sharpen Tools", "carpentry-for-boys", "CHAPTER II"),
      chapter("the-best-woods-for-the-beginner", "The Best Woods for the Beginner", "carpentry-for-boys", "CHAPTER XIII"),
      chapter("useful-articles-to-make", "Useful Articles to Make", "carpentry-for-boys", "CHAPTER XVII"),
    ],
  },
  {
    id: "04-clay-and-fire",
    title: "Clay and fire",
    children: [
      chapter(
        "the-nature-and-properties-of-clay",
        "The Nature and Properties of Clay",
        "potters-craft",
        "CHAPTER IV The Nature and Properties of Clay",
      ),
      chapter(
        "the-preparation-of-the-clay",
        "The Preparation of the Clay",
        "potters-craft",
        "CHAPTER V The Preparation of the Clay",
      ),
      chapter("building-by-hand", "Building by Hand", "potters-craft", "CHAPTER VIII Building by Hand"),
      chapter("the-fire", "The Fire", "potters-craft", "CHAPTER XVII The Fire", {
        drop: [
          {
            // The edition hard-wraps its paragraphs, so every space in the
            // sentence is a run of whitespace in the bytes being edited.
            pattern:
              /The kiln having arrived\s+it is mounted on the platform\s+and the asbestos-lined pipe is securely connected\s+with the chimney\.\s*/,
            reason:
              "The chapter's kiln is joined to its chimney with an asbestos-lined pipe. Asbestos belongs in no pack, and leaving this one sentence out costs the chapter nothing: what it says about fuelling, stacking and drawing a kiln is either side of it.",
          },
        ],
      }),
    ],
  },
  {
    id: "05-wikibooks",
    title: "Wikibooks pages (CC BY-SA 4.0)",
    children: [
      page("hand-sewing", "Hand Sewing", "wikibooks-hand-sewing"),
      page("sharpening", "Sharpening", "wikibooks-sharpening"),
      page("candlemaking", "Candlemaking", "wikibooks-candlemaking"),
    ],
  },
];

/**
 * What must not appear in an article this pack ships.
 *
 * Expressed as patterns over the whole article, because a rule that fires is a
 * refusal to ship that article, and `docs/packs/make.md` lists what it fired on.
 * The rules are the materials an old manual reaches for and a home workshop
 * cannot: lead in a glaze, asbestos, arsenic, mercury, hydrofluoric acid. The
 * lead rule names lead's compounds and not the word `lead`, because a pottery
 * chapter says `leads to` on most of its pages and a rule that fired on those
 * would fire on everything.
 */
export const FORBIDDEN = [
  {
    id: "lead",
    pattern:
      /\b(?:white lead|red lead|litharge|sugar of lead|lead glaze|leaded glaze|lead oxide|lead poisoning|lead carbonate|lead sulphide)\b/i,
  },
  { id: "asbestos", pattern: /\basbestos\b/i },
  { id: "arsenic", pattern: /\b(?:arsenic|arsenate|arsenical|paris green)\b/i },
  { id: "mercury", pattern: /\b(?:mercury|mercuric|mercurous|corrosive sublimate|calomel)\b/i },
  { id: "hydrofluoric-acid", pattern: /\b(?:hydrofluoric|fluoric acid)\b/i },
  // A dose with a drug unit beside it: what a person cannot act on out of the
  // book that wrote it, and the shape the Survival pack's own rule bans.
  { id: "drug-dose", pattern: /\b\d+(?:[.,]\d+)?\s?(?:mg|milligram|mcg|microgram|IU|tablets?|capsules?)\b/i },
];

/**
 * What was left out on purpose, and why. Each entry is checked against the
 * source it names (`heading` must really be there), so this list cannot drift
 * away from the pack: a source that changed enough for an omission to be
 * meaningless stops the build rather than shipping a stale claim.
 */
export const OMISSIONS = [
  {
    id: "soap-plant",
    source: "soap-making-manual",
    heading: "CHAPTER II Construction and Equipment of a Soap Plant",
    reason:
      "A factory's plant and machinery. The pack ships what soap is made of and no procedure at all: every procedure in this manual dissolves caustic soda the way a soap works does, with fittings and labour for it, and the source carries no safe-handling instructions for a kitchen.",
  },
  {
    id: "soap-methods",
    source: "soap-making-manual",
    heading: "CHAPTER III Classification of Soap-Making Methods",
    reason:
      "Full-boiled, cold and carbonate saponification, left out for the same reason as the plant: caustic lye handled at works scale.",
  },
  {
    id: "soap-glycerine",
    source: "soap-making-manual",
    heading: "CHAPTER V Glycerine Recovery",
    reason: "Industrial chemistry; its reagents and apparatus are a works'.",
  },
  {
    id: "soap-analysis",
    source: "soap-making-manual",
    heading: "CHAPTER VI Analytical Methods",
    reason: "A laboratory's methods, with the reagents and the apparatus a laboratory has.",
  },
  {
    id: "soap-standard-methods",
    source: "soap-making-manual",
    heading: "CHAPTER VII Standard Methods for the Sampling and Analysis of Commercial Fats and Oils",
    reason: "The same, for fats and oils bought by the tank car.",
  },
  {
    id: "lead-glazes",
    source: "potters-craft",
    heading: "CHAPTER XV Glazes and Glazing",
    reason:
      "Lead glazes. Its recipes are the historic practice — white lead, litharge, red lead — and lead in a glaze is poison in a workshop that fires pots by hand; the pack ships how a pot is made and how it is fired, and no glaze recipe at all.",
  },
  {
    id: "pottery-casting",
    source: "potters-craft",
    heading: "CHAPTER XIII Casting",
    reason:
      "Slip casting and plaster work: the work of a pottery rather than of a workshop at home, and its material is fine plaster dust.",
  },
];
