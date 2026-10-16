/**
 * The PUZZLES module (sudoku, nonograms, mahjong and Broj) through the assistant's
 * eyes: what is in progress and on the record, the next step in a sudoku or a
 * mahjong board, opening a puzzle at a grade, discarding one in progress, and the
 * one setting, whether a sudoku marks its mistakes while it is played.
 *
 * **The hints are the engines' answers, read off the saved board.** A sudoku's
 * next step is `sudokuHint` on the board as the player has it, and a mahjong pair
 * is `mahjongHint` on the board's own game, which is what the panels ask for. The
 * panels compute the same things in the renderer's worker; main calls the same
 * `@nexus/core` functions directly, and the mahjong search is bounded by its own
 * node budget.
 *
 * **Nothing here fills a board in.** The assistant gives the next step and never
 * the whole solution. The page has no way to show one for sudoku, nonograms or
 * mahjong, and Broj's solution appears on its page only when the player gives up.
 *
 * **Every write is the store the IPC channel calls.** `puzzles:clearSave` and
 * `puzzles:setCheckWhileTyping` run the same methods here. A new game opened on
 * the page clears the saved one first, as the page's „Nova igra" does, and the
 * page does that clearing itself when it receives the `start` action.
 */

import {
  mahjongGameFrom,
  mahjongHint,
  sudokuHint,
  TURTLE_SLOTS,
  type AssistantLocale,
  type AssistantText,
  type SudokuTechnique,
  type Tool,
} from "@nexus/core";
import {
  PUZZLE_IDS,
  PUZZLE_VARIANTS,
  PuzzlesStore,
  type MahjongState,
  type PuzzleId,
  type SudokuState,
} from "@nexus/db";
import { asArgs, asEnum, asOptionalBoolean, asOptionalEnum } from "./args.js";
import {
  assertLive,
  confirmOrDecline,
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

export interface PuzzlesToolDeps {
  /** See `ToolDeps.profileDb`. */
  readonly profileDb: ProfileDb;
  /** See `ToolDeps.now`. */
  readonly now: () => number;
}

/** Every grade any puzzle is played at, once each, in the store's own order. */
const VARIANTS = [...new Set(Object.values(PUZZLE_VARIANTS).flat())];

const PUZZLE_NAME: Record<PuzzleId, AssistantText> = {
  sudoku: { sr: "Sudoku", en: "Sudoku" },
  nonogram: { sr: "Nonogrami", en: "Nonograms" },
  mahjong: { sr: "Mahjong", en: "Mahjong" },
  broj: { sr: "Broj", en: "Numbers" },
};

/** A grade's name as the page's grade chips print it. */
const GRADE_NAME: Readonly<Record<string, AssistantText>> = {
  easy: { sr: "lako", en: "easy" },
  medium: { sr: "srednje", en: "medium" },
  hard: { sr: "teško", en: "hard" },
  "5x5": { sr: "5 × 5", en: "5 × 5" },
  "10x10": { sr: "10 × 10", en: "10 × 10" },
  "15x15": { sr: "15 × 15", en: "15 × 15" },
  "20x20": { sr: "20 × 20", en: "20 × 20" },
  turtle: { sr: "Kornjača", en: "Turtle" },
  six: { sr: "šest brojeva", en: "six numbers" },
};

/** The next-step technique, in the words the sudoku panel gives it. */
const TECHNIQUE: Record<SudokuTechnique, AssistantText> = {
  "naked-single": { sr: "samo jedna cifra ostaje u polju", en: "only one digit is left for the cell" },
  "hidden-single": {
    sr: "cifra ima samo jedno mesto u ovom redu, koloni ili kvadratu",
    en: "the digit has only one place in this row, column or box",
  },
  "naked-pair": {
    sr: "dve cifre dele dva polja, pa im nema mesta drugde u jedinici",
    en: "two digits share two cells, so they fit nowhere else in the unit",
  },
  "hidden-pair": {
    sr: "dve cifre se javljaju samo u istim dvama poljima",
    en: "two digits appear only in the same two cells",
  },
  pointing: {
    sr: "cifra je u kvadratu vezana za jedan red ili kolonu",
    en: "the digit is locked to one row or column inside the box",
  },
  "box-line": {
    sr: "cifra je u redu ili koloni vezana za jedan kvadrat",
    en: "the digit is locked to one box inside the row or column",
  },
  "x-wing": {
    sr: "cifra je u dva reda na istim dvema kolonama",
    en: "the digit sits in two rows at the same two columns",
  },
};

const NONE_SAVED: AssistantPhrase<[name: string, grade: string]> = {
  sr: (name, grade) => `nema igre u toku: ${name}, ${grade}.`,
  en: (name, grade) => `there is no game in progress: ${name}, ${grade}.`,
};

const IN_PROGRESS: AssistantText = { sr: "U toku:", en: "In progress:" };
const IN_PROGRESS_LINE: AssistantPhrase<[name: string, grade: string, time: string]> = {
  sr: (name, grade, time) => `- ${name}, ${grade}: ${time}`,
  en: (name, grade, time) => `- ${name}, ${grade}: ${time}`,
};
const RECORD: AssistantText = { sr: "Rezultati:", en: "Record:" };
const RECORD_LINE: AssistantPhrase<[name: string, grade: string, played: number, solved: number]> = {
  sr: (name, grade, played, solved) => `- ${name}, ${grade}: odigrano ${played}, rešeno ${solved}`,
  en: (name, grade, played, solved) => `- ${name}, ${grade}: played ${played}, solved ${solved}`,
};
const BEST_TIME: AssistantPhrase<[time: string]> = {
  sr: (time) => `, najbolje ${time}`,
  en: (time) => `, best ${time}`,
};
const BEST_DISTANCE: AssistantPhrase<[distance: string]> = {
  sr: (distance) => `, najbliže ${distance}`,
  en: (distance) => `, closest ${distance}`,
};
const STATS_EMPTY: AssistantText = {
  sr: "Još nema igara ni rezultata.",
  en: "There are no games or results yet.",
};

const SUDOKU_STEP: AssistantPhrase<[technique: string, action: string]> = {
  sr: (technique, action) => `Sledeći korak: ${technique}. ${action}`,
  en: (technique, action) => `The next step: ${technique}. ${action}`,
};
const SUDOKU_FILL: AssistantPhrase<[digit: number, cell: number]> = {
  sr: (digit, cell) => `Upiši cifru ${String(digit)} u polje ${String(cell)}.`,
  en: (digit, cell) => `Enter the digit ${String(digit)} into cell ${String(cell)}.`,
};
const SUDOKU_ELIMINATE: AssistantPhrase<[digits: string, cells: string]> = {
  sr: (digits, cells) => `Iz polja ${cells} skloni kandidate ${digits}.`,
  en: (digits, cells) => `Remove the candidates ${digits} from cells ${cells}.`,
};
const SUDOKU_NARROW: AssistantPhrase<[digits: string, cells: string]> = {
  sr: (digits, cells) => `U poljima ${cells} ostavi samo kandidate ${digits}.`,
  en: (digits, cells) => `In cells ${cells} keep only the candidates ${digits}.`,
};
const SUDOKU_NONE: AssistantText = {
  sr: "Za ovu tablu nema više koraka iz lestvice tehnika.",
  en: "This board has no step left on the technique ladder.",
};
const MAHJONG_PAIR: AssistantPhrase<[first: string, second: string]> = {
  sr: (first, second) => `Uzmi ovaj par: ${first} i ${second}.`,
  en: (first, second) => `Take this pair: ${first} and ${second}.`,
};
const MAHJONG_NONE: AssistantText = {
  sr: "Nijedan par više ne vodi do kraja partije.",
  en: "No pair left on this board still clears it.",
};
/** The two puzzles whose page has no hint, and what the page does have for them instead. */
const NO_HINT: Partial<Record<PuzzleId, AssistantText>> = {
  nonogram: {
    sr: "Stranica nema savet za nonograme, ni rešenje.",
    en: "The page has no hint for nonograms, and no solution either.",
  },
  broj: {
    sr: "Stranica nema savet za Broj. Najbolji izraz prikazuje tek kada korisnik preda rundu.",
    en: "The page has no hint for Numbers. Its best expression appears only when the user gives up the round.",
  },
};

const CHECK_ON: AssistantText = {
  sr: "Označavati greške dok se igra sudoku?",
  en: "Mark mistakes while a sudoku is played?",
};
const CHECK_OFF: AssistantText = {
  sr: "Prestati da označavaš greške dok se igra sudoku?",
  en: "Stop marking mistakes while a sudoku is played?",
};
const CHECK_DONE: AssistantPhrase<[on: string]> = {
  sr: (on) => `Označavanje grešaka dok se igra sudoku je ${on}.`,
  en: (on) => `Marking mistakes while a sudoku is played is ${on}.`,
};
const ON_WORD: AssistantText = { sr: "uključeno", en: "on" };
const OFF_WORD: AssistantText = { sr: "isključeno", en: "off" };

const START_SUMMARY: AssistantPhrase<[name: string, grade: string, fresh: boolean]> = {
  sr: (name, grade, fresh) =>
    fresh
      ? `Obrisati sačuvanu igru i započeti novu: ${name}, ${grade}?`
      : `Otvoriti ${name}, ${grade} na stranici?`,
  en: (name, grade, fresh) =>
    fresh
      ? `Delete the saved game and start a new one: ${name}, ${grade}?`
      : `Open ${name}, ${grade} on the page?`,
};
const START_OPENED: AssistantPhrase<[name: string, grade: string, fresh: boolean]> = {
  sr: (name, grade, fresh) => `Otvara se ${fresh ? "nova " : ""}igra: ${name}, ${grade}.`,
  en: (name, grade, fresh) => `Opening ${fresh ? "a new " : "the "}${name} game, ${grade}.`,
};

const CLEAR_SUMMARY: AssistantPhrase<[name: string, grade: string]> = {
  sr: (name, grade) => `Obrisati sačuvanu igru: ${name}, ${grade}? Napredak se gubi.`,
  en: (name, grade) => `Delete the saved ${name} game (${grade})? Its progress is lost.`,
};
const CLEARED: AssistantPhrase<[name: string, grade: string]> = {
  sr: (name, grade) => `Sačuvana igra je obrisana: ${name}, ${grade}.`,
  en: (name, grade) => `The saved ${name} game (${grade}) was deleted.`,
};

/** The puzzle and the grade a tool was asked for, checked against the store's own list. */
function pairOf(args: Record<string, unknown>): { puzzle: PuzzleId; variant: string } {
  const puzzle = asEnum(args.puzzle, "puzzle", PUZZLE_IDS);
  const variant = asEnum(args.variant, "variant", VARIANTS);
  if (!PUZZLE_VARIANTS[puzzle].includes(variant)) {
    throw new Error(`"variant" is not a grade of ${puzzle}.`);
  }
  return { puzzle, variant };
}

function sudokuStep(state: SudokuState, locale: AssistantLocale): string {
  // The board as the panel merges it: the givens, with what the player has entered over them.
  const cells = state.givens.map((given, index) => (given !== 0 ? given : (state.entries[index] ?? 0)));
  const hint = sudokuHint(cells);
  if (hint === null) return text(locale, SUDOKU_NONE);
  const technique = text(locale, TECHNIQUE[hint.technique]);
  const list = (values: readonly number[]) => values.join(", ");
  const cellNames = (indices: readonly number[]) => list(indices.map((index) => index + 1));
  let action: string;
  if (hint.action === "fill") {
    action = phrase(locale, SUDOKU_FILL, hint.digit, hint.cell + 1);
  } else if (hint.action === "eliminate") {
    action = phrase(locale, SUDOKU_ELIMINATE, list(hint.digits), cellNames(hint.cells));
  } else {
    action = phrase(locale, SUDOKU_NARROW, list(hint.digits), cellNames(hint.cells));
  }
  return phrase(locale, SUDOKU_STEP, technique, action);
}

function mahjongPair(state: MahjongState, seed: number, locale: AssistantLocale): string {
  const game = mahjongGameFrom({ slots: TURTLE_SLOTS, faces: state.faces, remaining: state.remaining, seed });
  const pair = mahjongHint(game);
  if (pair === null) return text(locale, MAHJONG_NONE);
  return phrase(locale, MAHJONG_PAIR, game.faces[pair[0]] ?? "", game.faces[pair[1]] ?? "");
}

export function puzzlesTools(deps: PuzzlesToolDeps): readonly Tool[] {
  const withStore = <T>(profileId: string, use: (store: PuzzlesStore) => T): T =>
    deps.profileDb(profileId, (db, id) => use(new PuzzlesStore(db, id)));

  const stats: Tool = {
    name: "puzzles.stats",
    description: {
      sr: "Čita stanje zagonetki: igre u toku i rezultate po stepenima (sudoku, nonogrami, mahjong, Broj). Koristi ga kada korisnik pita koliko je rešio ili šta je ostalo nezavršeno.",
      en: "Reads the puzzles: the games in progress and the record by grade (sudoku, nonograms, mahjong, Numbers). Use it when the user asks how many they solved or what they left unfinished.",
    },
    parameters: {
      type: "object",
      properties: {
        puzzle: { type: "string", enum: [...PUZZLE_IDS], description: "One puzzle only. Omit for all four." },
      },
      required: [],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const puzzle = asOptionalEnum(asArgs(rawArgs).puzzle, "puzzle", PUZZLE_IDS);
        const locale = context.locale;
        const { saves, rows } = withStore(context.profileId, (store) => ({
          saves: store.listSaves(),
          rows: store.listStats(),
        }));
        const inScope = (name: PuzzleId) => puzzle === undefined || puzzle === name;
        const open = saves.filter((save) => inScope(save.puzzle));
        const played = rows.filter((row) => inScope(row.puzzle) && row.played > 0);
        if (open.length === 0 && played.length === 0) return okResult(text(locale, STATS_EMPTY));
        const lines: string[] = [];
        if (open.length > 0) {
          lines.push(text(locale, IN_PROGRESS));
          for (const save of open) {
            lines.push(
              phrase(
                locale,
                IN_PROGRESS_LINE,
                text(locale, PUZZLE_NAME[save.puzzle]),
                gradeOf(save.variant, locale),
                formatDuration(locale, save.elapsedSeconds),
              ),
            );
          }
        }
        if (played.length > 0) {
          lines.push(text(locale, RECORD));
          for (const row of played) {
            let line = phrase(
              locale,
              RECORD_LINE,
              text(locale, PUZZLE_NAME[row.puzzle]),
              gradeOf(row.variant, locale),
              row.played,
              row.solved,
            );
            if (row.bestTimeSeconds !== null) {
              line += phrase(locale, BEST_TIME, formatDuration(locale, row.bestTimeSeconds));
            }
            if (row.bestDistance !== null) {
              line += phrase(locale, BEST_DISTANCE, formatNumber(locale, row.bestDistance));
            }
            lines.push(line);
          }
        }
        return okResult(lines.join("\n"));
      }),
  };

  const hint: Tool = {
    name: "puzzles.hint",
    description: {
      sr: "Daje sledeći korak za sačuvanu sudoku tablu ili sledeći par za mahjong, kako ga daje stranica. Nikada ne daje ceo rešeni sudoku. Koristi ga kada korisnik traži pomoć, a ne rešenje.",
      en: "Gives the next step on a saved sudoku board, or the next pair on a mahjong board, as the page does. It never gives a whole solved sudoku. Use it when the user asks for help, not for the solution.",
    },
    parameters: {
      type: "object",
      properties: {
        puzzle: { type: "string", enum: [...PUZZLE_IDS], description: "The puzzle the hint is for." },
        variant: { type: "string", enum: VARIANTS, description: "The grade the game is played at." },
      },
      required: ["puzzle", "variant"],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const locale = context.locale;
        const { puzzle, variant } = pairOf(asArgs(rawArgs));
        const none = NO_HINT[puzzle];
        if (none !== undefined) return okResult(text(locale, none));
        const save = withStore(context.profileId, (store) =>
          store.listSaves().find((entry) => entry.puzzle === puzzle && entry.variant === variant),
        );
        if (save === undefined) {
          return failResult(
            locale,
            phrase(locale, NONE_SAVED, text(locale, PUZZLE_NAME[puzzle]), gradeOf(variant, locale)),
          );
        }
        const answer =
          puzzle === "sudoku"
            ? sudokuStep(save.state as SudokuState, locale)
            : mahjongPair(save.state as MahjongState, save.seed, locale);
        return okResult(answer);
      }),
  };

  const start: Tool = {
    name: "puzzles.start",
    description: {
      sr: "Otvara zagonetku na zadatom stepenu, nastavlja sačuvanu igru ili pokreće novu ako je fresh tačno. Koristi ga kada korisnik kaže da hoće da igra sudoku, nonogram, mahjong ili Broj.",
      en: "Opens a puzzle at a grade: it resumes the saved game, or starts a new one when fresh is true. Use it when the user wants to play sudoku, nonograms, mahjong or Numbers.",
    },
    parameters: {
      type: "object",
      properties: {
        puzzle: { type: "string", enum: [...PUZZLE_IDS], description: "The puzzle to open." },
        variant: { type: "string", enum: VARIANTS, description: "The grade to open it at." },
        fresh: { type: "boolean", description: "True to discard the saved game and deal a new one." },
      },
      required: ["puzzle", "variant"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const { puzzle, variant } = pairOf(args);
        const fresh = asOptionalBoolean(args.fresh, "fresh") ?? false;
        const locale = context.locale;
        const name = text(locale, PUZZLE_NAME[puzzle]);
        const grade = gradeOf(variant, locale);
        const declined = await confirmOrDecline(context, "puzzles.start", "write", phrase(locale, START_SUMMARY, name, grade, fresh));
        if (declined !== null) return declined;
        return okResult(phrase(locale, START_OPENED, name, grade, fresh), {
          navigateTo: { module: "puzzles", action: { name: "start", payload: { puzzle, variant, fresh } } },
        });
      }),
  };

  const clear: Tool = {
    name: "puzzles.clear",
    description: {
      sr: "Briše sačuvanu igru jedne zagonetke na jednom stepenu, bez upisa u rezultate. Koristi ga samo kada korisnik jasno kaže da želi da odbaci tu igru.",
      en: "Deletes the saved game of one puzzle at one grade, without counting it in the record. Use it only when the user clearly asks to discard that game.",
    },
    parameters: {
      type: "object",
      properties: {
        puzzle: { type: "string", enum: [...PUZZLE_IDS], description: "The puzzle." },
        variant: { type: "string", enum: VARIANTS, description: "The grade of the saved game." },
      },
      required: ["puzzle", "variant"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const { puzzle, variant } = pairOf(asArgs(rawArgs));
        const locale = context.locale;
        const name = text(locale, PUZZLE_NAME[puzzle]);
        const grade = gradeOf(variant, locale);
        const saved = withStore(context.profileId, (store) =>
          store.listSaves().some((entry) => entry.puzzle === puzzle && entry.variant === variant),
        );
        if (!saved) return failResult(locale, phrase(locale, NONE_SAVED, name, grade));
        const declined = await confirmOrDecline(context, "puzzles.clear", "write", phrase(locale, CLEAR_SUMMARY, name, grade));
        if (declined !== null) return declined;
        assertLive(context);
        withStore(context.profileId, (store) => store.clearSave(puzzle, variant));
        return okResult(phrase(locale, CLEARED, name, grade), { navigateTo: { module: "puzzles" } });
      }),
  };

  const mistakes: Tool = {
    name: "puzzles.mistakes",
    description: {
      sr: "Uključuje ili isključuje označavanje grešaka dok se igra sudoku. Koristi ga kada korisnik kaže da želi da vidi greške odmah ili da ih više ne vidi.",
      en: "Turns the marking of mistakes on or off while a sudoku is played. Use it when the user wants mistakes shown as they type, or not shown any more.",
    },
    parameters: {
      type: "object",
      properties: {
        on: { type: "boolean", description: "True to mark mistakes while playing, false to mark them only when asked." },
      },
      required: ["on"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const on = asArgs(rawArgs).on;
        if (typeof on !== "boolean") throw new Error('"on" must be a boolean.');
        const locale = context.locale;
        const declined = await confirmOrDecline(context, "puzzles.mistakes", "write", text(locale, on ? CHECK_ON : CHECK_OFF));
        if (declined !== null) return declined;
        assertLive(context);
        const settings = withStore(context.profileId, (store) =>
          store.setCheckWhileTyping(on, new Date(deps.now()).toISOString()),
        );
        return okResult(phrase(locale, CHECK_DONE, text(locale, settings.checkWhileTyping ? ON_WORD : OFF_WORD)), {
          navigateTo: { module: "settings", settings: "puzzles" },
        });
      }),
  };

  return [stats, hint, start, clear, mistakes];
}

/** A grade's name in the locale, or the grade's own key for one this table does not know. */
function gradeOf(variant: string, locale: AssistantLocale): string {
  return text(locale, GRADE_NAME[variant] ?? { sr: variant, en: variant });
}
