/**
 * Interleaved practice (ADR-047 / STUDY-010): the order a mixed, randomized
 * practice session asks its cards in.
 *
 * The learning claim is *interleaving* — a session that keeps switching topic
 * teaches discrimination between them, which a session that marches through one
 * topic at a time cannot. A plain shuffle does not deliver that: shuffling
 * everything together leaves long accidental runs of one deck, which is exactly
 * the blocked practice interleaving exists to avoid. So the order here is built
 * in two moves — shuffle WITHIN each deck, then merge the decks round by round —
 * and the second move is what makes the guarantee: while more than one deck
 * still has cards, no deck can be asked three times in a row.
 *
 * There is no topics table in Nexus; the topic-shaped entity is the DECK, so
 * "which topic is this card" is whatever `deckOf` says. The module never sees a
 * card's own type — it is pure and platform-neutral, strings and callbacks in,
 * a new array out, no clock, no IO, no dependency.
 *
 * Deterministic by construction: the caller supplies the seed, so the same seed
 * over the same queue replays the same session. That is what lets a practice
 * session survive a re-render — the renderer seeds ONCE, before the queue
 * materializes, and never re-runs this over a queue it is already working
 * through.
 */

/**
 * The PRNG this module randomizes with: mulberry32, spelled out here rather
 * than depended on. Thirty-two bits of state, one multiply-xor round, a uniform
 * `[0, 1)` — far more than a card order needs, and reproducible across every
 * platform the app runs on, which `Math.random` is not.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates, in place, descending — the standard unbiased shuffle. */
function shuffle<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const at = items[i] as T;
    items[i] = items[j] as T;
    items[j] = at;
  }
  return items;
}

/**
 * `cards` reordered for interleaved practice under `seed`, as a NEW array; the
 * input is never touched.
 *
 * Exactly the cards that went in come out — this reorders a session, it never
 * filters one (scope and the problems-only filter are the queue's job). New and
 * due cards mix freely: a practice session has no trailing-New rule, because
 * mixing is the entire point of it.
 *
 * The arrangement, and the tie-breaks that make it reproducible:
 *
 *  1. Cards are grouped by `deckOf`, and the decks take the order they FIRST
 *     appear in `cards` — the queue's own order, so nothing here depends on how
 *     a deck id happens to sort.
 *  2. Each deck's cards are shuffled, decks in that same first-appearance
 *     order, so the sequence of random draws is fixed.
 *  3. Then rounds: the decks still holding cards are shuffled into a rotation,
 *     one card is taken from each in that order, and any deck emptied by the
 *     round leaves the rotation. Survivors keep the order that round put them
 *     in — the next round reshuffles them anyway.
 *
 * A single deck falls out of this as a plain shuffle: a one-deck rotation
 * needs no shuffling (Fisher–Yates draws nothing for one element), so step 3
 * simply hands out step 2's order.
 */
export function interleavePractice<T>(
  cards: readonly T[],
  deckOf: (card: T) => string,
  seed: number,
): T[] {
  const byDeck = new Map<string, T[]>();
  for (const card of cards) {
    const deck = byDeck.get(deckOf(card));
    if (deck) deck.push(card);
    else byDeck.set(deckOf(card), [card]);
  }

  const random = mulberry32(seed);
  // Insertion order IS first-appearance order (Map keeps it), and the shuffles
  // run in it, which is what pins the draw sequence.
  let rotation = [...byDeck.values()].map((deck) => shuffle(deck, random));

  const mixed: T[] = [];
  while (rotation.length > 0) {
    const round = shuffle(rotation, random);
    for (const deck of round) {
      // A deck in the rotation always has a card: it is dropped the moment it
      // runs out, below.
      mixed.push(deck.shift() as T);
    }
    rotation = round.filter((deck) => deck.length > 0);
  }

  return mixed;
}
