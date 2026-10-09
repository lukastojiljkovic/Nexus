import type { ToolPack } from "../contracts/tools.js";

/**
 * ADR-086 §3: turning „reci ukratko čime se baviš" into toolkits.
 *
 * **This table has to be hand-written, and that is worth saying once here so
 * nobody tries to derive it.** Three hundred and fifty-seven tools carry
 * `keywords`, and every one of those keywords describes what the TOOL does
 * („zadaci", „markdown", „interval") — they exist for settings search. Nothing
 * in the registry knows that a `stolar` wants `zanat`, because nothing in the
 * registry is about people. So the mapping from a person's own words to a pack
 * is domain knowledge, it lives in exactly one reviewable table, and the tests
 * beside it are what keep the table honest.
 *
 * Matching is **diacritic-folded and by prefix at a word boundary**. Serbian
 * inflects on the suffix, so `stolar` has to cover stolara, stolaru, stolari
 * and stolarski without four rows — and a table with four rows per trade is a
 * table where the missing fifth row is a person the app fails to recognise.
 *
 * The cost of prefix matching is that a stem three characters too short turns
 * an ordinary word into a toolkit nobody asked for, with no way for the user to
 * know why it appeared. That is why every stem is at least four characters, why
 * no stem may be a prefix of another, and why `lexicon.test.ts` carries a list
 * of sentences that MUST resolve to nothing — each one a stem that was tempting
 * and wrong (`prav-` against „pravim", `stan-` against „stanje", `firm-`
 * against „firmware").
 */

/** One row of the table: a folded stem, and what recognising it argues for. */
export interface TradeStem {
  /** Folded, lower-case, matched by prefix at a word boundary. Multi-word stems match word by word. */
  readonly stem: string;
  readonly packs: readonly ToolPack[];
}

/**
 * What the person's own words argue for.
 *
 * Pack order inside a row is the order the reveal screen lists them in, so it
 * is the trade's own emphasis: a `stolar` is a craftsman first and a builder
 * second, and „Zanatstvo, Gradnja" reads as recognition where the reverse reads
 * as a guess.
 *
 * **There is deliberately no clinical entry, and there must never be one.** The
 * `zdravstvo` pack was removed from the catalogue because intended purpose is
 * what makes software a medical device; a lexicon row saying „you are a nurse,
 * here are your tools" states the same intended purpose one level down. The ban
 * is a test (`recognises no clinical profession`) rather than this paragraph,
 * because a helpful future addition has to fail rather than merely be regretted.
 */
