import { clozeNumbers, findClozeRuns, renderClozeCard } from "../study/clozeText.js";
import type { ExportCard, ExportDeck, ExportSubject, ProfileData } from "./exportArchive.js";
import { walkProtoFields } from "./protoWalk.js";

/**
 * The pure half of the Anki `.apkg` import (ADR-052 / STUDY-011): somebody
 * else's collection, already read off disk by `main/apkgReader.ts`, turned into
 * the `ProfileData` `planForeignImport` merges and an honest account of
 * everything that did not survive the crossing.
 *
 * The split is the same one every other import in this package makes. The
 * READER is where untrusted bytes live — a zip, a foreign SQLite file, a
 * protobuf manifest — and it answers with plain numbers and strings. THIS
 * module is pure: no clock (`now` is injected), no id generator (the ids below
 * are deterministic source-side names the planner mints over), no IO. That is
 * what lets every rule here be tested against an adversarial fixture rather
 * than against a real `.apkg` somebody had to produce.
 *
 * Three decisions shape everything below, and each is a refusal to guess:
 *
 *  - **Text is text.** Anki fields are HTML. `stripAnkiHtml` reduces one to the
 *    plain text a Nexus card holds, decoding entities AFTER the markup is gone
 *    (so `&lt;script&gt;` can never become a tag), keeping `$…$`, rewriting the
 *    two MathJax spellings into it, and COUNTING — never silently swallowing —
 *    every image and sound reference it removes. v1 carries no media, and the
 *    preview says so in a number.
 *  - **A cloze note either translates exactly or does not translate at all.**
 *    `canonicalizeCloze` keeps Anki's own `{{cN::…}}` numbers — since ADR-068
 *    they are Nexus's numbers too — and then CHECKS its own output against
 *    `findClozeRuns`, core's own reader of that grammar. Anything the check
 *    disagrees with is refused by name. A cloze card whose blanks landed one
 *    position off would be worse than a card that never arrived.
 *  - **No scheduling history crosses.** Every card is born new, at `now`, in
 *    exactly the shape `createEmptyCard` gives one (`CardStore.insertNew`).
 *    FSRS's parameters are not Anki's SM-2 ones, and a stability invented from
 *    an interval would be a fabricated number in the user's own study data.
 */

// --- Field text --------------------------------------------------------------

/** One Anki field, reduced to plain text, plus what was taken out of it. */
export interface AnkiFieldText {
  text: string;
  /** `<img>` references removed — v1 carries no media, so these are counted and named. */
  images: number;
  /** `[sound:…]` references removed, on the same terms. */
  sounds: number;
}

/**
 * Tags that separate BLOCKS of text: each becomes a newline, because the words
 * on either side of one were never on the same line. Everything else is
 * unwrapped in place (`<b>`, `<span>`, `<a>`), because its text continues the
 * sentence around it.
 */
const BLOCK_TAGS = new Set([
  "br",
  "div",
  "p",
  "li",
  "ul",
  "ol",
  "tr",
  "td",
  "th",
  "table",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
]);

/** The opener of Anki's own media reference in a field: `[sound:whatever.mp3]`. */
const SOUND_OPEN = "[sound:";

/**
 * Every `[sound:...]` reference in `field`, removed in one forward pass.
 *
 * A scan rather than the pattern it replaces, and for `ANY_TAG`'s reason
 * below: with no closing bracket in the tail, `/\[sound:[^\]]*\]/g` re-walks
 * every remaining character from each `[sound:` start, which is quadratic on a
 * field built to repeat the prefix (#7). `indexOf` visits each character once
 * and finds the same references: leftmost first, non-overlapping, an empty
 * body included, and one that never closes left exactly as it was typed.
 */
function removeSoundReferences(field: string): { text: string; sounds: number } {
  let text = "";
  let sounds = 0;
  let cursor = 0;
  for (;;) {
    const open = field.indexOf(SOUND_OPEN, cursor);
    if (open === -1) break;
    const close = field.indexOf("]", open + SOUND_OPEN.length);
    // No bracket after this opener means none after a later one either, so the
    // rest of the field is text.
    if (close === -1) break;
    text += field.slice(cursor, open);
    sounds += 1;
    cursor = close + 1;
  }
  return { text: text + field.slice(cursor), sounds };
}
/** How far before a join a new opener's `<` can sit: its name comes from the text in front of it. */
const SCRIPT_OR_STYLE_LOOKBACK = 7;

/** The two names whose element takes its contents with it. */
type ScriptOrStyle = "script" | "style";

/** The two names whose element takes its contents with it. */
const SCRIPT_OR_STYLE_NAMES: readonly ScriptOrStyle[] = ["script", "style"];

/** The closer a walk has found for one name, and how far its raw search has reached. */
interface CloserState {
  closer: { start: number; end: number } | null;
  reached: number;
}

/** The canonical key for a name `nameAt` matched against `SCRIPT_OR_STYLE_NAMES`. */
function asScriptOrStyle(name: string): ScriptOrStyle {
  return name.toLowerCase() === "style" ? "style" : "script";
}

/** `<img ...>`: the one tag counted rather than unwrapped, because v1 carries no media. */
const IMAGE_NAMES: readonly string[] = ["img"];

/** The newer editor's math element, whose content is TeX. */
const ANKI_MATHJAX_NAMES: readonly string[] = ["anki-mathjax"];

// The four patterns that used to live here — a `<script>`/`<style>` element, an
// `<img …>`, any `<tag …>` and `<anki-mathjax>…</anki-mathjax>` — all carried
// the same `[^>]*>` shape, and it is quadratic even though `[^>]*` itself never
// backtracks WITHIN one start: the engine re-runs it from EVERY `<` in the
// field, so a field at the reader's 256 KiB cap built from one opener repeated
// with no terminator re-walks the whole tail per start — measured at 9.3 s for
// the any-tag pattern, 3.7 s for `<img`, 2.4 s for `<script `, 1.8 s for
// `<anki-mathjax`, and 3.7 s each for the two `\(`/`\[` MathJax spellings.
//
// They are scans now, on the fact a regex engine cannot use: when a start has
// no terminator after it, no LATER start has one either, so the rest of the
// field is text and each character is visited once. Inside an element the fact
// is per NAME — a `<script>` opener with no `</script>` says nothing about a
// `<style>` one — and each found closer advances the scan past itself, so the
// searches cannot overlap.
//
// Identical output is the contract, and it is a real one: the scanners
// reproduce `String.replace`'s leftmost-first, non-overlapping walk, the `i`
// flag's exact folding, `\b`'s ASCII word boundary, and `ANY_TAG`'s name
// CAPTURE, whose greedy `[a-zA-Z0-9-]*` backtracks to the longest prefix that
// ends on a boundary — `<div->` captures `div` (a block tag) and not `div-`.
// A differential fuzz against the old patterns in the test pins every case.

