/**
 * The dictionary pack's conversion: Wiktextract records in, a searchable index
 * out — pure, so the build script beside it is only download and disk.
 *
 * **The index, and why it is four files per direction.** A pack of 15 000 +
 * 60 000 words must be searchable without reading it, so each direction is:
 *
 *   `keys.txt`      one folded key per line, sorted by byte order
 *   `group.bin`     uint32 per key (plus one sentinel), the index of its first entry
 *   `lines.bin`     uint32 per entry: the byte offset of its line in `entries.jsonl`
 *   `entries.jsonl` one JSON record per line, in key order
 *
 * The search then reads `keys.txt` (a few hundred kilobytes), binary-searches
 * it, and reads only the entry lines a hit needs. Nothing else is ever loaded,
 * which is what lets a pack of a few megabytes answer a keystroke.
 *
 * **Two directions, one source.** The English side comes from records whose
 * `lang_code` is `en` and whose translation list holds a Serbo-Croatian item
 * (Wiktionary files Serbian under `sh`); the Serbian side comes from records
 * whose own `lang_code` is `sh`, where the English definitions are the meaning.
 * Both live in the same file — the raw Wiktextract extract of the English
 * Wiktionary edition — which is why the build downloads one archive, not two.
 */

import { Buffer } from "node:buffer";

import { compareDictionaryKeys, dictionaryKey } from "./fold.mjs";

/** The pack content's own format number. A reader that does not know it refuses the pack rather than guessing. */
export const CONTENT_FORMAT = 1;

/** The pack id, spelled once: the folder name, the `about.json` field, and the meta file `pack-sign.mjs` takes. */
export const PACK_ID = "dictionary-sr-en";

/**
 * How many entries one KEY may hold.
 *
 * A cap on one key rather than on the pack: `biti` and `take` really do have
 * many senses, and a lookup that answered four hundred rows would be a lookup
 * nobody reads. What the cap drops is counted and reported, never silently
 * forgotten.
 */
export const MAX_ENTRIES_PER_KEY = 12;

/** How many English definitions a Serbian entry carries. The first two tell a reader which word this is; the fifth does not. */
export const MAX_GLOSSES = 3;

/** Whether a record is the English kind the pack's first direction is built from. */
export function isEnglishRecord(record) {
  return record.lang_code === "en";
}

/** Whether a record is the Serbo-Croatian kind the pack's second direction is built from. */
export function isSerbianRecord(record) {
  return record.lang_code === "sh";
}

/** The first English definition of a record, or `""` when it has none. */
function firstGloss(record) {
  const senses = Array.isArray(record.senses) ? record.senses : [];
  for (const sense of senses) {
    const glosses = Array.isArray(sense?.glosses) ? sense.glosses : [];
    for (const gloss of glosses) {
      if (typeof gloss === "string" && gloss.trim() !== "") return gloss.trim();
    }
  }
  return "";
}

/** Every English definition of a record, in order, deduplicated and capped — what a Serbian entry shows. */
function allGlosses(record) {
  const senses = Array.isArray(record.senses) ? record.senses : [];
  const out = [];
  for (const sense of senses) {
    const glosses = Array.isArray(sense?.glosses) ? sense.glosses : [];
    for (const gloss of glosses) {
      if (typeof gloss !== "string") continue;
      const trimmed = gloss.trim();
      if (trimmed === "" || out.includes(trimmed)) continue;
      out.push(trimmed);
      if (out.length >= MAX_GLOSSES) return out;
    }
  }
  return out;
}

/**
 * The Wiktionary page an entry came from — the attribution the Terms of Use
 * ask for.
 *
 * The record's own `source_url` wins when it carries one, because that is the
 * address the source states; otherwise the canonical page name is derived from
 * the headword, which is the same address by the wiki's own naming rule.
 */
function sourceUrl(record) {
  if (typeof record.source_url === "string" && record.source_url !== "") return record.source_url;
  const page = String(record.word ?? "").trim().replace(/ /g, "_");
  return `https://en.wiktionary.org/wiki/${encodeURIComponent(page)}`;
}

/**
 * One English record as the en-to-sr index keeps it, or `null` when this index
 * does not carry it.
 *
 * **What is kept and what is dropped, because both are decisions.**
 *
 * - Kept: records whose own language is English, that carry at least one
 *   Serbo-Croatian translation item with a non-empty word, and that have an
 *   English definition. The definition is what tells a reader which sense the
 *   translation belongs to, so an entry without one would be a Serbian word
 *   with nothing to explain it.
 * - Dropped: everything else in a 25-gigabyte extract — every other language,
 *   and every English word nobody has translated into Serbo-Croatian.
 * - Merged: the Cyrillic and Latin spellings of one Serbian word, which the
 *   source carries as two translation items. They are one word in two scripts,
 *   so they are one entry, and the folded key is what merges them.
 */