export const TRADE_STEMS: readonly TradeStem[] = [
  // gradnja — the site, and the trades that live on it
  { stem: "gradjevin", packs: ["gradnja"] },
  { stem: "gradiliste", packs: ["gradnja"] },
  { stem: "zidar", packs: ["gradnja", "zanat"] },
  { stem: "armirac", packs: ["gradnja"] },
  { stem: "fasad", packs: ["gradnja"] },
  { stem: "izolacij", packs: ["gradnja"] },
  { stem: "krovopokriv", packs: ["gradnja", "zanat"] },
  { stem: "keramicar", packs: ["gradnja", "zanat"] },
  { stem: "plocic", packs: ["gradnja", "zanat"] },
  { stem: "moler", packs: ["gradnja", "zanat"] },
  { stem: "malter", packs: ["gradnja"] },
  { stem: "beton", packs: ["gradnja"] },
  { stem: "tesar", packs: ["gradnja", "zanat"] },
  { stem: "parket", packs: ["zanat", "gradnja"] },
  { stem: "vodoinstalater", packs: ["gradnja", "zanat"] },
  { stem: "elektroinstalater", packs: ["gradnja", "zanat"] },

  // inženjerstvo
  { stem: "inzenjer", packs: ["inzenjering"] },
  { stem: "masinsk", packs: ["inzenjering"] },
  { stem: "elektrotehnick", packs: ["inzenjering"] },
  { stem: "konstrukt", packs: ["inzenjering"] },
  { stem: "projektant", packs: ["inzenjering", "gradnja"] },
  { stem: "mehatronik", packs: ["inzenjering"] },
  { stem: "robotik", packs: ["inzenjering"] },
  { stem: "automatik", packs: ["inzenjering"] },
  { stem: "tehnolog", packs: ["inzenjering"] },

  // softver
  { stem: "programer", packs: ["softver"] },
  { stem: "programir", packs: ["softver"] },
  { stem: "developer", packs: ["softver"] },
  { stem: "softver", packs: ["softver"] },
  { stem: "frontend", packs: ["softver"] },
  { stem: "backend", packs: ["softver"] },
  { stem: "devops", packs: ["softver"] },
  { stem: "kodir", packs: ["softver"] },
  { stem: "sajt", packs: ["softver"] },
  { stem: "aplikacij", packs: ["softver"] },
  { stem: "startap", packs: ["biznis", "softver"] },

  // dizajn i slika
  { stem: "dizajn", packs: ["dizajn"] },
  { stem: "grafick", packs: ["dizajn"] },
  { stem: "ilustrat", packs: ["dizajn"] },
  { stem: "brendir", packs: ["dizajn"] },
  { stem: "tipograf", packs: ["dizajn"] },
  { stem: "maket", packs: ["dizajn"] },
  { stem: "fotograf", packs: ["foto"] },
  { stem: "videograf", packs: ["foto"] },
  { stem: "kamerman", packs: ["foto"] },
  { stem: "snimanj", packs: ["foto"] },
  { stem: "kolorist", packs: ["foto"] },

  // muzika
  { stem: "muzicar", packs: ["muzika"] },
  { stem: "gitar", packs: ["muzika"] },
  { stem: "klavir", packs: ["muzika"] },
  { stem: "bubnj", packs: ["muzika"] },
  { stem: "pevac", packs: ["muzika"] },
  { stem: "orkestar", packs: ["muzika"] },
  { stem: "tonsk", packs: ["muzika"] },
  { stem: "producent", packs: ["muzika"] },
  { stem: "aranzman", packs: ["muzika"] },
  { stem: "didzej", packs: ["event", "muzika"] },

  // prosveta
  { stem: "nastavnik", packs: ["prosveta"] },
  { stem: "ucitelj", packs: ["prosveta"] },
  { stem: "profesor", packs: ["prosveta"] },
  { stem: "pedagog", packs: ["prosveta"] },
  { stem: "vaspitac", packs: ["prosveta"] },
  { stem: "predajem", packs: ["prosveta"] },
  { stem: "instruktor", packs: ["prosveta"] },

  // tekst
  { stem: "lektor", packs: ["tekst"] },
  { stem: "prevod", packs: ["tekst"] },
  { stem: "novinar", packs: ["tekst"] },
  { stem: "copywriter", packs: ["tekst"] },
  { stem: "urednik", packs: ["tekst"] },
  { stem: "korektur", packs: ["tekst"] },
  { stem: "scenarist", packs: ["tekst"] },
  { stem: "pisac", packs: ["tekst"] },

  // trening
  { stem: "trener", packs: ["trening"] },
  { stem: "trening", packs: ["trening"] },
  { stem: "fitnes", packs: ["trening"] },
  { stem: "teretan", packs: ["trening"] },
  { stem: "kondicij", packs: ["trening"] },
  { stem: "sportist", packs: ["trening"] },
  { stem: "atletic", packs: ["trening"] },
  { stem: "joga", packs: ["trening"] },
  { stem: "pilates", packs: ["trening"] },

  // kuhinja
  { stem: "kuvar", packs: ["kuhinja"] },
  { stem: "kuhinj", packs: ["kuhinja"] },
  { stem: "restoran", packs: ["kuhinja"] },
  { stem: "poslasticar", packs: ["kuhinja"] },
  { stem: "pekar", packs: ["kuhinja"] },
  { stem: "ugostitelj", packs: ["kuhinja"] },
  { stem: "konobar", packs: ["kuhinja"] },
  { stem: "kafic", packs: ["kuhinja"] },
  { stem: "katering", packs: ["kuhinja", "event"] },

  // pravo
  { stem: "advokat", packs: ["pravo"] },
  { stem: "pravn", packs: ["pravo"] },
  { stem: "notar", packs: ["pravo"] },
  { stem: "sudij", packs: ["pravo"] },
  { stem: "sudsk", packs: ["pravo"] },
  { stem: "tuzilac", packs: ["pravo"] },
  { stem: "tuzb", packs: ["pravo"] },
  { stem: "parnic", packs: ["pravo"] },
  { stem: "izvrsitelj", packs: ["pravo"] },
  { stem: "ugovor", packs: ["pravo", "biznis"] },

  // računovodstvo
  { stem: "knjigovodj", packs: ["racunovodstvo"] },
  { stem: "racunovodj", packs: ["racunovodstvo"] },
  { stem: "racunovodstv", packs: ["racunovodstvo"] },
  { stem: "revizor", packs: ["racunovodstvo"] },
  { stem: "porez", packs: ["racunovodstvo"] },
  { stem: "bilans", packs: ["racunovodstvo"] },
  { stem: "obracun", packs: ["racunovodstvo"] },
  { stem: "faktur", packs: ["racunovodstvo", "biznis"] },
  { stem: "vodim knjige", packs: ["racunovodstvo"] },

  // biznis
  { stem: "preduzetnik", packs: ["biznis"] },
  { stem: "klijent", packs: ["biznis"] },
  { stem: "prodaj", packs: ["biznis"] },
  { stem: "ponud", packs: ["biznis"] },
  { stem: "marketing", packs: ["biznis"] },
  { stem: "agencij", packs: ["biznis"] },
  { stem: "dobavljac", packs: ["biznis"] },
  { stem: "zaliha", packs: ["biznis"] },

  // nekretnine
  { stem: "nekretnin", packs: ["nekretnine"] },
  { stem: "katastar", packs: ["nekretnine"] },
  { stem: "zakup", packs: ["nekretnine"] },
  { stem: "hipotek", packs: ["nekretnine"] },
  { stem: "kvadratur", packs: ["nekretnine"] },
  { stem: "etazn", packs: ["nekretnine"] },
  { stem: "izdavanj", packs: ["nekretnine"] },

  // transport
  { stem: "vozac", packs: ["transport"] },
  { stem: "kamion", packs: ["transport"] },
  { stem: "prevoz", packs: ["transport"] },
  { stem: "spedicij", packs: ["transport"] },
  { stem: "logistik", packs: ["transport"] },
  { stem: "taksi", packs: ["transport"] },
  { stem: "dostav", packs: ["transport"] },
  { stem: "kilometraz", packs: ["transport"] },
  { stem: "tovar", packs: ["transport"] },

  // poljoprivreda
  { stem: "poljoprivred", packs: ["agro"] },
  { stem: "ratar", packs: ["agro"] },
  { stem: "stocar", packs: ["agro"] },
  { stem: "vocnjak", packs: ["agro"] },
  { stem: "vinograd", packs: ["agro"] },
  { stem: "plastenik", packs: ["agro"] },
  { stem: "traktor", packs: ["agro"] },
  { stem: "prinos", packs: ["agro"] },
  { stem: "djubriv", packs: ["agro"] },
  { stem: "njiva", packs: ["agro"] },
  { stem: "usev", packs: ["agro"] },

  // zanat
  { stem: "stolar", packs: ["zanat", "gradnja"] },
  { stem: "namestaj", packs: ["zanat", "gradnja"] },
  { stem: "bravar", packs: ["zanat"] },
  { stem: "limar", packs: ["zanat"] },
  { stem: "zavariv", packs: ["zanat"] },
  { stem: "varilac", packs: ["zanat"] },
  { stem: "obucar", packs: ["zanat"] },
  { stem: "krojac", packs: ["zanat"] },
  { stem: "frizer", packs: ["zanat"] },
  { stem: "tapetar", packs: ["zanat"] },
  { stem: "kovac", packs: ["zanat"] },
  { stem: "staklorez", packs: ["zanat"] },
  { stem: "tokar", packs: ["zanat"] },
  { stem: "radionic", packs: ["zanat"] },

  // događaji
  { stem: "vencanj", packs: ["event"] },
  { stem: "svadb", packs: ["event"] },
  { stem: "dogadjaj", packs: ["event"] },
  { stem: "konferencij", packs: ["event"] },
  { stem: "festival", packs: ["event"] },
  { stem: "dekoracij", packs: ["event"] },
  // laboratorija, elektro, it, auto
  { stem: "laboratorij", packs: ["laboratorija"] },
  { stem: "hemicar", packs: ["laboratorija"] },
  { stem: "elektricar", packs: ["elektro"] },
  { stem: "informatic", packs: ["it"] },
  { stem: "mrez", packs: ["it"] },
  { stem: "automehanicar", packs: ["auto"] },
  { stem: "autoelektricar", packs: ["auto", "elektro"] },
  { stem: "autolimar", packs: ["auto"] },
  { stem: "autoservis", packs: ["auto"] },
  { stem: "vulkanizer", packs: ["auto"] },

  // more i jedrenje
  { stem: "jedrilic", packs: ["nautika"] },
  { stem: "jedrenj", packs: ["nautika"] },
  { stem: "nauticar", packs: ["nautika"] },
  { stem: "skiper", packs: ["nautika"] },
  { stem: "regat", packs: ["nautika"] },
  { stem: "brodic", packs: ["nautika"] },

  // vazduhoplovstvo
  { stem: "avijacij", packs: ["vazduhoplovstvo"] },
  { stem: "avion", packs: ["vazduhoplovstvo"] },
  { stem: "pilot", packs: ["vazduhoplovstvo"] },
  { stem: "stjuard", packs: ["vazduhoplovstvo"] },
  { stem: "vazduhoplov", packs: ["vazduhoplovstvo"] },

  // geodezija
  { stem: "geodet", packs: ["geodezija"] },
  { stem: "geodezij", packs: ["geodezija"] },
  { stem: "kartograf", packs: ["geodezija"] },
  { stem: "topograf", packs: ["geodezija"] },

  // radio-amaterizam
  { stem: "antena", packs: ["radio"] },
  { stem: "kratkotalas", packs: ["radio"] },
  { stem: "predajnik", packs: ["radio"] },
  { stem: "prijemnik", packs: ["radio"] },
  { stem: "radioamat", packs: ["radio"] },

  // energija
  { stem: "akumulator", packs: ["energija"] },
  { stem: "fotonap", packs: ["energija"] },
  { stem: "invertor", packs: ["energija"] },
  { stem: "solar", packs: ["energija"] },
];

