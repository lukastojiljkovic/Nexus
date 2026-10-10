import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseHtml, pruneChrome, selectMain, textContent, toMarkdown } from "./lib/html.mjs";
import { normalise, stripMarkup } from "./lib/text.mjs";

/**
 * The federal pages, on a real section of one of them.
 *
 * The fixture is 20 KB cut out of the FSIS page on keeping food safe during an
 * emergency, and the expected sentences below are the page's own — the same two
 * the research run quoted as E51 and E52, which is why they are the ones pinned:
 * a converter that dropped or re-worded them would be dropping or re-wording the
 * figures the whole chapter rests on.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const URL_BASE = "https://www.fsis.usda.gov/food-safety/safe-food-handling-and-preparation/emergencies/keep-your-food-safe-during-emergencies";

const root = parseHtml(readFileSync(join(HERE, "fixtures", "fsis-power-outage.html"), "utf8"));
const main = selectMain(root);
const markdown = toMarkdown(main, { url: URL_BASE });
const text = normalise(stripMarkup(markdown));

describe("the FSIS power-outage page", () => {
  it("finds the article rather than the navigation around it", () => {
    // The page's `main` is 10 907 characters of article inside a 35 942-character
    // document; the fixture's biggest region holds the same text.
    expect(text.length).toBeGreaterThan(8000);
    expect(text).toContain("Keep Your Food Safe During Emergencies");
  });

  it("keeps the four-hour figure, which is the chapter's central instruction", () => {
    expect(text).toContain("The refrigerator will keep food safe for up to 4 hours.");
  });

  it("keeps the freezer figures, both of them", () => {
    expect(text).toContain(
      "A full freezer will hold the temperature for approximately 48 hours (24 hours if it is half full).",
    );
  });

  it("writes the page's headings as headings", () => {
    expect(markdown).toContain("#### Power Outages");
    expect(markdown).toContain("##### Plan Ahead");
  });

  it("writes a bullet list as a bullet list, one item per line", () => {
    expect(markdown).toContain(
      "- Keep an appliance thermometer in both the refrigerator and freezer.",
    );
    expect(markdown).toContain("- Group foods together in both the refrigerator and freezer.");
  });

  it("keeps each list item whole rather than splitting it at the wrap", () => {
    // The page breaks this sentence across two lines; joins are the converter's
    // business and `normalise` is how both sides agree they happened.
    expect(text).toContain(
      "If the power is off longer, you can transfer food to a cooler and fill with ice or frozen gel packs.",
    );
  });

  it("reads the page's own words and nothing else", () => {
    // The whole promise, on real markup: the article's text with its markup
    // stripped is the page's text.
    expect(text).toBe(normalise(textContent(main)));
  });

});

describe("the reader", () => {
  it("drops the chrome a reader does not need, and keeps what is inside it", () => {
    // `pruneChrome` is what the selection is scored on and what is emitted:
    // navigation, asides and footers are not the article — but the class-name
    // rule that used to sit beside the tag rule threw away this page's whole
    // content, because its layout wrapper is called `l-sidebar`.
    const parsed = parseHtml(
      "<main><nav>Menu <a href='/a'>One</a></nav><div class='l-sidebar'><p>The article.</p></div>" +
        "<aside>Related</aside><footer>© 2026</footer></main>",
    );
    const pruned = pruneChrome(parsed);
    expect(normalise(textContent(pruned))).toBe("The article.");
  });

  it("closes a paragraph that the page never closed", () => {
    // Real pages leave `<p>` open; a reader that did not close it would make the
    // rest of the document one paragraph.
    const parsed = parseHtml("<p>one<p>two");
    expect(textContent(parsed).replace(/\s+/g, " ").trim()).toBe("one two");
  });

  it("reads a table into a table", () => {
    const parsed = parseHtml(
      "<table><tr><th>Style</th><th>Jar</th></tr><tr><td>Raw</td><td>Pints</td></tr></table>",
    );
    expect(toMarkdown(parsed, { url: "" })).toBe("| Style | Jar |\n| --- | --- |\n| Raw | Pints |\n");
  });

  it("decodes the character references a page writes its degrees and dashes with", () => {
    expect(toMarkdown(parseHtml("<p>40&deg;F &ndash; colder</p>"), { url: "" })).toBe("40°F – colder\n");
  });

  it("keeps a link's label and resolves its target", () => {
    expect(toMarkdown(parseHtml('<p>see <a href="/x">this</a></p>'), { url: "https://example.invalid/a" })).toBe(
      "see [this](https://example.invalid/x)\n",
    );
  });
});
