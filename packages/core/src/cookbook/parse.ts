/**
 * Reading a typed ingredient line into the structured one.
 *
 * Stage 2 uses this for quick entry and for imports: the user types „2–3 kašike
 * maslinovog ulja, po potrebi" once, and the form's fields fill themselves. The
 * parser is pure and total — every string either parses or is blank — because it
 * runs on whatever somebody pasted, and a field that throws on odd input is a
 * field nobody can paste into.
 *
 * **What it reads, in order:** an amount (a decimal with `.` or `,`, a vulgar
 * fraction, `1 1/2`, `half`/`pola`/`quarter`, `a`/`an`), an optional range's
 * upper end (`2-3`, `2–3`, `2 to 3`, `2 do 3` — a dash with no second amount
 * after it is not a range), a unit word, and then the name with whatever note
 * follows it. The note is taken from the FIRST comma, from a TRAILING
 * parenthetical, or from a trailing „po ukusu" / „to taste"-shaped phrase —
 * three shapes a Serbian and an English recipe both write, and the only three
 * this function recognises.
 *
 * **Two tables, and both are DATA rather than copy.** The unit words are the
 * Serbian and English spellings of `units.ts`' closed vocabulary — „kašičica" is
 * the teaspoon, „čen"/„češanj" the clove — and the quantity words are the handful
 * of amounts a recipe writes in letters. They live here, beside the matcher that
 * reads them, for the reason `FOOD_CATEGORIES` gives for its Serbian keys: a key
 * spelled in English would need a second mapping nobody would keep in step. A
 * word the table does not carry is NOT guessed — „2 zrna bibera" keeps „zrna
 * bibera" as its name and leaves the unit empty, which is a line the user can
 * correct in one click, where a guess is a number they would have to notice.
 *
 * **What it deliberately does not do.** It does not recognise a group heading
 * („Za sos:"), because a heading is not an ingredient and a parser that returned
 * a nameless line for one would corrupt the recipe it was reading: the caller
 * sees the name exactly as typed and decides. It does not read a compound amount
 * („1 tbsp + 1 tsp") — that is two lines, and this function answers for one. And
 * it does not fold Serbian diacritics: the tables are spelled the way Serbian is
 * written, and `foldSearchText` belongs to the search index rather than here,
 * where a fold would merge two things a cook means separately.
 *
 * Nothing here reads a clock, touches a DOM or imports `node:` anything.
 */

import type { IngredientLine } from "./ingredient.js";
import { type IngredientUnit } from "./units.js";

/**
 * The unit words, lower-case, as the two languages spell them — including the
 * inflections a recipe uses („2 kašike", „1 kašičica") and the multi-word names
 * („supena kašika", „fl oz"). Every value is a unit `units.ts` ships, and the
 * matcher below tries the LONGEST word first so „grama" is not read as „g".
 */
const UNIT_WORDS: Readonly<Record<string, IngredientUnit>> = {
  // --- mass -----------------------------------------------------------------
  g: "g",
  gr: "g",
  gram: "g",
  grama: "g",
  grami: "g",
  grams: "g",
  kg: "kg",
  kilogram: "kg",
  kilograma: "kg",
  kilograms: "kg",
  kilo: "kg",
  kila: "kg",
  // --- volume ---------------------------------------------------------------
  ml: "ml",
  mililitar: "ml",
  mililitra: "ml",
  millilitre: "ml",
  millilitres: "ml",
  milliliter: "ml",
  milliliters: "ml",
  l: "l",
  litar: "l",
  litra: "l",
  litara: "l",
  litre: "l",
  litres: "l",
  liter: "l",
  liters: "l",
  tsp: "tsp",
  "tsp.": "tsp",
  teaspoon: "tsp",
  teaspoons: "tsp",
  kašičica: "tsp",
  kašičice: "tsp",
  kašičicu: "tsp",
  "čajna kašičica": "tsp",
  "mala kašika": "tsp",
  tbsp: "tbsp",
  "tbsp.": "tbsp",
  tbs: "tbsp",
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  kašika: "tbsp",
  kašike: "tbsp",
  kašiku: "tbsp",
  "supena kašika": "tbsp",
  "supena kašičica": "tbsp",
  "velika kašika": "tbsp",
  cup: "cup",
  cups: "cup",
  šolja: "cup",
  šolje: "cup",
  šolju: "cup",
  šoljica: "cup",
  šoljice: "cup",
  floz: "fl_oz",
  "fl oz": "fl_oz",
  "fluid ounce": "fl_oz",
  "fluid ounces": "fl_oz",
  // --- counts ---------------------------------------------------------------
  pinch: "pinch",
  pinches: "pinch",
  prstohvat: "pinch",
  prstohvata: "pinch",
  dash: "dash",
  dashes: "dash",
  clove: "clove",
  cloves: "clove",
  čen: "clove",
  čena: "clove",
  čenova: "clove",
  češanj: "clove",
  češnja: "clove",
  češnjeva: "clove",
  piece: "piece",
  pieces: "piece",
  komad: "piece",
  komada: "piece",
  komadi: "piece",
  kom: "piece",
  slice: "slice",
  slices: "slice",
  kriška: "slice",
  kriške: "slice",
  kolut: "slice",
  kolutić: "slice",
  sprig: "sprig",
  sprigs: "sprig",
  grančica: "sprig",
  grančice: "sprig",
  stalk: "stalk",
  stalks: "stalk",
  stabljika: "stalk",
  stabljike: "stalk",
  struk: "stalk",
  struka: "stalk",
  head: "head",
  heads: "head",
  glavica: "head",
  glavice: "head",
  bunch: "bunch",
  bunches: "bunch",
  veza: "bunch",
  veze: "bunch",
  vezica: "bunch",
  handful: "handful",
  handfuls: "handful",
  šaka: "handful",
  šake: "handful",
  pregršt: "handful",
  stick: "stick",
  sticks: "stick",
  štapić: "stick",
  štapića: "stick",
  sheet: "sheet",
  sheets: "sheet",
  list: "sheet",
  lista: "sheet",
  listova: "sheet",
  kora: "sheet",
  kore: "sheet",
  can: "can",
  cans: "can",
  tin: "can",
  tins: "can",
  konzerva: "can",
  konzerve: "can",
  limenka: "can",
  limenke: "can",
  packet: "packet",
  packets: "packet",
  pack: "packet",
  packs: "packet",
  sachet: "packet",
  sachets: "packet",
  kesica: "packet",
  kesice: "packet",
  kesa: "packet",
  kese: "packet",
  pakovanje: "packet",
  paket: "packet",
  vrećica: "packet",
  vrećice: "packet",
  cube: "cube",
  cubes: "cube",
  kocka: "cube",
  kocke: "cube",
  kockica: "cube",
  kockice: "cube",
};

