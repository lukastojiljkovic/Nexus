import { Chess, validateFen } from "chess.js";
import type { Move as ChessJsMove, Square } from "chess.js";
import { ChessError } from "./position.js";

/**
 * The rules engine the UI plays against, wrapped.
 *
 * **`chess.js` is the authority on what is legal, what a position is, and what a
 * game's PGN says.** The engine in this folder is a move generator and a search
 * — fast, and wrong in ways only perft would find — and it must never be the
 * thing a screen asks "can I play this?". So everything a person can see or do
 * goes through the functions below, and the two only meet at the FEN string
 * between them.
 *
 * The wrapper is deliberately thin: it pads the FEN fields humans omit, turns
 * UCI text into a move and back, and gathers the questions `chess.js` already
 * answers into one snapshot. It adds no rule of its own.
 */

/** `"w"` or `"b"`, the same letters a FEN uses. */
export type ChessColor = "w" | "b";
/** The four PGN result tokens, `"*"` while a game is unfinished. */
export type ChessResultToken = "1-0" | "0-1" | "1/2-1/2" | "*";

export type { Chess, ChessJsMove as Move, Square };

/** Everything a board needs to draw itself, gathered in one read. */
export interface GameSnapshot {
  fen: string;
  turn: ChessColor;
  moveNumber: number;
  inCheck: boolean;
  checkmate: boolean;
  stalemate: boolean;
  insufficientMaterial: boolean;
  threefoldRepetition: boolean;
  fiftyMoveDraw: boolean;
  draw: boolean;
  gameOver: boolean;
  result: ChessResultToken;
  /** The moves played, in algebraic notation, in order. */
  san: string[];
  /** The same moves as UCI text, parallel to `san`. */
  uci: string[];
}

/**
 * The six fields `chess.js` insists on, given the two to four a person writes.
 *
 * A FEN is often quoted as placement plus side to move, and this project's own
 * brief quotes Kiwipete that way. The defaults are the ones the standard names:
 * no castling, no en passant, and both clocks at their starting values. Anything
 * shorter than two fields, or longer than six, is not a FEN at all.
 */
function padFen(fen: string): string {
  const fields = fen.trim().split(/\s+/);
  if (fields.length < 2 || fields.length > 6) return fen;
  const defaults = ["-", "-", "0", "1"];
  while (fields.length < 6) fields.push(defaults[fields.length - 2]!);
  return fields.join(" ");
}

/** Whether the text is a position `chess.js` will accept, abbreviated or not. */
export function isValidFen(fen: string): boolean {
  return validateFen(padFen(fen)).ok;
}

/** A fresh game, from the standard start position or from `fen`. Throws on a bad FEN. */
export function createGame(fen?: string): Chess {
  if (fen === undefined) return new Chess();
  const padded = padFen(fen);
  if (!validateFen(padded).ok) throw new ChessError(`Not a position: "${fen}".`);
  return new Chess(padded);
}

/** The UCI text of a `chess.js` move. */
function uciOf(move: ChessJsMove): string {
  return `${move.from}${move.to}${move.promotion ?? ""}`;
}

/** Every legal move, or every legal move of one square — what the board highlights. */
export function legalUci(chess: Chess, square?: string): string[] {
  const moves = square === undefined
    ? chess.moves({ verbose: true })
    : chess.moves({ verbose: true, square: square as Square });
  return moves.map(uciOf);
}

/**
 * Plays a move named in UCI and returns its algebraic notation. Throws when the
 * move is not legal — this is the call a board makes when a person has dropped a
 * piece, and there is no silent answer for a dropped piece.
 */
export function applyUci(chess: Chess, uci: string): string {
  const text = uci.trim().toLowerCase();
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(text)) {
    throw new ChessError(`"${uci}" is not a move.`);
  }
  const promotion = text.length === 5 ? text[4]! : undefined;
  const played = chess.move({
    from: text.slice(0, 2),
    to: text.slice(2, 4),
    ...(promotion === undefined ? {} : { promotion }),
  });
  return played.san;
}

/**
 * The result the position itself states: a checkmate is a win for the side that
 * is not to move, and every draw `chess.js` recognises is a draw. `"*"` means
 * the game is still going — it is a claim about the POSITION, never about what
 * a player said, which is why a resigned game is stored with its own result
 * beside a PGN that ends in `"*"`.
 */
export function resultToken(chess: Chess): ChessResultToken {
  if (chess.isCheckmate()) return chess.turn() === "w" ? "0-1" : "1-0";
  if (chess.isDraw()) return "1/2-1/2";
  return "*";
}

/** One snapshot of everything the board and the move list draw from. */
export function gameStatus(chess: Chess): GameSnapshot {
  const history = chess.history({ verbose: true });
  return {
    fen: chess.fen(),
    turn: chess.turn(),
    moveNumber: chess.moveNumber(),
    inCheck: chess.isCheck(),
    checkmate: chess.isCheckmate(),
    stalemate: chess.isStalemate(),
    insufficientMaterial: chess.isInsufficientMaterial(),
    threefoldRepetition: chess.isThreefoldRepetition(),
    fiftyMoveDraw: chess.isDrawByFiftyMoves(),
    draw: chess.isDraw(),
    gameOver: chess.isGameOver(),
    result: resultToken(chess),
    san: history.map((move) => move.san),
    uci: history.map(uciOf),
  };
}

/**
 * The game as PGN, with the result header always taken from the position. A
 * caller may name the players, the event and the date; it may not name the
 * result, because a PGN whose result disagrees with its moves is a file that two
 * readers will read differently.
 */
export function gamePgn(chess: Chess, headers: Readonly<Record<string, string>> = {}): string {
  for (const [key, value] of Object.entries(headers)) chess.setHeader(key, value);
  chess.setHeader("Result", resultToken(chess));
  return chess.pgn();
}

/** Reads a PGN back. Throws on text that is not a game. */
export function loadGamePgn(pgn: string): Chess {
  const chess = new Chess();
  chess.loadPgn(pgn);
  return chess;
}

/**
 * Replays a list of UCI moves on a starting position, or throws at the first
 * move that is not legal there. This is the store's validator for a game in
 * progress: a saved move list that cannot be replayed is not a game, and it is
 * better to refuse it at the boundary than to hand a board a position nobody
 * could reach.
 */
export function replayUci(
  startFen: string,
  moves: readonly string[],
): { fen: string; san: string[] } {
  const chess = createGame(startFen);
  const san: string[] = [];
  for (const move of moves) san.push(applyUci(chess, move));
  return { fen: chess.fen(), san };
}

