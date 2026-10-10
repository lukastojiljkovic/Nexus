// No shebang, for the reason every other script in this repository has none.
//
// Regenerates `fixtures/expected/` — the pack the fixtures convert to, byte for
// byte, which `convert.test.mjs` compares the converter's output against.
//
//   node scripts/packs/dictionary/write-fixtures.mjs
//
// It exists for exactly that and does nothing else, which is the point: the
// golden files are what a format change has to be confronted with, and a script
// that could also fetch, build or sign would be a script somebody runs by
// accident. Run it only when the format changed DELIBERATELY, then read the
// diff: every byte of `expected/` is a claim about what the app will read.

import { readFileSync, mkdirSync, rmSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { englishEntry, parsePhrasebook, serbianEntry } from "./convert.mjs";
import { writePack } from "./build.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The `builtAt` and the source hashes the golden is written with.
 *
 * Fixed, because a golden that carried today's date would differ on every run
 * and the comparison would have to be "everything except the parts that change",
 * which is a comparison that stops being one.
 */
export const FIXTURE_BUILT_AT = "2026-10-10T00:00:00.000Z";

/** The two sources the fixture records came from, with the real URLs and a placeholder digest — the fixtures are not the sources. */
export function fixtureSources() {
  const recorded = JSON.parse(readFileSync(new URL("./sources.json", import.meta.url), "utf8")).sources;
  return recorded.map((entry) => ({ url: entry.url, sha256: "fixture".padEnd(64, "0"), bytes: entry.bytes }));
}

/** The records the fixtures convert to: the same functions the build runs, over the two fixture files. */
export function fixtureInputs() {
  const read = (name) =>
    readFileSync(join(HERE, "fixtures", name), "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line));

  const english = [];
  for (const record of read("en.jsonl")) {
    const entry = englishEntry(record);
    if (entry !== null) english.push(entry);
  }
  const serbian = [];
  for (const record of read("sh.jsonl")) {
    const entry = serbianEntry(record);
    if (entry !== null) serbian.push(entry);
  }
  const phrases = parsePhrasebook(readFileSync(join(HERE, "fixtures", "phrasebook.wiki"), "utf8"));
  return { english, serbian, phrases, builtAt: FIXTURE_BUILT_AT, sourceHashes: fixtureSources() };
}

/** Every file under `dir`, as `/`-separated paths relative to it. */
export function filesUnder(dir, prefix = "") {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...filesUnder(join(dir, entry.name), relative));
    else out.push(relative);
  }
  return out.sort();
}

function main() {
  const target = join(HERE, "fixtures", "expected");
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  const written = writePack(target, fixtureInputs());
  for (const file of filesUnder(target)) {
    console.log(file, statSync(join(target, file)).size);
  }
  console.log("total", written.total, "bytes");
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
