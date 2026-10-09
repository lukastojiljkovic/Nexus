/**
 * Dice, coins, picks and teams (mini-apps, stage 1).
 *
 * Every function that needs a random number takes `randomBelow(bound)` as its
 * LAST argument and never calls `Math.random` itself. That is the whole design:
 * stage 2 passes a crypto-backed source, the tests pass a recording or scripted
 * one, and because the bound is the only thing this module ever asks for, the
 * two are interchangeable and the tests can assert the exact sequence of
 * bounds. `randomBelow` must return an integer in `[0, bound)`, and every
 * function here is total over its documented bounds — it either answers or
 * throws, with the bounds it asked for stated in the doc comment beside it.
 *
 * The dice grammar is parsed, never guessed at: malformed notation raises
 * `DiceNotationError` with a code, because a page that answered "2d6+" with a
 * roll of some kind would be showing the user a number that did not come from
 * the dice they asked for.
 */

/**
 * The only randomness this module consumes: an integer in `[0, bound)`.
 * `bound` is always at least 1.
 */
export type RandomBelow = (bound: number) => number;

/** Dice limits, per term: `100d1000` is the widest term the grammar admits. */
export const DICE_MAX_DICE_PER_TERM = 100;
export const DICE_MIN_FACES = 2;
export const DICE_MAX_FACES = 1000;
/** The longest notation read at all, which bounds the terms, and so the dice, one roll asks for. */
export const DICE_MAX_NOTATION_LENGTH = 100;

export type DiceNotationCode =
  | "empty"
  | "too-long"
  | "syntax"
  | "no-dice"
  | "dice-count"
  | "faces"
  | "keep-count";

/** Malformed dice notation, named so stage 2 can turn the code into its own copy. */
export class DiceNotationError extends Error {
  readonly code: DiceNotationCode;

  constructor(code: DiceNotationCode, message: string) {
    super(message);
    this.name = "DiceNotationError";
    this.code = code;
  }
}

export interface DiceKeep {
  /** `kh` keeps the highest dice of the term, `kl` the lowest. */
  readonly mode: "kh" | "kl";
  readonly count: number;
}

export interface DiceTerm {
  /** `1` for a term that adds its dice, `-1` for a subtracted one (`2d6-1d4`). */
  readonly sign: 1 | -1;
  readonly count: number;
  readonly faces: number;
  /** `null` when the whole term counts. */
  readonly keep: DiceKeep | null;
}

export interface DiceNotation {
  readonly terms: readonly DiceTerm[];
  /** The constant terms, added together. */
  readonly modifier: number;
}

export interface RolledDie {
  readonly faces: number;
  readonly value: number;
  /** False for a die a `kh`/`kl` term dropped. */
  readonly kept: boolean;
}

export interface DiceTermRoll {
  readonly sign: 1 | -1;
  readonly count: number;
  readonly faces: number;
  readonly keep: DiceKeep | null;
  readonly dice: readonly RolledDie[];
  /** The kept dice, with the term's sign already applied. */
  readonly total: number;
}

export interface DiceRoll {
  readonly terms: readonly DiceTermRoll[];
  /** Every die in the order it was rolled, kept and dropped alike. */
  readonly dice: readonly RolledDie[];
  readonly modifier: number;
  readonly total: number;
}

/**
 * One term: `NdS`, `NdSkh K`, `NdSkl K`, or a bare integer constant. Every digit
 * run is bounded: one digit wider than its limit, so `101d6` and `1d1001` still
 * reach their range checks, and a constant has six digits at most.
 */
const TERM = /(\d{0,4})[dD](\d{1,5})(?:(kh|kl)(\d{1,4}))?|(\d{1,6})/iy;

function skipSpaces(text: string, from: number): number {
  let index = from;
  while (index < text.length && (text[index] === " " || text[index] === "\t")) index += 1;
  return index;
}