function isAsciiLetter(ch: string | undefined): boolean {
  return ch !== undefined && ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z"));
}

/** The tag-name characters, as `ANY_TAG` above reads them. */
function isTagNameChar(ch: string | undefined): boolean {
  return isAsciiLetter(ch) || (ch !== undefined && ch >= "0" && ch <= "9") || ch === "-";
}

/** A word character in the sense `\b` uses: ASCII letters, digits and the underscore. The hyphen is a NAME character but not a word one, which is why `<a->` is a tag named `a`. */
function isWordChar(ch: string | undefined): boolean {
  return isAsciiLetter(ch) || (ch !== undefined && ch >= "0" && ch <= "9") || ch === "_";
}

/** `\b` between two characters: exactly one of the pair is a word character. */
function isBoundary(before: string | undefined, after: string | undefined): boolean {
  return isWordChar(before) !== isWordChar(after);
}

/** One character of `\s`, which is what a closer allows before its `>`. */
function isSpace(ch: string | undefined): boolean {
  return ch !== undefined && /\s/.test(ch);
}

/** One opener a scan found: the name it captured and the index just past the opener's `>`. */
interface TagOpener {
  readonly at: number;
  readonly name: string;
  readonly after: number;
}

/**
 * The `i` flag's canonicalization, spelled as the engine's own non-Unicode rule:
 * `toUpperCase`, unless that is not one character or BOTH sides are non-ASCII.
 * The last clause is the one that matters — U+212A KELVIN SIGN lowercases to
 * `k`, so a `toLowerCase()` compare would read `<an\u212Ai-mathjax>` as the
 * math element, which `/anki-mathjax/i` (no `u` flag) does not.
 */
function canonical(ch: string): string {
  const upper = ch.toUpperCase();
  if (upper.length !== 1) return ch;
  if (ch.charCodeAt(0) >= 128 && upper.charCodeAt(0) >= 128) return ch;
  return upper;
}

/** True when the literal (lower-case, ASCII) `name` sits at `at` under one of the patterns' `i` flag. */
function literalNameAt(text: string, at: number, name: string): boolean {
  if (at + name.length > text.length) return false;
  for (let index = 0; index < name.length; index += 1) {
    if (canonical(text.charAt(at + index)) !== name.charAt(index).toUpperCase()) return false;
  }
  return true;
}

/**
 * The name a tag at `at` carries: the longest one that ends at a word boundary.
 *
 * The backtracking matters only for `ANY_TAG`'s open class, where `\b` is tried
 * after the greedy name and then after shorter ones — that is what makes
 * `<a->` a tag named `a` and not one named `a-`. A LITERAL name backtracks into
 * nothing, so `<anki-mathjax_>` is not the math element at all.
 */
function nameAt(
  text: string,
  at: number,
  names: readonly string[] | null,
): { name: string; end: number } | null {
  if (text[at] !== "<") return null;
  let cursor = at + 1;
  if (names === null && text[cursor] === "/") cursor += 1;
  const nameStart = cursor;
  if (names !== null) {
    const found = names.find((name) => literalNameAt(text, nameStart, name));
    if (found === undefined) return null;
    return isBoundary(text[nameStart + found.length - 1], text[nameStart + found.length])
      ? { name: found, end: nameStart + found.length }
      : null;
  }
  if (!isAsciiLetter(text[cursor])) return null;
  cursor += 1;
  while (isTagNameChar(text[cursor])) cursor += 1;
  for (let length = cursor - nameStart; length > 0; length -= 1) {
    const end = nameStart + length;
    if (isBoundary(text[end - 1], text[end])) return { name: text.slice(nameStart, end), end };
  }
  return null;
}

/**
 * The opener at `at`, read the way the patterns above read one: `<`, an optional
 * `/`, a name, a word boundary, then anything up to the first `>`.
 *
 * `names` is the closed set of names to accept, matched case-insensitively;
 * `null` selects `ANY_TAG`'s own class instead (any name at all, case-sensitive).
 *
 * `"no-terminator"` is the fact that makes every scan below linear. The pattern
 * needs a `>` somewhere after `at`, and there is none left in the field, so no
 * LATER start can match either and the caller may stop: the rest is text. A
 * regular expression cannot use that fact, which is why these patterns re-walked
 * the tail from every `<` - nine seconds on one 256 KiB field of `<a`.
 */
function matchTagOpener(
  text: string,
  at: number,
  names: readonly string[] | null,
): TagOpener | "no-terminator" | null {
  const named = nameAt(text, at, names);
  if (named === null) return null;
  const gt = text.indexOf(">", named.end);
  if (gt === -1) return "no-terminator";
  return { at, name: named.name, after: gt + 1 };
}

/** The first `</name\s*>` at or after `from`: where it starts and where it ends. */
function closerSpan(
  text: string,
  from: number,
  name: string,
): { start: number; end: number } | null {
  let cursor = from;
  for (;;) {
    const open = text.indexOf("</", cursor);
    if (open === -1) return null;
    if (literalNameAt(text, open + 2, name)) {
      let after = open + 2 + name.length;
      while (isSpace(text[after])) after += 1;
      if (text[after] === ">") return { start: open, end: after + 1 };
    }
    cursor = open + 2;
  }
}

/** Every tag, with the name captured: a newline for a block tag, nothing for the rest. */
function stripTags(text: string): string {
  // `kept` is where the text still owed to the output starts; `search` is where
  // the next `<` is looked for. Only a MATCH moves `kept` - a candidate that
  // fails is a character that stays in the text.
  let out = "";
  let kept = 0;
  let search = 0;
  for (;;) {
    const at = text.indexOf("<", search);
    if (at === -1) break;
    const opener = matchTagOpener(text, at, null);
    if (opener === "no-terminator") break;
    if (opener === null) {
      search = at + 1;
      continue;
    }
    out += text.slice(kept, at);
    out += BLOCK_TAGS.has(opener.name.toLowerCase()) ? "\n" : "";
    kept = opener.after;
    search = opener.after;
  }
  return out + text.slice(kept);
}

