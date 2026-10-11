import { sr } from "./copy.sr.js";

/**
 * ARCADE in English - the same shape as `copy.sr.ts`, checked by the compiler.
 *
 * `typeof sr` is the whole mechanism: a sentence left untranslated, a key
 * invented here, or a nested table that does not match is one compile error each.
 * The register is the app's own English: sentence case, informative, no
 * exclamation marks, and the same words for a board and a move that the rest of
 * the interface uses.
 */
export const en: typeof sr = {
  page: {
    subtitle: "Five quick games for a break — offline, no account, nothing to set up.",
    loading: "Loading…",
  },
  shelf: {
    title: "Games",
  },
  games: {
    minesweeper: "Minesweeper",
    blocks: "Blocks",
    snake: "Snake",
    bricks: "Bricks",
    tile2048: "2048",
  },
  boards: {
    standard: "Standard board",
  },
  levels: {
    label: "Board",
    beginner: "Beginner",
    intermediate: "Intermediate",
    expert: "Expert",
    custom: "Custom",
  },
  counts: {
    lines: "Most lines",
    food: "Longest snake",
    levels: "Most levels",
    moves: "Most moves",
  },
  stats: {
    title: "Scores",
    played: "Played",
    bestTime: "Best time",
    bestScore: "Best score",
    currentStreak: "Streak",
    longestStreak: "Longest streak",
    lastPlayed: "Last played",
    none: "none",
    unplayed: "Not played yet",
    empty: "Pick a game and play the first round — the best scores show up here.",
  },
  actions: {
    newGame: "New game",
    undo: "Undo move",
    continueAfterWin: "Continue after the win",
    resume: "Resume",
  },
  custom: {
    title: "Custom board",
    columns: "Columns",
    rows: "Rows",
    mines: "Mines",
    invalid: "The first click is always safe: cells minus mines must be at least 9.",
  },
  status: {
    paused: "Paused",
    pausedHint: "Click the board or press a key to resume.",
    ready: "The first click is always safe.",
    remaining: "Mines left",
    time: "Time",
    won: "Won",
    lost: "Over",
    over: "Game over",
    score: "Score",
    lines: "Lines",
    level: "Level",
    next: "Next",
    hold: "Hold",
    length: "Length",
    eaten: "Eaten",
    lives: "Lives",
    cleared: "Levels",
    moves: "Moves",
    bestTile: "Largest tile",
  },
  keys: {
    minesweeper:
      "Arrow keys move the cursor, Space opens a cell, F marks it, C opens its neighbours; right-click marks, left-click opens.",
    blocks:
      "Left and right move the piece, up and Z rotate it, down falls faster, Space drops it to the floor, C holds it.",
    snake: "Arrow keys turn the snake; it dies on a wall or on itself.",
    bricks: "Left and right move the paddle, Space launches the ball, and the mouse can steer the paddle too.",
    tile2048: "Arrow keys merge tiles, U takes the last move back.",
  },
  errors: {
    load: "The scores could not be loaded.",
    record: "The score was not saved.",
  },
};
