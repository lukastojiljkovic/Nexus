import { describe, expect, it } from "vitest";
import {
  DiceNotationError,
  coinFlip,
  dealTeams,
  parseDiceNotation,
  pickItems,
  randomInt,
  rollDiceNotation,
  shuffleItems,
  type RandomBelow,
} from "./random.js";

/**
 * A source that answers `0` every time and remembers every bound it was asked
 * for — the point of these tests is the SEQUENCE of bounds, because that is
 * what makes a crypto-backed source and a seeded one interchangeable.
 */
function recording(): { source: RandomBelow; bounds: number[] } {
  const bounds: number[] = [];
  return {
    source: (bound) => {
      bounds.push(bound);
      return 0;
    },
    bounds,
  };
}

/**
 * A source that hands out the scripted values in order and refuses to answer a
 * bound they cannot fit in, so a roll that asked for a different bound than the
 * test expected fails instead of quietly passing.
 */
function scripted(values: readonly number[]): RandomBelow {
  let index = 0;
  return (bound) => {
    const value = values[index];
    index += 1;
    if (value === undefined) throw new Error(`ran out of scripted values at bound ${bound}`);
    if (!Number.isInteger(value) || value < 0 || value >= bound) {
      throw new Error(`scripted value ${value} does not fit bound ${bound}`);
    }
    return value;
  };
}

describe("parseDiceNotation", () => {
  it("reads dice terms and their constant", () => {
    expect(parseDiceNotation("2d6+1d4+3")).toEqual({
      terms: [
        { sign: 1, count: 2, faces: 6, keep: null },
        { sign: 1, count: 1, faces: 4, keep: null },
      ],
      modifier: 3,
    });
  });

  it("reads a bare die as one die and a bare constant as a modifier", () => {
    expect(parseDiceNotation("d20")).toEqual({
      terms: [{ sign: 1, count: 1, faces: 20, keep: null }],
      modifier: 0,
    });
    expect(parseDiceNotation("2d6-1")).toEqual({
      terms: [{ sign: 1, count: 2, faces: 6, keep: null }],
      modifier: -1,
    });
    expect(parseDiceNotation("2d6+3+4").modifier).toBe(7);
  });

  it("reads keep-highest and keep-lowest, case-insensitively, and tolerates spaces", () => {
    expect(parseDiceNotation("4d6kh3").terms[0]).toEqual({
      sign: 1,
      count: 4,
      faces: 6,
      keep: { mode: "kh", count: 3 },
    });
    expect(parseDiceNotation("10d10kl2").terms[0]?.keep).toEqual({ mode: "kl", count: 2 });
    expect(parseDiceNotation("  2D6  +  1d4  +  3  ")).toEqual(parseDiceNotation("2d6+1d4+3"));
  });

  it("reads a subtracted dice term as a term with its own sign", () => {
    expect(parseDiceNotation("2d6-1d4")).toEqual({
      terms: [
        { sign: 1, count: 2, faces: 6, keep: null },
        { sign: -1, count: 1, faces: 4, keep: null },
      ],
      modifier: 0,
    });
  });

  it("refuses malformed notation by name rather than guessing", () => {
    const code = (text: string) => {
      try {
        parseDiceNotation(text);
      } catch (error) {
        expect(error).toBeInstanceOf(DiceNotationError);
        expect((error as DiceNotationError).name).toBe("DiceNotationError");
        return (error as DiceNotationError).code;
      }
      return "did not throw";
    };

    expect(code("")).toBe("empty");
    expect(code("   ")).toBe("empty");
    expect(code("abc")).toBe("syntax");
    expect(code("2d6+")).toBe("syntax");
    expect(code("2d6*2")).toBe("syntax");
    expect(code("2d6 1d4")).toBe("syntax");
    expect(code("-2d6")).toBe("syntax");
    expect(code("7")).toBe("no-dice");
    expect(code("0d6")).toBe("dice-count");
    expect(code("101d6")).toBe("dice-count");
    expect(code("1d1")).toBe("faces");
    expect(code("1d1001")).toBe("faces");
    expect(code("1d6kh2")).toBe("keep-count");
    expect(code("1d6kh0")).toBe("keep-count");
  });
});