/** The same table, longest word first, so „grama" is tried before „g" and „fl oz" before „l". */
const UNIT_WORDS_LONGEST_FIRST: readonly (readonly [string, IngredientUnit])[] = Object.entries(
  UNIT_WORDS,
)
  .sort(([left], [right]) => right.length - left.length)
  .map(([word, unit]) => [word, unit] as const);

/** The amounts a recipe writes in letters. „pola kašičice" is half a teaspoon and says so. */
const QUANTITY_WORDS: Readonly<Record<string, number>> = {
  half: 0.5,
  pola: 0.5,
  quarter: 0.25,
  četvrt: 0.25,
  cetvrt: 0.25,
};

/**
 * The notes that mean „as much as you like" — taken off the END of a line, as a
 * preparation note. The list is short on purpose: these are the phrases a recipe
 * writes INSTEAD of an amount, and each is a sentence rather than a word, so a
 * line ending in one is unambiguously noting rather than naming something.
 */
const TASTE_PHRASES: readonly string[] = [
  "po ukusu",
  "po želji",
  "po potrebi",
  "to taste",
  "as needed",
  "as desired",
  "for garnish",
  "za ukras",
];

/** A vulgar fraction as Unicode ships it, and what it is worth. */
const VULGAR_FRACTIONS: Readonly<Record<string, number>> = {
  "½": 0.5,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "¼": 0.25,
  "¾": 0.75,
  "⅕": 0.2,
  "⅖": 0.4,
  "⅗": 0.6,
  "⅘": 0.8,
  "⅙": 1 / 6,
  "⅚": 5 / 6,
  "⅐": 1 / 7,
  "⅛": 0.125,
  "⅜": 0.375,
  "⅝": 0.625,
  "⅞": 0.875,
  "⅑": 1 / 9,
  "⅒": 0.1,
};

/** An amount at the start of the text, and the text after it. */
interface Amount {
  readonly value: number;
  readonly rest: string;
}

/**
 * One ingredient line, structured. A blank line answers `null` — there is no
 * ingredient in an empty box — and everything else answers a line with every
 * field filled or deliberately null.
 */
export function parseIngredientLine(text: string): IngredientLine | null {
  const collapsed = text.trim().replace(/\s+/g, " ").replace(/[\u2013\u2014]/g, "-");
  if (collapsed.length === 0) return null;

  const amount = readAmount(collapsed);
  let rest = amount === null ? collapsed : amount.rest;
  let quantity = amount === null ? null : amount.value;
  let quantityMax: number | null = null;

  if (amount !== null) {
    const range = readRange(rest);
    if (range !== null) {
      quantityMax = range.value;
      rest = range.rest;
    }
    // An article after an amount is filler: „half a lemon" is half a lemon.
    rest = rest.replace(/^(?:an?|the)\s+/i, "");
  } else if (/^(?:an?|the)\s+/i.test(rest)) {
    // „a pinch of salt": the article itself is the one.
    quantity = 1;
    rest = rest.replace(/^(?:an?|the)\s+/i, "");
  }

  const unit = readUnit(rest);
  if (unit !== null) rest = unit.rest;
  // „2 tbsp of olive oil": the English partitive belongs to the amount, not to
  // the ingredient's name.
  rest = rest.replace(/^of\s+/i, "");

  // The three fields a typed line cannot carry are null rather than absent: an
  // ingredient line has one shape, and a caller filling a form should not have
  // to ask which of its keys the parser happened to write.
  return {
    ...readName(rest),
    quantity,
    quantityMax,
    unit: unit === null ? null : unit.unit,
    group: null,
    foodRef: null,
    gramsPerUnit: null,
  };
}

