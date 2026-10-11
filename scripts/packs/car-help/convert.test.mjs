// The converters' tests, on fixtures cut from the real sources (see
// `fixtures/README.md` for where each byte and each box came from).
//
// Every expected value below is either the source's own text, a hand-checked
// value from the scan, or a hand calculation written out beside it — never
// „something came back".

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { firstDifference, plainText, stripMarkup, toMarkdown } from "./blocks.mjs";
import { articleOf, fidelity, loadSource } from "./build.mjs";
import {
  applyCorrections,
  applyPageCorrections,
  CORRECTIONS,
  correctionsFor,
  correctionsTable,
} from "./corrections.mjs";
import { articleHtml, articleText, htmlParse, sliceEntries } from "./html.mjs";
import { assertFurnitureOnly, normalisePage, parseDjvu, toBlocks } from "./ocr.mjs";
import { SECTIONS } from "./plan.mjs";
import { collapse } from "./text.mjs";

const FIXTURES = join(import.meta.dirname, "fixtures");
const read = (name) => readFileSync(join(FIXTURES, name), "utf8");
const VOCABULARY = ["FM 21-305/AFMAN 24-306"];

/** The battery article's plan entry, which is the span this fixture was cut for. */
const JUMP_STARTING = SECTIONS.find((section) => section.id === "battery").articles[0];

describe("parseDjvu", () => {
  // Two pages, hand-written, so the parser's own rules are the only thing under
  // test: a page's width and height, the words of a line in the order the
  // extractor read them, and the boxes those words occupy.
  const xml = [
    "<OBJECT width=\"200\" height=\"300\">",
    "<PARAM name=\"PAGE\" value=\"a.djvu\"/>",
    "<HIDDENTEXT><PAGECOLUMN><REGION><PARAGRAPH>",
    "<LINE><WORD coords=\"10,40,60,10\">Hello</WORD><WORD coords=\"70,40,120,8\">there</WORD></LINE>",
    "<LINE><WORD coords=\"10,80,40,50\">21-4</WORD></LINE>",
    "</PARAGRAPH></REGION></PAGECOLUMN></HIDDENTEXT>",
    "</OBJECT>",
    "<OBJECT width=\"100\" height=\"150\">",
    "<HIDDENTEXT><PAGECOLUMN><REGION><PARAGRAPH>",
    "<LINE><WORD coords=\"5,20,25,5\">A&amp;B</WORD></LINE>",
    "</PARAGRAPH></REGION></PAGECOLUMN></HIDDENTEXT>",
    "</OBJECT>",
  ].join("");

  it("reads one page per OBJECT, with each line's words and box", () => {
    const pages = parseDjvu(xml);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toMatchObject({ leaf: 0, width: 200, height: 300 });
    // "Hello" spans y 10..40 and "there" y 8..40, so the line's box is 8..40.
    expect(pages[0].lines[0]).toEqual({ text: "Hello there", x: 10, right: 120, top: 8, bottom: 40, height: 32 });
    expect(pages[1].lines[0].text).toBe("A&B");
  });
});

/** The FM 21-305 page 17-4 fixture, normalised and corrected, as the builder loads it. */
function fixtureDocument() {
  const fixture = JSON.parse(read("fm-21-305-17-4.json"));
  const page = {
    leaf: fixture.leaf,
    width: fixture.width,
    height: fixture.height,
    label: null,
    lines: fixture.lines,
  };
  const result = normalisePage(page, { vocabulary: VOCABULARY });
  const loaded = new Map([[page.leaf, { leaf: page.leaf, label: result.label, lines: result.lines }]]);
  applyPageCorrections([...loaded.values()][0], "fm-21-305");
  return {
    document: { kind: "ocr", pages: loaded, source: { id: "fm-21-305" } },
    dropped: result.dropped,
    label: result.label,
  };
}

