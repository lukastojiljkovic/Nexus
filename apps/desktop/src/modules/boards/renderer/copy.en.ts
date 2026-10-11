import { sr } from "./copy.sr.js";

/**
 * BOARDS in English — the same shape as `copy.sr.ts`, checked by the compiler.
 *
 * `typeof sr` is the whole mechanism: a sentence left untranslated, a key
 * invented here, or a nested table that does not match is one compile error each.
 * The register is the app's own English: sentence case, informative, no
 * exclamation marks.
 */
export const en: typeof sr = {
  page: {
    subtitle: "Six board games — against the computer or on one machine.",
    loading: "Loading…",
  },
  games: {
    reversi: {
      name: "Reversi",
      about: "Turn the opponent's discs over and hold the corners.",
    },
    draughts: {
      name: "Draughts",
      about: "Twelve pieces, compulsory captures, two rule sets.",
    },
    mlin: {
      name: "Nine men's morris",
      about: "Three in a line — place, move and take a piece.",
    },
    backgammon: {
      name: "Backgammon",
      about: "Two dice, fifteen checkers and the doubling cube.",
    },
    "four-in-a-row": {
      name: "Four in a row",
      about: "Drop a disc and line four of them up.",
    },
    ludo: {
      name: "Ludo",
      about: "Two to four players, and a six brings a token out.",
    },
  },
  lobby: {
    title: "Games",
    play: "New game",
    resume: "Resume",
    saved: "Saved game",
    moves: "Moves: {count}",
    againstComputer: "Against the computer, level {level}",
    againstHuman: "Two people at one machine",
  },
  cell: {
    human: "person",
    computer: "computer",
    empty: "empty",
    column: "column",
  },
  setup: {
    title: "New game: {game}",
    opponent: "Opponent",
    computer: "The computer",
    human: "Another person",
    level: "Computer level",
    seats: "Number of players",
    seat: "Player {number}",
    rules: "Rules",
    english: "English draughts",
    russian: "Russian draughts",
    cube: "Play with the doubling cube",
    cubeHint: "The cube doubles the stake, and the opponent takes it or refuses it.",
    start: "Start",
    cancel: "Cancel",
  },
  game: {
    turn: "To move",
    you: "you",
    computer: "the computer",
    player: "player {number}",
    thinking: "The computer is thinking…",
    roll: "Roll the dice",
    pass: "Pass the turn",
    noMoves: "These dice allow no legal move.",
    undo: "Back",
    undoHint: "Takes back your move and the computer's answer.",
    resign: "Resign",
    record: "Record the result",
    leave: "Leave the game",
    newGame: "New game",
    listTitle: "Moves",
    listEmpty: "No moves yet.",
    cube: "Cube: {value}",
    offer: "Double",
    accepts: "Accept",
    declines: "Refuse",
    pickFrom: "Choose a piece.",
    pickTo: "Choose a square.",
    pickRemoval: "Choose the piece to take.",
    pickColumn: "Choose a column.",
    keys: "Keyboard: Tab through the squares, Enter to choose, Escape to back out.",
  },
  moves: {
    roll: "Dice",
    pass: "No move",
    double: "Doubled",
  },
  result: {
    title: "The game is over",
    win: "Win",
    loss: "Loss",
    draw: "Draw",
    seat: "Winner: player {number}",
    note: "The result enters the record when you record it.",
  },
  stats: {
    title: "Record",
    caption: "Only games against the computer are recorded, per level.",
    level: "Level",
    played: "played",
    won: "won",
    drawn: "drawn",
    lost: "lost",
    none: "No games recorded yet.",
    variant: { english: "English", russian: "Russian" },
  },
  settings: {
    caption: "The level a new game against the computer opens at.",
    hint: "The level can also be changed when starting a game.",
    saved: "Saved.",
    loadError: "The setting could not be loaded.",
    saveError: "The setting was not saved.",
  },
  widget: {
    empty: "No game is in progress.",
    loading: "Loading…",
    loadError: "The games could not be loaded.",
    moves: "Moves: {count}",
  },
  errors: {
    load: "The games could not be loaded.",
    mutate: "The change was not saved.",
    think: "The computer could not play its move. Try again, or resign the game.",
    position: "A saved game is not valid, so it was not opened.",
  },
};
