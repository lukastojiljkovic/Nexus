/**
 * The ARCADE module: what its scores say, and which game the assistant opens.
 *
 * **The scores are the store's own.** `ArcadeScoreStore.list()` answers one row
 * per board, and `arcade.stats` prints those rows the way the stats table does:
 * played, won and the best figure of each board. A board nobody has played has no
 * row and is not printed; the tool never computes a score or a time of its own.
 *
 * **The assistant does not play.** A finished game is reported by the page and
 * written by main (`register.ts`), and nothing the assistant says should look like
 * a game it did not watch. So there is no tool that writes a score, and
 * `arcade.play` only opens a game, on the board the user names, through the
 * page's own intent. Minesweeper has no hint either: the engine has no deduction
 * to read from, so there is no tool for one.
 *
 * **The names are restated here.** The page's words live in its renderer copy,
 * which main cannot import, so the game and board names are a short table in this
 * file, on `library.ts`'s precedent. The board keys are the store's own, and
 * `arcade.play`'s variants are the engine's presets, so the two vocabularies meet
 * in the one table below.
 */

import { ARCADE_GAMES, ArcadeScoreStore, type ArcadeGame, type ArcadeScore } from "@nexus/db";
import {
  MINESWEEPER_PRESET_IDS,
  type AssistantLocale,
  type AssistantText,
  type MinesweeperPresetId,
  type Tool,
} from "@nexus/core";
import { asArgs, asEnum, asOptionalEnum } from "./args.js";
import {
  assertLive,
  failResult,
  formatDuration,
  formatNumber,
  guard,
  okResult,
  phrase,
  text,
  type AssistantPhrase,
  type ProfileDb,
} from "./support.js";

export interface ArcadeToolDeps {
  /** See `ToolDeps.profileDb`. */
  readonly profileDb: ProfileDb;
}

/** The game names, as the shelf draws them. */
const GAME_NAME: Record<ArcadeGame, AssistantText> = {
  minesweeper: { sr: "Minolovac", en: "Minesweeper" },
  blocks: { sr: "Kocke", en: "Blocks" },
  snake: { sr: "Zmija", en: "Snake" },
  bricks: { sr: "Cigle", en: "Bricks" },
  tile2048: { sr: "2048", en: "2048" },
};

/** The three presets, as the level picker names them. */
const PRESET_NAME: Record<MinesweeperPresetId, AssistantText> = {
  beginner: { sr: "Početni", en: "Beginner" },
  intermediate: { sr: "Srednji", en: "Intermediate" },
  expert: { sr: "Napredni", en: "Expert" },
};

const CUSTOM: AssistantText = { sr: "Prilagođeno", en: "Custom" };
const STANDARD: AssistantText = { sr: "Standardna tabla", en: "Standard board" };

const HEADING: AssistantText = { sr: "Arkada — rezultati:", en: "Arcade — scores:" };
const EMPTY: AssistantText = {
  sr: "Arkada još nema rezultata.",
  en: "The arcade has no scores yet.",
};
const NO_BEST: AssistantText = { sr: "nema", en: "none" };

const PLAYED: AssistantPhrase<[count: string]> = {
  sr: (count) => `odigrano ${count}`,
  en: (count) => `played ${count}`,
};
const WON: AssistantPhrase<[count: string]> = {
  sr: (count) => `pobeda ${count}`,
  en: (count) => `won ${count}`,
};
const BEST_TIME: AssistantPhrase<[time: string]> = {
  sr: (time) => `najbolje vreme ${time}`,
  en: (time) => `best time ${time}`,
};
const BEST_SCORE: AssistantPhrase<[score: string]> = {
  sr: (score) => `najbolji rezultat ${score}`,
  en: (score) => `best score ${score}`,
};

const OPENED: AssistantPhrase<[game: string, board: string]> = {
  sr: (game, board) => `Otvaram ${game}, ${board}.`,
  en: (game, board) => `Opening ${game}, ${board}.`,
};
const OPENED_GAME: AssistantPhrase<[game: string]> = {
  sr: (game) => `Otvaram ${game}.`,
  en: (game) => `Opening ${game}.`,
};
const BOARD_NEEDS_MINESWEEPER: AssistantText = {
  sr: "Tabla se bira samo za Minolovac.",
  en: "A board can only be chosen for Minesweeper.",
};

const PRESET_IDS: readonly MinesweeperPresetId[] = MINESWEEPER_PRESET_IDS;

