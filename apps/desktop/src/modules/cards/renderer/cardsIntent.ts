import {
  isCardGameId,
  isCardGameVariant,
  isCardOpponentLevel,
  isCardSeed,
  isFreeCellDeal,
  type CardGameId,
  type CardGameVariant,
  type CardOpponentLevel,
} from "@nexus/core";

/** A deal the assistant asked the page to make: what `cards.start` names. */
export interface StartDeal {
  readonly game: CardGameId;
  readonly variant: CardGameVariant;
  readonly level: CardOpponentLevel;
  readonly seed: number;
}

/**
 * The `start` action's payload, read with the page's own checks.
 *
 * The tool has validated the same fields, but a location travels through a window
 * event and nothing between the tool and this page is a gate, so the page checks
 * again. A FreeCell deal is a deal number and every other game a 32-bit seed: the
 * same rule the store and the engines apply. Anything else is `null`, and the page
 * ignores it rather than dealing a game it cannot name.
 */
export function startDealOf(payload: unknown): StartDeal | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { game, variant, level, seed } = payload as Record<string, unknown>;
  if (!isCardGameId(game) || !isCardGameVariant(game, variant) || !isCardOpponentLevel(level)) return null;
  const seedOk = game === "freecell" ? isFreeCellDeal(seed) : isCardSeed(seed);
  if (!seedOk) return null;
  return { game, variant, level, seed: seed as number };
}
