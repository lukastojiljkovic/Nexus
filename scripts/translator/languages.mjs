// No shebang — this module is both a CLI and an import target for its own test.
//
// Builds the translator's language table: one row per NLLB-200 language, with
// the Whisper code that hears it, the MMS-TTS voice that speaks it and the name
// to show for it. Every row is derived from the upstream files by code; nothing
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
  whisper: "https://huggingface.co/openai/whisper-small/resolve/main/generation_config.json",
  mmsModels: "https://huggingface.co/api/models?author=facebook&search=mms-tts&limit=2000",
};

const NLLB_CODE = /^([a-z]{3})_([A-Z][a-z]{3})$/;
/** A per-language or per-script MMS repo. Dialect splits (`-dialect_*`) are not voices for an NLLB code. */
const MMS_REPO = /^facebook\/mms-tts-[a-z]{3}(?:-script_[a-z]+)?$/;

/**
 * Whisper's codes that differ from the BCP 47 primary subtag this table derives.
 * The derivation is `Intl.Locale`'s canonicalisation, which is right for every
 * other language here: `jav` becomes `jv` but Whisper calls Javanese `jw`;
 * `tgl` becomes `fil` but Whisper's Tagalog is `tl`; `nob` becomes `nb` but
 * Whisper's Norwegian (Bokmål) is `no`. Whisper's `yue` and `haw` need no entry:
 * their primary subtags already match.
 */
const WHISPER_OVERRIDES = new Map([
  ["jv", "jw"],
  ["fil", "tl"],
  ["nb", "no"],
]);

const SCRIPT_NAMES = new Intl.DisplayNames(["en"], { type: "script" });
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

/** The language ids of a Whisper `generation_config.json`, from its `lang_to_id` keys. */
export function parseWhisperCodes(generationConfig) {
  return Object.keys(generationConfig.lang_to_id).map((token) => {
    const match = token.match(/^<\|([a-z]+)\|>$/);
    if (match === null) throw new Error(`languages: unexpected Whisper language token "${token}"`);
    return match[1];
  });
}

