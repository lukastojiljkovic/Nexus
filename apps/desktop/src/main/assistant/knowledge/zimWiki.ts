import { foldSearchText, MAX_ID_LENGTH } from "@nexus/core";
import { transliterate } from "@nexus/core/pro/tekst";
import { decodeEntities } from "../web/extract.js";
import type { WikiSource, WikiTitle } from "./types.js";

/**
 * THE OFFLINE WIKI, READ: `types.ts`'s `WikiSource` over the ZIM service.
 *
 * **Why the host arrives as a structural port.** Everything below is three
 * questions - which libraries are there, what titles does one answer to a
 * prefix, and what are one entry's bytes - so the port is that and nothing more.
 * The ZIM host satisfies it as it stands, and nothing here imports it: no
 * Electron, no session, no file. A test can hand this module a table of fakes,
 * or a real `ZimReader` behind three lines of shim, and either one exercises the
 * same code the app runs.
 *
 * **Every library present on disk is searched, and a path carries its library.**
 * A machine with the Serbian Wikipedia and the English Wikibooks has two title
 * indexes and no reason to prefer one, so a question is asked of both. A
 * `WikiTitle.path` is therefore `<library id>/<entry path>`: a library id is
 * kebab-case with no `/` in it (`zim/libraries.ts`), so the first slash is the
 * boundary and `readArticle` can route an entry back to the file it came from.
 * The list is read on every call rather than remembered, because a library can
 * arrive or leave while the application runs - and with none, this source simply
 * answers no titles.
 *
 * **The keys are derived from the question, because the reader has no notion of
 * relevance.** `search` is a prefix walk over a title index in the file's own
 * byte order, so the question as typed ("Ko je bio Nikola Tesla?") matches
 * nothing. What can be a title is a run of capitalised words ("Nikola Tesla") or
 * a content word ("Francuska"), so those are the keys - and a title index cannot
 * rank, so an exact title is put before a prefix match and the rest keeps the
 * file's own order. A hit that equals a STEM is not exact, though: a stem is a
 * guess at a title's ending, and a title that happens to be spelled like one
 * ("Нико" for "Nikola") is a prefix match like any other. What comes back is
 * therefore candidates rather than an answer, and the caller asks for more of
 * them than it cites (`sources.ts`'s `WIKI_CANDIDATE_LIMIT`) so that the
 * relevance gate there, which is the only place the question is still known, has
 * something to choose from.
 *
 * **A Serbian library is also asked in Cyrillic.** sr.wikipedia writes its
 * titles in Cyrillic while its readers type Latin, so every key is
 * transliterated for a library whose own language is Serbian. That is
 * `pro/tekst.ts`'s transliterator - the one table in this repository that maps
 * the Serbian Latin alphabet onto the Cyrillic one, digraphs included - rather
 * than a second copy of the same thirty pairs. The digraphs it reports as
 * ambiguous (`nadživeti` is not *nađiveti*) cost a key that finds nothing, which
 * is the whole of the harm here: the other keys are still asked. A word is
 * also asked without its case ending (`stems`), because a question declines
 * the noun its title names. And that table reads the answer back the other way:
 * a Serbian library's titles and article text are transliterated to Latin,
 * because this app's Serbian is Latin and a passage a model can copy without
 * carrying Cyrillic into its answer is the point. A `WikiTitle.path` is left as
 * the reader wrote it - it routes back to the entry, and no transliteration of
 * it would.
 *
 * **An article is read as the plain text `leadSection` expects.** A ZIM stores
 * the HTML whoever built the pack wrote, full of scripts, infoboxes, tables,
 * references and navigation boxes; the pass at the bottom of this file keeps the
 * document's own structure - a title, headings, paragraphs - and drops the rest,
 * so a citation carries the paragraph that answers "what is this" rather than a
 * grid of coordinates. Entity decoding is `web/extract.ts`'s rule, reused: it is
 * the same question about the same bytes, and its answer (an entity this build
 * does not know is left as written) is the one that cannot invent a character.
 */

/** One library, as much of it as this adapter reads. */
export interface ZimWikiLibrary {
  readonly id: string;
  /** The ZIM's own `M/Language`, or `null` when it declares none. */
  readonly language: string | null;
  /** False when the record's file is no longer on disk. Such a library is not searched. */
  readonly present: boolean;
}

