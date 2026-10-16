/**
 * The BOARDS module (the six games on a table) through the assistant's eyes: what
 * is saved and what the record says, the position a game is in, a suggested move,
 * and the three writes a person makes here: start a game, set the default level,
 * discard a game in progress.
 *
 * **Every read and write is the store the IPC channel uses.** `boards:remove` and
 * `boards:setDefaultLevel` call `BoardsStore` with the same arguments these tools
 * do, and the store's own checks decide what is written. The engines are
 * `@nexus/core`'s: a position is rebuilt from its log with `replayBoard`, the same
 * fold the store runs before it accepts a save, and a move is the engine's answer.
 *
 * **A new game is the page's to start.** The page holds the game in progress in
 * its own state and writes it on every move, so `boards.start` answers with the
 * page's own verb and the page starts the game the way its Play button does. A
 * suggestion is the engine's bounded search (`boards-shared/search.ts`, a node
 * budget per level), and never a dice roll: a dice game waiting for its throw
 * answers that the throw comes first.
 */

import {
  BOARDS_GAMES,
  boardEngine,
  createSeededRandom,
  describeBoardEvent,
  moveEvent,
  replayBoard,
  turnSeat,
  type AssistantLocale,
  type AssistantText,
  type BoardEvent,
  type BoardsGame,
  type Tool,
} from "@nexus/core";
import { BoardsStore, type BoardSave } from "@nexus/db";
import { asArgs, asEnum, asOptionalCount, asOptionalEnum } from "./args.js";
import {
  assertLive,
  confirmOrDecline,
  failResult,
  guard,
  okResult,
  phrase,
  text,
  type AssistantPhrase,
  type ProfileDb,
} from "./support.js";

export interface BoardsToolDeps {
  /** See `ToolDeps.profileDb`. */
  readonly profileDb: ProfileDb;
  /** See `ToolDeps.now`. */
  readonly now: () => number;
}

/** The names the page prints for each game (`modules/boards/renderer/copy.*.ts`). */
const GAME_NAME: Record<BoardsGame, AssistantText> = {
  reversi: { sr: "Reversi", en: "Reversi" },
  draughts: { sr: "Dama", en: "Draughts" },
  mlin: { sr: "Mlin", en: "Nine men's morris" },
  backgammon: { sr: "Tavla", en: "Backgammon" },
  "four-in-a-row": { sr: "Četiri u nizu", en: "Four in a row" },
  ludo: { sr: "Ne ljuti se, čoveče", en: "Ludo" },
};

/** A draughts rule set, as the record names it (the only game with variants). */
const VARIANT_NAME: Readonly<Record<string, AssistantText>> = {
  english: { sr: "engleska pravila", en: "English rules" },
  russian: { sr: "ruska pravila", en: "Russian rules" },
};

const OPPONENTS = ["computer", "human"] as const;
type Opponent = (typeof OPPONENTS)[number];

/** How many of the last moves a position answer lists. */
const LAST_EVENTS = 8;

const COMPUTER: AssistantText = { sr: "računar", en: "the computer" };
const YOU: AssistantText = { sr: "ti", en: "you" };
const PLAYER: AssistantPhrase<[number: number]> = {
  sr: (number) => `igrač ${String(number)}`,
  en: (number) => `player ${String(number)}`,
};

const AGAINST_COMPUTER: AssistantPhrase<[level: number]> = {
  sr: (level) => `protiv računara, nivo ${String(level)}`,
  en: (level) => `against the computer, level ${String(level)}`,
};
const AGAINST_PERSON: AssistantText = {
  sr: "protiv drugog igrača",
  en: "against another player",
};

const EVENT_ROLL: AssistantPhrase<[dice: string]> = {
  sr: (dice) => `Kocka: ${dice}`,
  en: (dice) => `Dice: ${dice}`,
};
const EVENT_PASS: AssistantText = { sr: "Bez poteza", en: "No move" };
const EVENT_DOUBLE: AssistantText = { sr: "Dupliranje", en: "Doubled" };

const TO_MOVE: AssistantPhrase<[who: string]> = {
  sr: (who) => `Na potezu: ${who}.`,
  en: (who) => `To move: ${who}.`,
};
const ROLL_FIRST: AssistantText = {
  sr: "Pre poteza treba bacanje kocke.",
  en: "A roll of the dice is due before the next move.",
};
const OVER: AssistantPhrase<[who: string]> = {
  sr: (who) => `Partija je završena. Pobednik: ${who}.`,
  en: (who) => `The game is over. Winner: ${who}.`,
};
const DRAW: AssistantText = {
  sr: "Partija je završena nerešeno.",
  en: "The game is over: a draw.",
};
const LAST_HEADING: AssistantText = { sr: "Poslednji potezi:", en: "Last moves:" };

