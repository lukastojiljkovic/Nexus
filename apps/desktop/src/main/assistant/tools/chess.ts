/**
 * The CHESS module: its saved games, the game in progress, the record against each
 * engine level, an analysis of a position, and the page's own opening of a game and
 * its delete.
 *
 * **The store is the app's own.** Every read and the one write go through
 * `ChessStore`, through the calls `modules/chess/main/register.ts` makes
 * (`listGames`, `getResume`, `listLevelStats`, `getGame`, `deleteGame`). No chess
 * table is read any other way.
 *
 * **The rules and the engines are not decided here.** Legality, FEN and results
 * are `@nexus/core`'s. An analysis is the core engine's search at the requested
 * level, or, at the levels the page hands to the Stockfish pack, the pack's search
 * through the same sessions the page uses. A reply that came from the pack names
 * its title, licence and source, as ADR-094 asks wherever the program is named.
 *
 * **What the assistant never does.** It does not play a move for the user in a game
 * in progress: `chess.analyze` suggests and writes nothing. A new game and a saved
 * game are the page's own actions, so the page's confirmation and its store calls do
 * the work. `chess.delete` is the one write, and it makes exactly the call the
 * page's Delete makes.
 */

import {
  MATE_SCORE,
  chooseEngineMove,
  createGame,
  isValidFen,
  legalUci,
  materialBalance,
  parseFen,
  type AssistantLocale,
  type Tool,
  type ToolResult,
} from "@nexus/core";
import { ChessNotFoundError, ChessStore, MAX_CHESS_LEVEL, type SavedGame } from "@nexus/db";
import type { ModuleToolPack, ModuleToolsAccess } from "../../moduleTools.js";
import { createStockfishSessions, type EngineMoveView } from "../../../modules/chess/main/engine.js";
import { needsPack, STOCKFISH_PACK_ID } from "../../../modules/chess/main/stockfish.js";
import { PACK_FIRST_LEVEL } from "../../../modules/chess/shared/levels.js";
import {
  CHESS_START_ACTION,
  COMMON_TIME_CONTROLS,
  NO_CLOCK,
  START_COLORS,
  START_OPPONENTS,
  type ChessStartRequest,
} from "../../../modules/chess/shared/setup.js";
import {
  asArgs,
  asEnum,
  asIdentifier,
  asOptionalCount,
  asOptionalEnum,
  asOptionalText,
} from "./args.js";
import {
  assertLive,
  confirmOrDecline,
  failResult,
  formatClock,
  formatDayInSentence,
  formatDuration,
  guard,
  localDay,
  numberFormat,
  okResult,
  phrase,
  text,
  type AssistantPhrase,
  type ProfileDb,
} from "./support.js";

export interface ChessToolDeps {
  /** See `ToolDeps.profileDb`. */
  readonly profileDb: ProfileDb;
  /** Main's wall clock, stamped into the row a delete writes. */
  readonly now: () => number;
  /** The installed tool packs, for the Stockfish pack's searches (ADR-094). */
  readonly tools: ModuleToolsAccess;
}

/** How many saved games one read names; a cut list says how many it left out. */
const GAMES_LIMIT = 20;
/** The longest FEN text a tool reads. A bound on untrusted text only: `isValidFen` decides what a position is. */
const MAX_FEN_CHARS = 100;
/**
 * The level an analysis plays when the request names none: the top of the built-in
 * engine's own range, the levels the pack does not take. A policy choice, not a
 * measurement; it keeps an analysis without the pack at the built-in engine's
 * strongest search.
 */
const DEFAULT_ANALYSIS_LEVEL = PACK_FIRST_LEVEL - 1;
/** The session an analysis holds its pack process under: one analysis, one session, closed once it has answered. */
const ANALYSIS_GAME = "assistant-analysis";

type Bilingual = { readonly sr: string; readonly en: string };

