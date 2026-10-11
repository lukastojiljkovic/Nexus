import { describe, expect, it } from "vitest";
import { cardFromCode, SUITS, type Card, type Suit } from "./card.js";
import { autoplaySafe, autoplaySafeCards } from "./autoplay.js";

function card(code: string): Card {
  const parsed = cardFromCode(code);
  if (parsed === null) throw new Error(`fixture is not a card: ${code}`);
  return parsed;
}

/** Foundations written the way a table stores them: one pile per suit, from the Ace up. */
function foundations(spec: Partial<Record<Suit, string>>): Card[][] {
  return SUITS.map((suit) => (spec[suit] ?? "").split(/\s+/).filter(Boolean).map(card));
}

describe("the autoplay safety rule", () => {
  it("calls an Ace safe as soon as its foundation is empty", () => {
    const empty = foundations({});
    expect(autoplaySafe(empty, card("AS"))).toBe(true);
    // And not before: a foundation that already holds the Ace has no room for it.
    expect(autoplaySafe(foundations({ spades: "AS" }), card("AS"))).toBe(false);
  });

  it("calls a Two safe once its Ace is home, whatever the other Aces are doing", () => {
    // The FAQ names this one outright: „Aces can always safely be played, as well
    // as twos of any suits whose aces are already there".
    const onlyClubs = foundations({ clubs: "AC" });
    expect(autoplaySafe(onlyClubs, card("2C"))).toBe(true);
    // Without the Ace it cannot go home at all, so it is not a candidate.
    expect(autoplaySafe(foundations({}), card("2C"))).toBe(false);
  });

  it("holds a card whose packers are still in play and not themselves safe", () => {
    // A red Three can go home (diamonds are at the Two) but the two black Fours
    // that could be packed onto it are neither home nor playable, so a tableau
    // card that needs one of them would have nowhere to go.
    const unsafe = foundations({ clubs: "AC 2C", diamonds: "AD 2D" });
    expect(autoplaySafe(unsafe, card("3D"))).toBe(false);

    // Both black Fours ON the foundations: nothing can be packed onto the Three
    // that is not already out of the way, so it is safe.
    const safe = foundations({
      clubs: "AC 2C 3C 4C",
      diamonds: "AD 2D",
      spades: "AS 2S 3S 4S",
    });
    expect(autoplaySafe(safe, card("3D"))).toBe(true);
  });

  it("walks the packer chain one rank deeper, which is the FAQ's own example", () => {
    // „a seven of diamonds is safe to autoplay (onto a six of diamonds already
    // there) when both black fives and the four of hearts are already on the
    // foundations" — the black Sixes stay harmless only because the red Fives
    // below them are, which is one rank deeper than „the packers are gone".
    const example = foundations({
      clubs: "AC 2C 3C 4C 5C",
      diamonds: "AD 2D 3D 4D 5D 6D",
      hearts: "AH 2H 3H 4H",
      spades: "AS 2S 3S 4S 5S",
    });
    expect(autoplaySafe(example, card("7D"))).toBe(true);

    // Take the four of hearts back off the foundation and the chain breaks: the
    // five of hearts could be packed onto the seven, and it cannot go home.
    const broken = foundations({
      clubs: "AC 2C 3C 4C 5C",
      diamonds: "AD 2D 3D 4D 5D 6D",
      hearts: "AH 2H 3H",
      spades: "AS 2S 3S 4S 5S",
    });
    expect(autoplaySafe(broken, card("7D"))).toBe(false);
  });

  it("calls a King safe once the two Queens that could be packed onto it are home", () => {
    // A King is not the end of the chain by colour: a RED Queen is what lands on
    // a black King, so a black King waits for diamonds AND hearts to reach the
    // Queen — clubs, the same colour, never enters the question.
    const queensHome = foundations({
      diamonds: "AD 2D 3D 4D 5D 6D 7D 8D 9D TD JD QD",
      hearts: "AH 2H 3H 4H 5H 6H 7H 8H 9H TH JH QH",
      spades: "AS 2S 3S 4S 5S 6S 7S 8S 9S TS JS QS",
    });
    expect(autoplaySafe(queensHome, card("KS"))).toBe(true);

    // Hearts barely started: the Queen of Hearts is still in play, so the black
    // King could be needed to hold it and is not safe.
    const queenInPlay = foundations({
      diamonds: "AD 2D 3D 4D 5D 6D 7D 8D 9D TD JD QD",
      hearts: "AH 2H 3H",
      spades: "AS 2S 3S 4S 5S 6S 7S 8S 9S TS JS QS",
    });
    expect(autoplaySafe(queenInPlay, card("KS"))).toBe(false);
  });

  it("given several candidates, filters them in the order they were handed over", () => {
    const table = foundations({});
    const candidates = [card("KS"), card("AH"), card("2C"), card("AS")];
    // Only the Aces can go home, and the answer is in the caller's order.
    expect(autoplaySafeCards(table, candidates)).toEqual([card("AH"), card("AS")]);
  });
});
