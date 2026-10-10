/**
 * The index KEY, as the pack builder computes it.
 *
 * **This is a port of `packages/core/src/search/searchText.ts`'s `FOLD_TABLE`
 * and `packages/core/src/dictionary/keys.ts`'s `dictionaryKey`, and the port is
 * deliberate.** The builder runs under plain Node (`node
 * scripts/packs/dictionary/build.mjs`) and `@nexus/core` is TypeScript that Node
 * cannot load, so the one rule the pack and the app must agree on is written
 * twice — here, and in core — and `fold.test.mjs` holds the two together: it
 * folds a fixture set of words through BOTH implementations and fails on any
 * disagreement. If the copy ever drifts, the build fails rather than producing a
 * pack the app cannot look anything up in.
 *
 * The table's keys are escaped rather than written literally, which is this
 * directory's own convention for the reason `check:invisibles` exists: a
 * character class holding invisible-in-most-editors codepoints is how a letter
 * gets dropped by a well-meant edit.
 *
 * The algorithm is the one `foldSearchText` implements, step for step:
 * lowercase each code point, NFD-normalise it, drop combining marks, then map
 * what is left through the table.
 */

/** Combining Diacritical Marks, the block NFD moves a Latin diacritic into. */
const COMBINING_START = 0x0300;
const COMBINING_END = 0x036f;

/**
 * What each letter becomes, and the `đ` decision is the load-bearing one:
 * the Serbian convention for U+0111 is `dj`, not `d`, which is what makes a
 * query typed without the letter (`djordje`) find the word that has it.
 *
 * The Cyrillic half is the Serbian alphabet. `ž`-with-a-stroke and
 * `ž`-with-a-caron both map to `z`, and `ц`, `ч` and `ћ`
 * all map to `c` — the fold is lossy on purpose, and the pack keeps the word
 * itself beside its key.
 */
const FOLD_TABLE = {
  // Precomposed digraphs: only compatibility-decomposable, so NFD leaves them.
  "\u01c6": "dz",
  "\u01c5": "dz",
  "\u01c9": "lj",
  "\u01c8": "lj",
  "\u01cc": "nj",
  "\u01cb": "nj",
  // U+0111 has no decomposition at all: the stroke is part of the letter.
  "\u0111": "dj",
  // The rest of the Serbian Cyrillic alphabet.
  "\u0430": "a",
  "\u0431": "b",
  "\u0432": "v",
  "\u0433": "g",
  "\u0434": "d",
  "\u0452": "dj",
  "\u0435": "e",
  "\u0436": "z",
  "\u0437": "z",
  "\u0438": "i",
  "\u0458": "j",
  "\u043a": "k",
  "\u043b": "l",
  "\u0459": "lj",
  "\u043c": "m",
  "\u043d": "n",
  "\u045a": "nj",
  "\u043e": "o",
  "\u043f": "p",
  "\u0440": "r",
  "\u0441": "s",
  "\u0442": "t",
  "\u045b": "c",
  "\u0443": "u",
  "\u0444": "f",
  "\u0445": "h",
  "\u0446": "c",
  "\u0447": "c",
  "\u045f": "dz",
  "\u0448": "s",
};

/** One string folded: `foldSearchText`'s algorithm, character for character. */
export function fold(text) {
  let out = "";
  for (const char of text) {
    const decomposed = char.toLowerCase().normalize("NFD");
    for (const piece of decomposed) {
      const code = piece.codePointAt(0) ?? 0;
      if (code >= COMBINING_START && code <= COMBINING_END) continue;
      out += FOLD_TABLE[piece] ?? piece;
    }
  }
  return out;
}

/** One headword or query as the index knows it: `dictionaryKey` in core, and this is the same function. */
export function dictionaryKey(word) {
  return fold(word.trim());
}

/** The index's own order — code unit, matching `compareDictionaryKeys` in core. See that file for why it is not a collator. */
export function compareDictionaryKeys(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