/** Every `<img ...>`, counted and removed. */
function removeImageTags(text: string): { text: string; images: number } {
  let out = "";
  let images = 0;
  let kept = 0;
  let search = 0;
  for (;;) {
    const at = text.indexOf("<", search);
    if (at === -1) break;
    const opener = matchTagOpener(text, at, IMAGE_NAMES);
    if (opener === "no-terminator") break;
    if (opener === null) {
      search = at + 1;
      continue;
    }
    out += text.slice(kept, at);
    images += 1;
    kept = opener.after;
    search = opener.after;
  }
  return { text: out + text.slice(kept), images };
}

/** `<anki-mathjax ...>body</anki-mathjax>` rewritten as `$body$`. */
function rewriteAnkiMathjax(text: string): string {
  let out = "";
  let kept = 0;
  let search = 0;
  for (;;) {
    const at = text.indexOf("<", search);
    if (at === -1) break;
    const opener = matchTagOpener(text, at, ANKI_MATHJAX_NAMES);
    if (opener === "no-terminator") break;
    if (opener === null) {
      search = at + 1;
      continue;
    }
    const closer = closerSpan(text, opener.after, ANKI_MATHJAX_NAMES[0] ?? "");
    // No closer in the tail means no later opener can have one either.
    if (closer === null) break;
    out += text.slice(kept, at) + "$" + text.slice(opener.after, closer.start) + "$";
    kept = closer.end;
    search = closer.end;
  }
  return out + text.slice(kept);
}

/**
 * `\(...\)` and `\[...\]` rewritten as `$...$`, which is the delimiter a Nexus
 * card's own KaTeX rendering reads. `open` and `close` are the two-character
 * spellings, so one scan serves both.
 */
function rewriteDelimited(text: string, open: string, close: string): string {
  let out = "";
  let cursor = 0;
  for (;;) {
    const at = text.indexOf(open, cursor);
    if (at === -1) break;
    const end = text.indexOf(close, at + open.length);
    // No closer in the tail means no later opener can have one either.
    if (end === -1) break;
    out += text.slice(cursor, at) + "$" + text.slice(at + open.length, end) + "$";
    cursor = end + close.length;
  }
  return out + text.slice(cursor);
}

/**
 * A `<script>`/`<style>` element AND its contents removed, to the fixed point
 * `#12` needed, in one forward walk.
 *
 * The pattern this replaces was quadratic twice over. `[^>]*` cannot backtrack
 * WITHIN one start, but the engine re-runs the pattern from EVERY `<`, so a
 * 256 KiB field of `<script ` with no terminator re-walked the tail per start
 * (2.5 s measured). And reaching the fixed point with one pass per joined element
 * cost a walk of the whole field per element (a crafted chain of 15 000 of them:
 * 76 s, measured).
 *
 * One walk is enough because of what a join can and cannot do:
 *
 *  - a start with no `>` after it has no later start with one either, so the scan
 *    stops there and the rest of the field is text;
 *  - removal can join the text on either side into a NEW opener or a NEW closer,
 *    but only out of the characters it just joined - an opener is longer than
 *    `SCRIPT_OR_STYLE_LOOKBACK`, so one born at a join starts inside the held tail
 *    of the kept text and the head of the unread text finishes it;
 *  - a NEW closer can only close an opener that was already there and had no
 *    closer, which is the one `waiting` remembers per name: the walk therefore
 *    resumes at that opener, not only at the join.
 *
 * The closer search is in two parts and neither re-walks the field: the window
 * above (a join can only have built a closer there), then the raw text from
 * wherever the last search for that name stopped - the raw text never changes,
 * and every deletion is behind the cursor, so one cursor per name is enough.
 */
function stripScriptAndStyle(text: string): string {
  let kept = "";
  let unread = 0;
  /** The kept-text position of the leftmost opener of each name that has no closer. */
  const waiting: { script: number | null; style: number | null } = { script: null, style: null };
  /** Per name: the next closer found, and how far the raw search has reached. */
  const state: { script: CloserState; style: CloserState } = {
    script: { closer: null, reached: 0 },
    style: { closer: null, reached: 0 },
  };
  for (;;) {
    // The held tail reaches back to a waiting opener, because a join can now have
    // built the closer that opener was missing.
    let holdStart = Math.max(0, kept.length - SCRIPT_OR_STYLE_LOOKBACK);
    for (const name of SCRIPT_OR_STYLE_NAMES) {
      const at = waiting[name];
      if (at !== null && at < holdStart) holdStart = at;
    }
    const hold = kept.slice(holdStart);
    const head = text.slice(unread, unread + 24);
    const window = hold + head;
    const toCurrent = (raw: number): number => kept.length + (raw - unread);
    const endCurrent = (at: number): number =>
      at < hold.length ? holdStart + at : toCurrent(unread + (at - hold.length));
    const closerEnd = (name: ScriptOrStyle, after: number, fromRaw: number): number => {
      // (a) a closer the last deletion may have joined together
      for (let at = 0; at + 2 <= window.length; at += 1) {
        if (endCurrent(at) < after) continue;
        if (window.slice(at, at + 2).toLowerCase() !== "</") continue;
        if (window.slice(at + 2, at + 2 + name.length).toLowerCase() !== name) continue;
        const rawNameEnd = unread + Math.max(0, at + 2 + name.length - hold.length);
        let scan = Math.max(rawNameEnd, unread);
        while (isSpace(text[scan])) scan += 1;
        if (text[scan] !== ">") continue;
        const end = toCurrent(scan + 1);
        if (end >= after) return end;
      }
      // (b) the raw text, from where the last search for this name stopped
      const st = state[name];
      const cursor = Math.max(unread, fromRaw, st.reached);
      if (st.closer !== null && st.closer.start >= cursor) return toCurrent(st.closer.end);
      let at = text.indexOf("</", cursor);
      while (at !== -1) {
        if (text.slice(at + 2, at + 2 + name.length).toLowerCase() === name) {
          let scan = at + 2 + name.length;
          while (isSpace(text[scan])) scan += 1;
          if (text[scan] === ">") {
            st.closer = { start: at, end: scan + 1 };
            st.reached = at;
            return toCurrent(scan + 1);
          }
        }
        at = text.indexOf("</", at + 2);
      }
      st.closer = null;
      st.reached = text.length;
      return -1;
    };
    // 1. An opener starting in the held tail, which the unread text finishes.
    let outcome: { hold: boolean; at: number; name: string; end: number } | null = null;
    for (let at = 0; at < hold.length && outcome === null; at += 1) {
      const named = nameAt(window, at, SCRIPT_OR_STYLE_NAMES);
      if (named === null) continue;
      const name = asScriptOrStyle(named.name);
      const rawNameEnd = unread + Math.max(0, named.end - hold.length);
      const gt = text.indexOf(">", rawNameEnd);
      if (gt === -1) return kept + text.slice(unread);
      const end = closerEnd(name, toCurrent(gt + 1), gt + 1);
      if (end === -1) {
        if (waiting[name] === null) waiting[name] = holdStart + at;
        continue;
      }
      outcome = { hold: true, at, name, end };
    }
    // 2. An opener wholly inside the unread text.
    if (outcome === null) {
      let at = text.indexOf("<", unread);
      while (at !== -1) {
        const named = nameAt(text, at, SCRIPT_OR_STYLE_NAMES);
        if (named !== null) {
          const name = asScriptOrStyle(named.name);
          const gt = text.indexOf(">", named.end);
          if (gt === -1) return kept + text.slice(unread);
          const end = closerEnd(name, toCurrent(gt + 1), gt + 1);
          if (end === -1) {
            if (waiting[name] === null) waiting[name] = toCurrent(at);
          } else {
            outcome = { hold: false, at, name, end };
            break;
          }
        }
        at = text.indexOf("<", at + 1);
      }
      if (outcome === null) return kept + text.slice(unread);
    }
    // A waiting opener is exactly the case this walk deliberately does not try to
    // finish: a closer a join built for an opener it has already passed. The
    // committed loop answers it, and it is rare enough to cost nothing.
    if (waiting.script !== null || waiting.style !== null) return stripScriptAndStyleByPattern(text);
    const rawEnd = unread + (outcome.end - kept.length);
    kept = outcome.hold ? kept.slice(0, holdStart + outcome.at) : kept + text.slice(unread, outcome.at);
    unread = rawEnd;
    waiting.script = null;
    waiting.style = null;
  }
}


