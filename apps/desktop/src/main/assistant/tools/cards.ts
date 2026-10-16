/**
 * The CARDS module through the assistant's eyes: the record, the games saved in
 * progress, what a saved solitaire looks like, a hint for it, and starting or
 * discarding a game.
 *
 * **Who owns what.** The record and the saved games are store state, read and
 * cleared through `CardGameStore`, the one the IPC handlers call. A deal is the
 * page's: the table holds the live game and writes its own saves, so `cards.start`
 * asks the page to deal (`navigateTo` with an `action`) and writes no row itself.
 *
 * **What no tool does.** None plays a move, and none plays for the computer's
 * side of a game against it: a game against the computer is described and left to
 * the person.
 */

import { randomInt } from "node:crypto";
import { CardGameStore, type CardGameProgress } from "@nexus/db";
import {
  CARD_GAMES,
  CARD_GAME_VARIANTS,
  CARD_OPPONENT_LEVELS,
  DEFAULT_LEVEL_NAME,
  FREE_CELL_MAX_DEAL,
  FREE_CELL_MIN_DEAL,
  MAX_CARD_SEED,
  SUITS,
  cardCode,
  hintMove,
  isCard,
  isComputerGame,
  isFinished,
  isWon,
  legalCardMoves,
  resumeGame,
  seatNow,
  type AssistantLocale,
  type AssistantText,
  type CardGameId,
  type CardGameVariant,
  type CardSession,
  type Suit,
  type Tool,
} from "@nexus/core";
import { asArgs, asCount, asEnum } from "./args.js";
import {
  assertLive,
  confirmOrDecline,
  formatDuration,
  formatNumber,
  guard,
  okResult,
  phrase,
  text,
  type AssistantPhrase,
  type ProfileDb,
} from "./support.js";

export interface CardsToolDeps {
  readonly profileDb: ProfileDb;
}

/** What `resolveVariant` falls back to: every game has a first variant, so this is never reached. */
const DEFAULT_VARIANT: CardGameVariant = "standard";

/** The games a hint is given for: the three the engines can hint. */
const HINT_GAMES = ["klondike", "freecell", "spider"] as const;

/** Every variant of every game, once each, for the closed enum the schemas offer. */
const VARIANTS: readonly CardGameVariant[] = [
  ...new Set(CARD_GAMES.flatMap((game) => CARD_GAME_VARIANTS[game])),
];

const GAME_NAME: Record<CardGameId, AssistantText> = {
  klondike: { sr: "Klondajk", en: "Klondike" },
  freecell: { sr: "Frisel", en: "FreeCell" },
  spider: { sr: "Pauk", en: "Spider" },
  pyramid: { sr: "Piramida", en: "Pyramid" },
  tripeaks: { sr: "Tri vrha", en: "TriPeaks" },
  golf: { sr: "Golf", en: "Golf" },
  hearts: { sr: "Herc", en: "Hearts" },
  spades: { sr: "Pik", en: "Spades" },
  tablic: { sr: "Tablić", en: "Tablic" },
};

const VARIANT_NAME: Record<CardGameVariant, AssistantText> = {
  draw1: { sr: "po jednu", en: "draw one" },
  draw3: { sr: "po tri", en: "draw three" },
  classic: { sr: "klasična", en: "classic" },
  suits1: { sr: "jedna boja", en: "one suit" },
  suits2: { sr: "dve boje", en: "two suits" },
  suits4: { sr: "četiri boje", en: "four suits" },
  pass1: { sr: "jedno okretanje", en: "one pass" },
  pass3: { sr: "tri okretanja", en: "three passes" },
  standard: { sr: "standardna", en: "standard" },
  wrap: { sr: "sa obrtanjem", en: "wrap" },
  duo: { sr: "dvoje", en: "two players" },
  pairs: { sr: "dva para", en: "pairs" },
};

