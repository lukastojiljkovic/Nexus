/**
 * The board's own vocabulary, as pure functions (ADR-090).
 *
 * **Why the arithmetic is here and not in the page.** Every question a board
 * answers when somebody presses a key — which square an arrow points at, whether
 * a square is light, what a second activation means — is a decision, and a
 * decision written inside JSX is one only the screenshot sweep can check. These
 * are the pieces that can be pinned by a test with no DOM, which is exactly the
 * half the kit asks a module to keep out of its component.
 *
 * **Squares are the algebraic names chess.js already speaks** (`"e4"`), and the
 * pieces are chess.js's own `{ color, type, square }` records. Nothing here
 * invents a second spelling of a square or a piece: `createGame(fen).board()` is
 * the renderer's source of truth for what stands where, and `legalUci(chess,
 * square)` for what may move — both from `@nexus/core`, which is the module's
 * only authority on the rules.
 */

/** The eight files, a-file first — the order a board is indexed in, not the order it is drawn. */
export const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
/** The eight ranks, first rank first. */
export const RANKS = ["1", "2", "3", "4", "5", "6", "7", "8"] as const;

/** A piece as chess.js reports it: its own colour and type, and the square it stands on. */
export interface BoardPiece {
  readonly color: "w" | "b";
  readonly type: "p" | "n" | "b" | "r" | "q" | "k";
  readonly square: string;
}

/** What `chess.board()` answers: eight ranks, each eight files, rank 8 first. */
export type BoardCells = readonly (readonly (BoardPiece | null)[])[];

/** One square of the board as drawn: its name, whether it is light, and what stands on it. */
export interface BoardSquareView {
  readonly square: string;
  readonly light: boolean;
  readonly piece: BoardPiece | null;
}

/** The square for a zero-based file and rank, or `null` off the board. Rank 0 is the first rank. */
export function squareOf(file: number, rank: number): string | null {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return `${FILES[file]}${RANKS[rank]}`;
}

/** A square's zero-based file and rank, or `null` when the text is not a square. */
export function squareParts(square: string): { file: number; rank: number } | null {
  if (square.length !== 2) return null;
  const file = FILES.indexOf(square[0] as (typeof FILES)[number]);
  const rank = RANKS.indexOf(square[1] as (typeof RANKS)[number]);
  if (file < 0 || rank < 0) return null;
  return { file, rank };
}

/**
 * Whether a square is one of the light ones. Checkerboard arithmetic on the two
 * indices, and `a1` is dark — the corner every chess board agrees about.
 */
export function isLight(file: number, rank: number): boolean {
  return (file + rank) % 2 === 1;
}

/**
 * The board as it is DRAWN: eight rows of eight squares, top row first.
 *
 * `chess.board()` already answers with the eighth rank on top, which is the view
 * White has; flipping reverses the rows and each row, which is the whole of what
 * „flip the board" means — and doing it here rather than in the component keeps
 * the one piece of board geometry that a test can check out of the JSX.
 */
export function displayRows(cells: BoardCells, flipped: boolean): BoardSquareView[][] {
  const rows = flipped ? [...cells].reverse().map((row) => [...row].reverse()) : cells;
  return rows.map((row, rowIndex) =>
    row.map((piece, columnIndex) => {
      // The drawn index is not the board index once the board is flipped, so the
      // square is read off the CELL rather than computed from the loop.
      const square = piece?.square ?? drawnSquare(rowIndex, columnIndex, flipped);
      const parts = squareParts(square);
      return {
        square,
        light: parts === null ? false : isLight(parts.file, parts.rank),
        piece,
      };
    }),
  );
}

/** The square at a drawn row and column, which is what an empty cell has to be named from. */
function drawnSquare(row: number, column: number, flipped: boolean): string {
  const file = flipped ? 7 - column : column;
  const rank = flipped ? row : 7 - row;
  return squareOf(file, rank) ?? "a1";
}

/**
 * The square one arrow press points at, or `null` at the edge of the board.
 *
 * **The direction is the one on SCREEN, not the one on the board.** A flipped
 * board puts the first rank at the top, so „up" from e4 is e3 there — the key the
 * user presses means what they see, which is the only reading that does not make
 * a flipped board a puzzle.
 */
export function squareInDirection(
  square: string,
  key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight",
  flipped: boolean,
): string | null {
  const parts = squareParts(square);
  if (parts === null) return null;
  const rankStep = key === "ArrowUp" ? 1 : key === "ArrowDown" ? -1 : 0;
  const fileStep = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
  const forward = flipped ? -1 : 1;
  return squareOf(parts.file + fileStep * forward, parts.rank + rankStep * forward);
}

/**
 * A piece's glyph, as the character the board draws it with.
 *
 * The two colours take the two halves of Unicode's chess block — the hollow
 * pieces `U+2654..2659` and the solid ones `U+265A..265F` — so the two sides are
 * told apart by the SHAPE of the glyph they are drawn with rather than by a
 * colour, which is what keeps a dark theme from inverting the game's own
 * convention (the design system's redundancy rule, applied to a board: colour is
 * never the only channel). Both are drawn in the theme's ink.
 */