describe("rollDiceNotation", () => {
  it("rolls every die and totals the kept ones plus the constant", () => {
    // 2d6 rolls 6 and 6; 1d4 rolls 4; the constant is 3 -> 6 + 6 + 4 + 3 = 19.
    const roll = rollDiceNotation("2d6+1d4+3", scripted([5, 5, 3]));
    expect(roll.dice.map((die) => die.value)).toEqual([6, 6, 4]);
    expect(roll.dice.map((die) => die.faces)).toEqual([6, 6, 4]);
    expect(roll.terms.map((term) => term.total)).toEqual([12, 4]);
    expect(roll.modifier).toBe(3);
    expect(roll.total).toBe(19);
  });

  it("keeps the highest three of four dice, dropping the lowest", () => {
    // Values 1, 2, 3, 4 -> keeps 2, 3, 4 -> 9, and the 1 is marked dropped.
    const roll = rollDiceNotation("4d6kh3", scripted([0, 1, 2, 3]));
    expect(roll.dice.map((die) => die.value)).toEqual([1, 2, 3, 4]);
    expect(roll.dice.map((die) => die.kept)).toEqual([false, true, true, true]);
    expect(roll.total).toBe(9);
  });

  it("keeps the lowest three of four dice, dropping the highest", () => {
    const roll = rollDiceNotation("4d6kl3", scripted([0, 1, 2, 3]));
    expect(roll.dice.map((die) => die.kept)).toEqual([true, true, true, false]);
    expect(roll.total).toBe(6);
  });

  it("breaks ties in dice order, so equal rolls always report the same dice", () => {
    const roll = rollDiceNotation("4d6kh3", scripted([0, 0, 0, 0]));
    expect(roll.dice.map((die) => die.kept)).toEqual([true, true, true, false]);
    expect(roll.total).toBe(3);
  });

  it("subtracts a negative modifier and floors nothing", () => {
    const roll = rollDiceNotation("2d6-1", scripted([0, 0]));
    expect(roll.total).toBe(1);
    expect(rollDiceNotation("1d2-1", scripted([0])).total).toBe(0);
  });

  it("subtracts the roll of a subtracted term", () => {
    // 2d6 rolls 6 and 6; 1d4 rolls 4 -> 6 + 6 - 4 = 8.
    const roll = rollDiceNotation("2d6-1d4", scripted([5, 5, 3]));
    expect(roll.terms.map((term) => term.total)).toEqual([12, -4]);
    expect(roll.total).toBe(8);
    expect(roll.dice.map((die) => die.value)).toEqual([6, 6, 4]);
  });

  it("asks for the bound of each die, and nothing for a constant or a keep", () => {
    const diceOnly = recording();
    rollDiceNotation("2d6+1d4+3", diceOnly.source);
    expect(diceOnly.bounds).toEqual([6, 6, 4]);

    const withKeep = recording();
    rollDiceNotation("4d6kh3", withKeep.source);
    expect(withKeep.bounds).toEqual([6, 6, 6, 6]);
  });

  it("rolls every die of a full-size term", () => {
    const many = recording();
    const roll = rollDiceNotation("100d1000", many.source);
    expect(many.bounds).toHaveLength(100);
    expect(new Set(many.bounds)).toEqual(new Set([1000]));
    expect(roll.total).toBe(100);
  });
});

describe("coinFlip", () => {
  it("asks for two outcomes and maps 0 to heads and 1 to tails", () => {
    const source = recording();
    expect(coinFlip(source.source)).toBe("heads");
    expect(source.bounds).toEqual([2]);
    expect(coinFlip(scripted([1]))).toBe("tails");
  });
});