const RESULT_WORDS: Readonly<Record<SavedGame["result"], Bilingual>> = {
  white: { sr: "Pobeda belih", en: "White wins" },
  black: { sr: "Pobeda crnih", en: "Black wins" },
  draw: { sr: "Nerešeno", en: "Draw" },
  unfinished: { sr: "Nedovršena partija", en: "Unfinished game" },
};

const OPPONENT_WORDS: Readonly<Record<SavedGame["opponent"], Bilingual>> = {
  engine: { sr: "Računar", en: "The engine" },
  human: { sr: "Druga osoba", en: "Another person" },
};

/** The colours in the nominative: the start line names one, and a mate names the side that wins. */
const COLOR_WORDS: Readonly<Record<ChessStartRequest["color"], Bilingual>> = {
  white: { sr: "beli", en: "White" },
  black: { sr: "crni", en: "Black" },
};

const LEVEL_WORD: Bilingual = { sr: "Nivo", en: "Level" };

const NO_GAMES: Bilingual = { sr: "Nema sačuvanih partija.", en: "No saved games." };

const GAMES_HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Sačuvane partije (${String(count)}):`,
  en: (count) => `Saved games (${String(count)}):`,
};

const GAMES_MORE: AssistantPhrase<[count: number]> = {
  sr: (count) => `…i još ${String(count)}.`,
  en: (count) => `…and ${String(count)} more.`,
};

const IN_PROGRESS: AssistantPhrase<[description: string, moves: number]> = {
  sr: (description, moves) => `Partija u toku: ${description}. Odigrano poteza: ${String(moves)}.`,
  en: (description, moves) => `Game in progress: ${description}. Moves played: ${String(moves)}.`,
};

const NO_RECORD: Bilingual = {
  sr: "Protiv računara još nijedna partija nije završena.",
  en: "No game against the engine has finished yet.",
};

const RECORD_HEADING: Bilingual = { sr: "Protiv računara:", en: "Against the engine:" };

const RECORD_LINE: AssistantPhrase<[level: number, played: number, won: number, drawn: number, lost: number]> = {
  sr: (level, played, won, drawn, lost) =>
    `Nivo ${String(level)}: odigrano ${String(played)}, pobede ${String(won)}, nerešeno ${String(drawn)}, porazi ${String(lost)}.`,
  en: (level, played, won, drawn, lost) =>
    `Level ${String(level)}: played ${String(played)}, won ${String(won)}, drawn ${String(drawn)}, lost ${String(lost)}.`,
};

const NOT_FOUND: Bilingual = {
  sr: "Nema sačuvane partije s tom oznakom.",
  en: "No saved game has that id.",
};

const OPENING: AssistantPhrase<[when: string, result: string]> = {
  sr: (when, result) => `Otvaram sačuvanu partiju na stranici Šah (${when}, ${result}).`,
  en: (when, result) => `Opening the saved game on the chess page (${when}, ${result}).`,
};

const STARTING: AssistantPhrase<[description: string]> = {
  sr: (description) => `Otvaram novu partiju na stranici Šah: ${description}.`,
  en: (description) => `Opening a new game on the chess page: ${description}.`,
};

const DELETE_SUMMARY: AssistantPhrase<[when: string, result: string]> = {
  sr: (when, result) => `Obriši sačuvanu partiju (${when}, ${result}).`,
  en: (when, result) => `Delete the saved game (${when}, ${result}).`,
};

const DELETED: AssistantPhrase<[when: string, result: string]> = {
  sr: (when, result) => `Obrisana je sačuvana partija (${when}, ${result}).`,
  en: (when, result) => `Deleted the saved game (${when}, ${result}).`,
};

const NO_POSITION: Bilingual = {
  sr: "Nema pozicije: nijedna partija nije u toku i nije dat FEN.",
  en: "There is no position: no game is in progress and no FEN was given.",
};

const NOT_A_POSITION: Bilingual = {
  sr: "Taj FEN nije šahovska pozicija.",
  en: "That FEN is not a chess position.",
};

const GAME_OVER: Bilingual = {
  sr: "U toj poziciji nema poteza: partija je završena.",
  en: "The position has no move: the game is over.",
};

const BEST_MOVE: AssistantPhrase<[move: string]> = {
  sr: (move) => `Najbolji potez: ${move}`,
  en: (move) => `Best move: ${move}`,
};

const EVALUATION: AssistantPhrase<[value: string]> = {
  sr: (value) => `Procena: ${value} (plus je za bele)`,
  en: (value) => `Evaluation: ${value} (positive favours White)`,
};

const EVALUATION_UNSTATED: Bilingual = {
  sr: "Procena: motor je nije iskazao.",
  en: "Evaluation: the engine did not state one.",
};

const FORCED_MATE: AssistantPhrase<[winner: string]> = {
  sr: (winner) => `Procena: forsiran mat, pobeđuju ${winner}.`,
  en: (winner) => `Evaluation: forced mate, ${winner} wins.`,
};

const MATERIAL: AssistantPhrase<[value: string]> = {
  sr: (value) => `Materijal: ${value} (plus je za bele)`,
  en: (value) => `Material: ${value} (positive favours White)`,
};

const LEGAL_MOVES: AssistantPhrase<[count: number, moves: string]> = {
  sr: (count, moves) => `Dozvoljeni potezi (${String(count)}): ${moves}`,
  en: (count, moves) => `Legal moves (${String(count)}): ${moves}`,
};

const PACK_CREDIT: AssistantPhrase<[name: string, licence: string, attribution: string, url: string]> = {
  sr: (name, licence, attribution, url) => `Motor: ${name} · ${licence} · ${attribution} · ${url}`,
  en: (name, licence, attribution, url) => `Engine: ${name} · ${licence} · ${attribution} · ${url}`,
};

const NO_PACK: Bilingual = {
  sr: "Paket Stockfish nije instaliran, pa je odgovorio ugrađeni motor.",
  en: "The Stockfish pack is not installed, so the built-in engine answered.",
};

const PACK_SILENT: Bilingual = {
  sr: "Paket Stockfish nije odgovorio, pa je odgovorio ugrađeni motor.",
  en: "The Stockfish pack did not answer, so the built-in engine answered.",
};

export function chessTools(deps: ChessToolDeps): readonly Tool[] {
  const games: Tool = {
    name: "chess.games",
    description: {
      sr: "Čita šah: sačuvane partije sa ishodom, partiju koja je u toku i rezultate protiv računara po nivoima. Koristi ga kada korisnik pita koje je partije igrao, kako mu ide protiv računara ili gde je stao.",
      en: "Reads chess: the saved games with their results, the game in progress and the record against the engine by level. Use it when the user asks which games they played, how they do against the engine, or where they stopped.",
    },
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        asArgs(rawArgs);
        const locale = context.locale;
        const { games: rows, stats, resume } = deps.profileDb(context.profileId, (db, id) => {
          const store = new ChessStore(db, id);
          return { games: store.listGames(), stats: store.listLevelStats(), resume: store.getResume() };
        });

        const sections: string[] = [];
        sections.push(
          rows.length === 0
            ? text(locale, NO_GAMES)
            : [
                phrase(locale, GAMES_HEADING, rows.length),
                ...rows.slice(0, GAMES_LIMIT).map((game) => gameLine(locale, game)),
                ...(rows.length > GAMES_LIMIT
                  ? [phrase(locale, GAMES_MORE, rows.length - GAMES_LIMIT)]
                  : []),
              ].join("\n"),
        );
        if (resume !== null) {
          const description = describeGame(locale, resume);
          sections.push(phrase(locale, IN_PROGRESS, description, resume.moves.length));
        }
        const played = stats.filter((entry) => entry.played > 0);
        sections.push(
          played.length === 0
            ? text(locale, NO_RECORD)
            : [
                text(locale, RECORD_HEADING),
                ...played.map((entry) =>
                  phrase(locale, RECORD_LINE, entry.level, entry.played, entry.won, entry.drawn, entry.lost),
                ),
              ].join("\n"),
        );
        return okResult(sections.join("\n\n"));
      }),
  };

  const analyze: Tool = {
    name: "chess.analyze",
    description: {
      sr: "Analizira šahovsku poziciju: najbolji potez, procenu motora i dozvoljene poteze. Bez FEN-a uzima partiju koja je u toku. Koristi ga kada korisnik pita šta da odigra ili kako stoji pozicija. Nikada ne igra potez umesto korisnika.",
      en: "Analyses a chess position: the engine's best move, its evaluation and the legal moves. Without a FEN it uses the game in progress. Use it when the user asks what to play or how a position stands. It never plays a move for the user.",
    },
    parameters: {
      type: "object",
      properties: {
        fen: {
          type: "string",
          minLength: 1,
          maxLength: MAX_FEN_CHARS,
          description: "The position as FEN. Omit it to analyse the game in progress.",
        },
        level: {
          type: "integer",
          minimum: 1,
          maximum: MAX_CHESS_LEVEL,
          description: `Engine level 1 to ${String(MAX_CHESS_LEVEL)}. Defaults to ${String(DEFAULT_ANALYSIS_LEVEL)}.`,
        },
      },
      required: [],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const locale = context.locale;
        const level = asOptionalCount(args.level, "level", 1, MAX_CHESS_LEVEL) ?? DEFAULT_ANALYSIS_LEVEL;
        const fen = asOptionalText(args.fen, "fen", MAX_FEN_CHARS) ?? resumeFen(deps, context.profileId);
        if (fen === null) return failResult(locale, text(locale, NO_POSITION));
        if (!isValidFen(fen)) return failResult(locale, text(locale, NOT_A_POSITION));
        return await analyse(fen, level, deps.tools, locale);
      }),
  };

  const start: Tool = {
    name: "chess.start",
    description: {
      sr: "Otvara novu partiju na stranici Šah: boja, protivnik, nivo i sat. Koristi ga kada korisnik želi da igra šah protiv računara ili druge osobe. Ako je partija u toku, stranica pre zamene pita korisnika.",
      en: "Opens a new game on the chess page with a colour, an opponent, a level and a clock. Use it when the user wants to play chess against the engine or another person. If a game is in progress, the page asks before replacing it.",
    },
    parameters: {
      type: "object",
      properties: {
        color: { type: "string", enum: [...START_COLORS], description: "The colour the user plays." },
        opponent: { type: "string", enum: [...START_OPPONENTS], description: "The engine or another person." },
        level: {
          type: "integer",
          minimum: 1,
          maximum: MAX_CHESS_LEVEL,
          description: "Engine level, against the engine only.",
        },
        time: {
          type: "string",
          enum: [NO_CLOCK, ...COMMON_TIME_CONTROLS],
          description: "Clock as base+increment in seconds, or none.",
        },
      },
      required: ["color", "opponent"],
      additionalProperties: false,
    },
    effect: "navigate",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const level = asOptionalCount(args.level, "level", 1, MAX_CHESS_LEVEL);
        const time = asOptionalEnum(args.time, "time", [NO_CLOCK, ...COMMON_TIME_CONTROLS]);
        const request: ChessStartRequest = {
          color: asEnum(args.color, "color", START_COLORS),
          opponent: asEnum(args.opponent, "opponent", START_OPPONENTS),
          ...(level === undefined ? {} : { level }),
          ...(time === undefined ? {} : { time }),
        };
        return okResult(phrase(context.locale, STARTING, startDescription(context.locale, request)), {
          navigateTo: { module: "chess", action: { name: CHESS_START_ACTION, payload: request } },
        });
      }),
  };

  const open: Tool = {
    name: "chess.open",
    description: {
      sr: "Otvara sačuvanu partiju na stranici Šah radi pregleda. Koristi ga kada korisnik traži da vidi neku partiju; oznaku uzmi iz chess.games.",
      en: "Opens a saved chess game on the chess page for review. Use it when the user wants to see a game; take the id from chess.games.",
    },
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", minLength: 1, maxLength: 64, description: "The game's id, from chess.games." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    effect: "navigate",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const id = asIdentifier(asArgs(rawArgs).id, "id");
        const game = findGame(deps, context.profileId, id);
        if (game === null) return failResult(context.locale, text(context.locale, NOT_FOUND));
        const when = dayOf(context.locale, game);
        const result = text(context.locale, RESULT_WORDS[game.result]);
        return okResult(phrase(context.locale, OPENING, when, result), {
          navigateTo: { module: "chess", item: game.id },
        });
      }),
  };

  const remove: Tool = {
    name: "chess.delete",
    description: {
      sr: "Briše jednu sačuvanu šahovsku partiju. Koristi ga samo kada korisnik jasno traži brisanje; oznaku uzmi iz chess.games.",
      en: "Deletes one saved chess game. Use it only when the user clearly asks to delete it; take the id from chess.games.",
    },
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", minLength: 1, maxLength: 64, description: "The game's id, from chess.games." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const id = asIdentifier(asArgs(rawArgs).id, "id");
        const locale = context.locale;
        const game = findGame(deps, context.profileId, id);
        if (game === null) return failResult(locale, text(locale, NOT_FOUND));
        const when = dayOf(locale, game);
        const result = text(locale, RESULT_WORDS[game.result]);
        const declined = await confirmOrDecline(
          context,
          "chess.delete",
          "write",
          phrase(locale, DELETE_SUMMARY, when, result),
        );
        if (declined !== null) return declined;
        assertLive(context);
        deps.profileDb(context.profileId, (db, profileId) =>
          new ChessStore(db, profileId).deleteGame(id, new Date(deps.now()).toISOString()),
        );
        return okResult(phrase(locale, DELETED, when, result), { navigateTo: { module: "chess" } });
      }),
  };

  return [games, analyze, start, open, remove];
}

/** The saved game with `id`, or `null` when this profile has no live game by that id. */
function findGame(deps: ChessToolDeps, profileId: string, id: string): SavedGame | null {
  return deps.profileDb(profileId, (db, owner) => {
    try {
      return new ChessStore(db, owner).getGame(id);
    } catch (error) {
      if (error instanceof ChessNotFoundError) return null;
      throw error;
    }
  });
}

/** The FEN of the game in progress, or `null` when there is none. */
function resumeFen(deps: ChessToolDeps, profileId: string): string | null {
  return deps.profileDb(profileId, (db, owner) => new ChessStore(db, owner).getResume())?.fen ?? null;
}

/**
 * The analysis: the pack's search at the levels it plays, when it is installed and
 * answers, and the core engine's search otherwise. Either way the reply names which
 * engine answered.
 */
async function analyse(
  fen: string,
  level: number,
  tools: ModuleToolsAccess,
  locale: AssistantLocale,
): Promise<ToolResult> {
  const notes: string[] = [];
  if (needsPack(level)) {
    const pack = tools.pack(STOCKFISH_PACK_ID);
    if (pack === null) {
      notes.push(text(locale, NO_PACK));
    } else {
      const answer = await packMove(tools, fen, level);
      if (answer.outcome === "none") return okResult(text(locale, GAME_OVER));
      if (answer.outcome === "move") {
        return report(locale, fen, { move: answer.move, score: answer.score }, [packCredit(locale, pack)]);
      }
      notes.push(text(locale, PACK_SILENT));
    }
  }
  const best = chooseEngineMove(fen, level);
  if (best === null) return okResult(text(locale, GAME_OVER));
  return report(locale, fen, { move: best.move, score: best.score }, notes);
}

/** One search through the pack, with its process ended as soon as it has answered. */
async function packMove(tools: ModuleToolsAccess, fen: string, level: number): Promise<EngineMoveView> {
  const sessions = createStockfishSessions({ tools });
  try {
    return await sessions.move({ game: ANALYSIS_GAME, fen, moves: [], level });
  } finally {
    await sessions.closeAll();
  }
}

/**
 * The reply for one analysis. The engines report centipawns for the side to move;
 * the reply states them for White, so one sign convention runs through the whole.
 */
function report(
  locale: AssistantLocale,
  fen: string,
  search: { readonly move: string; readonly score: number | null },
  notes: readonly string[],
): ToolResult {
  const chess = createGame(fen);
  const mover = chess.turn();
  const lines = [phrase(locale, BEST_MOVE, search.move), evaluationText(locale, search.score, mover)];
  const position = parseFen(fen);
  if (position !== null) {
    const material = materialBalance(position);
    lines.push(phrase(locale, MATERIAL, pawns(locale, mover === "w" ? material : -material)));
  }
  const legal = legalUci(chess);
  lines.push(phrase(locale, LEGAL_MOVES, legal.length, legal.join(", ")), ...notes);
  return okResult(lines.join("\n"));
}

/** The evaluation line, from the score for the side to move, stated for White. */
function evaluationText(locale: AssistantLocale, score: number | null, mover: "w" | "b"): string {
  if (score === null) return text(locale, EVALUATION_UNSTATED);
  const white = mover === "w" ? score : -score;
  if (Math.abs(score) >= MATE_SCORE) {
    return phrase(locale, FORCED_MATE, text(locale, COLOR_WORDS[white > 0 ? "white" : "black"]));
  }
  return phrase(locale, EVALUATION, pawns(locale, white));
}

/** A pack's credit line: its name, licence, attribution and licence address, as its manifest states them. */
function packCredit(locale: AssistantLocale, pack: ModuleToolPack): string {
  return phrase(
    locale,
    PACK_CREDIT,
    `${pack.title[locale]} ${pack.version}`,
    pack.licence.spdx,
    pack.licence.attribution,
    pack.licence.url,
  );
}

/** Centipawns as pawns, with a sign and the locale's own decimal mark. */
function pawns(locale: AssistantLocale, centipawns: number): string {
  return numberFormat(locale, {
    signDisplay: "exceptZero",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(centipawns / 100);
}

/** One saved game as a list line: when it was played, what it was against, how it ended, and its id. */
function gameLine(locale: AssistantLocale, game: SavedGame): string {
  const when = `${dayOf(locale, game)} ${formatClock(locale, Date.parse(game.playedAt))}`;
  return `- ${when} · ${describeGame(locale, game)} · ${text(locale, RESULT_WORDS[game.result])} (${game.id})`;
}

/** A game's day, as the page's own list writes it, without the sentence's full stop. */
function dayOf(locale: AssistantLocale, game: Pick<SavedGame, "playedAt">): string {
  return formatDayInSentence(locale, localDay(Date.parse(game.playedAt)));
}

/** Who a game was against, at what level and on what clock. */
function describeGame(
  locale: AssistantLocale,
  game: Pick<SavedGame, "opponent" | "level" | "timeControl">,
): string {
  const parts = [text(locale, OPPONENT_WORDS[game.opponent])];
  if (game.level !== null) parts.push(`${text(locale, LEVEL_WORD)} ${String(game.level)}`);
  if (game.timeControl !== null) parts.push(clockDescription(locale, game.timeControl));
  return parts.join(" · ");
}

/** The description of a start request, in the words the saved games use. */
function startDescription(locale: AssistantLocale, request: ChessStartRequest): string {
  const parts = [text(locale, COLOR_WORDS[request.color]), text(locale, OPPONENT_WORDS[request.opponent])];
  if (request.opponent === "engine" && request.level !== undefined) {
    parts.push(`${text(locale, LEVEL_WORD)} ${String(request.level)}`);
  }
  if (request.time !== undefined && request.time !== NO_CLOCK) {
    parts.push(clockDescription(locale, request.time));
  }
  return parts.join(" · ");
}

/** A `base+increment` clock in seconds, as a person reads it: „10 min + 5 s“. */
function clockDescription(locale: AssistantLocale, control: string): string {
  const [base = "0", increment = "0"] = control.split("+");
  const baseText = formatDuration(locale, Number(base));
  if (Number(increment) === 0) return baseText;
  return `${baseText} + ${formatDuration(locale, Number(increment))}`;
}