export function englishEntry(record) {
  if (!isEnglishRecord(record)) return null;
  const word = typeof record.word === "string" ? record.word.trim() : "";
  if (word === "") return null;
  const translations = Array.isArray(record.translations) ? record.translations : [];
  const words = [];
  const seen = new Set();
  for (const item of translations) {
    if (item?.lang_code !== "sh") continue;
    const translated = typeof item.word === "string" ? item.word.trim() : "";
    if (translated === "") continue;
    const key = dictionaryKey(translated);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    words.push(translated);
  }
  if (words.length === 0) return null;
  const gloss = firstGloss(record);
  if (gloss === "") return null;
  return {
    word,
    pos: typeof record.pos === "string" ? record.pos : "",
    glosses: [gloss],
    translations: words,
    url: sourceUrl(record),
  };
}

/**
 * One Serbo-Croatian record as the sr-to-en index keeps it, or `null`.
 *
 * The English definitions ARE the meaning — Wiktextract's Serbo-Croatian
 * entries carry no translation lists into English (the research measured zero),
 * which is why this direction is built from definitions rather than from a
 * second index. A record with no definition at all is dropped: a headword with
 * nothing said about it is not a dictionary entry.
 */
export function serbianEntry(record) {
  if (!isSerbianRecord(record)) return null;
  const word = typeof record.word === "string" ? record.word.trim() : "";
  if (word === "") return null;
  const glosses = allGlosses(record);
  if (glosses.length === 0) return null;
  return {
    word,
    pos: typeof record.pos === "string" ? record.pos : "",
    glosses,
    url: sourceUrl(record),
  };
}

/**
 * Records in, a sorted, grouped index out.
 *
 * A key that would hold more than {@link MAX_ENTRIES_PER_KEY} entries keeps the
 * first ones in the order the source gave them and drops the rest; `dropped` is
 * returned so the build can print it, because a silent cap is a fact nobody can
 * check.
 */
export function buildIndex(records) {
  const withKeys = records.map((entry) => ({ key: dictionaryKey(entry.word), entry }));
  withKeys.sort((left, right) => {
    const byKey = compareDictionaryKeys(left.key, right.key);
    if (byKey !== 0) return byKey;
    const byWord = compareDictionaryKeys(left.entry.word, right.entry.word);
    if (byWord !== 0) return byWord;
    return compareDictionaryKeys(left.entry.pos, right.entry.pos);
  });

  const keys = [];
  const group = [];
  const entries = [];
  let dropped = 0;
  let held = 0;
  let currentKey = null;
  for (const { key, entry } of withKeys) {
    if (key === "") {
      dropped += 1;
      continue;
    }
    if (key !== currentKey) {
      currentKey = key;
      keys.push(key);
      group.push(entries.length);
      held = 0;
    }
    if (held >= MAX_ENTRIES_PER_KEY) {
      dropped += 1;
      continue;
    }
    held += 1;
    entries.push(entry);
  }
  group.push(entries.length);
  return { keys, group, entries, dropped };
}

/** `keys.txt`: the folded keys, one per line, in the order `buildIndex` sorted them. */
export function keysFile(keys) {
  return Buffer.from(`${keys.join("\n")}\n`, "utf8");
}

/** A `uint32` array as little-endian bytes — the one encoding every platform this app ships on reads with a single call. */
export function uint32File(values) {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => buffer.writeUInt32LE(value, index * 4));
  return buffer;
}

/**
 * The entry lines and their offsets, as two buffers.
 *
 * The offsets are byte offsets into the JSONL, so the reader seeks once per hit
 * instead of scanning the file — which is the whole reason the index is not one
 * JSON document.
 */
export function entriesFile(entries) {
  const lines = [];
  const offsets = [];
  let offset = 0;
  for (const entry of entries) {
    const line = `${JSON.stringify(entry)}\n`;
    offsets.push(offset);
    lines.push(line);
    offset += Buffer.byteLength(line, "utf8");
  }
  return { jsonl: Buffer.from(lines.join(""), "utf8"), lines: uint32File(offsets) };
}

/** Everything one direction's index is made of, ready to write. */
export function indexFiles(index) {
  const { jsonl, lines } = entriesFile(index.entries);
  return {
    "keys.txt": keysFile(index.keys),
    "group.bin": uint32File(index.group),
    "lines.bin": lines,
    "entries.jsonl": jsonl,
  };
}