describe("the FM 21-305 page 17-4 fixture", () => {
  it("finds the printed page label and drops only the page's own furniture", () => {
    const { dropped, label } = fixtureDocument();
    expect(label).toBe("17-4");
    // Measured on the fixture: the running head at 39 pixels from the top and
    // the printed page number at 138 from the bottom, and nothing else.
    expect(dropped.map((line) => line.text)).toEqual(["FM 21-305/AFMAN 24-306", "17-4"]);
    expect(dropped.every((line) => line.rule === "named")).toBe(true);
  });

  it("folds the sixteen printed bullets without touching a word of their text", () => {
    const fixture = JSON.parse(read("fm-21-305-17-4.json"));
    const { lines } = normalisePage(
      { leaf: fixture.leaf, width: fixture.width, height: fixture.height, label: null, lines: fixture.lines },
      { vocabulary: VOCABULARY },
    );
    const bullets = lines.filter((line) => line.bullet === true);
    expect(bullets).toHaveLength(16);
    // The scan prints one bullet glyph for every one of the sixteen; the OCR
    // read it as `e` fifteen times and as `@` once.
    expect(bullets.map((line) => line.text).slice(0, 3)).toEqual([
      "Apply the foot brake.",
      "Select the proper transmission lever position —",
      "Place the transfer shift lever in the appropriate",
    ]);
    expect(bullets.map((line) => line.text)).toContain("Stop the engine of the jump starting vehicle.");
    expect(bullets.map((line) => line.text)).toContain("Remove jumper cables (2) and (5).");
  });

  it("applies the page's four corrections and leaves the OCR's errors gone", () => {
    const { document } = fixtureDocument();
    const page = [...document.pages.values()][0];
    const texts = page.lines.map((line) => line.text);
    const entries = correctionsFor("fm-21-305").filter((entry) => entry.page === "17-4");
    expect(entries).toHaveLength(4);
    // Every corrected line is on the page, and no line the table names as wrong
    // is: the table is what changed the text, and it changed all of it.
    for (const entry of entries) {
      for (const line of entry.right) expect(texts).toContain(line);
      // A line the correction keeps is in both lists (the reordered box keeps
      // its first line), so only the lines it replaced have to be gone.
      for (const line of entry.wrong) {
        if (!entry.right.includes(line)) expect(texts).not.toContain(line);
      }
    }
    // The two corrections the acceptance names, read off the scan: the page says
    // "safety" where the OCR read "arall", and "jump" where it read "jum"/"ump".
    expect(texts).toContain("responsible for the safety of your troops, both on and");
    expect(texts).toContain("connect the negative terminal of the jump");
    expect(texts).toContain("terminal (1) of the jump starting vehicle and the");
    // The box's second column came back out of order; the correction puts the
    // sentence back in the order the scan prints it (the line-end hyphens are
    // joined later, when the lines become blocks).
    expect(texts).toContain("minals. Failure to do so may cause");
    expect(texts.join(" ")).not.toContain("or ter- ailure");
  });

  it("builds the article the plan asks for, and its fidelity holds", () => {
    const { document } = fixtureDocument();
    const article = articleOf(JUMP_STARTING, document);
    expect(article.blocks.map((block) => block.kind)).toEqual([
      "heading",
      "paragraph",
      "heading",
      "paragraph",
      "list",
      "heading",
      "paragraph",
      "list",
      "heading",
      "paragraph",
      "list",
    ]);
    expect(article.blocks[2]).toEqual({ kind: "heading", level: 2, text: "Using Jumper Cables to Start Engine" });
    expect(article.blocks[3].text).toBe(
      "Use the following procedure to start an engine using jumper cables on a 12-volt system (Figure 17-1):",
    );
    expect(article.blocks[4].items).toEqual([
      "Position the jump starting vehicle with batteries opposite the batteries of the disabled vehicle.",
      "Stop the engine of the jump starting vehicle.",
      "Open battery compartment doors of both vehicles. Pull both battery boxes onto running boards.",
    ]);
    expect(article.blocks[5].text).toBe("WARNING");
    const markdown = fidelity(article);
    expect(markdown).toContain("- Clamp one jumper cable (2) to the positive terminal (1) of the jump starting vehicle");
    // The hyphen the compositor broke "terminals" with is joined once the lines
    // are a paragraph, and the box's two sentences read in the scan's order.
    expect(article.sourceText).toContain(
      "clamps or terminals. Failure to do so may cause batteries to explode, injuring or killing personnel.",
    );
    // One article, one paragraph per box, and every line of the page between
    // them: the source text is the page's own words, collapsed.
    expect(article.sourceText).toContain("Start the engine of the disabled vehicle. If the engine does not start");
    expect(article.sourceText.endsWith("Remove jumper cables (2) and (5).")).toBe(true);
  });
});