/**
 * `stripScriptAndStyle` as the pattern reads it, to the fixed point: the answer the
 * walk above must agree with, kept as the fallback for the one case it declines
 * (and as the oracle its differential test pins it against).
 */
function stripScriptAndStyleByPattern(text: string): string {
  let previous: string;
  do {
    previous = text;
    text = text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  } while (text !== previous);
  return text;
}


/** A named or numeric character reference, WITH its terminating semicolon — a `&amp` that never closed is not an entity and stays as it was typed. */
const ENTITY = /&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g;

/** The named entities Anki's own editor writes. An unknown name is left literal rather than guessed at. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  // U+00A0, written as an escape: a raw one is invisible and every tool in
  // the chain treats it differently.
  nbsp: "\u00a0",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  bdquo: "„",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  deg: "°",
  times: "×",
  divide: "÷",
  plusmn: "±",
  micro: "µ",
  middot: "·",
  eacute: "é",
  szlig: "ß",
};

/** Above this, a numeric reference names no character — decoding it would throw, so the reference is left literal. */
const MAX_CODE_POINT = 0x10ffff;

function decodeEntities(text: string): string {
  return text.replace(ENTITY, (whole, body: string) => {
    if (body.startsWith("#")) {
      const digits = body.startsWith("#x") || body.startsWith("#X") ? body.slice(2) : body.slice(1);
      const code = Number.parseInt(digits, body.startsWith("#x") || body.startsWith("#X") ? 16 : 10);
      if (!Number.isInteger(code) || code < 0 || code > MAX_CODE_POINT) return whole;
      // Surrogate halves are not characters; `String.fromCodePoint` accepts
      // them and would produce a lone surrogate in the middle of a card.
      if (code >= 0xd800 && code <= 0xdfff) return whole;
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}


/**
 * One Anki field as plain Nexus card text.
 *
 * ORDER IS THE SECURITY PROPERTY here, and it is worth stating outright:
 * entities are decoded LAST, after every tag is already gone. A field carrying
 * `&lt;script&gt;alert(1)&lt;/script&gt;` therefore ends up as that text,
 * visible, and can never be re-read as markup by anything downstream — which is
 * exactly what would happen if the two steps were the other way round.
 *
 * Every step is one forward scan rather than a pattern, and that is load-bearing
 * rather than tidy: `[^>]*` cannot backtrack WITHIN one start, but a regular
 * expression still re-runs it from every `<`, so a 256 KiB field (the reader's
 * per-field cap) of `<a` with no `>` spent nine seconds in the strip. A scan can
 * use the fact an engine cannot: when a start has no terminator after it, no
 * LATER start has one either, so the rest of the field is text.
 */
export function stripAnkiHtml(field: string): AnkiFieldText {
  const soundRefs = removeSoundReferences(field);
  let text = soundRefs.text;
  const sounds = soundRefs.sounds;

  // The fixed point #12 needs: one removal can join the text on either side into
  // the element AROUND it, and the walk below reaches that fixed point itself.
  text = stripScriptAndStyle(text);
  text = rewriteAnkiMathjax(text);

  const imageRefs = removeImageTags(text);
  text = imageRefs.text;
  const images = imageRefs.images;

  text = stripTags(text);

  text = decodeEntities(text);
  text = rewriteDelimited(text, "\\(", "\\)");
  text = rewriteDelimited(text, "\\[", "\\]");

  // Horizontal whitespace (the U+00A0 a decoded `&nbsp;` leaves included)
  // collapses to one
  // space; a run of newlines collapses to one, so the block tags above cannot
  // turn `<div></div><div>x</div>` into a gap. Then every line is trimmed, and
  // the empty ones dropped.
  text = text.replace(/[^\S\n]+/g, " ");
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return { text: lines.join("\n"), images, sounds };
}

// --- Cloze ------------------------------------------------------------------

/** Why one Anki cloze note cannot become Nexus cloze cards. Every one of these refuses the NOTE and is counted; none of them ever refuses the archive. */
export type ClozeCanonicalRefusal =
  | "cloze-nested"
  | "cloze-no-deletions"
  | "cloze-unrepresentable";

export interface ClozeCanonical {
  /** The note's text in Nexus's `{{…}}` grammar — the `cloze_text` every sibling row stores. */
  template: string;
  /** The deletion numbers `template` carries, ascending — Anki's own `cN`, unchanged, and one Nexus card each. */
  numbers: readonly number[];
  /** How many `::hint` parts were dropped — Nexus's grammar has no hint, and a silently discarded one is indistinguishable from a bug. */
  hintsDropped: number;
}

/**
 * `{{cN::text}}` or `{{cN::text::hint}}`, up to the first closing brace run.
 *
 * The body is matched brace-free and split at its FIRST `::` in code below
 * rather than by a second optional group here: two adjacent `[^{}]*` groups
 * overlap on `:`, and that ambiguity is what made the old pattern re-walk the
 * tail of a hostile field from every candidate start (#8). `[^{}]*` on the
 * body is still what makes a NESTED deletion fail to match rather than match
 * wrongly.
 */
const ANKI_CLOZE = /\{\{c(\d+)::([^{}]*)\}\}/g;

/** Where a deletion CLAIMS to begin. Every one of these must be the start of a full `ANKI_CLOZE` match, or the field says something this grammar cannot read. */
const ANKI_CLOZE_OPENER = /\{\{c\d+::/g;

/** Any `{{` or `}}` at all — used only to prove that nothing brace-shaped survived the rewrite unaccounted for. */
const ANY_BRACE_RUN = /\{\{|\}\}/g;

/**
 * One Anki cloze field as a Nexus cloze template.
 *
 * Anki's `cN` numbers are KEPT (ADR-068): a Nexus deletion's number is its own
 * `cN` label, so `{{c2::…}} … {{c1::…}}` stays exactly that and the two decks
 * agree on which blank is which. Only the `::hint` part is dropped, since this
 * grammar has none — and a repeated `cN`, which Anki blanks on ONE card, is now
 * one Nexus card with two blanks rather than a refusal.
 *
 * Three refusals, each of them a case where the two grammars genuinely disagree
 * and guessing would corrupt somebody's deck:
 *
 *  - `cloze-nested` — Anki's own parser rejects these too; ours must not
 *    silently half-match one.
 *  - `cloze-no-deletions` — a cloze note with nothing to hide has no cards.
 *  - `cloze-unrepresentable` — the catch-all, and the one that makes the other
 *    two safe: the finished template is read back with `findClozeRuns`, and
 *    unless it yields exactly the deletions that were put in, in order, with
 *    the same number and the same text, the note is refused. A brace inside a
 *    deletion, an empty deletion, a stray `{{…}}` in the surrounding prose —
 *    none of them needs its own rule, because the check catches all of them by
 *    construction.
 */
export function canonicalizeCloze(
  field: string,
): { ok: true; value: ClozeCanonical } | { ok: false; reason: ClozeCanonicalRefusal } {
  const matches = [...field.matchAll(ANKI_CLOZE)].filter((match) => match.index !== undefined);
  const matchStarts = new Set(matches.map((match) => match.index));

  // STRUCTURE FIRST. `[^{}]*` makes an outer `{{c1::… {{c2::…}} …}}` fail to
  // match at all, so a deletion that opened and never parsed is the only
  // evidence nesting leaves behind. Which of the two refusals it is depends on
  // what follows the opener: another `{{` before the next `}}` is a deletion
  // wrapped around a deletion; anything else is a field whose braces this
  // grammar simply cannot express.
  for (const opener of field.matchAll(ANKI_CLOZE_OPENER)) {
    if (opener.index === undefined || matchStarts.has(opener.index)) continue;
    const rest = field.slice(opener.index + opener[0].length);
    const nextOpen = rest.indexOf("{{");
    const nextClose = rest.indexOf("}}");
    const nested = nextOpen !== -1 && (nextClose === -1 || nextOpen < nextClose);
    return { ok: false, reason: nested ? "cloze-nested" : "cloze-unrepresentable" };
  }

  /** Every deletion written into the template, in document order — what the self-check reads back. */
  const written: { number: number; text: string }[] = [];
  let hintsDropped = 0;
  let template = "";
  let cursor = 0;

  for (const match of matches) {
    const index = match.index ?? 0;
    const number = Number.parseInt(match[1] ?? "", 10);
    // `c0` is not a deletion in Anki either. Left in the text as it was written
    // rather than unwrapped, since unwrapping it would silently change what the
    // note says — and the self-check below then refuses the note, because a
    // stray `{{…}}` in the prose is exactly what it is looking for.
    if (!Number.isInteger(number) || number < 1) continue;
    // The text is the body up to its first `::`; anything after that separator
    // is the hint, which this grammar drops and counts. The old pattern asked
    // for the same split with a second group, which is the overlap #8 names.
    const body = match[2] ?? "";
    const separator = body.indexOf("::");
    const inner = separator === -1 ? body : body.slice(0, separator);
    if (separator !== -1) hintsDropped += 1;
    written.push({ number, text: inner });
    template += field.slice(cursor, index) + `{{c${number}::${inner}}}`;
    cursor = index + match[0].length;
  }
  template += field.slice(cursor);

  if (written.length === 0) return { ok: false, reason: "cloze-no-deletions" };

  // The self-check. `findClozeRuns` is core's OWN reader of the `{{…}}` grammar
  // — the same one `CardStore` re-derives a row's sides with and the reviewer
  // splits its segments with — so agreeing with it is the only definition of
  // "this template says what we meant" that cannot drift.
  const runs = findClozeRuns(template);
  if (runs.length !== written.length) return { ok: false, reason: "cloze-unrepresentable" };
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index];
    const meant = written[index];
    if (run?.label !== meant?.number || run?.inner !== meant?.text) {
      return { ok: false, reason: "cloze-unrepresentable" };
    }
  }
  // A brace run outside the deletions we wrote would not change what
  // `findClozeRuns` returns but WOULD be text the user never sees the same way
  // twice; counted here so it is refused rather than shipped.
  const braceRuns = template.match(ANY_BRACE_RUN)?.length ?? 0;
  if (braceRuns !== runs.length * 2) return { ok: false, reason: "cloze-unrepresentable" };

  return { ok: true, value: { template, numbers: clozeNumbers(runs), hintsDropped } };
}

// --- Schema 18's notetype kind ----------------------------------------------

/**
 * The one fact a schema-18 collection keeps ONLY in a protobuf blob: whether a
 * notetype is basic or cloze. `Notetype.Config`'s field 1 is `Kind kind`
 * (varint; `KIND_NORMAL = 0`, `KIND_CLOZE = 1` — verified against Anki's
 * proto/anki/notetypes.proto). Everything else in the blob is walked past by
 * size and never interpreted, because everything else the import needs comes
 * from real table columns.
 *
 * Two proto3 rules are load-bearing here, both the format's own:
 *
 *  - A zero enum is OMITTED from the wire, so a config with no field 1 at all
 *    IS a normal notetype — absence is the common case, not an error.
 *  - When a non-repeated scalar appears twice, the LAST occurrence wins.
 *
 * `null` — never a guess — for a kind value this build does not know: a note
 * whose type we cannot name is a note whose text we cannot honestly call a
 * question or a cloze template. A malformed blob throws `ProtoWalkError`
 * instead, because "this build does not know it" and "the bytes are damaged"
 * deserve different refusals, and only the caller knows both vocabularies.
 */
export function ankiNotetypeKind(config: Uint8Array): "basic" | "cloze" | null {
  let kind = 0;
  for (const field of walkProtoFields(config)) {
    if (field.fieldNumber === 1 && field.wireType === 0) kind = field.value;
  }
  if (kind === 0) return "basic";
  if (kind === 1) return "cloze";
  return null;
}

// --- Translation -------------------------------------------------------------

/**
 * Why something an `.apkg` carried is not in the plan. Every one of these is
 * COUNTED and shown before anything is written; none of them ever refuses the
 * whole file, which the reader's caps are for.
 */
export type ApkgSkipCode =
  | "unknown-notetype"
  | "unknown-deck"
  | "empty-note"
  | "empty-deck"
  | "template-unsupported"
  | "extra-fields-dropped"
  | "cloze-nested"
  | "cloze-no-deletions"
  | "cloze-unrepresentable"
  | "cloze-hint-dropped"
  | "media-stripped"
  | "history-dropped"
  | "tags-dropped"
  | "card-without-note";

/** Every skip code, in the order the preview lists them: what was lost outright first, what was merely trimmed after. */
export const APKG_SKIP_CODES: readonly ApkgSkipCode[] = [
  "unknown-notetype",
  "unknown-deck",
  "empty-note",
  "empty-deck",
  "template-unsupported",
  "cloze-nested",
  "cloze-no-deletions",
  "cloze-unrepresentable",
  "cloze-hint-dropped",
  "extra-fields-dropped",
  "media-stripped",
  "tags-dropped",
  "history-dropped",
  "card-without-note",
];

export interface ApkgSkip {
  code: ApkgSkipCode;
  count: number;
}

export interface ApkgTranslateReport {
  /** Decks the plan will create. */
  decks: number;
  /** Anki notes that produced at least one card. */
  notes: number;
  /** Cards the plan will create. */
  cards: number;
  /** Every named loss, in `APKG_SKIP_CODES` order, zero-count lines omitted. */
  skips: readonly ApkgSkip[];
}

/** One deck of the collection. `name` is Anki's own `Parent::Child` path — the reader normalises schema 18's `\x1f` separator to it. */
export interface ApkgDeck {
  id: number;
  name: string;
}

/**
 * One notetype, reduced to the two facts a translation needs: whether its notes
 * are cloze, and how many templates it defines. Everything else about an Anki
 * notetype is a rendering language this import deliberately does not implement.
 */
export interface ApkgNotetype {
  id: number;
  name: string;
  kind: "basic" | "cloze";
  templateCount: number;
}

/** One note: its fields already split on `\x1f`, still as raw HTML, plus its tags. */
export interface ApkgNote {
  id: number;
  notetypeId: number;
  fields: readonly string[];
  tags: readonly string[];
}

/** One card: which note and template it is, where it lives, and the two facts that make it "already studied". */
export interface ApkgCard {
  noteId: number;
  ord: number;
  deckId: number;
  reps: number;
  /** Suspended OR buried — both are `queue < 0` in Anki, and both mean a state this import does not carry. */
  suspended: boolean;
}

/** One collection, as `main/apkgReader.ts` reads it. */
export interface ParsedApkg {
  decks: readonly ApkgDeck[];
  notetypes: readonly ApkgNotetype[];
  notes: readonly ApkgNote[];
  cards: readonly ApkgCard[];
  /** How many entries the `media` manifest declared. Counted, never fetched — v1 imports no media. */
  mediaCount: number;
}

/** Where the imported decks land: a subject the profile already has, or one this import names into being. */
export type ApkgSubjectChoice = { kind: "existing"; id: string } | { kind: "new"; name: string };

export interface ApkgTranslateTarget {
  /** The profile every row is stamped with — never the archive's, because an `.apkg` has none. */
  profileId: string;
  subject: ApkgSubjectChoice;
  /** ISO-8601, injected: this module reads no clock. Every row's `createdAt`/`updatedAt`, and every fresh card's `due`. */
  now: string;
}

export interface ApkgTranslation {
  /** Ready for `planForeignImport`, whose id map re-mints every id below. */
  data: ProfileData;
  /** `ForeignImportTarget.seededIds` — non-empty exactly when an EXISTING subject was chosen (see `APKG_SUBJECT_SOURCE_ID`). */
  seededIds: ReadonlyMap<string, string>;
  report: ApkgTranslateReport;
}

/**
 * The source-side id every deck points at. Deterministic rather than minted,
 * because this module is pure — the planner is where real ids are made, and it
 * either mints one for the subject ROW below or resolves this name straight
 * onto an existing subject through `seededIds`.
 */
export const APKG_SUBJECT_SOURCE_ID = "apkg:subject";

/** The subject colour an import creates with. The schema's own default (migration 005) and the study module's primary hue. */
const IMPORT_SUBJECT_COLOR = "jade";

/** How a flattened `Parent::Child` deck name reads in Nexus, which has no deck hierarchy — the same separator the note-folder picker renders a path with. */
const DECK_PATH_SEPARATOR = " / ";

/**
 * A fresh card's scheduling columns, exactly as `createEmptyCard(now)` produces
 * them (`CardStore.insertNew`) — spelled out rather than imported, because
 * `@nexus/core` has no `ts-fsrs` dependency and must not grow one for eleven
 * constants. `due` is `now`: a new card is due immediately, which is what makes
 * an imported deck studiable the moment it lands.
 *
 * Exported because it is not Anki's: EVERY importer that creates a card creates
 * a NEW one (`llmPrompts.ts` is the second), and two copies of these eleven
 * constants could only ever drift apart.
 */
export function freshCardScheduling(now: string): Pick<
  ExportCard,
  | "due"
  | "stability"
  | "difficulty"
  | "elapsedDays"
  | "scheduledDays"
  | "learningSteps"
  | "reps"
  | "lapses"
  | "state"
  | "lastReview"
  | "createdAt"
  | "updatedAt"
> {
  return {
    due: now,
    stability: 0,
    difficulty: 0,
    elapsedDays: 0,
    scheduledDays: 0,
    learningSteps: 0,
    reps: 0,
    lapses: 0,
    state: 0,
    lastReview: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Collects skips by code, so the report is a set of named lines rather than a running commentary. */
class SkipLedger {
  private readonly counts = new Map<ApkgSkipCode, number>();

  add(code: ApkgSkipCode, count = 1): void {
    if (count <= 0) return;
    this.counts.set(code, (this.counts.get(code) ?? 0) + count);
  }

  toReport(): ApkgSkip[] {
    return APKG_SKIP_CODES.filter((code) => (this.counts.get(code) ?? 0) > 0).map((code) => ({
      code,
      count: this.counts.get(code) ?? 0,
    }));
  }
}

/**
 * Turns one parsed collection into the profile data an import inserts.
 *
 * The shape of the answer is deliberately narrow: an `.apkg` carries decks,
 * notes and cards and NOTHING else this app models — no tasks, no notes-module
 * notes, no calendar — so every other member of `ProfileData` is planned empty.
 * Written as one object literal typed `ProfileData` for the reason
 * `planForeignImport`'s pass 2 is: a member added to that interface later fails
 * to compile here rather than silently arriving absent.
 */
export function translateApkg(parsed: ParsedApkg, target: ApkgTranslateTarget): ApkgTranslation {
  const skips = new SkipLedger();
  const notetypes = new Map(parsed.notetypes.map((notetype) => [notetype.id, notetype]));
  const deckNames = new Map(parsed.decks.map((deck) => [deck.id, deck.name]));
  const notes = new Map(parsed.notes.map((note) => [note.id, note]));

  // Every media entry the manifest declared is a file this import does not
  // carry, on exactly the terms an `<img>` inside a field is one. Counted
  // together, because "koliko slika i zvukova ne stiže" is one question.
  skips.add("media-stripped", parsed.mediaCount);

  // One pass over the cards, grouped by their note: a note's cards decide how
  // many rows it produces (basic) and which decks they land in (both kinds).
  const cardsByNote = new Map<number, ApkgCard[]>();
  for (const card of parsed.cards) {
    if (!notes.has(card.noteId)) {
      skips.add("card-without-note");
      continue;
    }
    const bucket = cardsByNote.get(card.noteId);
    if (bucket === undefined) cardsByNote.set(card.noteId, [card]);
    else bucket.push(card);
  }
  for (const bucket of cardsByNote.values()) bucket.sort((a, b) => a.ord - b.ord);

  const scheduling = freshCardScheduling(target.now);
  const cards: ExportCard[] = [];
  const usedDeckIds = new Set<number>();
  let notesWithCards = 0;

  const deckSourceId = (ankiDeckId: number): string => `apkg:deck:${ankiDeckId}`;
  const cardSourceId = (noteId: number, ordinal: number): string => `apkg:card:${noteId}:${ordinal}`;

  for (const note of parsed.notes) {
    const notetype = notetypes.get(note.notetypeId);
    if (notetype === undefined) {
      skips.add("unknown-notetype");
      continue;
    }
    const noteCards = cardsByNote.get(note.id) ?? [];
    // A note with no card at all is a note Anki itself shows nowhere. It is not
    // an error and not a loss worth its own line — it simply has nothing to
    // become — but a note whose cards all name unknown decks IS a loss, and the
    // deck check below names it.
    if (noteCards.length === 0) continue;

    const stripped = note.fields.map(stripAnkiHtml);
    for (const field of stripped) skips.add("media-stripped", field.images + field.sounds);
    if (note.tags.length > 0) skips.add("tags-dropped");
    if (noteCards.some((card) => card.reps > 0 || card.suspended)) skips.add("history-dropped");

    const emit: EmitContext = {
      profileId: target.profileId,
      cardSourceId,
      deckSourceId,
      usedDeckIds,
    };
    const before = cards.length;
    if (notetype.kind === "cloze") {
      translateClozeNote(note, stripped, noteCards, deckNames, skips, scheduling, cards, emit);
    } else {
      translateBasicNote(
        note,
        stripped,
        noteCards,
        notetype,
        deckNames,
        skips,
        scheduling,
        cards,
        emit,
      );
    }
    if (cards.length > before) notesWithCards += 1;
  }

  const decks: ExportDeck[] = [];
  for (const deck of parsed.decks) {
    if (!usedDeckIds.has(deck.id)) {
      // A deck nothing landed in is not created: an import that added a dozen
      // empty decks to somebody's study page would be noise, not data.
      skips.add("empty-deck");
      continue;
    }
    decks.push({
      id: deckSourceId(deck.id),
      profileId: target.profileId,
      subjectId: APKG_SUBJECT_SOURCE_ID,
      name: flattenDeckName(deck.name),
      createdAt: target.now,
      updatedAt: target.now,
    });
  }

  const subjects: ExportSubject[] =
    target.subject.kind === "new"
      ? [
          {
            id: APKG_SUBJECT_SOURCE_ID,
            profileId: target.profileId,
            name: target.subject.name,
            color: IMPORT_SUBJECT_COLOR,
            semester: null,
            archived: false,
            createdAt: target.now,
            updatedAt: target.now,
          },
        ]
      : [];
  // The seam that lets an EXISTING subject own the imported decks without this
  // module ever knowing a real id's shape: the planner pre-populates its id map
  // with this one entry and mints nothing for it (`ForeignImportTarget.seededIds`).
  const seededIds =
    target.subject.kind === "existing"
      ? new Map([[APKG_SUBJECT_SOURCE_ID, target.subject.id]])
      : new Map<string, string>();

  const data: ProfileData = {
    tasks: [],
    taskLists: [],
    taskSections: [],
    taskTags: [],
    taskTagLinks: [],
    taskAttachments: [],
    taskTemplates: [],
    taskDependencies: [],
    events: [],
    eventTemplates: [],
    documents: [],
    renewals: [],
    people: [],
    calendarSettings: [],
    subjects,
    subjectAttachments: [],
    subjectNoteLinks: [],
    exams: [],
    decks,
    cards,
    // No history crosses (see the module header), so there is nothing to log.
    reviewLog: [],
    // An .apkg carries decks and cards, never an exam's curriculum (ADR-063).
    examTopics: [],
    plans: [],
    blocks: [],
    focusSessions: [],
    studySettings: [],
    notifications: [],
    notes: [],
    noteFolders: [],
    noteTags: [],
    noteCategories: [],
    noteTagLinks: [],
    noteTemplates: [],
    noteAttachments: [],
    noteVersions: [],
    dashboardSettings: [],
    dashboardSets: [],
    dashboardWidgets: [],
    // An Anki deck carries no ledger (migration 051), so all four are empty —
    // the same "this source has nothing of that module" every collection above
    // says.
    finAccounts: [],
    finCategories: [],
    finRecurring: [],
    finTransactions: [],
    finBudgets: [],
    // An `.apkg` carries no habits (migration 055): empty, the same "this source
    // has nothing of that module" every collection above says.
    habits: [],
    habitEntries: [],
    // Nor any food log (migration 058), and nor could it: a deck of cards says
    // nothing about what anybody ate.
    fitFoods: [],
    fitMealItems: [],
    fitTargets: [],
    // Nor any training log (migration 060) — same reason.
    fitExercises: [],
    fitRoutines: [],
    fitRoutineItems: [],
    fitWorkouts: [],
    fitWorkoutSets: [],
    fitMeasurements: [],
    fitBodyProfile: [],
    canvasBoards: [],
    circuits: [],
    circuitChassis: [],
    circuitParts: [],
    circuitWires: [],
  };

  return {
    data,
    seededIds,
    report: {
      decks: decks.length,
      notes: notesWithCards,
      cards: cards.length,
      skips: skips.toReport(),
    },
  };
}

/** `Fakultet::Biologija::Ćelija` → `Fakultet / Biologija / Ćelija`. Nexus decks are flat, so the path becomes the name rather than being thrown away — two decks called „Ćelija" under different parents must still be two names a user can tell apart. */
function flattenDeckName(name: string): string {
  return name
    .split("::")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(DECK_PATH_SEPARATOR);
}

/** The id helpers, the target profile and the deck-usage set, passed as one value so the two note translators cannot drift in how they name a row. */
interface EmitContext {
  profileId: string;
  cardSourceId: (noteId: number, ordinal: number) => string;
  deckSourceId: (ankiDeckId: number) => string;
  usedDeckIds: Set<number>;
}

/**
 * A basic note: one Nexus card per Anki card, which is one per TEMPLATE.
 *
 * Ordinal 0 is the note's own two fields in order; ordinal 1 is them swapped,
 * which is what Anki's stock "Basic (and reversed card)" renders and the one
 * convention this import is willing to rely on. Anything beyond that is a
 * template whose question and answer are written in Anki's own rendering
 * language, over fields this import has no mapping for — so it is refused by
 * name rather than rendered as a guess.
 */
function translateBasicNote(
  note: ApkgNote,
  stripped: readonly AnkiFieldText[],
  noteCards: readonly ApkgCard[],
  notetype: ApkgNotetype,
  deckNames: ReadonlyMap<number, string>,
  skips: SkipLedger,
  scheduling: ReturnType<typeof freshCardScheduling>,
  out: ExportCard[],
  ctx: EmitContext,
): void {
  const front = stripped[0]?.text ?? "";
  const back = stripped[1]?.text ?? "";
  if (front.length === 0) {
    skips.add("empty-note");
    return;
  }
  if (stripped.slice(2).some((field) => field.text.length > 0)) skips.add("extra-fields-dropped");

  for (const card of noteCards) {
    if (card.ord > 1 || card.ord >= notetype.templateCount) {
      skips.add("template-unsupported");
      continue;
    }
    if (!deckNames.has(card.deckId)) {
      skips.add("unknown-deck");
      continue;
    }
    ctx.usedDeckIds.add(card.deckId);
    out.push({
      id: ctx.cardSourceId(note.id, card.ord),
      profileId: ctx.profileId,
      deckId: ctx.deckSourceId(card.deckId),
      front: card.ord === 1 ? back : front,
      back: card.ord === 1 ? front : back,
      sourceNoteId: null,
      sourceBlockKey: null,
      kind: "basic",
      clozeText: null,
      clozeOrdinal: null,
      problemSteps: null,
      ...scheduling,
    });
  }
}

/**
 * A cloze note: one Nexus card per deletion NUMBER of the canonical template,
 * not per Anki card. The two normally agree exactly — Anki makes one card per
 * `cN` — but the template is the authority here, because it is what the row
 * stores and what `renderClozeCard` derives the sides from. A card Anki had for
 * a deletion the text no longer contains would otherwise arrive asking about
 * nothing, and a `cN` written twice is one card in both apps.
 *
 * The sides are rendered by core's OWN `renderClozeCard`, the same function
 * `CardStore` re-derives them with on every edit, so an imported cloze card and
 * a hand-written one are the same row in every respect the moment they land.
 */
function translateClozeNote(
  note: ApkgNote,
  stripped: readonly AnkiFieldText[],
  noteCards: readonly ApkgCard[],
  deckNames: ReadonlyMap<number, string>,
  skips: SkipLedger,
  scheduling: ReturnType<typeof freshCardScheduling>,
  out: ExportCard[],
  ctx: EmitContext,
): void {
  const text = stripped[0]?.text ?? "";
  if (text.length === 0) {
    skips.add("empty-note");
    return;
  }
  if (stripped.slice(1).some((field) => field.text.length > 0)) skips.add("extra-fields-dropped");

  const canonical = canonicalizeCloze(text);
  if (!canonical.ok) {
    skips.add(canonical.reason);
    return;
  }
  skips.add("cloze-hint-dropped", canonical.value.hintsDropped);

  // Which deck each deletion lands in: the deck of the Anki card that asked
  // that very deletion when there is one (a cloze note's siblings CAN sit in
  // different decks), otherwise the note's first card's deck. An Anki cloze
  // card's `ord` is its own `cN` minus one, which is the whole mapping now that
  // both apps number deletions the same way.
  const deckByNumber = new Map<number, number>();
  for (const card of noteCards) {
    const number = card.ord + 1;
    if (canonical.value.numbers.includes(number) && !deckByNumber.has(number)) {
      deckByNumber.set(number, card.deckId);
    }
  }
  const fallbackDeckId = noteCards[0]?.deckId;
  if (fallbackDeckId === undefined) return;

  const template = canonical.value.template;
  for (const number of canonical.value.numbers) {
    const deckId = deckByNumber.get(number) ?? fallbackDeckId;
    if (!deckNames.has(deckId)) {
      skips.add("unknown-deck");
      continue;
    }
    const rendered = renderClozeCard(template, number);
    // Unreachable: `canonicalizeCloze` already proved every number renders.
    // Kept because `renderClozeCard`'s null is the contract, and a silent
    // `?? ""` here would write a blank card rather than say so.
    if (rendered === null) {
      skips.add("cloze-unrepresentable");
      continue;
    }
    ctx.usedDeckIds.add(deckId);
    out.push({
      id: ctx.cardSourceId(note.id, number),
      profileId: ctx.profileId,
      deckId: ctx.deckSourceId(deckId),
      front: rendered.front,
      back: rendered.back,
      sourceNoteId: null,
      sourceBlockKey: null,
      kind: "cloze",
      clozeText: template,
      clozeOrdinal: number,
      problemSteps: null,
      ...scheduling,
    });
  }
}
