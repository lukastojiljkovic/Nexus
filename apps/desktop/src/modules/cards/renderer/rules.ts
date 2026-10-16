/**
 * The card games' turn logic, now in `@nexus/core` (`games/cards/dispatch.ts`, AG-22), so
 * the assistant replays a saved game through the same dispatcher the table uses. The page
 * keeps importing it from here.
 */

export type { CardSession } from "@nexus/core";
export {
  LEVELS,
  DEFAULT_LEVEL_NAME,
  GAME_ORDER,
  variantsOf,
  isComputerGame,
  seatCount,
  listIsValid,
  startGame,
  resumeGame,
  legalCardMoves as legalMoves,
  hasMovesLeft,
  isWon,
  isFinished,
  seatToAct,
  seatNow,
  undoEntry,
  stepSession,
  canUndo,
  undoSession,
  hintMove,
  safeMoves,
  canSolve,
  solveVerdict,
  spiderRows,
  playedMoves,
  moveSeed,
  computerMove,
  isMoveFor,
  cardCodeOf,
} from "@nexus/core";
