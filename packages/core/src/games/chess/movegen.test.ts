import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { START_FEN, legalMoves, moveToUci, parseFen, perft, playMove, toFen } from "./index.js";

/**
 * The move generator's proof is PERFT — the count of leaf nodes in the legal
 * move tree — and the counts below are the published ones for the two standard
 * positions, so a wrong generator cannot make them pass by agreeing with itself.
 *
 * The start position and Kiwipete are the two suites the brief names:
 *   1 rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1
 *   2 r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1P/PPPBBPPP/R3K2R w KQkq -
 * and Kiwipete is deliberately written here with FOUR fields, because that is
 * how the brief spells it: `parseFen` has to accept the abbreviated form every
 * human writes (the clocks default to `0 1`), while `chess.js` — the oracle
 * used by the tests below — insists on all six.
 *
 * The positions after them are this module's own, chosen for the three rules
 * that a perft of the start position never reaches: en passant, promotion and
 * castling THROUGH an attacked square. Each is cross-checked against
 * `chess.js`'s own `perft`, which is an independent implementation, and the one
 * count that is small enough to check by eye is worked out in its comment.
 */

/** Where `chess.js` has to agree: the same position, counted by another engine. */
function oracle(fen: string, depth: number): number {
  return new Chess(fen).perft(depth);
}

describe("perft against the published counts", () => {
  it("counts the start position to depth 4", () => {
    expect([1, 2, 3, 4].map((depth) => perft(START_FEN, depth))).toEqual([
      20, 400, 8902, 197281,
    ]);
  });

  it("counts the start position as one leaf at depth 0", () => {
    expect(perft(START_FEN, 0)).toBe(1);
  });

  it("counts Kiwipete — four-field FEN, castling both sides, pins — to depth 3", () => {
    // The brief writes this position `2N2Q1P`, with a WHITE pawn on h3 — nine
    // white pawns, which is not a position either engine can reach, and which
    // measures 47/1995/93986 rather than the published counts. The brief's
    // counts are the standard suite's, and they belong to the canonical spelling
    // below, with a BLACK pawn on h3: that is the position this test pins.
    const kiwipete = "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -";
    expect([1, 2, 3].map((depth) => perft(kiwipete, depth))).toEqual([48, 2039, 97862]);
  });

  it("generates the twenty start moves by hand", () => {
    // Sixteen pawn pushes (two each) and four knight moves — the whole count,
    // written out so a generator that quietly drops a file or a knight fails
    // here rather than three levels up.
    const position = parseFen(START_FEN);
    expect(position).not.toBeNull();
    const moves = legalMoves(position!).map(moveToUci).sort();
    expect(moves).toEqual([
      "a2a3", "a2a4", "b1a3", "b1c3", "b2b3", "b2b4", "c2c3", "c2c4",
      "d2d3", "d2d4", "e2e3", "e2e4", "f2f3", "f2f4", "g1f3", "g1h3",
      "g2g3", "g2g4", "h2h3", "h2h4",
    ]);
  });
});

describe("perft on the rules the start position never reaches", () => {
  it("counts a position full of en-passant chances", () => {
    const fen = "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1";
    expect([1, 2, 3, 4].map((depth) => perft(fen, depth))).toEqual(
      [1, 2, 3, 4].map((depth) => oracle(fen, depth)),
    );
  });

  it("counts a promotion position, and depth 1 by hand", () => {
    // White has a pawn on a7 and a king on a1; black has a king on c7 and a
    // pawn on g2. The pawn's four promotions (`a8=Q/R/B/N`) plus the king's
    // three squares (a2, b1, b2 — none of them attacked by either black piece)
    // is the whole of it: 4 + 3 = 7.
    const fen = "8/P1k5/8/8/8/8/6p1/K7 w - - 0 1";
    expect(perft(fen, 1)).toBe(7);
    expect([2, 3].map((depth) => perft(fen, depth))).toEqual(
      [2, 3].map((depth) => oracle(fen, depth)),
    );
  });

  it("refuses to castle through an attacked square, but allows the other side", () => {
    // Black's f2 rook covers f1, so O-O would carry the king across an attacked
    // square and is illegal; nothing attacks d1, so O-O-O stands.
    const fen = "r3k2r/8/8/8/8/8/5r2/R3K2R w KQkq - 0 1";
    const moves = legalMoves(parseFen(fen)!).map(moveToUci);
    expect(moves).toContain("e1c1");
    expect(moves).not.toContain("e1g1");
    expect([1, 2, 3].map((depth) => perft(fen, depth))).toEqual(
      [1, 2, 3].map((depth) => oracle(fen, depth)),
    );
  });

  it("refuses to castle past a piece of its own — and keeps the other side", () => {
    // The b1 knight stands exactly where the queenside rook would land.
    const fen = "r3k2r/8/8/8/8/8/8/RN2K2R w KQkq - 0 1";
    const moves = legalMoves(parseFen(fen)!).map(moveToUci);
    expect(moves).not.toContain("e1c1");
    expect(moves).toContain("e1g1");
    expect([1, 2, 3].map((depth) => perft(fen, depth))).toEqual(
      [1, 2, 3].map((depth) => oracle(fen, depth)),
    );
  });

  it("plays the en-passant capture the FEN announces, and removes the pawn behind it", () => {
    // White's last move was e2-e4; the `e3` in the FEN is the square a black
    // pawn may capture INTO, taking the pawn that stands on e4.
    const fen = "4k3/8/8/8/3pP3/8/8/4K3 b - e3 0 1";
    const position = parseFen(fen)!;
    expect(legalMoves(position).map(moveToUci)).toContain("d4e3");

    const chess = new Chess(fen);
    chess.move("dxe3");
    // Playing it on OUR position has to produce the FEN chess.js produces —
    // that is what catches an en-passant capture that forgets the pawn it took
    // off `e4`, which no move count would notice.
    expect(playMove(position, "d4e3")).toBe(true);
    expect(toFen(position)).toBe(chess.fen());
    expect([1, 2].map((depth) => perft(fen, depth))).toEqual(
      [1, 2].map((depth) => oracle(fen, depth)),
    );
  });
});