/**
 * The safety net under the text field: things somebody DOES in a week, tapped
 * rather than typed.
 *
 * An activity is not a category. „Merim i sečem" is something a person
 * recognises about their own Tuesday without deciding what they are, which is
 * the whole difference from the eight-card taxonomy this replaced — a dentist,
 * a nurse, a shop manager can all read this list and honestly tick nothing,
 * and ticking nothing here is an ordinary outcome rather than the product
 * failing to see them.
 *
 * The list must be able to reach EVERY pack (there is a test), or the screen
 * would quietly hide toolkits behind a text field that not everybody will use.
 *
 * `id` is a key into `strings.ts`, never Serbian text: the copy lives where all
 * the copy lives, and `@nexus/core` stays free of user-facing prose.
 */
export interface TradeActivity {
  readonly id: string;
  readonly packs: readonly ToolPack[];
}

export const TRADE_ACTIVITIES: readonly TradeActivity[] = [
  { id: "mere-sece", packs: ["gradnja", "zanat"] },
  { id: "ponude", packs: ["biznis", "racunovodstvo"] },
  { id: "teren", packs: ["gradnja", "nekretnine", "agro"] },
  { id: "predaje", packs: ["prosveta"] },
  { id: "ugovori", packs: ["pravo"] },
  { id: "vozi", packs: ["transport"] },
  { id: "kuva", packs: ["kuhinja"] },
  { id: "snima", packs: ["foto", "dizajn"] },
  { id: "kod", packs: ["softver", "inzenjering"] },
  { id: "svira", packs: ["muzika"] },
  { id: "knjige", packs: ["racunovodstvo"] },
  { id: "dogadjaji", packs: ["event"] },
  { id: "trenira", packs: ["trening"] },
  { id: "prevodi", packs: ["tekst"] },
  { id: "laboratorija", packs: ["laboratorija"] },
  { id: "instalacije", packs: ["elektro"] },
  { id: "sistemi", packs: ["it"] },
  { id: "servis", packs: ["auto"] },
  { id: "jedrim", packs: ["nautika"] },
  { id: "letim", packs: ["vazduhoplovstvo"] },
  { id: "merim-teren", packs: ["geodezija"] },
  { id: "radio", packs: ["radio"] },
  { id: "solar", packs: ["energija"] },
];

