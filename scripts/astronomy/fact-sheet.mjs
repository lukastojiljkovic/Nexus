// No shebang — this module is both a CLI and an import target for its own test.
//
// The astronomy body card's facts, read from NASA's planetary and solar fact sheets.
//
//   node scripts/astronomy/fact-sheet.mjs --out apps/desktop/src/modules/astronomy/shared/facts.ts
//
// WHAT IT DOES AND DOES NOT DO. It fetches the two NSSDCA pages in `SOURCES`, reads
// their tables by markup, and writes the TypeScript module the app imports. No value
// is typed from memory: every one is a cell this tool just read. Each keeps the cell's
// published text exactly and a parsed number beside it, so the card can show NASA's
// wording and still compare numbers. A footnote mark stays in the text and is stripped
// from the number. The rows of the planet table are kept whole, because the card
// should show what NASA publishes, not a selection of it; the Sun's sheet is narrowed
// to the rows that have a planet counterpart, because its other rows have none.
//
// The fixtures in `fixtures/` are the two pages as they were fetched, and the tests
// parse those, so the parser can be checked without the network.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

export const SOURCES = Object.freeze({
  planets: "https://nssdc.gsfc.nasa.gov/planetary/factsheet/",
  sun: "https://nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html",
});

const BODY_IDS = ["sun", "mercury", "venus", "earth", "moon", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto"];

const SUN_ROWS = new Set([
  "mass",
  "volume",
  "volumetricMeanRadius",
  "meanDensity",
  "surfaceGravity",
  "escapeVelocity",
  "siderealRotationPeriod",
]);

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;
const YES_NO_UNKNOWN = /^(yes|no|unknown)$/i;

/** The table rows of a page, each as the list of its cells' inner HTML. */
function rowsOf(html) {
  return [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((row) =>
    [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((cell) => cell[1]),
  );
}

/** A cell's published text: tags out, entities decoded, whitespace collapsed. */
function cellText(html) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * `Mass (10<sup>24</sup>kg)` is the label "Mass" and the unit "10^24 kg". The last
 * parenthesis is the unit, so a label may carry its own ("Surface gravity (eq.)").
 */
function splitLabel(html) {
  const text = cellText(html.replace(/<sup>([\s\S]*?)<\/sup>/g, "^$1"))
    .replace(/\*/g, "")
    .trim();
  const match = /^(.*?)\s*\(([^()]*)\)$/.exec(text);
  if (!match) return { label: text, unit: null };
  return { label: match[1], unit: match[2].replace(/(\^-?\d+)(?=[A-Za-z])/, "$1 ") };
}

/** The camelCase id of a row label: "Escape Velocity" is `escapeVelocity`, "Ring System?" is `ringSystem`. */
function factId(label) {
  const [first, ...rest] = label.replace(/\([^()]*\)/g, " ").match(/[A-Za-z]+/g);
  return [first.toLowerCase(), ...rest.map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase())].join("");
}

/** A Yes/No row keeps booleans (Unknown is null); any other cell keeps its number, or null when it has none. */
function valueOf(text, flagRow) {
  if (flagRow) {
    const word = text.toLowerCase();
    return { text, flag: word === "yes" ? true : word === "no" ? false : null };
  }
  const digits = text.replace(/[*,]/g, "");
  return { text, number: NUMBER.test(digits) ? Number(digits) : null };
}

/** The planet table: one column per body, the header row names them, every labelled row is kept. */
export function parsePlanetFactSheet(html) {
  const [header, ...rows] = rowsOf(html);
  const names = header.slice(1).map((cell) => cellText(cell).toLowerCase());
  const facts = Object.fromEntries(names.map((name) => [name, {}]));
  for (const cells of rows) {
    const { label, unit } = splitLabel(cells[0]);
    if (!label) continue;
    const texts = cells.slice(1).map(cellText);
    const flagRow = texts.every((text) => YES_NO_UNKNOWN.test(text));
    const id = factId(label);
    names.forEach((name, i) => {
      facts[name][id] = { label, unit, value: valueOf(texts[i], flagRow) };
    });
  }
  return facts;
}

/** The Sun's sheet: its own column is the first value cell; the Earth and the ratio are not the Sun's facts. */
export function parseSunFactSheet(html) {
  const sun = {};
  for (const cells of rowsOf(html)) {
    const { label, unit } = splitLabel(cells[0]);
    if (!label) continue;
    const id = factId(label);
    if (SUN_ROWS.has(id)) sun[id] = { label, unit, value: valueOf(cellText(cells[1]), false) };
  }
  return { sun };
}

function literal(value) {
  return value === null ? "null" : JSON.stringify(value);
}

function renderRow(id, row) {
  const value = "flag" in row.value
    ? `{ text: ${literal(row.value.text)}, flag: ${row.value.flag} }`
    : `{ text: ${literal(row.value.text)}, number: ${row.value.number} }`;
  return [
    `    ${id}: {`,
    `      label: ${literal(row.label)},`,
    `      unit: ${literal(row.unit)},`,
    `      value: ${value},`,
    "    },",
  ].join("\n");
}

/** The TypeScript module the app imports; the header says what made it, so nobody edits it by hand. */
export function renderFactsModule(facts, { retrieved, urls }) {
  const bodies = BODY_IDS.map((id) => {
    const rows = Object.entries(facts[id]).map(([rowId, row]) => renderRow(rowId, row));
    return `  ${id}: {\n${rows.join("\n")}\n  },`;
  });
  return `// Generated by scripts/astronomy/fact-sheet.mjs from the NASA fact sheets listed in
// BODY_FACTS_SOURCE, retrieved on ${retrieved}. Do not edit by hand: run the script again to refresh it.
//
// NASA material is not subject to US copyright.

import type { BodyId } from "@nexus/core";

/** A published value: the cell's text as NASA prints it, and its number or Yes/No flag where it has one. */
export type FactValue =
  | { readonly text: string; readonly number: number | null }
  | { readonly text: string; readonly flag: boolean | null };

export interface FactRow {
  readonly label: string;
  readonly unit: string | null;
  readonly value: FactValue;
}

/** One body's rows, keyed by a camelCase id derived from the row label. */
export type BodyFacts = Readonly<Record<string, FactRow>>;

export const BODY_FACTS_SOURCE = {
  urls: [${urls.map((url) => JSON.stringify(url)).join(", ")}],
  retrieved: ${JSON.stringify(retrieved)},
} as const;

export const BODY_FACTS: Readonly<Record<BodyId, BodyFacts>> = {
${bodies.join("\n")}
};
`;
}

export async function fetchFactSheet(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

async function main() {
  const { values } = parseArgs({ options: { out: { type: "string" } } });
  if (!values.out) throw new Error("usage: fact-sheet.mjs --out <facts.ts>");
  const [planetHtml, sunHtml] = await Promise.all([fetchFactSheet(SOURCES.planets), fetchFactSheet(SOURCES.sun)]);
  const retrieved = new Date().toISOString().slice(0, 10);
  const facts = { ...parsePlanetFactSheet(planetHtml), ...parseSunFactSheet(sunHtml) };
  writeFileSync(resolve(values.out), renderFactsModule(facts, { retrieved, urls: Object.values(SOURCES) }));
  console.log(`wrote ${values.out} (${retrieved})`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
