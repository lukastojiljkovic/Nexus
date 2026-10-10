/**
 * The drawing's own units, from its `$INSUNITS` header variable.
 *
 * **The table is the source's, not ours.** The DXF reference documents
 * `$INSUNITS` (group code 70) as the value list below, verbatim, including the
 * four US Survey units Autodesk added later:
 *
 *   https://help.autodesk.com/cloudhelp/2025/ENU/AutoCAD-DXF/files/GUID-A85E8E67-27CD-4C59-BE61-4DC9FADBE74A.htm
 *   ($INSUNITS: "Default drawing units ... 0 = Unitless ... 24 = US Survey Mile")
 *
 * **Why the codes are not written out as a lookup object.** The index IS the
 * value the header carries, and a `{ 0: ..., 1: ... }` object would be a second
 * spelling of the same fact that can silently lose an entry. An array whose
 * entries are in code order is the file's own shape, and the test asserts its
 * length against the source's last code.
 *
 * **`unitless` is the honest answer twice over.** Code 0 says so, and a DXF with
 * no `$INSUNITS` at all (which is every drawing older than R2000, and common
 * after it) says nothing - so a reader cannot tell those two apart, and must not
 * pretend to. The page prints the raw numbers and says, once, that the drawing
 * declares no unit.
 */

/** One unit a drawing may be in. The keys are this module's copy-table keys. */
export type DrawingUnit =
  | "unitless"
  | "inches"
  | "feet"
  | "miles"
  | "millimeters"
  | "centimeters"
  | "meters"
  | "kilometers"
  | "microinches"
  | "mils"
  | "yards"
  | "angstroms"
  | "nanometers"
  | "microns"
  | "decimeters"
  | "dekameters"
  | "hectometers"
  | "gigameters"
  | "astronomicalUnits"
  | "lightYears"
  | "parsecs"
  | "usSurveyFeet"
  | "usSurveyInches"
  | "usSurveyYards"
  | "usSurveyMiles";

/** The source's page, cited above. Exported so the report and the page can name where the table comes from. */
export const INSUNITS_SOURCE_URL =
  "https://help.autodesk.com/cloudhelp/2025/ENU/AutoCAD-DXF/files/GUID-A85E8E67-27CD-4C59-BE61-4DC9FADBE74A.htm";

/** Index = the value of `$INSUNITS`. 0 is "Unspecified (No units)", 24 is "US Survey Mile". */
export const INSUNITS_TABLE: readonly DrawingUnit[] = [
  "unitless",
  "inches",
  "feet",
  "miles",
  "millimeters",
  "centimeters",
  "meters",
  "kilometers",
  "microinches",
  "mils",
  "yards",
  "angstroms",
  "nanometers",
  "microns",
  "decimeters",
  "dekameters",
  "hectometers",
  "gigameters",
  "astronomicalUnits",
  "lightYears",
  "parsecs",
  "usSurveyFeet",
  "usSurveyInches",
  "usSurveyYards",
  "usSurveyMiles",
];

/**
 * The unit a parsed header declares, or `unitless`.
 *
 * Anything that is not an index into the table - a missing `$INSUNITS`, a
 * float, a code from a future AutoCAD release, a string a hand-edited file put
 * there - answers `unitless`, which is what a reader who cannot name the unit
 * actually knows.
 */
export function unitOfInsunits(raw: unknown): DrawingUnit {
  if (typeof raw !== "number" || !Number.isInteger(raw)) return "unitless";
  return INSUNITS_TABLE[raw] ?? "unitless";
}

/**
 * The `$INSUNITS` value out of a DXF's own text, or `null` when it declares
 * none.
 *
 * **Why the header is read here rather than from the parsed document.** The
 * library can hand the parsed file back with the scene (`retainParsedDxf`), and
 * that was the obvious route - until the cost of it: the whole parsed document
 * then crosses the worker boundary as one structured clone, on the UI thread,
 * for a file that may hold hundreds of thousands of entities. One integer from
 * the file's own first kilobytes costs a scan of the header instead, which is
 * the same reason the heavy work is in the worker at all.
 *
 * **Why group code 9 alone is enough.** `$INSUNITS` is a HEADER VARIABLE, and
 * the DXF reference documents code 9 as "variable name identifier (used only in
 * HEADER section of the DXF file)" - so a `9`/`$INSUNITS` pair cannot be an
 * entity's text and no section tracking is needed:
 *
 *   https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-DXF/files/GUID-3F0380A5-1C15-464D-BC66-2C5F094BCFB9.htm
 *   (DXF Group Codes in Numerical Order, group 9)
 */
export function insunitsOfHeader(text: string): number | null {
  // A DXF is a flat list of (group code, value) pairs, one per line, so the
  // read is two lines at a time. The BOM and any leading blank lines are
  // stripped first, because one stray line would shift every pair after it.
  const lines = text.replace(/^\uFEFF/, "").split("\n").map((line) => line.trim());
  const first = lines.findIndex((line) => line.length > 0);
  if (first < 0) return null;
  const pairs = lines.slice(first);
  for (let index = 0; index + 1 < pairs.length; index += 2) {
    if (pairs[index] !== "9" || pairs[index + 1] !== "$INSUNITS") continue;
    const raw = pairs[index + 3] ?? "";
    if (pairs[index + 2] !== "70" || !/^\d+$/.test(raw)) return null;
    return Number(raw);
  }
  return null;
}

/**
 * A length in the drawing's own unit, as the page prints it.
 *
 * `format` is the active locale's number formatter, passed in rather than
 * imported: this module is arithmetic and a table, and the one thing it must not
 * do is decide that a number looks the same in both languages.
 *
 * A value whose unit is `unitless` is printed as the bare number, with no unit
 * word at all - appending one would be the fiction this module refuses.
 */
export function formatLength(
  value: number,
  unit: DrawingUnit,
  label: string,
  format: (value: number) => string,
): string {
  const number = format(value);
  return unit === "unitless" ? number : `${number} ${label}`;
}