/**
 * The parsed form of dice notation: `2d6+1d4+3`, `4d6kh3`, `d20`, `2d6-1d4`.
 *
 * A term is `NdS` (with `N` optional, so `d20` is one twenty-sided die) or a
 * bare integer, and the terms are joined by `+` or `-`. `kh`/`kl` keep the
 * highest or lowest `K` dice of their term. Counts are 1–100 dice per term and
 * faces 2–1000, the bounds the module states, and the whole notation is 100
 * characters at most; anything else — including a
 * leading sign, a term with no operator before it, or an expression with no
 * dice term at all — raises `DiceNotationError` rather than being repaired.
 */
export function parseDiceNotation(text: string): DiceNotation {
  const source = text.trim();
  if (source === "") throw new DiceNotationError("empty", "dice notation is empty");
  if (source.length > DICE_MAX_NOTATION_LENGTH) {
    throw new DiceNotationError(
      "too-long",
      `dice notation is ${DICE_MAX_NOTATION_LENGTH} characters at most`,
    );
  }

  const terms: DiceTerm[] = [];
  let modifier = 0;
  let index = 0;
  let sign: 1 | -1 = 1;
  let first = true;

  while (index < source.length) {
    if (!first) {
      const operator = source[index];
      if (operator === "+") sign = 1;
      else if (operator === "-") sign = -1;
      else {
        throw new DiceNotationError("syntax", `expected + or - at position ${index}`);
      }
      index = skipSpaces(source, index + 1);
    }

    TERM.lastIndex = index;
    const match = TERM.exec(source);
    if (match === null || match[0].length === 0) {
      throw new DiceNotationError("syntax", `cannot read a term at position ${index}`);
    }
    index += match[0].length;

    const constant = match[5];
    if (constant !== undefined) {
      modifier += sign * Number(constant);
    } else {
      const count = match[1] === "" ? 1 : Number(match[1]);
      const faces = Number(match[2]);
      if (count < 1 || count > DICE_MAX_DICE_PER_TERM) {
        throw new DiceNotationError(
          "dice-count",
          `a term rolls ${DICE_MAX_DICE_PER_TERM} dice at most`,
        );
      }
      if (faces < DICE_MIN_FACES || faces > DICE_MAX_FACES) {
        throw new DiceNotationError(
          "faces",
          `faces must be ${DICE_MIN_FACES}–${DICE_MAX_FACES}`,
        );
      }
      let keep: DiceKeep | null = null;
      const keepMode = match[3];
      const keepCount = match[4];
      if (keepMode !== undefined && keepCount !== undefined) {
        const kept = Number(keepCount);
        if (kept < 1 || kept > count) {
          throw new DiceNotationError(
            "keep-count",
            "keep must be one die or more, and never more than the term holds",
          );
        }
        keep = { mode: keepMode === "kh" ? "kh" : "kl", count: kept };
      }
      terms.push({ sign, count, faces, keep });
    }

    first = false;
    index = skipSpaces(source, index);
    if (index < source.length && source[index] !== "+" && source[index] !== "-") {
      throw new DiceNotationError("syntax", `unexpected ${source[index]} at position ${index}`);
    }
  }

  if (terms.length === 0) {
    throw new DiceNotationError("no-dice", "notation must roll at least one die");
  }
  return { terms, modifier };
}

/**
 * Rolls a parsed notation. One `randomBelow(faces)` per die, in term order and
 * then in dice order — a `kh`/`kl` selection consumes nothing extra, because it
 * chooses among the dice already rolled.
 */