/**
 * The Wikivoyage phrasebook as topics of phrases.
 *
 * The source is a list of definition-list lines (`; English : Serbian
 * (pronunciation)`) under `==`/`===` headings, and the headings are the topics.
 * The text is the source's own: a phrasebook is somebody's writing, and this
 * pack may not paraphrase it — CC BY-SA keeps it verbatim.
 *
 * What the parser deliberately does NOT read: the inside of `{{…}}` templates.
 * This page carries a "Common signs" infobox whose rows are sign names, and a
 * `:` inside a template is not the phrase separator; skipping the block says
 * that rather than guessing at it.
 */
export function parsePhrasebook(wikitext) {
  const topics = [];
  const used = new Set();
  let current = null;
  let templateDepth = 0;

  for (const rawLine of wikitext.split("\n")) {
    const line = rawLine.trim();
    const wasInside = templateDepth > 0;
    templateDepth = Math.max(0, templateDepth + countOccurrences(line, "{{") - countOccurrences(line, "}}"));
    // A line that opens, sits inside or closes a template is part of it, and
    // none of it is the phrasebook: the infobox whose closing braces share a
    // line with its last row would otherwise leave that row (and the `}}`) in
    // the topic.
    if (wasInside || templateDepth > 0) continue;

    const heading = /^(={2,4})\s*(.+?)\s*\1$/.exec(line);
    if (heading !== null) {
      const depth = heading[1].length;
      const title = stripMarkup(heading[2]);
      // Only the two heading levels the source uses for topics. A level-4
      // heading on this page is a phrase somebody typed as a heading by
      // mistake, and its rows belong to the topic above it.
      current = depth <= 3 && title !== "" ? { title, phrases: [] } : null;
      if (current !== null) topics.push(current);
      continue;
    }

    if (current === null || !line.startsWith(";")) continue;
    const match = /^;\s*(.*?)\s*:\s+(.*)$/.exec(line);
    if (match === null) continue;
    const english = stripMarkup(match[1]);
    const serbian = stripMarkup(match[2]);
    if (english === "" || serbian === "") continue;
    current.phrases.push({ en: english, sr: serbian });
  }

  return topics
    .filter((topic) => topic.phrases.length > 0)
    .map((topic) => ({ id: topicId(topic.title, used), title: topic.title, phrases: topic.phrases }));
}

/** How many times `needle` occurs in `text`, without a regular expression to escape. */
function countOccurrences(text, needle) {
  let count = 0;
  let index = text.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

/** Wikitext reduced to the text it shows: comments, links, emphasis and inline templates gone. */
function stripMarkup(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\{\{[^{}]*\}\}/g, "")
    .replace(/\[\[([^[\]|]*)\|([^[\]]*)\]\]/g, "$2")
    .replace(/\[\[([^[\]]*)\]\]/g, "$1")
    .replace(/'''/g, "")
    .replace(/''/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** A kebab-case id for a topic, unique in the pack — the same rule a pack's own file ids follow. */
function topicId(title, used) {
  const base =
    dictionaryKey(title)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "topic";
  let id = base;
  let counter = 2;
  while (used.has(id)) {
    id = `${base}-${String(counter)}`;
    counter += 1;
  }
  used.add(id);
  return id;
}

/**
 * `about.json`: what the pack says about itself, so the module can answer "is
 * the pack installed, and what does it hold" without reading an index.
 */
export function aboutFile({ counts, sources, builtAt, bytes }) {
  return {
    format: CONTENT_FORMAT,
    id: PACK_ID,
    builtAt,
    licence: "CC-BY-SA-4.0",
    counts,
    bytes,
    sources,
    attribution: ATTRIBUTION,
  };
}

/**
 * The notice every pack built from this pipeline carries, verbatim — the
 * research's recommended wording, word for word.
 *
 * Written as one string because it is one notice. The Wikimedia Terms of Use
 * allow the hyperlink route for attribution and the pack takes it: every entry
 * carries its own Wiktionary URL, and this names the projects and the licence.
 */
export const ATTRIBUTION = [
  "Dictionary data derived from Wiktionary (en.wiktionary.org), created by Wiktionary",
  "contributors, licensed under CC BY-SA 4.0. Source per entry: the url field in",
  "each record (or https://en.wiktionary.org/wiki/<word>); full licence list at",
  "https://en.wiktionary.org/wiki/Wiktionary:Copyrights.",
  "Phrasebook text derived from Wikivoyage (en.wikivoyage.org), licensed CC BY-SA 4.0.",
  "Extracted with Wiktextract (MIT). This pack is licensed CC BY-SA 4.0; it is not part of,",
  "and does not change the licence of, the Nexus application.",
].join("\n");