const NONE_SAVED: AssistantPhrase<[name: string]> = {
  sr: (name) => `nema partije u toku za ${name}.`,
  en: (name) => `there is no game in progress for ${name}.`,
};

const RECORD_EMPTY: AssistantText = {
  sr: "Još nema sačuvanih partija ni rezultata.",
  en: "There are no saved games or results yet.",
};
const SAVED_HEADING: AssistantText = { sr: "U toku:", en: "In progress:" };
const SAVED_LINE: AssistantPhrase<[name: string, moves: number, mode: string]> = {
  sr: (name, moves, mode) => `- ${name}: ${String(moves)} poteza, ${mode}`,
  en: (name, moves, mode) => `- ${name}: ${String(moves)} moves, ${mode}`,
};
const RECORD_HEADING: AssistantText = { sr: "Rezultati:", en: "Record:" };
const RECORD_LINE: AssistantPhrase<
  [name: string, level: number, played: number, won: number, drawn: number, lost: number]
> = {
  sr: (name, level, played, won, drawn, lost) =>
    `- ${name}, nivo ${String(level)}: odigrano ${String(played)}, pobeda ${String(won)}, nerešeno ${String(drawn)}, poraza ${String(lost)}`,
  en: (name, level, played, won, drawn, lost) =>
    `- ${name}, level ${String(level)}: played ${String(played)}, won ${String(won)}, drawn ${String(drawn)}, lost ${String(lost)}`,
};

const OVER_NO_SUGGESTION: AssistantText = {
  sr: "Partija je završena, pa nema poteza za predlog.",
  en: "The game is over, so there is no move to suggest.",
};
const NO_MOVE: AssistantText = {
  sr: "Nema legalnog poteza u ovoj poziciji.",
  en: "There is no legal move in this position.",
};
const SUGGESTION: AssistantPhrase<[move: string, who: string, level: number, depth: number]> = {
  sr: (move, who, level, depth) =>
    `Predlog za ${who}: ${move}. Nivo ${String(level)}, pretraga do dubine ${String(depth)}.`,
  en: (move, who, level, depth) =>
    `Suggested move for ${who}: ${move}. Level ${String(level)}, search to depth ${String(depth)}.`,
};
const SUGGESTION_CUT: AssistantText = {
  sr: " Pretraga je stala na granici, pa predlog može biti slabiji.",
  en: " The search stopped at its limit, so the suggestion may be weaker.",
};

const LEVEL_SET: AssistantPhrase<[level: number]> = {
  sr: (level) => `Podrazumevani nivo za nove partije protiv računara biće ${String(level)}?`,
  en: (level) => `Set the default computer level for new games to ${String(level)}?`,
};
const LEVEL_DONE: AssistantPhrase<[level: number]> = {
  sr: (level) => `Podrazumevani nivo je sada ${String(level)}.`,
  en: (level) => `The default level is now ${String(level)}.`,
};

const START_SUMMARY: AssistantPhrase<[name: string, mode: string, replaces: string]> = {
  sr: (name, mode, replaces) => `Započeti novu partiju: ${name}, ${mode}?${replaces}`,
  en: (name, mode, replaces) => `Start a new ${name} game, ${mode}?${replaces}`,
};
const START_REPLACES: AssistantText = {
  sr: " Sačuvana partija te igre biće zamenjena.",
  en: " The saved game of this kind will be replaced.",
};
const START_OPENED: AssistantPhrase<[name: string]> = {
  sr: (name) => `Otvara se nova partija: ${name}.`,
  en: (name) => `Opening a new ${name} game.`,
};
const LEVEL_OUT_OF_RANGE: AssistantPhrase<[name: string, levels: number]> = {
  sr: (name, levels) => `nivo za ${name} mora biti između 1 i ${String(levels)}.`,
  en: (name, levels) => `the level for ${name} must be between 1 and ${String(levels)}.`,
};

