import { describe, expect, it } from "vitest";
import { buildCardModel } from "@nexus/core";
import type { EmergencyCardSource } from "@nexus/core";
import { CARD_PRINT_LAYOUTS, buildCardPrintDocument, cardFileName, escapeHtml } from "./print.js";

/**
 * The printed card, as a document.
 *
 * These are the tests the acceptance calls „a render test of the card helpers":
 * there is no DOM in this repository and no PDF renderer under Vitest, so what is
 * pinned here is the DOCUMENT - its two passes, its escaping, the sentences an
 * answered-empty list and a dangling reference print, and the absence of a colour
 * value in it. Everything below is hand-built input with the result checked by
 * hand, which is the only kind of expectation that can catch a document that is
 * wrong in a way that still typechecks.
 */

const TITLE = { sr: "Hitna karta", en: "Emergency card" };

/** A complete card, so each test can change exactly the one fact it is about. */
function card(overrides: Partial<EmergencyCardSource> = {}): EmergencyCardSource {
  return {
    fullName: "Mila Petrović",
    dateOfBirth: "1988-04-12",
    bloodType: "A+",
    allergies: [{ label: "penicilin", severity: "anaphylaxis" }],
    conditions: [],
    medications: [{ name: "metformin", dose: "1 ujutru" }],
    organDonor: "yes",
    healthInsuranceNumber: "1234567890",
    doctorName: "dr Jovan Jović",
    doctorPhone: "+381 11 000 000",
    notes: "Nosim sobu za inhalaciju.",
    printLanguage: "both",
    contacts: [
      { id: "c1", personId: null, name: "Ana", phone: "064 111", relation: "sestra" },
    ],
    documents: [],
    ...overrides,
  };
}

function document(source: EmergencyCardSource, locale: "sr" | "en" = "sr", format: "a6" | "card-a4" = "a6") {
  return buildCardPrintDocument({
    model: buildCardModel(source, [], [], locale),
    title: TITLE,
    format,
  });
}

describe("buildCardPrintDocument", () => {
  it("prints one sheet per language the card asks for, in the reader's own order", () => {
    const both = document(card());
    // Two `<section class="pass">`s, the Serbian one first because this reader's
    // interface is Serbian.
    expect(both.match(/class="pass"/g)).toHaveLength(2);
    expect(both.indexOf('lang="sr"')).toBeLessThan(both.indexOf('lang="en"'));
    expect(both.indexOf("Krvna grupa")).toBeLessThan(both.indexOf("Blood type"));

    const englishFirst = document(card(), "en");
    expect(englishFirst.indexOf('lang="en"')).toBeLessThan(englishFirst.indexOf('lang="sr"'));
    expect(englishFirst.indexOf("Blood type")).toBeLessThan(englishFirst.indexOf("Krvna grupa"));
  });

  it("prints one language when the card asks for one", () => {
    const serbian = document(card({ printLanguage: "sr" }));
    expect(serbian.match(/class="pass"/g)).toHaveLength(1);
    expect(serbian).toContain("Krvna grupa");
    expect(serbian).not.toContain("Blood type");
  });

  it("carries the four emergency numbers and the line that says where the facts come from", () => {
    const html = document(card({ printLanguage: "sr" }));
    for (const number of ["112", "192", "193", "194"]) expect(html).toContain(number);
    expect(html).toContain("Policija");
    expect(html).toContain("Hitna pomoć");
    expect(html).toContain("Podatke navodi vlasnik kartice.");
  });

  it("says an unanswered list is answered, and a dangling reference is dangling", () => {
    const html = document(card({ printLanguage: "sr", conditions: [] }));
    expect(html).toContain("Nema navedenih stanja");
    // A contact whose person has left the address book prints the fact rather
    // than a blank line: a silently shortened list is the one outcome the card
    // model refuses.
    const dangling = document(
      card({
        printLanguage: "sr",
        contacts: [{ id: "c1", personId: "gone", name: null, phone: "064", relation: null }],
      }),
    );
    expect(dangling).toContain("Osoba više nije u imeniku");
  });

  it("prints no name at all for a card that has none, rather than a placeholder", () => {
    const html = document(card({ printLanguage: "sr", fullName: null }));
    expect(html).not.toContain('class="identity__name"');
    // The birth date is still there: the identity block is not the name's alone.
    expect(html).toContain("12. april 1988.");
  });

  it("escapes everything the user typed, and carries no colour value at all", () => {
    const html = document(
      card({
        printLanguage: "sr",
        fullName: '<script>alert("x")</script>',
        notes: '5 < 6 & 7 > 4, brend "Ani"',
      }),
    );
    // The one document in this module is BUILT here, so nothing typed into a
    // card can be markup: every value is escaped on the way in.
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("5 &lt; 6 &amp; 7 &gt; 4");
    // The stylesheet declares no colour: a printed sheet is the printer's own
    // ink on the printer's own paper, and the app's two themes belong on screen.
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(html).not.toMatch(/\brgba?\(/);
    expect(html).not.toMatch(/\bhsla?\(/);
  });

  it("lays the same document out on the two papers the user picks", () => {
    expect(document(card(), "sr", "a6")).toContain('<body class="card--a6">');
    expect(document(card(), "sr", "card-a4")).toContain('<body class="card--card-a4">');
    // A6 is 105 × 148 mm and A4 is 210 × 297 mm, written in the inches
    // `printToPDF` measures pages in.
    expect(CARD_PRINT_LAYOUTS.a6.pageSize).toEqual({ width: 4.1339, height: 5.8268 });
    expect(CARD_PRINT_LAYOUTS["card-a4"].pageSize).toEqual({ width: 8.2677, height: 11.6929 });
  });
});

describe("escapeHtml", () => {
  it("escapes the five characters that can end a text node or an attribute", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;",
    );
  });
});

describe("cardFileName", () => {
  it("folds a Serbian name into a file name on somebody else's filesystem", () => {
    // „č", „ć", „š" and „ž" decompose under NFD and are stripped; „đ" does not,
    // which is why it has a line of its own.
    expect(cardFileName("Mila Petrović")).toBe("hitna-karta-mila-petrovic.pdf");
    expect(cardFileName("Đorđe Šarić")).toBe("hitna-karta-dorde-saric.pdf");
  });

  it("still names a file for a card with no name, and bounds what it suggests", () => {
    expect(cardFileName(null)).toBe("hitna-karta.pdf");
    expect(cardFileName("   ")).toBe("hitna-karta.pdf");
    const long = cardFileName("a".repeat(200));
    expect(long.length).toBeLessThanOrEqual("hitna-karta-".length + 60 + ".pdf".length);
    expect(long.endsWith(".pdf")).toBe(true);
  });
});