/**
 * The amount at the start, in any of the five shapes a recipe writes it, or null
 * when the line begins with something that is not an amount.
 */
function readAmount(text: string): Amount | null {
  const lower = text.toLowerCase();

  // „half a lemon", „pola kašičice"
  for (const [word, value] of Object.entries(QUANTITY_WORDS)) {
    if (lower.startsWith(`${word} `)) {
      return { value, rest: text.slice(word.length + 1) };
    }
  }

  // „1 1/2", then „1/2", then a plain number, then a bare vulgar fraction.
  const mixed = /^(\d+)\s+(\d+)\s*\/\s*(\d+)(?=\s|$)/.exec(text);
  if (mixed !== null) {
    const denominator = Number(mixed[3]);
    if (denominator !== 0) {
      return {
        value: Number(mixed[1]) + Number(mixed[2]) / denominator,
        rest: text.slice(mixed[0].length).trimStart(),
      };
    }
  }

  const fraction = /^(\d+)\s*\/\s*(\d+)(?=\s|$)/.exec(text);
  if (fraction !== null) {
    const denominator = Number(fraction[2]);
    if (denominator !== 0) {
      return {
        value: Number(fraction[1]) / denominator,
        rest: text.slice(fraction[0].length).trimStart(),
      };
    }
  }

  const decimal = /^(\d+(?:[.,]\d+)?)/.exec(text);
  if (decimal !== null) {
    const value = Number((decimal[1] ?? "").replace(",", "."));
    if (Number.isFinite(value)) {
      // „1½" — a whole number immediately followed by a vulgar fraction.
      const after = text.slice(decimal[0].length);
      const marked = after.slice(0, 1);
      const vulgar = VULGAR_FRACTIONS[marked];
      if (vulgar !== undefined && (after.length === 1 || after.startsWith(`${marked} `))) {
        return { value: value + vulgar, rest: after.slice(1).trimStart() };
      }
      return { value, rest: after.trimStart() };
    }
  }

  const vulgarOnly = VULGAR_FRACTIONS[text.slice(0, 1)];
  if (vulgarOnly !== undefined) {
    return { value: vulgarOnly, rest: text.slice(1).trimStart() };
  }

  return null;
}

/**
 * The upper end of a range, or null. A dash with no amount after it is not a
 * range — „200 g - maslinovo ulje" keeps its dash as part of the name, because
 * refusing to read a second AMOUNT is the whole test.
 */
function readRange(text: string): Amount | null {
  const separator = /^(?:-|to\s|do\s)/i.exec(text);
  if (separator === null) return null;
  const after = text.slice(separator[0].length).trimStart();
  return readAmount(after);
}

/** The unit word at the start, longest match first and word-aligned, or null. */
function readUnit(text: string): { unit: IngredientUnit; rest: string } | null {
  const lower = text.toLowerCase();
  for (const [word, unit] of UNIT_WORDS_LONGEST_FIRST) {
    if (!lower.startsWith(word)) continue;
    const after = lower.slice(word.length);
    // The boundary is what keeps „2 lampaca" a name: „l" is a litre only when
    // the next character ends the word.
    if (after.length !== 0 && !after.startsWith(" ")) continue;
    return { unit, rest: text.slice(word.length).trimStart() };
  }
  return null;
}

/** The name, and whatever note followed it — from a comma, a trailing parenthesis, or a taste phrase. */
function readName(text: string): { name: string; preparation: string | null } {
  const trimmed = text.trim();

  const comma = trimmed.indexOf(",");
  if (comma > 0) {
    const preparation = trimmed.slice(comma + 1).trim();
    if (preparation.length > 0) {
      return { name: trimmed.slice(0, comma).trim(), preparation };
    }
  }

  const parenthesis = /^(.*\S)\s*\(([^()]*)\)$/.exec(trimmed);
  if (parenthesis !== null) {
    const inside = (parenthesis[2] ?? "").trim();
    const before = (parenthesis[1] ?? "").trim();
    if (inside.length > 0 && before.length > 0) {
      return { name: before, preparation: inside };
    }
  }

  const lower = trimmed.toLowerCase();
  for (const phrase of TASTE_PHRASES) {
    if (!lower.endsWith(phrase)) continue;
    const before = trimmed.slice(0, trimmed.length - phrase.length).trim();
    if (before.length > 0) {
      return { name: before, preparation: trimmed.slice(trimmed.length - phrase.length) };
    }
  }

  // A group heading („Za sos:") reaches here whole, colon included: this function
  // reads an ingredient, and only the caller knows a heading from one. A trailing
  // full stop, on the other hand, is a sentence's punctuation rather than part of
  // any name.
  return { name: trimmed.replace(/\.$/, "").trim(), preparation: null };
}