/** The Whisper code for a BCP 47 tag, or `null` when Whisper does not hear that language. */
export function whisperCodeFor(tag, whisperCodes) {
  const primary = tag.split("-")[0];
  const code = WHISPER_OVERRIDES.get(primary) ?? primary;
  return whisperCodes.has(code) ? code : null;
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

/** The MMS-TTS repo ids from the Hugging Face API listing, dialect splits and the bare repo dropped. */
export function parseMmsModelIds(models) {
  return models.map((model) => model.id).filter((id) => MMS_REPO.test(id));
}

/**
 * The MMS-TTS repo that speaks an NLLB code: the per-language repo when MMS has
 * one, otherwise the script split whose script is the code's. `null` when neither
 * exists. MMS splits by script only where it has to, so the per-language repo
 * wins: no language in the upstream listing has both.
 */
export function mmsRepoFor(code, mmsIds) {
  const { iso3, script } = splitNllbCode(code);
  const base = `facebook/mms-tts-${iso3}`;
  if (mmsIds.includes(base)) return base;
  const scripted = `${base}-script_${SCRIPT_NAMES.of(script).toLowerCase()}`;
  return mmsIds.includes(scripted) ? scripted : null;
}

/** The `is_uroman` flag of an MMS repo's tokenizer config. Refuses a config that does not state it. */
export function uromanFlag(tokenizerConfig, repo) {
  if (typeof tokenizerConfig.is_uroman !== "boolean") {
    throw new Error(`languages: the tokenizer config of ${repo} does not state is_uroman`);
  }
  return tokenizerConfig.is_uroman;
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
export function buildLanguages({ codes, flores, whisperCodes, mmsIds, uromanByRepo }) {
  const tags = codes.map(bcp47Tag);
  return codes
    .map((code, index) => {
      const { iso3, script } = splitNllbCode(code);
      const bcp47 = tags[index];
      const names = namesFor(bcp47);
      const repo = mmsRepoFor(code, mmsIds);
      const shared = tags.indexOf(bcp47) !== tags.lastIndexOf(bcp47);
      return {
        code,
        iso3,
        script,
        bcp47,
        whisper: whisperCodeFor(bcp47, whisperCodes),
        tts: repo === null ? null : { repo, uroman: uromanFor(repo, uromanByRepo) },
        fallbackName:
          shared || names.en === undefined || names.srLatn === undefined
            ? floresNameFor(code, flores)
            : null,
      };
    })
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

function uromanFor(repo, uromanByRepo) {
  const flag = uromanByRepo.get(repo);
  if (flag === undefined) throw new Error(`languages: no tokenizer config was read for ${repo}`);
  return flag;
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
      `    whisper: ${JSON.stringify(language.whisper)},`,
      `    tts: ${language.tts === null ? "null" : `{ repo: ${JSON.stringify(language.tts.repo)}, uroman: ${String(language.tts.uroman)} }`},`,
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
    "/** One NLLB-200 language: the codes that name it in each system the translator uses. */",
    "export interface NllbLanguage {",
    "  /** The NLLB-200 (FLORES-200) code, `xxx_Ssss`. */",
    "  readonly code: string;",
    "  /** ISO 639-3, the first half of the code. */",
    "  readonly iso3: string;",
    "  /** ISO 15924 script, the second half of the code. */",
    "  readonly script: string;",
    "  /** BCP 47 tag, for `Intl` locale lookups. Two codes may share one (`ak-Latn`). */",
    "  readonly bcp47: string;",
    "  /** The Whisper language id that hears this language, or `null` when Whisper has none. */",
    "  readonly whisper: string | null;",
    "  /** The MMS-TTS voice that speaks it, or `null`. `uroman` is whether its text is romanised first. */",
    "  readonly tts: { readonly repo: string; readonly uroman: boolean } | null;",
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

/** The `rel="next"` URL of a Hugging Face API `Link` header, if there is one. */
export function nextLink(linkHeader) {
  return linkHeader?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
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

async function fetchMmsModels(folder) {
  const path = join(folder, "mms-models.json");
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
  const models = [];
  for (let url = SOURCES.mmsModels; url !== undefined; ) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`languages: ${url} answered ${String(response.status)}`);
    models.push(...(await response.json()));
    url = nextLink(response.headers.get("link"));
  }
  mkdirSync(folder, { recursive: true });
  writeFileSync(path, JSON.stringify(models));
  return models;
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
  const whisperCodes = new Set(
    parseWhisperCodes(
      JSON.parse(await cachedText(folder, "whisper-generation_config.json", SOURCES.whisper)),
    ),
  );
  const mmsIds = parseMmsModelIds(await fetchMmsModels(folder));

  const uromanByRepo = new Map();
  const repos = new Set(codes.map((code) => mmsRepoFor(code, mmsIds)).filter((repo) => repo !== null));
  for (const repo of repos) {
    const name = repo.replace("facebook/", "");
    const config = JSON.parse(
      await cachedText(
        join(folder, "tokenizers"),
        `${name}.json`,
        `https://huggingface.co/${repo}/resolve/main/tokenizer_config.json`,
      ),
    );
    uromanByRepo.set(repo, uromanFlag(config, repo));
  }

  const languages = buildLanguages({ codes, flores, whisperCodes, mmsIds, uromanByRepo });
  const date = new Date().toISOString().slice(0, 10);
  writeFileSync(
    values.out,
    renderModule({ languages, sources: Object.values(SOURCES), date }),
  );

  const count = (predicate) => languages.filter(predicate).length;
  console.log(
    `languages: ${String(languages.length)} NLLB languages; ${String(count((l) => l.whisper !== null))} with a Whisper code; ` +
      `${String(count((l) => l.tts !== null))} with an MMS voice (${String(count((l) => l.tts?.uroman === true))} uroman); ` +
      `${String(count((l) => l.fallbackName !== null))} with a FLORES fallback name -> ${values.out}`,
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