export function pieceGlyph(color: "w" | "b", type: BoardPiece["type"]): string {
  const base = color === "w" ? 0x2654 : 0x265a;
  const offset = { k: 0, q: 1, r: 2, b: 3, n: 4, p: 5 }[type];
  return String.fromCodePoint(base + offset);
}

/** A UCI move's three fields, as the board reads them when it draws a move. */
export interface MoveFields {
  readonly from: string;
  readonly to: string;
  /** `"q" | "r" | "b" | "n"`, or null when the move does not promote. */
  readonly promotion: string | null;
}

/** The three fields of a UCI move. A text that is not one answers `null` rather than a guess. */
export function moveFields(uci: string): MoveFields | null {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? null };
}

/**
 * What a second activation of a square means — the one decision the click, the
 * drag and the Enter key all share.
 *
 * **Three outcomes, and each is a rule rather than a convenience.** A square with
 * a piece of the side to move *picks it up*; a square that is a legal destination
 * of the picked piece *plays the move* (and, when a pawn's last step has four
 * answers, hands the choice back as `promotion` rather than guessing); a square
 * that is neither *re-picks* if it holds a movable piece and otherwise drops the
 * selection. Anything else would leave a picked-up piece with no way to let go.
 *
 * The legal list is `@nexus/core`'s (`legalUci`), so this function never decides
 * what is legal — only what the user's second press meant.
 */
export function afterSquareActivated(
  selected: string | null,
  square: string,
  legal: readonly string[],
): { selected: string | null; move: string | null; promotion: readonly string[] } {
  /** Every legal move that starts from `from` and ends on `to`. */
  const between = (from: string, to: string): string[] =>
    legal.filter((uci) => uci.startsWith(from) && uci.slice(2, 4) === to);

  if (selected === null) {
    return { selected: legal.some((uci) => uci.startsWith(square)) ? square : null, move: null, promotion: [] };
  }

  const candidates = between(selected, square);
  if (candidates.length === 1) {
    return { selected: null, move: candidates[0] ?? null, promotion: [] };
  }
  if (candidates.length > 1) {
    // A promotion: four moves differ only in the piece the pawn becomes, so the
    // board asks rather than choosing a queen on the user's behalf. The four are
    // handed back in the order the picker draws them - queen, rook, bishop,
    // knight - which is a decision about the SCREEN rather than something the
    // generator's own order should leak through.
    return { selected: null, move: null, promotion: inPromotionOrder(candidates) };
  }
  return {
    selected: legal.some((uci) => uci.startsWith(square)) ? square : null,
    move: null,
    promotion: [],
  };
}

/** The four promotion moves in the order a picker offers them. */
function inPromotionOrder(moves: readonly string[]): string[] {
  const order = ["q", "r", "b", "n"];
  return [...moves].sort((left, right) => order.indexOf(left[4] ?? "") - order.indexOf(right[4] ?? ""));
}

/** One ply of the move list, as a row draws it: its number in the game, and the move itself. */
export interface MoveRef {
  /** 1-based index into the game's move list — the position reached AFTER this move. */
  readonly ply: number;
  readonly uci: string;
  readonly san: string;
}

/** One row of the move list: the move number, White's move if there is one, and Black's. */
export interface MoveRow {
  readonly number: number;
  readonly white: MoveRef | null;
  readonly black: MoveRef | null;
}

/**
 * The move list as a board draws it: numbered rows, White's move left and
 * Black's right.
 *
 * `uci` and `san` are parallel — `gameStatus` answers both from one pass — and a
 * list that somehow disagreed is cut at the shorter of the two rather than
 * drawn with a blank half.
 */
export function moveRows(uci: readonly string[], san: readonly string[]): MoveRow[] {
  const count = Math.min(uci.length, san.length);
  const rows: MoveRow[] = [];
  for (let ply = 0; ply < count; ply += 1) {
    const ref: MoveRef = { ply: ply + 1, uci: uci[ply] ?? "", san: san[ply] ?? "" };
    if (ply % 2 === 0) {
      rows.push({ number: ply / 2 + 1, white: ref, black: null });
    } else {
      const last = rows[rows.length - 1];
      if (last === undefined) rows.push({ number: ply / 2 + 1, white: null, black: ref });
      else rows[rows.length - 1] = { ...last, black: ref };
    }
  }
  return rows;
}

/**
 * Where a move-list control lands: the first ply, the previous one, the next one,
 * or the end. The names are the ones the copy table's own controls carry, so a
 * button's label and the jump it makes cannot be two different words.
 */
export type PlyJump = "first" | "previous" | "next" | "last";

/**
 * The ply a navigation control selects, clamped to `0..total`.
 *
 * Ply 0 is the START position — a real place the board can stand, and the one a
 * „first" press has to reach — so the range is one longer than the move count.
 */
export function plyAfter(current: number, action: PlyJump, total: number): number {
  const last = Math.max(0, total);
  const now = Math.min(Math.max(current, 0), last);
  if (action === "first") return 0;
  if (action === "last") return last;
  if (action === "previous") return Math.max(0, now - 1);
  return Math.min(last, now + 1);
}