export interface ZimWikiHit {
  readonly zimPath: string;
  readonly title: string;
}

/** One entry's bytes, once the reader has followed its redirects. */
export interface ZimWikiServed {
  readonly bytes: Uint8Array;
  readonly html: boolean;
}

/**
 * What this adapter needs of the ZIM service, and no more.
 *
 * `search` is the reader's title-prefix walk and `serve` is the `nx-zim://`
 * handler's own path to an entry's bytes, redirects included - so the assistant
 * reads a library exactly the way the wiki page reads it, and a broken link is
 * answered the same way in both.
 */
export interface ZimWikiHost {
  libraries(): readonly ZimWikiLibrary[];
  search(libraryId: string, prefix: string, limit: number): readonly ZimWikiHit[];
  serve(request: { readonly libraryId: string; readonly zimPath: string }): ZimWikiServed | null;
}

/**
 * The language tags whose titles are Cyrillic: `sr`, `srp`, `sr-Latn`, `srp-Cyrl`.
 *
 * The tag rather than the language, because that is what a ZIM carries in its
 * own metadata (`M/Language`, which `zim/host.ts` records as it found it) and the
 * three spellings of the same language all mean the same thing to a
 * transliterator. `(?:p)?` is the ISO 639-3 half and the end of the tag is
 * either a separator or the end of the string - so `srn`, which is a language
 * this app has no packs for, is not read as Serbian.
 */
const SERBIAN_TAG = /^sr(?:p)?(?:[-_]|$)/;

/**
 * The words that carry no title in either language: articles, prepositions,
 * pronouns, auxiliaries, the copula and question words.
 *
 * Written FOLDED (`sta`, not `šta`) because a token is compared after
 * `foldSearchText`, and that is also what makes one list serve both scripts:
 * Cyrillic `шта` folds to `sta` and meets the same entry.
 *
 * Deliberately short, on `toolChoice.ts`'s terms: every word here is one a title
 * cannot begin with, and a longer list is a place where a real word goes
 * missing. The cost of a word wrongly dropped is one key of one question - the
 * other words still make keys - so the list errs toward keeping a word that is
 * only usually a function word.
 */
const STOP_WORDS: ReadonlySet<string> = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "can", "did",
  "do", "does", "for", "from", "had", "has", "have", "he", "her", "his", "how",
  "in", "into", "is", "it", "its", "me", "my", "not", "of", "on", "or", "our",
  "she", "so", "that", "the", "their", "them", "then", "there", "these", "they",
  "this", "those", "to", "was", "we", "were", "what", "when", "where", "which",
  "who", "whom", "whose", "why", "will", "with", "would", "you", "your",
  "ali", "bi", "bih", "bila", "bilo", "bio", "biti", "ce", "cime", "cim", "cemu",
  "da", "ga", "gde", "i", "ili", "iz", "je", "jesu", "joj", "ju", "kad", "kada",
  "kakav", "kakva", "kakvo", "kako", "kao", "kim", "ko", "kog", "koga", "koja",
  "koje", "koji", "kojih", "kojim", "koliko", "kome", "li", "me", "mi", "na",
  "nam", "nas", "ne", "nego", "nije", "njen", "njegov", "njihov", "o", "od", "on",
  "ona", "oni", "ono", "pa", "po", "pod", "s", "sa", "sam", "se", "si", "smo",
  "sta", "ste", "su", "ta", "taj", "te", "ti", "to", "tu", "u", "uz", "vam",
  "vas", "vi", "za", "zasto",
]);

/** One word of a question, in the shape the key builder compares. */
interface QueryToken {
  /** The word as the user typed it - what a key is made of. */
  readonly text: string;
  /** Folded: the shape `STOP_WORDS` is written in, and the same in both scripts. */
  readonly stop: boolean;
  readonly capitalised: boolean;
}

/** Anything that is not a letter or a digit separates words. */
const NOT_A_WORD = /[^\p{L}\p{N}]+/u;

/** The first codepoint of a word, tested for uppercase - `\p{Lu}` because it is the question's own spelling that decides. */
const UPPERCASE = /\p{Lu}/u;

/** `text` as its words: anything that is not a letter or a digit separates them. */
function wordsOf(text: string): readonly string[] {
  return text.split(NOT_A_WORD).filter((word) => word !== "");
}

