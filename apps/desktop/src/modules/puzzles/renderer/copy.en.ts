import { sr } from "./copy.sr.js";

/**
 * PUZZLES in English — the same shape as `copy.sr.ts`, checked by the compiler.
 *
 * `typeof sr` is the whole mechanism: a sentence left untranslated, a key
 * invented here, or a nested table that does not match is one compile error
 * each. The register is the app's own English: sentence case, informative, no
 * exclamation marks.
 *
 * Two names are the puzzles' own rather than translations of the Serbian: the
 * numbers game is „Numbers" here (the show's „Moj broj" has no English name, and
 * a reader who has never seen it is told what the round is about), and the
 * layout Mahjong solitaire's article calls „the turtle" keeps that name.
 */
export const en: typeof sr = {
  page: {
    subtitle: "Sudoku, nonograms, mahjong and Numbers — every game is saved and picks up where it stopped.",
    loading: "Loading…",
    stages: {
      deal: "Dealing the board…",
      search: "Searching for an answer…",
    },
    loadError: "The puzzles could not be loaded.",
    saveError: "The game was not saved.",
  },
  tabs: {
    sudoku: "Sudoku",
    nonogram: "Nonograms",
    mahjong: "Mahjong",
    broj: "Numbers",
  },
  variants: {
    sudoku: {
      easy: "Easy",
      medium: "Medium",
      hard: "Hard",
    },
    nonogram: {
      "5x5": "5 × 5",
      "10x10": "10 × 10",
      "15x15": "15 × 15",
      "20x20": "20 × 20",
    },
    mahjong: {
      turtle: "Turtle",
    },
    broj: {
      six: "Six numbers",
    },
  },
  common: {
    newGame: "New game",
    undo: "Undo",
    redo: "Redo",
    hint: "Hint",
    played: "Games",
    solved: "Solved",
    best: "Best time",
    time: "Time",
  },
  stats: {
    title: "Results",
    empty: "No results yet",
    emptyBody:
      "Pick a puzzle, play a game through, and its result appears here on its own.",
  },
  sudoku: {
    variantLabel: "Difficulty",
    boardLabel: "Board",
    cell: "Cell",
    padLabel: "Digits",
    erase: "Erase",
    notes: "Pencil marks",
    conflicts: "Show conflicts",
    conflictNote: "Cells that repeat a digit in a row, column or box are marked.",
    hintLead: "The next step:",
    hintFill: "enter digit {digit} into cell {cell}",
    hintEliminate: "remove candidates from the marked cells",
    hintNarrow: "keep only the marked candidates",
    hintNone: "The technique ladder has no step left for this board.",
    filled: "Filled",
    solved: "Solved — all 81 cells are right.",
  },
  techniques: {
    "naked-single": "only one digit is left for the cell",
    "hidden-single": "the digit has only one place in this row, column or box",
    "naked-pair": "two digits share two cells, so they fit nowhere else in the unit",
    "hidden-pair": "two digits appear only in the same two cells",
    pointing: "the digit is locked to one row or column inside the box",
    "box-line": "the digit is locked to one box inside the row or column",
    "x-wing": "the digit sits in two rows at the same two columns",
  },
  nonogram: {
    variantLabel: "Size",
    toolLabel: "Tool",
    fill: "Fill",
    cross: "Cross",
    zoomLabel: "Zoom",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    cell: "Cell",
    markUnknown: "empty",
    markFilled: "filled",
    markCrossed: "crossed",
    filled: "Correctly filled",
    solved: "Solved — the picture is right.",
  },
  mahjong: {
    layout: "Layout",
    left: "Tiles left",
    shuffle: "Shuffle",
    shuffled: "The tiles that are left were dealt out again.",
    stuck: "No pair can be taken any more. Shuffle the tiles.",
    shuffleFailed: "The tiles that are left cannot be arranged into a board that clears.",
    hintLead: "Take this pair.",
    hintNone: "No pair left on this board still clears it.",
    solved: "Every tile is cleared.",
    unknown: "Unknown tile",
    suits: {
      circles: "Circles",
      bamboo: "Bamboo",
      characters: "Characters",
    },
    winds: {
      east: "East wind",
      south: "South wind",
      west: "West wind",
      north: "North wind",
    },
    dragons: {
      red: "Red dragon",
      green: "Green dragon",
      white: "White dragon",
    },
    flower: "Flower",
    season: "Season",
  },
  broj: {
    target: "Target",
    numbers: "Numbers",
    expression: "Expression",
    check: "Check",
    refusals: {
      syntax: "That expression cannot be read. Use digits, +, −, ×, ÷ and brackets.",
      "unknown-number": "The expression uses a number that is not one of the six.",
      "inexact-division": "A division has to come out whole, with nothing left over.",
    },
    exact: "Exact — the value is {value}.",
    near: "The value is {value}, {distance} from the target.",
    solutionLead: "The best expression the six numbers can make:",
    solutionDistance: "Distance from the target",
    giveUp: "Give up",
  },
  widget: {
    empty: "No game is in progress.",
    loading: "Loading…",
    loadError: "The games in progress could not be loaded.",
  },
  settings: {
    caption: "The setting applies to sudoku and travels with the profile.",
    hint: "With it off, conflicts appear only when asked for, from the button above the board.",
    saved: "Saved.",
    loadError: "The setting could not be loaded.",
    saveError: "The setting was not saved.",
  },
};
