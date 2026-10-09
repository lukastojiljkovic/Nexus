/**
 * The one place a card is called SAFE to send home automatically, shared by
 * Klondike and FreeCell because the rule is about packing in alternate colours
 * and both games pack in alternate colours.
 *
 * The rule is the one the FreeCell FAQ states
 * (http://www.solitairelaboratory.com/fcfaq.html § „How does autoplay work?"):
 * *„completely safe to autoplay a card when any possible card that could be
 * packed onto it on a tableau column has already been played to the foundation,
 * or can be played there as soon as it is uncovered"*. The cards that could be
 * packed onto a card of rank R are the two cards of rank R−1 in the OTHER colour
 * — a red Five is what lands on a black Six — and a card can only be packed where
 * it comes to rest, so the chain walks DOWN the ranks and stops at the Aces,
 * which nothing can be packed onto and which are therefore always safe.
 *
 * **This is Allen's rule, not Microsoft's early one.** The FAQ records that
 * Microsoft did not implement it in full — it holds a card until the packers are
 * home rather than until they are home *or safe* — and then, having done that,
 * relaxes the rule in a way the FAQ calls unsafe when „worrying back" (playing a
 * card off the foundation again) is allowed. This app allows exactly that, so it
 * takes the general rule: the narrower reading loses games, and the wider one is
 * the one the FAQ warns about.
 *
 * A card that is not the next of its suit cannot go home at all and is never
 * „safe"; the caller filters on that too, and this function re-checks it because
 * the recursion needs the answer for cards nobody offered it.
 */

import { colourOf, SUITS, type Card, type Rank } from "./card.js";

/**
 * Whether sending `card` home is safe right now.
 *
 * **A greatest fixed point, not a recursion.** The rule is self-referential — a
 * black Six's packer is a red Five, and that red Five may only be safe because
 * the black Six is — so „is the Six safe" can lead back to itself. Read as a
 * recursion it need not terminate; read as „the largest set of cards that can be
 * played home without any of them being needed again", it has an obvious answer,
 * and that is what is computed here: start from every card whose foundation is
 * ready, then repeatedly drop any card with a packer that is neither home nor
 * still in the set, until the set stops changing.
 *
 * The FAQ's „both black fives and the four of hearts" example is what the
 * iteration buys: the black Sixes stay in the set only because the red Fives are
 * themselves ready to go home, which is one rank deeper than the naive reading
 * of „the packers must be gone".
 */
export function autoplaySafe(foundations: readonly (readonly Card[])[], card: Card): boolean {
  return autoplaySet(foundations).has(encode(card.suit, card.rank));
}

/**
 * The whole safe set, which is what a caller with several candidates wants —
 * `autoplaySafe` is the same computation for one card.
 */
export function autoplaySafeCards(foundations: readonly (readonly Card[])[], cards: readonly Card[]): Card[] {
  const safe = autoplaySet(foundations);
  return cards.filter((card) => safe.has(encode(card.suit, card.rank)));
}

function autoplaySet(foundations: readonly (readonly Card[])[]): ReadonlySet<string> {
  const safe = new Set<string>();
  for (const suit of SUITS) {
    const pile = foundations[SUITS.indexOf(suit)];
    if (pile === undefined) continue;
    // The rank this foundation wants next — the only card of that suit that can
    // go home at all.
    const next = pile.length + 1;
    if (next <= 13) safe.add(encode(suit, next as Rank));
  }
  const size = () => safe.size;
  let changed = true;
  while (changed) {
    const before = size();
    for (const member of [...safe]) {
      const { suit, rank } = decode(member);
      // An Ace has nothing that could be packed onto it, so it never has to wait.
      if (rank === 1) continue;
      for (const other of SUITS) {
        if (colourOf(other) === colourOf(suit)) continue;
        const packerRank = rank - 1;
        const held = foundations[SUITS.indexOf(other)]?.length ?? 0;
        // Home already: it cannot come back to the tableau to sit here.
        if (held >= packerRank) continue;
        // Otherwise it has to be a card that will go home as soon as it is
        // uncovered — which means its own foundation is the next one along AND
        // that it is itself in this set.
        if (held !== packerRank - 1) {
          safe.delete(member);
          break;
        }
        if (!safe.has(encode(other, packerRank as Rank))) {
          safe.delete(member);
          break;
        }
      }
    }
    changed = size() !== before;
  }
  return safe;
}

/** A card's key in the safe set: `"spades:7"`. Suffix-free, so no code can collide with another. */
function encode(suit: Card["suit"], rank: Rank): string {
  return `${suit}:${rank}`;
}

function decode(key: string): { suit: Card["suit"]; rank: Rank } {
  const [suit, rank] = key.split(":");
  return { suit: suit as Card["suit"], rank: Number(rank) as Rank };
}