/** A question as words, each carrying what the key builder decides on. */
function tokenize(query: string): QueryToken[] {
  return wordsOf(query).map((text) => ({
    text,
    stop: STOP_WORDS.has(foldSearchText(text)),
    capitalised: UPPERCASE.test([...text][0] ?? ""),
  }));
}

/**
 * `text` with its Cyrillic letters read as Latin, by `pro/tekst.ts`'s table -
 * the same one a key is asked in, and the unambiguous direction of it, because
 * Cyrillic to Latin is a substitution rather than a guess.
 *
 * The one text it refuses is one past the tool's own cap (half a million code
 * points), and that text is handed on as it stands rather than dropped: an
 * article this long is an article, and its passage is still worth citing.
 */
function transliterated(text: string): string {
  const latin = transliterate({ text, direction: "cyrillicToLatin" });
  return latin.ok ? latin.text : text;
}

/**
 * The words of a question that carry its subject: `tokenize`'s tokens minus
 * `STOP_WORDS`, each in the one form a comparison reads.
 *
 * Exported for the relevance gate in `sources.ts`. The gate judges every
 * `WikiSource` and not only this reader, but it has to read the question the way
 * the keys were built from it: a second tokenizer would be a second answer to
 * "what is this question about", and the two would disagree exactly when the
 * question is unusual.
 */
export function contentWords(query: string): readonly string[] {
  return tokenize(query)
    .filter((token) => !token.stop)
    .map((token) => foldSearchText(transliterated(token.text)));
}

/**
 * A title or a lead as the words a comparison reads, in that same one form:
 * transliterated to Latin, then folded.
 *
 * The transliteration happens BEFORE the split, because the digraph rule reads
 * the case of the letter beside a capital ("Њ" before a lower-case letter is
 * "Nj"), which a word transliterated on its own would have lost.
 */
export function comparableWords(text: string): readonly string[] {
  return wordsOf(transliterated(text)).map(foldSearchText);
}

/** The same word with its first letter upper-cased and the rest untouched. */
function upperFirst(text: string): string {
  const chars = [...text];
  const head = chars[0];
  return head === undefined ? text : head.toUpperCase() + chars.slice(1).join("");
}

/**
 * The keys one question is asked of a title index under, best first.
 *
 * Two shapes, in this order:
 *
 *   1. RUNS of capitalised words, longest run first. "Nikola Tesla" is a name
 *      and the whole point of the rule: the question around it ("Ko je bio") is
 *      not part of any title.
 *   2. The content words, longest first. A question about one thing names it in
 *      one word ("Francuska"), and length is the cheapest ordering that puts the
 *      topic before the words around it.
 *
 * Each key is tried as typed AND with its first letter upper-cased, because a
 * title index is case-sensitive (`ZimReader.titlesFrom` compares bytes) while a
 * person types `francuska`.
 */
export function searchKeys(query: string): readonly string[] {
  const tokens = tokenize(query);
  const keys: string[] = [];
  const add = (key: string): void => {
    for (const variant of [key, upperFirst(key)]) {
      if (variant !== "" && !keys.includes(variant)) keys.push(variant);
    }
  };

  for (const run of capitalisedRuns(tokens)) add(run);
  // Stable, so words of the same length keep the question's own order.
  for (const token of [...tokens].sort((left, right) => right.text.length - left.text.length)) {
    if (!token.stop) add(token.text);
  }
  return keys;
}

/**
 * The runs of capitalised words, longest first.
 *
 * A stop word ends a run rather than being skipped inside one: "Ko Je Bio
 * Nikola Tesla" is title-cased in a badly written sentence, and the words before
 * the name are not part of it.
 */
function capitalisedRuns(tokens: readonly QueryToken[]): readonly string[] {
  const runs: string[] = [];
  let run: string[] = [];
  const flush = (): void => {
    if (run.length > 0) runs.push(run.join(" "));
    run = [];
  };
  for (const token of tokens) {
    if (token.capitalised && !token.stop) run.push(token.text);
    else flush();
  }
  flush();
  return runs.sort((left, right) => wordCount(right) - wordCount(left) || right.length - left.length);
}

function wordCount(text: string): number {
  return text.split(" ").length;
}

/**
 * The Cyrillic spelling of a key.
 *
 * A key this table has no letter for - `q`, an English name in a Serbian
 * library - comes back unchanged, and the caller's deduplication drops the
 * second search rather than making it. A refusal (the tool's own text cap,
 * which no question reaches) answers `""`, which is treated the same way.
 */
