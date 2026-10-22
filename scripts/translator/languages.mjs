// No shebang — this module is both a CLI and an import target for its own test.
//
// Builds the translator's language table: one row per NLLB-200 language, with
// its BCP 47 tag and the name to show for it. Every row is derived from the upstream files by code; nothing
// is typed from memory, so a language added upstream appears here on the next run.
//
//   node scripts/translator/languages.mjs --out apps/desktop/src/modules/translator/shared/languages.ts
//   node scripts/translator/languages.mjs --out <file> --cache <folder>
//
// The downloads are cached in `%TEMP%\nexus-pack-cache\languages\` (or `--cache`)
// and reused when present, so a rerun is offline.
//
// WHY THE SOURCES ARE WHAT THEY ARE. The brief named the NLLB language tokens in
// the tokenizer config, but the Xenova conversion keeps them null there; they
// are listed in its `special_tokens_map.json`, which is what this reads. The
// FLORES README is the only upstream table of English names for the 200-odd
// codes, so it is the fallback name for a language ICU cannot name.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

export const SOURCES = {
  nllb: "https://huggingface.co/Xenova/nllb-200-distilled-600M/resolve/main/special_tokens_map.json",
  flores: "https://raw.githubusercontent.com/facebookresearch/flores/main/flores200/README.md",
};

const NLLB_CODE = /^([a-z]{3})_([A-Z][a-z]{3})$/;
// `fallback: "none"` makes ICU answer `undefined` for a tag it cannot name,
// where the default would return the tag itself.
const NAMES_EN = new Intl.DisplayNames(["en"], { type: "language", fallback: "none" });
const NAMES_SR_LATN = new Intl.DisplayNames(["sr-Latn"], { type: "language", fallback: "none" });

/** The NLLB codes of a `special_tokens_map.json`, sorted. */
export function parseNllbCodes(specialTokens) {
  const tokens = specialTokens.additional_special_tokens;
  if (!Array.isArray(tokens)) {
    throw new Error("languages: the NLLB special tokens carry no additional_special_tokens list");
  }
  return [...new Set(tokens.filter((token) => NLLB_CODE.test(token)))].sort();
}

/** `srp_Cyrl` → `{ iso3: "srp", script: "Cyrl" }`. */
export function splitNllbCode(code) {
  const match = code.match(NLLB_CODE);
  if (match === null) throw new Error(`languages: "${code}" is not an NLLB code`);
  return { iso3: match[1], script: match[2] };
}

/** `srp_Cyrl` → `sr-Cyrl`: ICU's canonical language subtag, then the script. */
export function bcp47Tag(code) {
  const { iso3, script } = splitNllbCode(code);
  return `${new Intl.Locale(iso3).language}-${script}`;
}

