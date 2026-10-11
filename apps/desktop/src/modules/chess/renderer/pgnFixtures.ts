/**
 * Two real games in PGN, with the collection each one comes from, for the PGN
 * round-trip test beside this file.
 *
 * **Why real games rather than made-up ones.** A parser test that only ever sees
 * text this project wrote proves that the writer and the reader agree with each
 * other and nothing else. These two are games other people recorded, so the test
 * is asking `chess.js` — the authority the module plays through — whether it
 * reads the same moves the collection does, and writes them back unchanged.
 *
 * **The licences, since the brief asks for them.** A chess game's MOVES are
 * facts: a sequence of moves is not a copyrightable expression (the same
 * reasoning that lets databases of games exist at all), and both games below are
 * from before 1900 besides. The COLLECTIONS the moves were read from are cited
 * with their own terms; not one sentence of either is reproduced here — only the
 * moves, the players, the place and the result, which are the game itself.
 *
 * Each `san`/`fen` below is the source's move list as `chess.js` 1.4.0 reads it,
 * measured with this build rather than transcribed from the article's prose
 * (`O-O-O` is how that library writes the castling the article spells `0-0-0`).
 */

export interface PgnFixture {
  /** What the game is called in this file's own test names. */
  readonly name: string;
  /** The collection it was read from, with its date of retrieval. */
  readonly source: string;
  readonly pgn: string;
  /** The game's moves as the source gives them, in the notation the source uses. */
  readonly sourceSan: readonly string[];
  /** The same moves as `chess.js` writes them. */
  readonly san: readonly string[];
  readonly uci: string;
  readonly fen: string;
  readonly result: "1-0" | "0-1" | "1/2-1/2";
}

/**
 * Morphy against the Duke of Brunswick and Count Isouard, Paris, October or
 * November 1858 — the „Opera Game", played in a box at the Salle Ventadour.
 *
 * Source: Wikipedia's article „Opera Game“
 * (https://en.wikipedia.org/wiki/Opera_Game, retrieved 2026-10-10), whose text is
 * CC BY-SA 4.0. The article's own header gives the players, Paris, and the two
 * candidate months; the PGN date is left unknown because the source says the
 * month cannot be settled, and this file does not invent one.
 */
export const OPERA_GAME: PgnFixture = {
  name: "Opera Game",
  source: "Wikipedia, „Opera Game“ (retrieved 2026-10-10; text CC BY-SA 4.0)",
  pgn: `[Event "Paris opera"]
[Site "Paris"]
[Date "1858.??.??"]
[White "Paul Morphy"]
[Black "Duke of Brunswick and Count Isouard"]
[Result "1-0"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7
8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. 0-0-0 Rd8 13. Rxd7 Rxd7
14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0
`,
  sourceSan: [
    "e4", "e5", "Nf3", "d6", "d4", "Bg4", "dxe5", "Bxf3", "Qxf3", "dxe5",
    "Bc4", "Nf6", "Qb3", "Qe7", "Nc3", "c6", "Bg5", "b5", "Nxb5", "cxb5",
    "Bxb5+", "Nbd7", "0-0-0", "Rd8", "Rxd7", "Rxd7", "Rd1", "Qe6", "Bxd7+",
    "Nxd7", "Qb8+", "Nxb8", "Rd8#",
  ],
  san: [
    "e4", "e5", "Nf3", "d6", "d4", "Bg4", "dxe5", "Bxf3", "Qxf3", "dxe5",
    "Bc4", "Nf6", "Qb3", "Qe7", "Nc3", "c6", "Bg5", "b5", "Nxb5", "cxb5",
    "Bxb5+", "Nbd7", "O-O-O", "Rd8", "Rxd7", "Rxd7", "Rd1", "Qe6", "Bxd7+",
    "Nxd7", "Qb8+", "Nxb8", "Rd8#",
  ],
  uci:
    "e2e4 e7e5 g1f3 d7d6 d2d4 c8g4 d4e5 g4f3 d1f3 d6e5 f1c4 g8f6 f3b3 d8e7 " +
    "b1c3 c7c6 c1g5 b7b5 c3b5 c6b5 c4b5 b8d7 e1c1 a8d8 d1d7 d8d7 h1d1 e7e6 " +
    "b5d7 f6d7 b3b8 d7b8 d1d8",
  fen: "1n1Rkb1r/p4ppp/4q3/4p1B1/4P3/8/PPP2PPP/2K5 b k - 1 17",
  result: "1-0",
};

/**
 * Fool's mate — the shortest possible game.
 *
 * Source: Wikipedia's article „Fool's mate“
 * (https://en.wikipedia.org/wiki/Fool%27s_mate, retrieved 2026-10-10; text
 * CC BY-SA 4.0), whose infobox gives this line as `1.f3 e6 2.g4 Qh4#` and
 * attributes it to Gioachino Greco (c. 1620), via Francis Beale (1656).
 *
 * A LINE and not a recorded game: the article gives no date, no place and no
 * players, and the tags below say „unknown" rather than filling them in.
 */
export const FOOLS_MATE: PgnFixture = {
  name: "Fool's mate",
  source: "Wikipedia, „Fool's mate“ (retrieved 2026-10-10; text CC BY-SA 4.0)",
  pgn: `[Event "Fool's mate"]
[Site "?"]
[Date "????.??.??"]
[White "?"]
[Black "?"]
[Result "0-1"]

1. f3 e6 2. g4 Qh4# 0-1
`,
  sourceSan: ["f3", "e6", "g4", "Qh4#"],
  san: ["f3", "e6", "g4", "Qh4#"],
  uci: "f2f3 e7e6 g2g4 d8h4",
  fen: "rnb1kbnr/pppp1ppp/4p3/8/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3",
  result: "0-1",
};

/** Both fixtures, in the order the test walks them. */
export const PGN_FIXTURES: readonly PgnFixture[] = [OPERA_GAME, FOOLS_MATE];