function cyrillicSpelling(key: string): string {
  const translated = transliterate({ text: key, direction: "latinToCyrillic" });
  return translated.ok ? translated.text : "";
}

/**
 * The shorter spellings a word is also asked under in a Serbian library: the
 * word less its last letter, and less its last two.
 *
 * Serbian declines its nouns ("o Beogradu", "glavni grad Francuske") while a
 * title is the nominative ("Београд", "Француска"), and a prefix walk cannot
 * see past an ending. A case ending is one or two letters, so the cut word is
 * the title itself or a prefix of it - and either way the hit is a prefix match,
 * because a stem is a guess at an ending and a guess cannot make a title exact.
 * A wrong cut costs a search that finds nothing, or prefix matches the caller's
 * relevance gate then drops. Only single words are cut, and never below four
 * letters: that floor is a POLICY CHOICE rather than a measurement, since no
 * fixed rule separates a case ending from the word's own tail.
 */
function stems(key: string): readonly string[] {
  if (key.includes(" ")) return [];
  const chars = [...key];
  return [1, 2].filter((cut) => chars.length - cut >= 4).map((cut) => chars.slice(0, -cut).join(""));
}

/** `<library id>/<entry path>`, and back. The id has no slash in it, so the first one is the boundary. */
function titlePath(libraryId: string, zimPath: string): string {
  return `${libraryId}/${zimPath}`;
}

/** Whether a library's own language is one whose titles are Cyrillic. */
function isSerbian(library: ZimWikiLibrary): boolean {
  return SERBIAN_TAG.test((library.language ?? "").trim().toLowerCase());
}

/** The knowledge base's `WikiSource`, over one ZIM service. */
export function zimWikiSource(host: ZimWikiHost): WikiSource {
  return {
    async searchTitles(query: string, limit: number, signal: AbortSignal): Promise<readonly WikiTitle[]> {
      if (limit <= 0) return [];
      const keys = searchKeys(query);
      if (keys.length === 0) return [];
      // Read on every call: a library the user downloads while the application
      // runs is readable from the next question, and one whose file is gone is
      // not read at all.
      const libraries = host.libraries().filter((library) => library.present);
      if (libraries.length === 0) return [];

      const exact: WikiTitle[] = [];
      const prefixed: WikiTitle[] = [];
      const seen = new Set<string>();
      /** What has been collected, which is what the caller's budget is spent on. */
      const collected = (): number => exact.length + prefixed.length;

      /**
       * One prefix, one library: a hit is the key itself or a title that starts
       * with it.
       *
       * `fromKey` is what decides whether a hit can be EXACT, and it is false
       * for a stem: a stem is a guess at a title's ending, so a hit that merely
       * equals one is a prefix match like the rest.
       */
      const ask = (library: ZimWikiLibrary, prefix: string, fromKey: boolean): void => {
        if (collected() >= limit) return;
        const serbian = isSerbian(library);
        for (const hit of host.search(library.id, prefix, limit)) {
          const path = titlePath(library.id, hit.zimPath);
          // A path is what the citation's `id` becomes, and `MAX_ID_LENGTH` is
          // the bound every identifier in this product lives under - the
          // conversation store refuses one past it when a turn is written, which
          // would cost the user the whole answer rather than one citation. A
          // library id is up to 64 characters and a ZIM path up to a few
          // hundred, so a title this long is one this seam cannot cite, and a
          // title it cannot cite is not one it offers.
          if (path.length > MAX_ID_LENGTH) continue;
          if (seen.has(path)) continue;
          seen.add(path);
          const title = serbian ? transliterated(hit.title) : hit.title;
          // The reader's OWN title is what is compared: a Serbian library's
          // transliterated title would never equal the Cyrillic spelling of the
          // key it was found under.
          if (fromKey && hit.title === prefix) exact.push({ path, title });
          else if (collected() < limit) prefixed.push({ path, title });
        }
      };

      const answer = (): readonly WikiTitle[] => [...exact, ...prefixed].slice(0, limit);
      // Every key is asked, because the ranking is no longer this reader's: a
      // title index answers in byte order, and the caller ranks what comes back
      // by how much of the question each candidate carries. Stopping at the
      // first key that filled a list would hand the gate the one thing it cannot
      // fix, which is a candidate it never saw.
      for (const key of keys) {
        if (signal.aborted) return answer();
        if (collected() >= limit) return answer();
        for (const library of libraries) {
          if (signal.aborted) return answer();
          if (!isSerbian(library)) {
            ask(library, key, true);
            continue;
          }
          // The stems right after their word, so that what they reach is
          // collected before the next, less likely word's.
          for (const spelling of [key, ...stems(key)]) {
            const fromKey = spelling === key;
            ask(library, spelling, fromKey);
            const cyrillic = cyrillicSpelling(spelling);
            if (cyrillic !== spelling) ask(library, cyrillic, fromKey);
          }
        }
      }
      return answer();
    },

    async readArticle(path: string, signal: AbortSignal): Promise<string> {
      if (signal.aborted) return "";
      const boundary = path.indexOf("/");
      if (boundary <= 0 || boundary === path.length - 1) return "";
      const libraryId = path.slice(0, boundary);
      const zimPath = path.slice(boundary + 1);

      let served: ZimWikiServed | null;
      try {
        served = host.serve({ libraryId, zimPath });
      } catch {
        // The reader refuses an entry it cannot serve - a cluster this build has
        // no decompressor for, a file that moved under it. "This build cannot
        // read that article" is then the honest answer, and the citation is the
        // one the caller decides not to make.
        return "";
      }
      // An entry that is not a document - an image, a stylesheet - has no lead
      // to read, and the caller would rather know that than see its bytes.
      if (served === null || !served.html) return "";
      const text = articleText(new TextDecoder("utf-8", { fatal: false }).decode(served.bytes));
      // The article follows the titles `searchTitles` returns, in the app's own
      // script: a Serbian library writes Cyrillic and this app's Serbian is
      // Latin, so a passage that answers a Serbian question is one the model can
      // quote without answering in the script it copied. The library is looked
      // up rather than remembered - for the reason the list is read afresh - and
      // a path whose library is no longer listed is read as it stands.
      const library = host.libraries().find((candidate) => candidate.id === libraryId);
      return library !== undefined && isSerbian(library) ? transliterated(text) : text;
    },
  };
}