export function rollParsedDice(notation: DiceNotation, randomBelow: RandomBelow): DiceRoll {
  const terms: DiceTermRoll[] = [];
  const dice: RolledDie[] = [];
  let total = notation.modifier;

  for (const term of notation.terms) {
    const values: number[] = [];
    for (let die = 0; die < term.count; die += 1) {
      values.push(randomBelow(term.faces) + 1);
    }

    // Every die counts unless a keep narrows the term.
    let kept: ReadonlySet<number> | null = null;
    const keep = term.keep;
    if (keep !== null) {
      // Highest (or lowest) first, ties broken by the order the dice fell in, so
      // an all-equal roll reports the same dice every time.
      const order = values
        .map((_value, at) => at)
        .sort((a, b) => {
          const left = values[a] as number;
          const right = values[b] as number;
          const difference = keep.mode === "kh" ? right - left : left - right;
          return difference !== 0 ? difference : a - b;
        });
      kept = new Set(order.slice(0, keep.count));
    }

    const rolled: RolledDie[] = values.map((value, at) => ({
      faces: term.faces,
      value,
      kept: kept === null || kept.has(at),
    }));
    const termTotal =
      term.sign * rolled.reduce((sum, die) => (die.kept ? sum + die.value : sum), 0);
    terms.push({
      sign: term.sign,
      count: term.count,
      faces: term.faces,
      keep: term.keep,
      dice: rolled,
      total: termTotal,
    });
    dice.push(...rolled);
    total += termTotal;
  }

  return { terms, dice, modifier: notation.modifier, total };
}

/** `parseDiceNotation` followed by `rollParsedDice` — the door stage 2's field uses. */
export function rollDiceNotation(text: string, randomBelow: RandomBelow): DiceRoll {
  return rollParsedDice(parseDiceNotation(text), randomBelow);
}

/** `heads` on 0, `tails` on 1; one draw from a bound of 2. */
export function coinFlip(randomBelow: RandomBelow): "heads" | "tails" {
  return randomBelow(2) === 0 ? "heads" : "tails";
}

/**
 * An integer in `[min, max]`, both ends included: one draw from a bound of
 * `max - min + 1`. A range of one value still draws, so replaying a session
 * consumes the same sequence whatever the range is.
 */
export function randomInt(min: number, max: number, randomBelow: RandomBelow): number {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max) {
    throw new RangeError("randomInt needs two integers, min first");
  }
  return min + randomBelow(max - min + 1);
}

/**
 * `count` distinct items from `items`, in the order they were drawn, by a
 * partial Fisher-Yates shuffle over a copy. The bounds asked for are
 * `items.length`, `items.length - 1`, ... down to `items.length - count + 1`.
 */
export function pickItems<T>(items: readonly T[], count: number, randomBelow: RandomBelow): T[] {
  if (!Number.isInteger(count) || count < 0 || count > items.length) {
    throw new RangeError("pickItems needs a whole count between 0 and the list's length");
  }
  const pool = [...items];
  const picked: T[] = [];
  for (let at = 0; at < count; at += 1) {
    const swapWith = at + randomBelow(pool.length - at);
    const held = pool[at] as T;
    pool[at] = pool[swapWith] as T;
    pool[swapWith] = held;
    picked.push(pool[at] as T);
  }
  return picked;
}

/**
 * A new array holding the same items in shuffled order, by Fisher-Yates from
 * the end: the bounds asked for are `items.length`, `items.length - 1`, ... `2`.
 * Nothing is drawn for an empty or single-item list.
 */
export function shuffleItems<T>(items: readonly T[], randomBelow: RandomBelow): T[] {
  const shuffled = [...items];
  for (let at = shuffled.length - 1; at > 0; at -= 1) {
    const swapWith = randomBelow(at + 1);
    const held = shuffled[at] as T;
    shuffled[at] = shuffled[swapWith] as T;
    shuffled[swapWith] = held;
  }
  return shuffled;
}

/**
 * The roster split into `teamCount` teams, shuffled first and then dealt
 * round-robin, so sizes differ by at most one and every item lands in exactly
 * one team. The first `items.length % teamCount` teams hold the extra member.
 * The bounds asked for are the shuffle's.
 */
export function dealTeams<T>(
  items: readonly T[],
  teamCount: number,
  randomBelow: RandomBelow,
): T[][] {
  if (!Number.isInteger(teamCount) || teamCount < 1 || teamCount > items.length) {
    throw new RangeError("dealTeams needs a team count between 1 and the roster's size");
  }
  const teams: T[][] = Array.from({ length: teamCount }, () => []);
  shuffleItems(items, randomBelow).forEach((item, at) => {
    (teams[at % teamCount] as T[]).push(item);
  });
  return teams;
}