export function arcadeTools(deps: ArcadeToolDeps): readonly Tool[] {
  const stats: Tool = {
    name: "arcade.stats",
    description: {
      sr: "Čita rezultate Arkade: koliko je partija odigrano na kojoj tabli, koliko pobeda i najbolji rezultat ili vreme. Koristi ga kada korisnik pita kakav mu je rezultat, koliko je puta igrao ili koje je vreme najbolje.",
      en: "Reads the arcade scores: how many games were played on each board, the wins, and the best score or time. Use it when the user asks what their best is, how often they played, or their fastest Minesweeper win.",
    },
    parameters: {
      type: "object",
      properties: {
        game: {
          type: "string",
          enum: [...ARCADE_GAMES],
          description: "Only this game. Leave out for all games.",
        },
      },
      required: [],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const game = asOptionalEnum(asArgs(rawArgs).game, "game", ARCADE_GAMES);
        const scores = deps.profileDb(context.profileId, (db, id) =>
          new ArcadeScoreStore(db, id).list(),
        );
        const shown = scores.filter((score) => game === undefined || score.game === game);
        if (shown.length === 0) return okResult(text(context.locale, EMPTY));
        const lines = shown.map((score) => scoreLine(context.locale, score));
        return okResult([text(context.locale, HEADING), ...lines].join("\n"));
      }),
  };

  const play: Tool = {
    name: "arcade.play",
    description: {
      sr: "Otvara igru u Arkadi, a kod minolovca i tablu: početnu, srednju ili naprednu. Ne igra umesto korisnika. Koristi ga kada korisnik traži da otvori ili pokrene neku igru.",
      en: "Opens an arcade game, and for Minesweeper the board: beginner, intermediate or expert. It does not play for the user. Use it when the user asks to open or start a game.",
    },
    parameters: {
      type: "object",
      properties: {
        game: {
          type: "string",
          enum: [...ARCADE_GAMES],
          description: "The game to open.",
        },
        variant: {
          type: "string",
          enum: [...PRESET_IDS],
          description: "The Minesweeper board. Only for minesweeper.",
        },
      },
      required: ["game"],
      additionalProperties: false,
    },
    effect: "navigate",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const game = asEnum(args.game, "game", ARCADE_GAMES);
        const preset = asOptionalEnum(args.variant, "variant", PRESET_IDS);
        if (preset !== undefined && game !== "minesweeper") {
          return failResult(context.locale, text(context.locale, BOARD_NEEDS_MINESWEEPER));
        }
        const gameName = text(context.locale, GAME_NAME[game]);
        const reply =
          preset === undefined
            ? phrase(context.locale, OPENED_GAME, gameName)
            : phrase(context.locale, OPENED, gameName, text(context.locale, PRESET_NAME[preset]));
        return okResult(reply, {
          navigateTo: {
            module: "arcade",
            item: preset === undefined ? game : `${game}/${preset}`,
          },
        });
      }),
  };

  return [stats, play];
}

/** One board's line: the game and board it is, then the figures the game keeps for it. */
function scoreLine(locale: AssistantLocale, score: ArcadeScore): string {
  const facts =
    score.game === "minesweeper"
      ? [
          phrase(locale, PLAYED, formatNumber(locale, score.played)),
          phrase(locale, WON, formatNumber(locale, score.won)),
          phrase(
            locale,
            BEST_TIME,
            score.bestTimeMs === null
              ? text(locale, NO_BEST)
              : formatDuration(locale, Math.round(score.bestTimeMs / 1000)),
          ),
        ]
      : [
          phrase(locale, PLAYED, formatNumber(locale, score.played)),
          phrase(
            locale,
            BEST_SCORE,
            score.bestScore === null ? text(locale, NO_BEST) : formatNumber(locale, score.bestScore),
          ),
        ];
  return `- ${text(locale, GAME_NAME[score.game])}, ${boardName(locale, score)}: ${facts.join(", ")}`;
}

/** A board key as the words the page uses for it: a preset's name, `Prilagođeno 9×9×10`, or `4×4`. */
function boardName(locale: AssistantLocale, score: ArcadeScore): string {
  if (score.game === "minesweeper") {
    const custom = /^custom:(\d+)x(\d+)x(\d+)$/.exec(score.variant);
    if (custom !== null) return `${text(locale, CUSTOM)} ${custom[1]}×${custom[2]}×${custom[3]}`;
    const preset = PRESET_IDS.find((id) => id === score.variant);
    return preset === undefined ? score.variant : text(locale, PRESET_NAME[preset]);
  }
  if (score.game === "tile2048") return score.variant.replace("x", "×");
  return text(locale, STANDARD);
}