// --- the article, as text ------------------------------------------------------

/**
 * Elements whose whole content is dropped, whatever it says.
 *
 * The first ten are `web/extract.ts`'s set, for its reasons: a script body is
 * code, a `<head>` is instructions to a browser, and a Zimit pack's payload
 * inside one has no business being read into an answer. The rest are the wiki's:
 * a TABLE is a grid of infobox values and of navigation boxes (Wikipedia's
 * navboxes are tables), and a FIGURE is its caption's picture. `audio` and
 * `video` are here for their fallback text, which is a browser's own message.
 */
const DROPPED_ELEMENTS: ReadonlySet<string> = new Set([
  "script", "style", "noscript", "template", "svg", "head", "iframe", "object", "embed", "canvas",
  "table", "figure", "audio", "video",
]);

/**
 * Classes that mark the encyclopaedia's own frame rather than its prose.
 *
 * By class because that is where Wikipedia puts the furniture: `infobox` and
 * `navbox` on the boxes themselves, `references`/`reflist` on the citation list
 * and `reference` on the `[1]` marker in the sentence, `mw-editsection` on the
 * "edit" links beside every heading, `toc` on the table of contents. A name this
 * list does not have is left in the text: a stray "Bibliography" heading is a
 * smaller loss than prose dropped for looking like furniture.
 */
const DROPPED_CLASSES: ReadonlySet<string> = new Set([
  "infobox", "navbox", "reflist", "references", "reference", "mw-references-wrap",
  "mw-editsection", "toc", "metadata", "thumb", "hatnote", "noprint",
]);

/** Elements that end the line they stand in, whether they open or close. */
const BLOCK_ELEMENTS: ReadonlySet<string> = new Set([
  "address", "article", "aside", "blockquote", "br", "caption", "dd", "div", "dl", "dt",
  "figcaption", "footer", "header", "hr", "li", "main", "nav", "ol", "p", "pre",
  "section", "td", "th", "tr", "ul",
]);

/** The heading elements, which end a line and become one. */
const HEADING_ELEMENTS: ReadonlySet<string> = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/** Tags, comments and CDATA as one token stream, exactly as `web/extract.ts` scans one. */
const TOKEN_PATTERN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[a-zA-Z/!][^>]*>|<|[^<]+/g;