describe("the OCR block builder", () => {
  const line = (text, top, options = {}) => ({ text, x: 50, right: 900, top, bottom: top + 30, height: 30, ...options });

  it("splits a paragraph where the gap is wider than the leading", () => {
    // Leading 48 pixels; the second paragraph starts 96 below the first, which
    // is two lines' worth of white space on the page.
    const blocks = toBlocks([line("First line", 100), line("second line.", 148), line("New paragraph", 244)], {});
    expect(blocks).toEqual([
      { kind: "paragraph", text: "First line second line." },
      { kind: "paragraph", text: "New paragraph" },
    ]);
  });

  it("joins a word the compositor broke at a line end", () => {
    const blocks = toBlocks([line("the injur-", 100), line("ing or killing personnel.", 148)], {});
    expect(blocks[0].text).toBe("the injuring or killing personnel.");
  });

  it("refuses a declared heading the source does not print", () => {
    expect(() => toBlocks([line("Something else", 100)], { declared: ["Highway Warning Kit"] })).toThrow(
      /the source does not print/,
    );
  });

  it("refuses a margin band that would drop a line of prose", () => {
    expect(() =>
      assertFurnitureOnly([{ text: "this reads like a sentence and is therefore a refusal", rule: "margin-band" }], "fm"),
    ).toThrow(/reads like prose/);
    expect(() =>
      assertFurnitureOnly([{ text: "17-4", rule: "named" }], "fm", ["FM 21-305/AFMAN 24-306"]),
    ).not.toThrow();
  });
});

describe("the corrections table", () => {
  /**
   * One page per leaf the table names, carrying exactly the OCR text the table
   * says is wrong. It is not a copy of any real page — it is the table read
   * back — so applying the table to it must succeed and leave the corrected
   * text behind.
   */
  function tablePages(source) {
    const byLeaf = new Map();
    for (const entry of correctionsFor(source)) {
      const page = byLeaf.get(entry.leaf) ?? { leaf: entry.leaf, label: entry.page, lines: [] };
      for (const text of entry.wrong) page.lines.push({ text, x: 0, right: 1, top: 0, bottom: 1, height: 1 });
      byLeaf.set(entry.leaf, page);
    }
    return [...byLeaf.values()];
  }

  it("applies every entry of the table to the text the table says is there", () => {
    for (const source of ["fm-21-305", "tm-9-8000"]) {
      const pages = tablePages(source);
      applyCorrections(pages, source);
      const text = pages.flatMap((page) => page.lines.map((line) => line.text)).join(" ");
      for (const entry of correctionsFor(source)) {
        expect(text).toContain(entry.right[0]);
      }
    }
  });

  it("has a page, a wrong text, a right text and a note for every entry", () => {
    expect(CORRECTIONS.length).toBeGreaterThan(20);
    for (const entry of CORRECTIONS) {
      expect(entry.wrong.length).toBeGreaterThan(0);
      expect(entry.right.length).toBeGreaterThan(0);
      expect(entry.page).toMatch(/^\d{1,2}-\d{1,2}$/);
      expect(entry.note.length).toBeGreaterThan(20);
    }
  });

  it("refuses a page whose printed label is not the one the table names", () => {
    const pages = tablePages("fm-21-305");
    pages.find((candidate) => candidate.leaf === 62).label = "11-9";
    expect(() => applyCorrections(pages, "fm-21-305")).toThrow(/leaf 62 is page "11-9"/);
  });

  it("refuses an entry whose OCR text is no longer on its page", () => {
    const pages = tablePages("fm-21-305");
    const page = pages.find((candidate) => candidate.leaf === 91);
    page.lines = page.lines.map((item) => ({ ...item, text: item.text.replace("arall", "safety") }));
    expect(() => applyCorrections(pages, "fm-21-305")).toThrow(/is not on the page/);
  });

  it("refuses a source whose pages no longer include one the table names", () => {
    expect(() => applyCorrections([{ leaf: 91, label: "17-4", lines: [] }], "fm-21-305")).toThrow(/has no leaf 62/);
  });

  it("renders the table the document prints, one row per entry", () => {
    const table = correctionsTable("fm-21-305", "https://example.invalid/<leaf>.jpg");
    expect(table.split("\n").filter((row) => row.startsWith("| 1"))).toHaveLength(
      correctionsFor("fm-21-305").length,
    );
  });
});