const REMOVE_SUMMARY: AssistantPhrase<[name: string, moves: number]> = {
  sr: (name, moves) => `Odbaciti sačuvanu partiju: ${name} (${String(moves)} poteza)? Ne ulazi u rezultate.`,
  en: (name, moves) => `Discard the saved ${name} game (${String(moves)} moves)? It is not counted in the record.`,
};
const REMOVED: AssistantPhrase<[name: string]> = {
  sr: (name) => `Sačuvana partija je odbačena: ${name}.`,
  en: (name) => `The saved ${name} game was discarded.`,
};
const NO_SAVE: AssistantPhrase<[name: string]> = {
  sr: (name) => `nema sačuvane partije: ${name}.`,
  en: (name) => `there is no saved ${name} game.`,
};

/** Who the other seat is, as the page's own list words it: the computer at a level, or another person. */
function modeOf(opponent: Opponent, level: number, locale: AssistantLocale): string {
  return opponent === "computer" ? phrase(locale, AGAINST_COMPUTER, level) : text(locale, AGAINST_PERSON);
}

function modeOfSave(save: BoardSave, locale: AssistantLocale): string {
  return save.level === null ? text(locale, AGAINST_PERSON) : phrase(locale, AGAINST_COMPUTER, save.level);
}

/** A seat, in the page's words: „ti" against the computer, the computer, or a numbered player. */
function seatName(save: BoardSave, seat: number, locale: AssistantLocale): string {
  const kind = save.seats[seat];
  if (kind === "computer") return text(locale, COMPUTER);
  if (save.seats.length === 2 && save.seats.includes("computer")) return text(locale, YOU);
  return phrase(locale, PLAYER, seat + 1);
}

/** One line of the move list, as the page writes it: a roll with its dice, a pass, a double, or a move in the game's own notation. */
function eventText(game: BoardsGame, event: BoardEvent, locale: AssistantLocale): string {
  if (event.kind === "roll") return phrase(locale, EVENT_ROLL, event.dice.join(" "));
  if (event.kind === "pass") return text(locale, EVENT_PASS);
  if (event.kind === "double") return text(locale, EVENT_DOUBLE);
  const label = describeBoardEvent(game, event);
  return label.kind === "notation" ? label.text : text(locale, EVENT_PASS);
}

/** The position a saved game is in, replayed from its log: the same fold the store runs before it accepts a save. */
function positionOf(save: BoardSave): unknown {
  return replayBoard(save.game, save.seed, save.events, save.state);
}

