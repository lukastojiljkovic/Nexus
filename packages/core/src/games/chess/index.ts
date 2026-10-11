/**
 * The chess module's logic: a position, the rules of moving, a built-in
 * opponent, and the wrapper a board plays through.
 *
 * Three layers, and it is worth knowing which one a caller is in.
 *
 * **Rules** (`createGame`, `gameStatus`, `applyUci`, `gamePgn`, `replayUci`)
 * delegate to `chess.js`. Everything a person can see or do belongs here: it is
 * the authority on legality, on FEN, on PGN and on every draw, and it is
 * deliberately the only thing a UI is allowed to ask.
 *
 * **The engine** (`parseFen`, `legalMoves`, `perft`, `searchPosition`,
 * `chooseEngineMove`) is this project's own: a 0x88 move generator proved by
 * perft, and a small alpha-beta search with quiescence. It exists because the
 * brief asks for our own opponent under our own licence, and because `chess.js`
 * has no search at all.
 *
 * **The two meet at a FEN string**, and nowhere else. The engine never decides
 * what is legal for the UI, and the UI never asks the engine whether a move is
 * one.
 */

export { ChessError, START_FEN, parseFen, toFen } from "./position.js";
export type { EnginePosition, Side } from "./types.js";

export {
  isCapture,
  legalMoves,
  moveSquares,
  moveToUci,
  playMove,
  squareIndex,
  squareName,
  uciToMove,
} from "./movegen.js";
export type { MoveSquares } from "./movegen.js";

export { perft, perftAt } from "./perft.js";

export { evaluate, materialBalance } from "./evaluate.js";

export { MATE_SCORE, searchPosition } from "./search.js";
export type { SearchLimits, SearchOptions, SearchResult } from "./search.js";

export { CHESS_LEVELS, chessLevel, chooseEngineMove } from "./levels.js";
export type { ChessLevel } from "./levels.js";

export {
  applyUci,
  createGame,
  gamePgn,
  gameStatus,
  isValidFen,
  legalUci,
  loadGamePgn,
  replayUci,
  resultToken,
} from "./rules.js";
export type { Chess, ChessColor, ChessResultToken, GameSnapshot, Move, Square } from "./rules.js";