describe("the HTML converter", () => {
  it("reads the page's own article element, counting nested ones", () => {
    const html = "<html><article class=\"outer\"><p>One</p><article><p>Two</p></article></article><p>Three</p></html>";
    const region = articleHtml(html);
    expect(region).toBe("<article class=\"outer\"><p>One</p><article><p>Two</p></article></article>");
    expect(articleText(region)).toContain("One");
    expect(articleText(region)).toContain("Two");
    expect(articleText(region)).not.toContain("Three");
  });

  it("skips a classed element whole, nesting and all", () => {
    const html = "<div class=\"carousel slide\"><div><span>562</span></div></div><p>Kept</p>";
    const { text, entries } = htmlParse(html, { skipClasses: ["carousel"] });
    expect(text).not.toContain("562");
    expect(entries.map((entry) => entry.block.text)).toEqual(["Kept"]);
  });

  it("decodes an entity where the text enters, so every offset still points at its own block", () => {
    const { text, entries } = htmlParse("<p>before&nbsp;an emergency</p><h2>Next</h2><p>After</p>");
    expect(text).toContain("before an emergency");
    for (const entry of entries) {
      const block = entry.block;
      const own = block.kind === "list" ? block.items.join(" ") : block.text;
      expect(collapse(text.slice(entry.start, entry.end))).toBe(collapse(own));
    }
  });

  it("converts the NHTSA 'Tire Blowouts' fixture and reads it back the same", () => {
    const { text, entries } = htmlParse(read("nhtsa-tires-blowouts.html"));
    const blocks = entries.map((entry) => entry.block);
    expect(blocks[0]).toEqual({ kind: "heading", level: 2, text: "Tire Blowouts" });
    expect(blocks[1].text.startsWith("A tire blowout is a rapid loss of tire air pressure")).toBe(true);
    const list = blocks.find((block) => block.kind === "list");
    expect(list.items).toEqual([
      "Hold the steering wheel with both hands.",
      "Maintain your vehicle speed if possible and if it\u2019s safe to do so.",
      "Gradually release the accelerator.",
      "Correct the steering as necessary to stabilize your vehicle and regain control. Look where you want the vehicle to go and steer in that direction.",
      "Once your vehicle has stabilized, continue to slow down and pull off the road where and when you judge it\u2019s safe to do so.",
    ]);
    // The converter changed markup and nothing else: the whole fixture's words
    // are in the blocks, and the blocks contain nothing else.
    expect(collapse(plainText(blocks))).toBe(collapse(text));
    expect(collapse(stripMarkup(toMarkdown(blocks)))).toBe(collapse(text));
  });

  it("keeps an h4 below an h2, and a two-space list item's own text, in the pressure fixture", () => {
    const { entries } = htmlParse(read("nhtsa-tires-pressure.html"));
    const blocks = entries.map((entry) => entry.block);
    expect(blocks[0]).toEqual({ kind: "heading", level: 2, text: "Maintaining Proper Tire Pressure" });
    expect(blocks[1]).toEqual({
      kind: "heading",
      level: 3,
      text: "Follow these tire pressure steps\u2014they're the most important part of maintaining your tires:",
    });
    const steps = blocks.find((block) => block.kind === "list");
    expect(steps.items[0]).toBe(
      "Step 1: Locate the recommended tire pressure on the Tire and Loading Information Labels on the driver's side door edge or post or in the owner's manual. (Remember, the correct pressure for your tire is what the vehicle manufacturer has listed, NOT what is listed on the tire itself.)",
    );
    expect(steps.items).toHaveLength(5);
  });

  it("converts the Ready.gov kit fixture, and drops the page's hidden image label", () => {
    const { text, entries } = htmlParse(read("ready-car-kit.html"), { skipClasses: ["visually-hidden"] });
    const blocks = entries.map((entry) => entry.block);
    expect(blocks.map((block) => block.kind)).toEqual(["heading", "paragraph", "list", "heading", "paragraph", "list"]);
    expect(blocks[0].text).toBe("Emergency Kit for the Car");
    expect(blocks[2].items).toEqual([
      "Jumper cables",
      "Flares or reflective triangle",
      "Ice scraper",
      "Car cell phone charger",
      "Blanket",
      "Map",
      "Cat litter or sand (for better tire traction)",
    ]);
    expect(blocks[5].items).toEqual([
      "Antifreeze levels",
      "Battery and ignition system",
      "Brakes",
      "Exhaust system",
      "Fuel and air filters",
      "Heater and defroster",
      "Lights and flashing hazard lights",
      "Oil",
      "Thermostat",
      "Windshield wiper equipment and washer fluid level",
    ]);
    expect(text).not.toContain("Image");
    expect(collapse(stripMarkup(toMarkdown(blocks)))).toBe(collapse(text));
  });

  it("slices a fixture between two headings, and refuses a heading the page does not print", () => {
    const { entries } = htmlParse(read("nhtsa-tires-pressure.html"));
    const slice = sliceEntries(entries, {
      from: "Maintaining Proper Tire Pressure",
      to: "Follow these tire pressure steps\u2014they're the most important part of maintaining your tires:",
    });
    expect(slice.entries).toHaveLength(1);
    expect(slice.entries[0].block.text).toBe("Maintaining Proper Tire Pressure");
    expect(() => sliceEntries(entries, { from: "Tire Blowouts" })).toThrow(/no heading/);
  });
});

