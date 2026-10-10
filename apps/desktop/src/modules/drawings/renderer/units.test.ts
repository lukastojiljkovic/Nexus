import { describe, expect, it } from "vitest";
import { formatLength, insunitsOfHeader, INSUNITS_TABLE, unitOfInsunits } from "./units.js";

/**
 * The units helper, against the source it quotes.
 *
 * Every expected value below is read off the Autodesk DXF reference's
 * `$INSUNITS` entry (the URL is in `units.ts`), so a table that drifted from the
 * document fails here rather than printing a wrong unit onto a drawing.
 */

describe("the $INSUNITS table", () => {
  it("covers codes 0..24, the range the source documents", () => {
    // "0 = Unitless ... 24 = US Survey Mile".
    expect(INSUNITS_TABLE).toHaveLength(25);
    expect(INSUNITS_TABLE[0]).toBe("unitless");
    expect(INSUNITS_TABLE[24]).toBe("usSurveyMiles");
  });

  it("names the codes a drawing actually declares, one by one", () => {
    // A spread of the list rather than the whole of it: these are the codes CAD
    // programs write in practice, and each is asserted against the source's own
    // wording ("4 = Millimeters", "6 = Meters", "1 = Inches", "21 = US Survey
    // Feet").
    expect(unitOfInsunits(0)).toBe("unitless");
    expect(unitOfInsunits(1)).toBe("inches");
    expect(unitOfInsunits(2)).toBe("feet");
    expect(unitOfInsunits(4)).toBe("millimeters");
    expect(unitOfInsunits(5)).toBe("centimeters");
    expect(unitOfInsunits(6)).toBe("meters");
    expect(unitOfInsunits(7)).toBe("kilometers");
    expect(unitOfInsunits(13)).toBe("microns");
    expect(unitOfInsunits(18)).toBe("astronomicalUnits");
    expect(unitOfInsunits(21)).toBe("usSurveyFeet");
    expect(unitOfInsunits(24)).toBe("usSurveyMiles");
  });

  it("answers unitless for everything a drawing might declare OTHERWISE", () => {
    // A header with no `$INSUNITS` at all (every drawing older than R2000), a
    // code a future release adds, a float, a string a hand-edited file carries.
    expect(unitOfInsunits(undefined)).toBe("unitless");
    expect(unitOfInsunits(null)).toBe("unitless");
    expect(unitOfInsunits(25)).toBe("unitless");
    expect(unitOfInsunits(-1)).toBe("unitless");
    expect(unitOfInsunits(4.5)).toBe("unitless");
    expect(unitOfInsunits("4")).toBe("unitless");
    expect(unitOfInsunits({ code: 4 })).toBe("unitless");
  });
});

describe("formatLength", () => {
  // An injected formatter rather than `Intl`: this test is about the string's
  // SHAPE (a number, a unit word, and nothing else), and a locale-dependent
  // formatter here would make it a second test of the app's number formatting.
  const format = (value: number): string => `N(${String(value)})`;

  it("prints the number and the unit word for a drawing that names a unit", () => {
    expect(formatLength(1234.5, "millimeters", "mm", format)).toBe("N(1234.5) mm");
    expect(formatLength(0, "inches", "in", format)).toBe("N(0) in");
  });

  it("prints the bare number for a unitless drawing, with no invented unit", () => {
    // "Unspecified (No units)" is an answer, not a gap: appending "mm" here is
    // the fiction this module exists to refuse.
    expect(formatLength(1234.5, "unitless", "bez jedinice", format)).toBe("N(1234.5)");
  });
});

describe("insunitsOfHeader", () => {
  /** A minimal file whose HEADER declares millimetres, and whose TEXT spells the variable's name. */
  const DRAWING = [
    "999", "written by hand",
    "0", "SECTION", "2", "HEADER",
    "9", "$ACADVER", "1", "AC1009",
    "9", "$INSUNITS", "70", "4",
    "0", "ENDSEC",
    "0", "SECTION", "2", "ENTITIES",
    "0", "TEXT", "8", "0", "1", "$INSUNITS",
    "0", "ENDSEC", "0", "EOF", "",
  ].join("\n");

  it("reads the value the HEADER declares", () => {
    expect(insunitsOfHeader(DRAWING)).toBe(4);
    expect(unitOfInsunits(insunitsOfHeader(DRAWING))).toBe("millimeters");
  });

  it("reads only a VARIABLE NAME, so an entity spelling it is not a declaration", () => {
    // The TEXT entity above carries the string "$INSUNITS" under group code 1,
    // which is content. Code 9 is the one the reference restricts to the HEADER
    // ("used only in HEADER section of the DXF file"), so dropping the header's
    // own pair must answer null even though the words are still in the file.
    const withoutDeclaration = DRAWING.replace("9\n$INSUNITS\n70\n4\n", "");
    expect(withoutDeclaration).toContain("$INSUNITS");
    expect(insunitsOfHeader(withoutDeclaration)).toBeNull();
  });

  it("answers null rather than guessing at anything it did not find whole", () => {
    expect(insunitsOfHeader("")).toBeNull();
    expect(insunitsOfHeader("0\nSECTION\n2\nENTITIES\n0\nEOF\n")).toBeNull();
    // A value that is not the whole-number group code 70 the reference documents.
    expect(insunitsOfHeader("9\n$INSUNITS\n40\n4\n")).toBeNull();
    expect(insunitsOfHeader("9\n$INSUNITS\n70\nfour\n")).toBeNull();
    expect(insunitsOfHeader("9\n$INSUNITS\n70\n4.5\n")).toBeNull();
  });

  it("tolerates a byte-order mark and blank lines before the first group", () => {
    // A stray line shifts every pair after it, which is why they are dropped
    // before the read rather than skipped inside it.
    expect(insunitsOfHeader(`\uFEFF\r\n\r\n${DRAWING}`)).toBe(4);
  });
});