const SUIT_NAME: Record<Suit, AssistantText> = {
  clubs: { sr: "tref", en: "clubs" },
  diamonds: { sr: "karo", en: "diamonds" },
  hearts: { sr: "herc", en: "hearts" },
  spades: { sr: "pik", en: "spades" },
};

const PLACE: Record<"column" | "cell" | "foundation" | "waste" | "tableau", AssistantText> = {
  column: { sr: "kolona", en: "column" },
  cell: { sr: "ćelija", en: "cell" },
  foundation: { sr: "temelj", en: "foundation" },
  waste: { sr: "otpad", en: "waste" },
  tableau: { sr: "sto", en: "tableau" },
};

const STOCK: AssistantText = { sr: "zalihe", en: "stock" };
const FACE_DOWN: AssistantText = { sr: "okrenuta nadole", en: "face down" };
const EMPTY_SLOT: AssistantText = { sr: "prazno", en: "empty" };

const LEVEL_NEEDS_COMPUTER: AssistantPhrase<[name: string]> = {
  sr: (name) => `Nivo važi samo za igru protiv računara, a ${name} je pasijans.`,
  en: (name) => `A level applies only to a game against the computer, and ${name} is a solitaire.`,
};
const NO_GAMES: AssistantText = { sr: "Nema odigranih partija ni sačuvanih igara.", en: "No games played and none saved." };
const RECORD_HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Rezultati (${count}):`,
  en: (count) => `Results (${count}):`,
};
const RECORD_LINE: AssistantPhrase<[name: string, played: string, won: string]> = {
  sr: (name, played, won) => `- ${name}: odigrano ${played}, pobeda ${won}`,
  en: (name, played, won) => `- ${name}: ${played} played, ${won} won`,
};
const BEST_SCORE: AssistantPhrase<[score: string]> = {
  sr: (score) => `, najbolji rezultat ${score}`,
  en: (score) => `, best score ${score}`,
};
const BEST_TIME: AssistantPhrase<[time: string]> = {
  sr: (time) => `, najbolje vreme ${time}`,
  en: (time) => `, best time ${time}`,
};
const STREAK: AssistantPhrase<[streak: string]> = {
  sr: (streak) => `, najduži niz pobeda ${streak}`,
  en: (streak) => `, longest win streak ${streak}`,
};
const SAVED_HEADING: AssistantText = { sr: "Sačuvano u toku:", en: "Saved in progress:" };
const SAVED_LINE: AssistantPhrase<[name: string, moves: string, time: string]> = {
  sr: (name, moves, time) => `- ${name}: ${moves} poteza, odigrano ${time}`,
  en: (name, moves, time) => `- ${name}: ${moves} moves, played for ${time}`,
};

const NO_SAVE: AssistantPhrase<[name: string]> = {
  sr: (name) => `Nema sačuvane partije: ${name}.`,
  en: (name) => `No saved game: ${name}.`,
};
const CHOOSE_VARIANT: AssistantPhrase<[name: string, variants: string]> = {
  sr: (name, variants) => `Sačuvano je više partija: ${name}. Navedi varijantu: ${variants}.`,
  en: (name, variants) => `More than one game is saved: ${name}. Name the variant: ${variants}.`,
};
const NOT_A_VARIANT: AssistantPhrase<[name: string, variants: string]> = {
  sr: (name, variants) => `${name} nema tu varijantu. Varijante: ${variants}.`,
  en: (name, variants) => `${name} has no such variant. Its variants: ${variants}.`,
};
const DEAL_NEEDS_FREECELL: AssistantText = {
  sr: "Broj partije važi samo za Frisel.",
  en: "A deal number applies only to FreeCell.",
};
const NO_HINT_POSITION: AssistantText = {
  sr: "U ovom položaju nema predloga poteza.",
  en: "This position has no move to suggest.",
};
const FINISHED: AssistantText = {
  sr: "Partija je završena; nema više poteza.",
  en: "The game is over; no moves are left.",
};
const WON: AssistantText = { sr: "Partija je dobijena.", en: "The game is won." };
const YOUR_TURN: AssistantText = { sr: "Na potezu si ti.", en: "It is your turn." };
const COMPUTER_TURN: AssistantText = { sr: "Na potezu je računar.", en: "It is the computer's turn." };
const MOVES_LEFT: AssistantPhrase<[count: number]> = {
  sr: (count) => `Dozvoljenih poteza: ${count}.`,
  en: (count) => `Legal moves: ${count}.`,
};
const POSITION_HEAD: AssistantPhrase<[name: string, score: string, moves: string]> = {
  sr: (name, score, moves) => `${name}: poeni ${score}, odigrano poteza ${moves}.`,
  en: (name, score, moves) => `${name}: score ${score}, ${moves} moves played.`,
};
const PILE_TEXT: AssistantPhrase<[count: string, top: string]> = {
  sr: (count, top) => `${count} karata, na vrhu ${top}`,
  en: (count, top) => `${count} cards, top ${top}`,
};

const HINT_DRAW: AssistantText = {
  sr: "Okreni sledeću kartu iz zaliha.",
  en: "Turn the next card from the stock.",
};
const HINT_RECYCLE: AssistantText = {
  sr: "Vrati otpad u zalihe.",
  en: "Turn the waste back onto the stock.",
};
const HINT_DEAL: AssistantText = {
  sr: "Podeli po jednu kartu na svaku kolonu.",
  en: "Deal one card to every column.",
};
const HINT_MOVE: AssistantPhrase<[count: string, from: string, to: string]> = {
  sr: (count, from, to) => `Premesti ${count}: ${from} → ${to}.`,
  en: (count, from, to) => `Move ${count}: ${from} → ${to}.`,
};

const START_SUMMARY: AssistantPhrase<[name: string, variant: string, replaces: string]> = {
  sr: (name, variant, replaces) => `Podeli novu igru ${name} (${variant})${replaces}`,
  en: (name, variant, replaces) => `Deal a new ${name} game (${variant})${replaces}`,
};
const REPLACES: AssistantPhrase<[moves: number]> = {
  sr: (moves) => `, čime se menja sačuvana partija sa ${moves} poteza`,
  en: (moves) => `, which replaces the saved game of ${moves} moves`,
};
const DISCARD_SUMMARY: AssistantPhrase<[name: string, variant: string, moves: number]> = {
  sr: (name, variant, moves) => `Odbaci sačuvanu igru ${name} (${variant}) sa ${moves} poteza`,
  en: (name, variant, moves) => `Discard the saved ${name} game (${variant}) of ${moves} moves`,
};
const STARTED: AssistantPhrase<[name: string, variant: string]> = {
  sr: (name, variant) => `Otvorena je nova igra ${name} (${variant}).`,
  en: (name, variant) => `Opened a new ${name} game (${variant}).`,
};
const DISCARDED: AssistantPhrase<[name: string, variant: string]> = {
  sr: (name, variant) => `Odbačena je sačuvana igra ${name} (${variant}).`,
  en: (name, variant) => `Discarded the saved ${name} game (${variant}).`,
};

export function cardsTools(deps: CardsToolDeps): readonly Tool[] {
  function store(profileId: string): CardGameStore {
    return deps.profileDb(profileId, (db, id) => new CardGameStore(db, id));
  }

  const stats: Tool = {
    name: "cards.stats",
    description: {
      sr: "Pokazuje rekord u kartaškim igrama (odigrano, pobede, najbolji rezultat i vreme) i partije sačuvane u toku. Koristi ga kad korisnik pita kako mu ide u kartama.",
      en: "Shows the card-game record (played, won, best score and time) and the games saved in progress. Use it when the user asks how they are doing at the card games.",
    },
    parameters: {
      type: "object",
      properties: {
        game: { type: "string", enum: [...CARD_GAMES], description: "Only this game. Leave it out for every game." },
      },
      required: [],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const game = args.game === undefined ? undefined : asEnum(args.game, "game", CARD_GAMES);
        const cards = store(context.profileId);
        const rows = cards
          .listStats()
          .filter((row) => (game === undefined || row.game === game) && row.played > 0);
        const saved = cards.listProgress().filter((progress) => game === undefined || progress.game === game);
        if (rows.length === 0 && saved.length === 0) return okResult(text(context.locale, NO_GAMES));
        const lines: string[] = [];
        if (rows.length > 0) {
          lines.push(phrase(context.locale, RECORD_HEADING, rows.length));
          for (const row of rows) {
            let line = phrase(
              context.locale,
              RECORD_LINE,
              slotName(row.game, row.variant, context.locale),
              formatNumber(context.locale, row.played),
              formatNumber(context.locale, row.won),
            );
            if (row.bestScore !== null) {
              line += phrase(context.locale, BEST_SCORE, formatNumber(context.locale, row.bestScore));
            }
            if (row.bestTimeMs !== null) {
              line += phrase(context.locale, BEST_TIME, formatDuration(context.locale, Math.round(row.bestTimeMs / 1000)));
            }
            line += phrase(context.locale, STREAK, formatNumber(context.locale, row.longestStreak));
            lines.push(`${line}.`);
          }
        }
        if (saved.length > 0) {
          lines.push(text(context.locale, SAVED_HEADING));
          for (const progress of saved) {
            lines.push(
              phrase(
                context.locale,
                SAVED_LINE,
                slotName(progress.game, progress.variant, context.locale),
                formatNumber(context.locale, progress.moves.length),
                formatDuration(context.locale, progress.elapsedSeconds),
              ),
            );
          }
        }
        return okResult(lines.join("\n"));
      }),
  };

  const position: Tool = {
    name: "cards.position",
    description: {
      sr: "Opisuje sačuvanu partiju: čija je na potezu, poene, broj dozvoljenih poteza i gomile karata. Koristi ga kad korisnik pita gde je stao ili šta je na stolu. Ne igra potez.",
      en: "Describes a saved game: whose turn it is, the score, the legal moves and the piles. Use it when the user asks where they stopped or what is on the table. It never plays a move.",
    },
    parameters: {
      type: "object",
      properties: {
        game: { type: "string", enum: [...CARD_GAMES], description: "The game." },
        variant: { type: "string", enum: [...VARIANTS], description: "The variant, when more than one is saved." },
      },
      required: ["game"],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const game = asEnum(args.game, "game", CARD_GAMES);
        const variant = args.variant === undefined ? undefined : asEnum(args.variant, "variant", VARIANTS);
        const progress = savedGame(store(context.profileId), game, variant, context.locale);
        return okResult(positionLines(sessionOf(progress), context.locale).join("\n"));
      }),
  };

  const hint: Tool = {
    name: "cards.hint",
    description: {
      sr: "Predlaže jedan legalan potez za sačuvanu partiju pasijansa: Klondajk, Frisel ili Pauk. Koristi ga kad korisnik traži savet. Potez ne igra.",
      en: "Suggests one legal move for a saved solitaire: Klondike, FreeCell or Spider. Use it when the user asks for a hint. It does not play the move.",
    },
    parameters: {
      type: "object",
      properties: {
        game: { type: "string", enum: [...HINT_GAMES], description: "The game." },
        variant: { type: "string", enum: [...VARIANTS], description: "The variant, when more than one is saved." },
      },
      required: ["game"],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const game = asEnum(args.game, "game", HINT_GAMES);
        const variant = args.variant === undefined ? undefined : asEnum(args.variant, "variant", VARIANTS);
        const session = sessionOf(savedGame(store(context.profileId), game, variant, context.locale));
        if (isFinished(session)) return okResult(text(context.locale, FINISHED));
        const move = hintMove(session);
        if (move === null) return okResult(text(context.locale, NO_HINT_POSITION));
        return okResult(hintSentence(move, context.locale));
      }),
  };

  const start: Tool = {
    name: "cards.start",
    description: {
      sr: "Deli novu partiju odabrane igre na stolu za karte. Sačuvana partija te igre se zamenjuje. Koristi ga kad korisnik traži da počne ili podeli igru; za igru protiv računara može da zada nivo.",
      en: "Deals a new game of the chosen kind on the card table. A saved game of that kind is replaced. Use it when the user asks to start or deal a card game; a game against the computer can take a level.",
    },
    parameters: {
      type: "object",
      properties: {
        game: { type: "string", enum: [...CARD_GAMES], description: "The game." },
        variant: { type: "string", enum: [...VARIANTS], description: "The variant. Defaults to the game's first." },
        level: {
          type: "string",
          enum: [...CARD_OPPONENT_LEVELS],
          description: "The computer's level, for Hearts, Spades and Tablic only. Defaults to medium.",
        },
        deal: {
          type: "integer",
          minimum: FREE_CELL_MIN_DEAL,
          maximum: FREE_CELL_MAX_DEAL,
          description: "The FreeCell deal number, for FreeCell only. Leave it out for a random deal.",
        },
      },
      required: ["game"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const game = asEnum(args.game, "game", CARD_GAMES);
        const variant = resolveVariant(game, args.variant, context.locale);
        if (args.level !== undefined && !isComputerGame(game)) {
          throw new Error(phrase(context.locale, LEVEL_NEEDS_COMPUTER, gameName(game, context.locale)));
        }
        if (args.deal !== undefined && game !== "freecell") {
          throw new Error(text(context.locale, DEAL_NEEDS_FREECELL));
        }
        const level = args.level === undefined ? DEFAULT_LEVEL_NAME : asEnum(args.level, "level", CARD_OPPONENT_LEVELS);
        const seed =
          game !== "freecell"
            ? randomInt(MAX_CARD_SEED + 1)
            : args.deal === undefined
              ? randomInt(FREE_CELL_MIN_DEAL, FREE_CELL_MAX_DEAL + 1)
              : asCount(args.deal, "deal", FREE_CELL_MIN_DEAL, FREE_CELL_MAX_DEAL);
        const saved = store(context.profileId).getProgress(game, variant);
        const replaces = saved === null ? "" : phrase(context.locale, REPLACES, saved.moves.length);
        const declined = await confirmOrDecline(
          context,
          "cards.start",
          "write",
          phrase(context.locale, START_SUMMARY, slotName(game, undefined, context.locale), variantName(variant, context.locale), replaces),
        );
        if (declined !== null) return declined;
        return okResult(phrase(context.locale, STARTED, gameName(game, context.locale), variantName(variant, context.locale)), {
          navigateTo: {
            module: "cards",
            item: `${game}/${variant}`,
            action: { name: "start", payload: { game, variant, level, seed } },
          },
        });
      }),
  };

  const clear: Tool = {
    name: "cards.clear",
    description: {
      sr: "Odbacuje sačuvanu partiju jedne igre bez upisa rezultata. Koristi ga kad korisnik kaže da baci ili obriše sačuvanu partiju; korisnik se pita pre toga.",
      en: "Discards one saved card game without recording a result. Use it when the user asks to throw away or delete a saved game; the user is asked first.",
    },
    parameters: {
      type: "object",
      properties: {
        game: { type: "string", enum: [...CARD_GAMES], description: "The game." },
        variant: { type: "string", enum: [...VARIANTS], description: "The variant, when more than one is saved." },
      },
      required: ["game"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const game = asEnum(args.game, "game", CARD_GAMES);
        const variant = args.variant === undefined ? undefined : asEnum(args.variant, "variant", VARIANTS);
        const cards = store(context.profileId);
        const progress = savedGame(cards, game, variant, context.locale);
        const declined = await confirmOrDecline(
          context,
          "cards.clear",
          "write",
          phrase(
            context.locale,
            DISCARD_SUMMARY,
            gameName(progress.game, context.locale),
            variantName(progress.variant, context.locale),
            progress.moves.length,
          ),
        );
        if (declined !== null) return declined;
        cards.clearProgress(progress.game, progress.variant);
        return okResult(
          phrase(context.locale, DISCARDED, gameName(progress.game, context.locale), variantName(progress.variant, context.locale)),
          { navigateTo: { module: "cards", item: `${progress.game}/${progress.variant}` } },
        );
      }),
  };

  return [stats, position, hint, start, clear];
}

// --- Helpers ----------------------------------------------------------------

function gameName(game: CardGameId, locale: AssistantLocale): string {
  return text(locale, GAME_NAME[game]);
}

function variantName(variant: CardGameVariant, locale: AssistantLocale): string {
  return text(locale, VARIANT_NAME[variant]);
}

/** A game and, when given, its variant, as the words a person would use: "Klondajk (po jednu)". */
function slotName(game: CardGameId, variant: CardGameVariant | undefined, locale: AssistantLocale): string {
  return variant === undefined ? gameName(game, locale) : `${gameName(game, locale)} (${variantName(variant, locale)})`;
}

/** The variant a start names, or the game's first when it names none. */
function resolveVariant(game: CardGameId, value: unknown, locale: AssistantLocale): CardGameVariant {
  const variants = CARD_GAME_VARIANTS[game];
  if (value === undefined) return variants[0] ?? DEFAULT_VARIANT;
  const variant = asEnum(value, "variant", VARIANTS);
  if (!variants.includes(variant)) {
    throw new Error(phrase(locale, NOT_A_VARIANT, gameName(game, locale), variants.map((v) => variantName(v, locale)).join(", ")));
  }
  return variant;
}

/**
 * The saved game a tool means: the named variant, or the game's only saved one.
 * With several saved and none named, the tool asks rather than guessing.
 */
function savedGame(
  cards: CardGameStore,
  game: CardGameId,
  variant: CardGameVariant | undefined,
  locale: AssistantLocale,
): CardGameProgress {
  const saved = cards.listProgress().filter((progress) => progress.game === game);
  if (variant !== undefined) {
    const named = saved.find((progress) => progress.variant === variant);
    if (named === undefined) throw new Error(phrase(locale, NO_SAVE, slotName(game, variant, locale)));
    return named;
  }
  if (saved.length === 1 && saved[0] !== undefined) return saved[0];
  if (saved.length === 0) throw new Error(phrase(locale, NO_SAVE, gameName(game, locale)));
  const names = saved.map((progress) => variantName(progress.variant, locale)).join(", ");
  throw new Error(phrase(locale, CHOOSE_VARIANT, gameName(game, locale), names));
}

/** The engine's own state for a saved game: the replay the store already checked. */
function sessionOf(progress: CardGameProgress): CardSession {
  return resumeGame({
    game: progress.game,
    variant: progress.variant,
    seed: progress.seed,
    moves: progress.moves,
    elapsedSeconds: progress.elapsedSeconds,
  });
}

/**
 * The position in words. The solitaires are read pile by pile; a game against the
 * computer gives only its score and whose turn it is, because the computer's hand
 * is not the person's to be told.
 */
function positionLines(session: CardSession, locale: AssistantLocale): string[] {
  const lines = [
    phrase(
      locale,
      POSITION_HEAD,
      slotName(session.game, session.variant, locale),
      formatNumber(locale, session.score),
      formatNumber(locale, session.log.length),
    ),
  ];
  if (isFinished(session)) {
    lines.push(text(locale, isWon(session) ? WON : FINISHED));
  } else if (seatNow(session) === 0) {
    lines.push(text(locale, YOUR_TURN), phrase(locale, MOVES_LEFT, legalCardMoves(session).length));
  } else {
    lines.push(text(locale, COMPUTER_TURN));
  }
  if (!isComputerGame(session.game)) lines.push(...boardLines(session, locale));
  return lines;
}

/** One line per pile, or per flat row of slots, of a solitaire's board. The stock is counted, not shown. */
function boardLines(session: CardSession, locale: AssistantLocale): string[] {
  const board = (session.state as { board: Record<string, unknown> }).board;
  const lines: string[] = [];
  for (const [key, value] of Object.entries(board)) {
    if (!Array.isArray(value)) continue;
    if (key === "stock") {
      lines.push(`${text(locale, STOCK)}: ${formatNumber(locale, value.length)}`);
    } else if (value.length > 0 && value.every(Array.isArray)) {
      value.forEach((pile: unknown[], index) => {
        lines.push(`${pileName(key, index, locale)}: ${pileText(pile, locale)}`);
      });
    } else if (value.some((entry) => entry === null || isCardLike(entry))) {
      lines.push(`${key}: ${value.map((entry) => cardText(entry, locale)).join(" ")}`);
    }
  }
  return lines;
}

function pileName(key: string, index: number, locale: AssistantLocale): string {
  if (key === "foundations") {
    const suit = SUITS[index];
    return suit === undefined ? text(locale, PLACE.foundation) : `${text(locale, PLACE.foundation)} ${text(locale, SUIT_NAME[suit])}`;
  }
  return `${text(locale, PLACE.column)} ${index + 1}`;
}

function pileText(pile: readonly unknown[], locale: AssistantLocale): string {
  const top = pile[pile.length - 1];
  if (top === undefined) return text(locale, EMPTY_SLOT);
  return phrase(locale, PILE_TEXT, formatNumber(locale, pile.length), cardText(top, locale));
}

/** A card as the notation the engine uses, face-down cards as such, and an empty slot as its word. */
function cardText(entry: unknown, locale: AssistantLocale): string {
  if (entry === null || entry === undefined) return text(locale, EMPTY_SLOT);
  const holder = entry as { card?: unknown; faceUp?: unknown };
  if (holder.faceUp === false) return text(locale, FACE_DOWN);
  if (isCard(entry)) return cardCode(entry);
  return isCard(holder.card) ? cardCode(holder.card) : text(locale, EMPTY_SLOT);
}

function isCardLike(entry: unknown): boolean {
  if (isCard(entry)) return true;
  return typeof entry === "object" && entry !== null && isCard((entry as { card?: unknown }).card);
}

/** A hint's move in words. Only the three hinted games reach here, so their move shapes are the ones read. */
function hintSentence(move: unknown, locale: AssistantLocale): string {
  const record = move as { kind: string; count?: number; from?: unknown; to?: unknown };
  if (record.kind === "draw") return text(locale, HINT_DRAW);
  if (record.kind === "recycle") return text(locale, HINT_RECYCLE);
  if (record.kind === "deal") return text(locale, HINT_DEAL);
  const count = formatNumber(locale, record.count ?? 1);
  return phrase(locale, HINT_MOVE, count, slotText(record.from, locale), slotText(record.to, locale));
}

/** A place a hint names: a Spider column index, or a Klondike or FreeCell slot. */
function slotText(slot: unknown, locale: AssistantLocale): string {
  if (typeof slot === "number") return `${text(locale, PLACE.column)} ${slot + 1}`;
  const place = slot as { kind?: string; column?: number; cell?: number; suit?: Suit };
  switch (place.kind) {
    case "waste":
      return text(locale, PLACE.waste);
    case "tableau":
    case "column":
      return `${text(locale, PLACE.column)} ${(place.column ?? 0) + 1}`;
    case "cell":
      return `${text(locale, PLACE.cell)} ${(place.cell ?? 0) + 1}`;
    case "foundation":
      return place.suit === undefined
        ? text(locale, PLACE.foundation)
        : `${text(locale, PLACE.foundation)} (${text(locale, SUIT_NAME[place.suit])})`;
    default:
      return text(locale, PLACE.tableau);
  }
}