describe("fidelity", () => {
  const article = (blocks, sourceText) => ({ id: "probe", blocks, sourceText });

  it("passes when the Markdown is the span's own words", () => {
    const blocks = [{ kind: "heading", level: 2, text: "Title" }, { kind: "list", items: ["One.", "Two."] }];
    expect(() => fidelity(article(blocks, "Title One. Two."))).not.toThrow();
    expect(toMarkdown(blocks)).toBe("## Title\n\n- One.\n- Two.\n");
  });

  it("fails when a word is dropped", () => {
    const blocks = [{ kind: "paragraph", text: "Two words" }];
    expect(() => fidelity(article(blocks, "Two words here"))).toThrow(/the article and the source span disagree/);
  });

  it("fails when two words change places", () => {
    const blocks = [{ kind: "paragraph", text: "second first" }];
    expect(() => fidelity(article(blocks, "first second"))).toThrow(/differ at 0/);
  });

  it("fails when the Markdown is not what the blocks say", () => {
    const blocks = [{ kind: "paragraph", text: "kept" }, { kind: "paragraph", text: "lost" }];
    const markdown = toMarkdown(blocks).replace("lost", "");
    expect(collapse(stripMarkup(markdown))).not.toBe(collapse(plainText(blocks)));
    expect(firstDifference("a b", "a c")).toBe('differ at 2: "b"');
  });
});

describe("loading a whole source", () => {
  it("takes the page's article element out of a full response, and nothing outside it", () => {
    const html = `<html><body><nav>Menu</nav><article>${read("nhtsa-tires-blowouts.html")}</article><footer>Footer</footer></body></html>`;
    const document = loadSource({ id: "nhtsa-tires", kind: "html", skipClasses: [] }, Buffer.from(html, "utf8"));
    expect(document.kind).toBe("html");
    expect(document.text).not.toContain("Menu");
    expect(document.text).not.toContain("Footer");
    expect(document.entries[0].block.text).toBe("Tire Blowouts");
    // `plain` is the WHOLE page's text, because that is what a licence quote is
    // checked against: the licence is a property of the page, not of the span.
    expect(document.plain).toContain("Footer");
  });

  it("refuses a page with no article element to read", () => {
    expect(() => loadSource({ id: "nhtsa-tires", kind: "html", skipClasses: [] }, Buffer.from("<p>No</p>"))).toThrow(
      /no <article> element/,
    );
  });
});