/**
 * Serbian Latin folded to the twenty-six letters the table is written in.
 *
 * `đ` is done by hand before the decomposition because it is not a decomposable
 * character — there is no „d + combining stroke" for `NFD` to take apart — so a
 * normalize-and-strip pass alone silently leaves it in place, and every
 * `knjigovođa` in the country stops being recognised.
 *
 * The strip is `\p{M}` and not the literal `U+0300`–`U+036F` range this was
 * first written with. A combining mark written as itself has nothing of its own
 * to render, so it attaches to the character before it: the range came out as
 * two specks on the `[` and the `-` of its own character class, and a reader
 * could not see what the class held. That is the shape `check:invisibles` bans
 * for the ten characters it lists, and `devtools/text.ts` already folds this way
 * — the property escape is visible, greppable, and the house idiom.
 */
function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/đ/g, "dj")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/** One recognised thing, quoted back in the person's own spelling. */
export interface TradeMatch {
  /**
   * The words as they were written. The reveal screen says them back, and
   * „ADVOKAT" must not come back as „advokat".
   */
  readonly term: string;
  readonly packs: readonly ToolPack[];
}

/** A word of the input, kept in both alphabets so a match can be quoted in the original. */
interface Token {
  readonly raw: string;
  readonly folded: string;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const raw of text.split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length > 0) tokens.push({ raw, folded: fold(raw) });
  }
  return tokens;
}