/** The element a tag token names, or `null` for a token that names none. */
const TAG_NAME = /^<(\/)?\s*([a-zA-Z][a-zA-Z0-9:-]*)/;

/** A `class` attribute, in either quoting. Wikipedia's output uses double quotes; a hand-written page may not. */
const CLASS_ATTRIBUTE = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

function tagOf(token: string): { readonly name: string; readonly closing: boolean } | null {
  const match = TAG_NAME.exec(token);
  if (match === null) return null;
  return { name: (match[2] ?? "").toLowerCase(), closing: match[1] === "/" };
}

/** Whether this opening tag starts a region no reader wants - by element name or by class. */
function dropsElement(name: string, token: string): boolean {
  if (DROPPED_ELEMENTS.has(name)) return true;
  const classes = CLASS_ATTRIBUTE.exec(token);
  const value = classes?.[1] ?? classes?.[2] ?? "";
  return value
    .toLowerCase()
    .split(/\s+/)
    .some((className) => DROPPED_CLASSES.has(className));
}

/** Runs of whitespace become one space and the ends are trimmed - the shape a line of a paragraph has. */
function collapse(text: string): string {
  return text.replace(/[\s\u00a0]+/g, " ").trim();
}

/**
 * One article's HTML as the Markdown-ish text `leadSection` reads: a `#` title,
 * `##` headings, and paragraphs separated by blank lines.
 *
 * A single pass over the token stream, in the shape `web/extract.ts` uses, and
 * it is a separate pass because the two answer different questions: that one
 * wants the visible prose of ANY page, and this one wants the structure of an
 * article - which heading is which, where one paragraph ends and the next begins
 * - so that the part of it that is the lead can be cut out afterwards.
 *
 * The `#` is the FIRST `h1` and a `##` is every other heading, which is what a
 * pack's own output gives: the article's title is the page's one `h1` and the
 * sections below it are `h2`s. A page whose headings are all `h2` - which is
 * what a Parsoid-derived article looks like - therefore opens with its first
 * section, and `leadSection` strips that heading and reads the text under it,
 * which is still the article's opening.
 */
export function articleText(html: string): string {
  const paragraphs: string[] = [];
  let current = "";
  /** The dropped elements still open, innermost last. */
  const dropped: string[] = [];
  let titleSeen = false;

  /** Decode first, collapse second: an entity that means whitespace has to count as whitespace. */
  const flush = (): void => {
    const text = collapse(decodeEntities(current));
    current = "";
    if (text !== "") paragraphs.push(text);
  };

  for (const token of html.match(TOKEN_PATTERN) ?? []) {
    if (token.startsWith("<!--") || token.startsWith("<![CDATA[")) continue;
    // A lone `<` is text (`a < b`), not a truncated tag.
    if (token === "<") {
      if (dropped.length === 0) current += token;
      continue;
    }
    if (token.startsWith("<")) {
      const tag = tagOf(token);
      if (tag === null) continue;
      if (tag.closing) {
        const open = dropped.lastIndexOf(tag.name);
        // A close tag ends the dropped region it belongs to AND everything
        // nested inside it, which is what truncating the stack does.
        if (open !== -1) {
          dropped.length = open;
          continue;
        }
        if (BLOCK_ELEMENTS.has(tag.name)) flush();
        continue;
      }
      if (dropped.length > 0) {
        // A nested element that also holds furniture, or one that merely shares
        // the open element's name, has to be pushed as well - otherwise its own
        // close tag would end the region a level early and leak the rest of it
        // into the text.
        if (dropsElement(tag.name, token) || dropped.includes(tag.name)) dropped.push(tag.name);
        continue;
      }
      if (dropsElement(tag.name, token)) {
        flush();
        dropped.push(tag.name);
        continue;
      }
      if (HEADING_ELEMENTS.has(tag.name)) {
        flush();
        // The article's own title is the page's first `h1`; every other heading
        // is a section below it.
        const isTitle = tag.name === "h1" && !titleSeen;
        if (tag.name === "h1") titleSeen = true;
        current = isTitle ? "# " : "## ";
        continue;
      }
      if (tag.name === "li") {
        flush();
        current = "- ";
        continue;
      }
      if (BLOCK_ELEMENTS.has(tag.name)) flush();
      continue;
    }
    if (dropped.length === 0) current += token;
  }
  flush();
  return paragraphs.join("\n\n");
}