/** The FLORES-200 English names, keyed by NLLB code, from the README's language table. */
export function parseFloresNames(markdown) {
  const section = markdown
    .split(/^## /m)
    .find((part) => part.startsWith("Languages in FLORES-200"));
  if (section === undefined) {
    throw new Error("languages: the FLORES README has no 'Languages in FLORES-200' section");
  }
  return new Map(
    [...section.matchAll(/^(.+) \| ([a-z]{3}_[A-Z][a-z]{3})$/gm)].map((match) => [match[2], match[1]]),
  );
}

/** ICU's English and Serbian (Latin) names for a BCP 47 tag, `undefined` where ICU has none. */
export function namesFor(tag) {
  return { en: NAMES_EN.of(tag), srLatn: NAMES_SR_LATN.of(tag) };
}

/**
 * One row per code, sorted. `fallbackName` is set where ICU cannot name the
 * language in both locales, and where its tag is shared with another code:
 * ICU names `ak-Latn` "Akan" for both Akan and Twi, so the FLORES name is the
 * only correct one for either.
 */
export function buildLanguages({ codes, flores }) {
  const tags = codes.map(bcp47Tag);
  return codes
    .map((code, index) => {
      const { iso3, script } = splitNllbCode(code);
      const bcp47 = tags[index];
      const names = namesFor(bcp47);
      const shared = tags.indexOf(bcp47) !== tags.lastIndexOf(bcp47);
      return {
        code,
        iso3,
        script,
        bcp47,
        fallbackName:
          shared || names.en === undefined || names.srLatn === undefined
            ? floresNameFor(code, flores)
            : null,
      };
    })
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

function floresNameFor(code, flores) {
  const name = flores.get(code);
  if (name === undefined) {
    throw new Error(`languages: ${code} has no name in ICU and none in the FLORES table`);
  }
  return name;
}

/** The generated TypeScript module: the typed table and its lookup. */
export function renderModule({ languages, sources, date }) {
  const entries = languages.map((language) =>
    [
      "  {",
      `    code: ${JSON.stringify(language.code)},`,
      `    iso3: ${JSON.stringify(language.iso3)},`,
      `    script: ${JSON.stringify(language.script)},`,
      `    bcp47: ${JSON.stringify(language.bcp47)},`,
      `    fallbackName: ${JSON.stringify(language.fallbackName)},`,
      "  },",
    ].join("\n"),
  );
  return [
    "// Generated by scripts/translator/languages.mjs. Do not edit.",
    "// Sources:",
    ...sources.map((source) => `//   ${source}`),
    `// Generated: ${date}`,
    "",
    "/** One NLLB-200 language: its codes, and a name where ICU has none. */",
    "export interface NllbLanguage {",
    "  /** The NLLB-200 (FLORES-200) code, `xxx_Ssss`. */",
    "  readonly code: string;",
    "  /** ISO 639-3, the first half of the code. */",
    "  readonly iso3: string;",
    "  /** ISO 15924 script, the second half of the code. */",
    "  readonly script: string;",
    "  /** BCP 47 tag, for `Intl` locale lookups. Two codes may share one (`ak-Latn`). */",
    "  readonly bcp47: string;",
    "  /** The FLORES English name, set where ICU cannot name the language, or where its tag is shared. */",
    "  readonly fallbackName: string | null;",
    "}",
    "",
    "export const NLLB_LANGUAGES: readonly NllbLanguage[] = [",
    ...entries,
    "];",
    "",
    "const BY_CODE: ReadonlyMap<string, NllbLanguage> = new Map(",
    "  NLLB_LANGUAGES.map((language) => [language.code, language]),",
    ");",
    "",
    "/** The row for an NLLB code, or `undefined` when the table does not carry it. */",
    "export function languageByCode(code: string): NllbLanguage | undefined {",
    "  return BY_CODE.get(code);",
    "}",
    "",
  ].join("\n");
}

async function cachedText(folder, name, url) {
  const path = join(folder, name);
  if (existsSync(path)) return readFileSync(path, "utf8");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`languages: ${url} answered ${String(response.status)}`);
  const text = await response.text();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return text;
}

async function main() {
  const { values } = parseArgs({
    options: { out: { type: "string" }, cache: { type: "string" } },
  });
  if (values.out === undefined) {
    throw new Error("languages: usage: node scripts/translator/languages.mjs --out <file> [--cache <folder>]");
  }
  const folder = values.cache ?? join(tmpdir(), "nexus-pack-cache", "languages");

  const codes = parseNllbCodes(
    JSON.parse(await cachedText(folder, "special_tokens_map.json", SOURCES.nllb)),
  );
  const flores = parseFloresNames(await cachedText(folder, "flores-README.md", SOURCES.flores));
  const languages = buildLanguages({ codes, flores });
  const date = new Date().toISOString().slice(0, 10);
  writeFileSync(
    values.out,
    renderModule({ languages, sources: Object.values(SOURCES), date }),
  );

  const count = (predicate) => languages.filter(predicate).length;
  console.log(
    `languages: ${String(languages.length)} NLLB languages; ` +
      `${String(count((l) => l.fallbackName !== null))} with a FLORES fallback name -> ${values.out}`,
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