/**
 * What the person just said, as toolkits — in the order they said it.
 *
 * Order is the person's own emphasis and it survives all the way to the reveal,
 * so „stolar koji vodi knjige" leads with Zanatstvo rather than with whichever
 * row happens to sit higher in the table.
 *
 * One match per STEM, never per occurrence: „advokat, advokatska kancelarija"
 * is somebody saying one thing twice, and a screen that answers it with two
 * identical chips looks broken.
 */
export function recognizeTrades(text: string): TradeMatch[] {
  const tokens = tokenize(text);
  if (tokens.length === 0) return [];

  const found: { at: number; match: TradeMatch }[] = [];
  for (const entry of TRADE_STEMS) {
    const words = entry.stem.split(" ");
    for (let at = 0; at + words.length <= tokens.length; at += 1) {
      const hit = words.every(
        (word, offset) => tokens[at + offset]?.folded.startsWith(word) === true,
      );
      if (!hit) continue;
      const raw = tokens
        .slice(at, at + words.length)
        .map((token) => token.raw)
        .join(" ");
      found.push({ at, match: { term: raw, packs: entry.packs } });
      break;
    }
  }

  // Sorted by where it was SAID, not by where it sits in the table. `sort` is
  // stable, so two stems recognised in the same word keep table order — which
  // only happens for multi-word stems overlapping a single-word one.
  return found.sort((a, b) => a.at - b.at).map((entry) => entry.match);
}