describe("randomInt", () => {
  it("asks for the inclusive range's width and offsets by the minimum", () => {
    const source = recording();
    expect(randomInt(5, 9, source.source)).toBe(5);
    expect(source.bounds).toEqual([5]);
    expect(randomInt(5, 9, scripted([4]))).toBe(9);
    expect(randomInt(-3, -1, scripted([0]))).toBe(-3);
  });

  it("still draws for a range of one value, so a replay is reproducible", () => {
    const source = recording();
    expect(randomInt(7, 7, source.source)).toBe(7);
    expect(source.bounds).toEqual([1]);
  });

  it("refuses a reversed or non-integer range", () => {
    expect(() => randomInt(9, 5, recording().source)).toThrow(RangeError);
    expect(() => randomInt(1.5, 3, recording().source)).toThrow(RangeError);
  });
});

describe("pickItems", () => {
  const letters = ["a", "b", "c", "d", "e"];

  it("picks k items without repeats, asking for one shrinking bound per pick", () => {
    const source = recording();
    expect(pickItems(letters, 3, source.source)).toEqual(["a", "b", "c"]);
    expect(source.bounds).toEqual([5, 4, 3]);
  });

  // pool [a,b,c,d,e], i=0: j=0+1 -> swap(0,1), take b; i=1: j=1+2 -> swap(1,3),
  // take d; i=2: j=2+0 -> swap(2,2), take c.
  it("walks a partial Fisher-Yates shuffle", () => {
    expect(pickItems(letters, 3, scripted([1, 2, 0]))).toEqual(["b", "d", "c"]);
  });

  it("takes everything, in some order, when k is the whole list", () => {
    const source = recording();
    const picked = pickItems(letters, 5, source.source);
    expect(source.bounds).toEqual([5, 4, 3, 2, 1]);
    expect([...picked].sort()).toEqual([...letters].sort());
  });

  it("draws nothing for k of zero and leaves the list alone", () => {
    const source = recording();
    expect(pickItems(letters, 0, source.source)).toEqual([]);
    expect(source.bounds).toEqual([]);
    expect(letters).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("refuses a k the list cannot supply", () => {
    expect(() => pickItems(letters, 6, recording().source)).toThrow(RangeError);
    expect(() => pickItems(letters, -1, recording().source)).toThrow(RangeError);
  });
});

describe("shuffleItems", () => {
  const letters = ["a", "b", "c", "d", "e"];

  it("shuffles with one draw per position from the end", () => {
    const source = recording();
    expect(shuffleItems(letters, source.source)).toEqual(["b", "c", "d", "e", "a"]);
    expect(source.bounds).toEqual([5, 4, 3, 2]);
  });

  it("leaves the input untouched and draws nothing for an empty or single list", () => {
    const empty = recording();
    expect(shuffleItems([], empty.source)).toEqual([]);
    const single = recording();
    expect(shuffleItems(["a"], single.source)).toEqual(["a"]);
    expect([...empty.bounds, ...single.bounds]).toEqual([]);
    expect(letters).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("dealTeams", () => {
  const people = ["a", "b", "c", "d", "e"];

  it("deals the shuffled list round-robin, so sizes differ by at most one", () => {
    // The same shuffle as above -> [b,c,d,e,a]; two teams take alternate picks:
    // [b,d,a] and [c,e].
    const source = recording();
    expect(dealTeams(people, 2, source.source)).toEqual([
      ["b", "d", "a"],
      ["c", "e"],
    ]);
    expect(source.bounds).toEqual([5, 4, 3, 2]);
  });

  it("splits evenly when the count divides, and otherwise by one", () => {
    const six = ["a", "b", "c", "d", "e", "f"];
    const even = dealTeams(six, 3, scripted([0, 0, 0, 0, 0]));
    expect(even.map((team) => team.length)).toEqual([2, 2, 2]);
    const seven = [...six, "g"];
    const odd = dealTeams(seven, 3, scripted([0, 0, 0, 0, 0, 0]));
    expect(odd.map((team) => team.length)).toEqual([3, 2, 2]);
  });

  it("refuses a team count the roster cannot fill", () => {
    expect(() => dealTeams(people, 0, recording().source)).toThrow(RangeError);
    expect(() => dealTeams(people, 6, recording().source)).toThrow(RangeError);
    expect(() => dealTeams([], 1, recording().source)).toThrow(RangeError);
  });
});