export function boardsTools(deps: BoardsToolDeps): readonly Tool[] {
  const withStore = <T>(profileId: string, use: (store: BoardsStore) => T): T =>
    deps.profileDb(profileId, (db, id) => use(new BoardsStore(db, id)));

  const stats: Tool = {
    name: "boards.stats",
    description: {
      sr: "Čita stanje igara na tablama: partije u toku i rezultate protiv računara po nivoima. Koristi ga kada korisnik pita koliko je igrao, koliko je pobeda ili šta je ostalo u toku.",
      en: "Reads the board games: the games in progress and the record against the computer, by level. Use it when the user asks how often they have won or what they left unfinished.",
    },
    parameters: {
      type: "object",
      properties: {
        game: { type: "string", enum: [...BOARDS_GAMES], description: "One game only. Omit for all six." },
      },
      required: [],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const game = asOptionalEnum(asArgs(rawArgs).game, "game", BOARDS_GAMES);
        const locale = context.locale;
        const { saves, rows } = withStore(context.profileId, (store) => ({
          saves: store.listSaves(),
          rows: store.listStats(),
        }));
        const inScope = (name: BoardsGame) => game === undefined || game === name;
        const saved = saves.filter((save) => inScope(save.game));
        const played = rows.filter((row) => inScope(row.game) && row.played > 0);
        if (saved.length === 0 && played.length === 0) return okResult(text(locale, RECORD_EMPTY));
        const lines: string[] = [];
        if (saved.length > 0) {
          lines.push(text(locale, SAVED_HEADING));
          for (const save of saved) {
            lines.push(phrase(locale, SAVED_LINE, text(locale, GAME_NAME[save.game]), save.moves, modeOfSave(save, locale)));
          }
        }
        if (played.length > 0) {
          lines.push(text(locale, RECORD_HEADING));
          for (const row of played) {
            const name = text(locale, GAME_NAME[row.game]);
            const label = row.variant === "" ? name : `${name}, ${text(locale, VARIANT_NAME[row.variant] ?? { sr: row.variant, en: row.variant })}`;
            lines.push(phrase(locale, RECORD_LINE, label, row.level, row.played, row.won, row.drawn, row.lost));
          }
        }
        return okResult(lines.join("\n"));
      }),
  };

  const position: Tool = {
    name: "boards.position",
    description: {
      sr: "Prikazuje poziciju sačuvane partije jedne igre: čija je na potezu, ishod ako je gotova i poslednje poteze, zapisane kao na stranici. Koristi ga kada korisnik pita gde je stao ili šta je odigrano.",
      en: "Shows where a saved game stands: whose move it is, the result if it is over, and the last moves in the page's own notation. Use it when the user asks where they stopped or what was played.",
    },
    parameters: {
      type: "object",
      properties: {
        game: { type: "string", enum: [...BOARDS_GAMES], description: "The game whose saved position to read." },
      },
      required: ["game"],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const game = asEnum(asArgs(rawArgs).game, "game", BOARDS_GAMES);
        const locale = context.locale;
        const save = withStore(context.profileId, (store) => store.getSave(game));
        if (save === null) return failResult(locale, phrase(locale, NONE_SAVED, text(locale, GAME_NAME[game])));
        const engine = boardEngine(game);
        const state = positionOf(save);
        const outcome = engine.outcome(state);
        const lines = [`${text(locale, GAME_NAME[game])}: ${modeOfSave(save, locale)}.`];
        if (outcome.status === "in_progress") {
          lines.push(phrase(locale, TO_MOVE, seatName(save, turnSeat(state), locale)));
          if (engine.needsRoll(state)) lines.push(text(locale, ROLL_FIRST));
        } else if (outcome.status === "win" && outcome.winner !== null) {
          lines.push(phrase(locale, OVER, seatName(save, outcome.winner, locale)));
        } else {
          lines.push(text(locale, DRAW));
        }
        if (save.events.length > 0) {
          const first = Math.max(0, save.events.length - LAST_EVENTS);
          lines.push(text(locale, LAST_HEADING));
          save.events.slice(first).forEach((event, offset) => {
            lines.push(`${String(first + offset + 1)}. ${eventText(game, event, locale)}`);
          });
        }
        return okResult(lines.join("\n"));
      }),
  };

  const suggest: Tool = {
    name: "boards.suggest",
    description: {
      sr: "Predlaže potez u sačuvanoj partiji, iz motora igre, na zadatom ili sačuvanom nivou. Koristi ga kada korisnik traži savet šta da odigra sledeće.",
      en: "Suggests a move in a saved game, from the game's own engine, at the given or the saved level. Use it when the user asks what to play next.",
    },
    parameters: {
      type: "object",
      properties: {
        game: { type: "string", enum: [...BOARDS_GAMES], description: "The game with the saved position." },
        level: { type: "integer", minimum: 1, maximum: 3, description: "How strong the search is. Omit to use the saved level." },
      },
      required: ["game"],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const game = asEnum(args.game, "game", BOARDS_GAMES);
        const locale = context.locale;
        const { save, defaultLevel } = withStore(context.profileId, (store) => ({
          save: store.getSave(game),
          defaultLevel: store.settings().defaultLevel,
        }));
        if (save === null) return failResult(locale, phrase(locale, NONE_SAVED, text(locale, GAME_NAME[game])));
        const engine = boardEngine(game);
        const level = asOptionalCount(args.level, "level", 1, engine.levels) ?? save.level ?? defaultLevel;
        const state = positionOf(save);
        if (engine.outcome(state).status !== "in_progress") return failResult(locale, text(locale, OVER_NO_SUGGESTION));
        if (engine.needsRoll(state)) return failResult(locale, text(locale, ROLL_FIRST));
        // The search only shuffles equal moves with its stream, so the game's own seed is as good a stream as any.
        const choice = engine.bestMove(state, level, createSeededRandom(save.seed));
        if (choice.move === null) return okResult(text(locale, NO_MOVE));
        const label = describeBoardEvent(game, moveEvent(game, state, choice.move));
        const notation = label.kind === "notation" ? label.text : text(locale, EVENT_PASS);
        const cut = choice.cut ? text(locale, SUGGESTION_CUT) : "";
        return okResult(
          phrase(locale, SUGGESTION, notation, seatName(save, turnSeat(state), locale), level, choice.depth) + cut,
        );
      }),
  };

  const level: Tool = {
    name: "boards.level",
    description: {
      sr: "Menja podrazumevani nivo računara za nove partije na tablama. Koristi ga kada korisnik kaže da računar treba da igra jače ili slabije.",
      en: "Changes the default computer level for new board games. Use it when the user says the computer should play stronger or weaker.",
    },
    parameters: {
      type: "object",
      properties: {
        level: { type: "integer", minimum: 1, maximum: 3, description: "The new level, 1 weakest to 3 strongest." },
      },
      required: ["level"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const requested = asOptionalCount(asArgs(rawArgs).level, "level", 1, 3);
        if (requested === undefined) throw new Error('"level" must be an integer from 1 to 3.');
        const locale = context.locale;
        const declined = await confirmOrDecline(context, "boards.level", "write", phrase(locale, LEVEL_SET, requested));
        if (declined !== null) return declined;
        assertLive(context);
        const settings = withStore(context.profileId, (store) =>
          store.setDefaultLevel(requested, new Date(deps.now()).toISOString()),
        );
        return okResult(phrase(locale, LEVEL_DONE, settings.defaultLevel), {
          navigateTo: { module: "settings", settings: "boards" },
        });
      }),
  };

  const start: Tool = {
    name: "boards.start",
    description: {
      sr: "Otvara novu partiju jedne igre na tablama, protiv računara ili drugog igrača, na zadatom nivou. Koristi ga kada korisnik kaže da hoće da igra neku od igara.",
      en: "Opens a new game of one board game, against the computer or another player, at a level. Use it when the user wants to play one of the games.",
    },
    parameters: {
      type: "object",
      properties: {
        game: { type: "string", enum: [...BOARDS_GAMES], description: "The game to start." },
        opponent: { type: "string", enum: [...OPPONENTS], description: "Who plays the other seat. Defaults to the computer." },
        level: { type: "integer", minimum: 1, maximum: 3, description: "The computer's level. Omit for the default." },
      },
      required: ["game"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const game = asEnum(args.game, "game", BOARDS_GAMES);
        const opponent = asOptionalEnum(args.opponent, "opponent", OPPONENTS) ?? "computer";
        const locale = context.locale;
        const name = text(locale, GAME_NAME[game]);
        const { defaultLevel, replaces } = withStore(context.profileId, (store) => ({
          defaultLevel: store.settings().defaultLevel,
          replaces: store.getSave(game) !== null,
        }));
        const chosen = asOptionalCount(args.level, "level", 1, boardEngine(game).levels) ?? defaultLevel;
        if (chosen > boardEngine(game).levels) {
          throw new Error(phrase(locale, LEVEL_OUT_OF_RANGE, name, boardEngine(game).levels));
        }
        const summary = phrase(
          locale,
          START_SUMMARY,
          name,
          modeOf(opponent, chosen, locale),
          replaces ? text(locale, START_REPLACES) : "",
        );
        const declined = await confirmOrDecline(context, "boards.start", "write", summary);
        if (declined !== null) return declined;
        return okResult(phrase(locale, START_OPENED, name), {
          navigateTo: {
            module: "boards",
            action: { name: "start", payload: { game, opponent, level: chosen } },
          },
        });
      }),
  };

  const remove: Tool = {
    name: "boards.remove",
    description: {
      sr: "Odbacuje sačuvanu partiju jedne igre, bez upisa u rezultate. Koristi ga samo kada korisnik jasno kaže da želi da obriše ili odbaci partiju u toku.",
      en: "Discards the saved game of one board game, without counting it in the record. Use it only when the user clearly asks to delete or discard the game in progress.",
    },
    parameters: {
      type: "object",
      properties: {
        game: { type: "string", enum: [...BOARDS_GAMES], description: "The game whose saved game is discarded." },
      },
      required: ["game"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const game = asEnum(asArgs(rawArgs).game, "game", BOARDS_GAMES);
        const locale = context.locale;
        const name = text(locale, GAME_NAME[game]);
        const save = withStore(context.profileId, (store) => store.getSave(game));
        if (save === null) return failResult(locale, phrase(locale, NO_SAVE, name));
        const declined = await confirmOrDecline(
          context,
          "boards.remove",
          "write",
          phrase(locale, REMOVE_SUMMARY, name, save.moves),
        );
        if (declined !== null) return declined;
        assertLive(context);
        withStore(context.profileId, (store) => store.remove(game));
        return okResult(phrase(locale, REMOVED, name), { navigateTo: { module: "boards" } });
      }),
  };

  return [stats, position, suggest, level, start, remove];
}
