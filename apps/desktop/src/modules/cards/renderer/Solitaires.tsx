import {
  isFreeCellMove,
  isKlondikeMove,
  isSpiderMove,
  type Card,
  type Suit,
} from "@nexus/core";
import { copy } from "./copy.js";
import { runFrom } from "./moves.js";
import type { CardSelection } from "./moves.js";
import type { CardSession } from "./rules.js";
import {
  FOUNDATIONS,
  boxKey,
  highlights,
  moveTo,
  type Box,
} from "./solitaire.js";
import { CardButton, CardFace, CardSlot, EmptySlot } from "./table.js";
import { TRIPEAKS_BASE, TRIPEAKS_MIDDLE, TRIPEAKS_TOP, triPeaksExposed } from "./cardParts.js";

/**
 * The six solitaires' tables (ADR-090 stage 2).
 *
 * **Every board is the same three steps.** It draws its boxes (a column, a cell, a
 * foundation, the stock, the waste), lights the ones the ENGINE's move list makes
 * pickable, and lights the destinations of the one card the person picked — all read
 * from `solitaire.ts`, so no board contains a rule. What differs between the six is
 * only the arrangement of the boxes.
 *
 * **A card that is not a control is still drawn.** A buried tableau card and a
 * face-down one are pictures: they are part of what the table looks like and cannot
 * be clicked, which is exactly what the engine's enumeration says about them.
 */

export interface SolitaireProps {
  readonly session: CardSession;
  readonly moves: readonly unknown[];
  readonly selected: CardSelection | null;
  readonly onSelect: (selection: CardSelection | null) => void;
  readonly onMove: (move: unknown) => void;
  readonly lastMove: unknown;
}

/** The click one box answers: play the selected card here, or pick this box up. */
function boxClick(
  props: SolitaireProps,
  box: Box,
  state: { readonly pickable: ReadonlySet<string>; readonly targets: ReadonlySet<string> },
): (() => void) | undefined {
  const key = boxKey(box);
  if (props.selected !== null && state.targets.has(key)) {
    const move = moveTo(props.session.game, props.moves, props.selected, box);
    return move === null ? undefined : () => {
      props.onSelect(null);
      props.onMove(move);
    };
  }
  if (state.pickable.has(key)) {
    return () => props.onSelect(props.selected !== null && boxKey(props.selected) === key ? null : box);
  }
  return undefined;
}

function marks(props: SolitaireProps): ReturnType<typeof highlights> {
  return highlights(props.session.game, props.moves, props.selected);
}

/** Whether a card face is the one the last move put down. */
function isLastCard(props: SolitaireProps, card: Card): boolean {
  const move = props.lastMove;
  if (move === null || typeof move !== "object") return false;
  const forward = (move as { kind?: unknown }).kind;
  if (forward === "play" || forward === "move" || forward === "match" || forward === "collect") {
    const named = (move as { card?: Card }).card;
    if (named !== undefined) return named.suit === card.suit && named.rank === card.rank;
  }
  return false;
}

// --- Klondike ---------------------------------------------------------------

export function KlondikeBoard(props: SolitaireProps) {
  const { session, moves } = props;
  const board = boardOf(session) as KlondikeTable;
  const state = marks(props);
  const plays = moves.filter(isKlondikeMove);
  const wasteTop = board.waste[board.waste.length - 1];

  return (
    <div className="cards__table">
      <div className="cards__row">
        <CardSlot
          title={`${copy.play.stock}: ${board.stock.length}`}
          marked={state.pickable.has("stock")}
          target={control(props, { kind: "stock" }, state)}
        >
          {board.stock.length === 0 ? <EmptySlot /> : <CardFace card={board.stock[board.stock.length - 1]!} faceUp={false} />}
        </CardSlot>
        <CardSlot title={copy.play.waste} target={control(props, { kind: "waste" }, state)}>
          {board.waste.length === 0 ? (
            <EmptySlot />
          ) : (
            <CardFace
              card={wasteTop!}
              faceUp
              state={wasteTop !== undefined && isLastCard(props, wasteTop) ? "last" : "plain"}
            />
          )}
        </CardSlot>
        {FOUNDATIONS.map((suit, index) => {
          const pile = board.foundations[index] ?? [];
          const top = pile[pile.length - 1];
          return (
            <CardSlot
              key={suit}
              title={`${copy.play.foundations}: ${copy.card.suit[suit]}`}
              target={control(props, { kind: "foundation", suit }, state)}
            >
              {top === undefined ? (
                <EmptySlot />
              ) : (
                <CardFace card={top} faceUp state={isLastCard(props, top) ? "last" : "plain"} />
              )}
            </CardSlot>
          );
        })}
      </div>
      <div className="cards__row cards__row--columns">
        {board.tableau.map((pile, column) => (
          <CardSlot
            key={column}
            title={`${copy.play.tableau} ${column + 1}`}
            stack
            target={pile.length === 0 ? control(props, { kind: "column", column }, state) : undefined}
          >
            {pile.length === 0 ? (
              <EmptySlot />
            ) : (
              pile.map((held, index) => (
                <TableauCard
                  key={index}
                  props={props}
                  box={{ kind: "column", column }}
                  held={held}
                  index={index}
                  plays={plays}
                />
              ))
            )}
          </CardSlot>
        ))}
      </div>
    </div>
  );
}

/**
 * One card in a tableau column.
 *
 * A card a click can pick up is a button; a buried or face-down one is a picture.
 * The pickable test is the engine's: a card is pickable when some legal move takes
 * exactly the cards from it to the foot of the column, which is what „a run" means
 * in Klondike and Spider.
 */
function TableauCard({
  props,
  box,
  held,
  index,
  plays,
}: {
  readonly props: SolitaireProps;
  readonly box: Box;
  readonly held: { readonly card: Card; readonly faceUp: boolean };
  readonly index: number;
  readonly plays: readonly unknown[];
}) {
  const column = box.kind === "column" ? box.column : 0;
  const pile = columnPile(props, column);
  const run = runFrom(pile, index);
  const inRun =
    props.selected !== null && props.selected.kind === "column" && props.selected.column === column;
  const pickable =
    held.faceUp &&
    run > 0 &&
    plays.some(
      (move) =>
        isKlondikeMove(move) &&
        move.kind === "move" &&
        move.from.kind === "tableau" &&
        move.from.column === column &&
        move.count === run,
    );
  if (!pickable) return <CardFace card={held.card} faceUp={held.faceUp} state="plain" />;
  return (
    <CardButton
      card={held.card}
      state={inRun ? "run" : "plain"}
      onClick={() => props.onSelect(inRun ? null : { kind: "column", column })}
    />
  );
}

// --- FreeCell ---------------------------------------------------------------

export function FreeCellBoard(props: SolitaireProps) {
  const board = boardOf(props.session) as FreeCellTable;
  const state = marks(props);
  return (
    <div className="cards__table">
      <div className="cards__row">
        {FOUNDATIONS.map((suit, index) => {
          const pile = board.foundations[index] ?? [];
          const top = pile[pile.length - 1];
          return (
            <CardSlot
              key={suit}
              title={`${copy.play.foundations}: ${copy.card.suit[suit]}`}
              target={control(props, { kind: "foundation", suit }, state)}
            >
              {top === undefined ? <EmptySlot /> : <CardFace card={top} faceUp />}
            </CardSlot>
          );
        })}
        {board.cells.map((held, cell) => (
          <CardSlot
            key={cell}
            title={`${copy.play.freeCells} ${cell + 1}`}
            target={control(props, { kind: "cell", cell }, state)}
          >
            {held === null ? <EmptySlot /> : <CardFace card={held} faceUp />}
          </CardSlot>
        ))}
      </div>
      <div className="cards__row cards__row--columns">
        {board.columns.map((pile, column) => (
          <CardSlot
            key={column}
            title={`${copy.play.columns} ${column + 1}`}
            stack
            target={pile.length === 0 ? control(props, { kind: "column", column }, state) : undefined}
          >
            {pile.length === 0 ? (
              <EmptySlot />
            ) : (
              pile.map((card, index) => (
                <TableauCard
                  key={index}
                  props={props}
                  box={{ kind: "column", column }}
                  held={{ card, faceUp: true }}
                  index={index}
                  plays={props.moves.filter(isFreeCellMove)}
                />
              ))
            )}
          </CardSlot>
        ))}
      </div>
    </div>
  );
}

// --- Spider -----------------------------------------------------------------

export function SpiderBoard(props: SolitaireProps) {
  const board = boardOf(props.session) as SpiderTable;
  const state = marks(props);
  const plays = props.moves.filter(isSpiderMove);
  return (
    <div className="cards__table">
      <div className="cards__row">
        <CardSlot
          title={`${copy.play.stock}: ${board.stock.length}`}
          marked={state.pickable.has("stock")}
          target={control(props, { kind: "stock" }, state)}
        >
          {board.stock.length === 0 ? <EmptySlot /> : <CardFace card={board.stock[board.stock.length - 1]!} faceUp={false} />}
        </CardSlot>
        <span className="cards__hint">{copy.play.runs}: {board.runs.length} / 8</span>
      </div>
      <div className="cards__row cards__row--columns">
        {board.columns.map((pile, column) => (
          <CardSlot
            key={column}
            title={`${copy.play.columns} ${column + 1}`}
            stack
            target={pile.length === 0 ? control(props, { kind: "column", column }, state) : undefined}
          >
            {pile.length === 0 ? (
              <EmptySlot />
            ) : (
              pile.map((held, index) => (
                <SpiderCard
                  key={index}
                  props={props}
                  column={column}
                  held={held}
                  index={index}
                  plays={plays}
                />
              ))
            )}
          </CardSlot>
        ))}
      </div>
    </div>
  );
}

function SpiderCard({
  props,
  column,
  held,
  index,
  plays,
}: {
  readonly props: SolitaireProps;
  readonly column: number;
  readonly held: { readonly card: Card; readonly faceUp: boolean };
  readonly index: number;
  readonly plays: readonly unknown[];
}) {
  const pile = columnPile(props, column);
  const run = runFrom(pile, index);
  const pickable =
    held.faceUp &&
    run > 0 &&
    plays.some(
      (move) =>
        isSpiderMove(move) &&
        move.kind === "move" &&
        move.from === column &&
        move.count === run,
    );
  const selected =
    props.selected !== null && props.selected.kind === "column" && props.selected.column === column;
  if (pickable) {
    return (
      <CardButton
        card={held.card}
        state={selected ? "run" : "plain"}
        onClick={() => props.onSelect(selected ? null : { kind: "column", column })}
      />
    );
  }
  return <CardFace card={held.card} faceUp={held.faceUp} state="plain" />;
}

// --- Pyramid ----------------------------------------------------------------

export function PyramidBoard(props: SolitaireProps) {
  const board = boardOf(props.session) as PyramidTable;
  const state = marks(props);
  return (
    <div className="cards__table">
      <div className="cards__row">
        <CardSlot
          title={`${copy.play.stock}: ${board.stock.length}`}
          marked={state.pickable.has("stock")}
          target={control(props, { kind: "stock" }, state)}
        >
          {board.stock.length === 0 ? <EmptySlot /> : <CardFace card={board.stock[board.stock.length - 1]!} faceUp={false} />}
        </CardSlot>
        <CardSlot title={copy.play.waste} target={control(props, { kind: "waste" }, state)}>
          {board.waste.length === 0 ? (
            <EmptySlot />
          ) : (
            <CardFace card={board.waste[board.waste.length - 1]!} faceUp />
          )}
        </CardSlot>
      </div>
      <div className="cards__pyramid">
        {PYRAMID_ROWS.map((row, rowIndex) => (
          <div className="cards__pyramid-row" key={rowIndex}>
            {row.map((slot) => {
              const held = board.cards[slot];
              const box: Box = { kind: "card", index: slot };
              const target = control(props, box, state);
              return (
                <CardSlot key={slot} title={`${copy.play.tableau} ${slot + 1}`} target={target}>
                  {held === undefined || held === null ? (
                    <EmptySlot />
                  ) : (
                    <CardFace card={held} faceUp state={isLastCard(props, held) ? "last" : "plain"} />
                  )}
                </CardSlot>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The pyramid's rows, as slot indices: row 0 is slot 0, row 6 is slots 21..27. */
const PYRAMID_ROWS: readonly (readonly number[])[] = (() => {
  const rows: number[][] = [];
  let first = 0;
  for (let row = 0; row < 7; row += 1) {
    rows.push(Array.from({ length: row + 1 }, (_, offset) => first + offset));
    first += row + 1;
  }
  return rows;
})();

// --- TriPeaks ---------------------------------------------------------------

export function TriPeaksBoard(props: SolitaireProps) {
  const board = boardOf(props.session) as TriPeaksTable;
  const state = marks(props);
  const layer = (slots: readonly number[], name: string) => (
    <div className="cards__peaks" key={name}>
      {slots.map((slot) => {
        const held = board.tableau[slot];
        const box: Box = { kind: "card", index: slot };
        const target = control(props, box, state);
        return (
          <CardSlot key={slot} title={name} target={target}>
            {held === undefined || held === null ? (
              <EmptySlot />
            ) : (
              <CardFace card={held} faceUp={triPeaksExposed(board.tableau, slot)} />
            )}
          </CardSlot>
        );
      })}
    </div>
  );
  return (
    <div className="cards__table">
      <div className="cards__row">
        <CardSlot
          title={`${copy.play.stock}: ${board.stock.length}`}
          marked={state.pickable.has("stock")}
          target={control(props, { kind: "stock" }, state)}
        >
          {board.stock.length === 0 ? <EmptySlot /> : <CardFace card={board.stock[board.stock.length - 1]!} faceUp={false} />}
        </CardSlot>
        <CardSlot title={copy.play.waste} target={control(props, { kind: "waste" }, state)}>
          {board.waste.length === 0 ? <EmptySlot /> : <CardFace card={board.waste[board.waste.length - 1]!} faceUp />}
        </CardSlot>
      </div>
      <div className="cards__row cards__row--columns">
        {layer(TRIPEAKS_TOP, copy.play.peaks)}
        {layer(TRIPEAKS_MIDDLE, copy.play.peaks)}
        {layer(TRIPEAKS_BASE, copy.play.tableau)}
      </div>
    </div>
  );
}

// --- Golf -------------------------------------------------------------------

export function GolfBoard(props: SolitaireProps) {
  const board = boardOf(props.session) as GolfTable;
  const state = marks(props);
  const base = board.foundation[board.foundation.length - 1];
  return (
    <div className="cards__table">
      <div className="cards__row">
        <CardSlot
          title={`${copy.play.stock}: ${board.stock.length}`}
          marked={state.pickable.has("stock")}
          target={control(props, { kind: "stock" }, state)}
        >
          {board.stock.length === 0 ? <EmptySlot /> : <CardFace card={board.stock[board.stock.length - 1]!} faceUp={false} />}
        </CardSlot>
        <CardSlot title={copy.play.base} target={control(props, { kind: "base" }, state)}>
          {base === undefined ? <EmptySlot /> : <CardFace card={base} faceUp state={isLastCard(props, base) ? "last" : "plain"} />}
        </CardSlot>
      </div>
      <div className="cards__row cards__row--columns">
        {board.columns.map((pile, column) => (
          <CardSlot
            key={column}
            title={`${copy.play.columns} ${column + 1}`}
            stack
            target={pile.length === 0 ? undefined : control(props, { kind: "column", column }, state)}
          >
            {pile.length === 0 ? (
              <EmptySlot />
            ) : (
              <CardFace card={pile[pile.length - 1]!} faceUp />
            )}
          </CardSlot>
        ))}
      </div>
    </div>
  );
}

// --- shared helpers ---------------------------------------------------------

/** The clickable half of a box, or undefined when the box is not a control right now. */
function control(
  props: SolitaireProps,
  box: Box,
  state: { readonly pickable: ReadonlySet<string>; readonly targets: ReadonlySet<string> },
): { readonly onClick: () => void } | undefined {
  const click = boxClick(props, box, state);
  return click === undefined ? undefined : { onClick: click };
}

function columnPile(props: SolitaireProps, column: number): readonly { readonly card: Card; readonly faceUp: boolean }[] {
  const board = boardOf(props.session) as {
    readonly tableau?: readonly (readonly { readonly card: Card; readonly faceUp: boolean }[])[];
    readonly columns?: readonly (readonly unknown[])[];
  };
  if (board.tableau !== undefined) return board.tableau[column] ?? [];
  const pile = board.columns?.[column] ?? [];
  return pile.map((held) =>
    typeof held === "object" && held !== null && "card" in held
      ? (held as { readonly card: Card; readonly faceUp: boolean })
      : { card: held as Card, faceUp: true },
  );
}

function boardOf(session: CardSession): unknown {
  return (session.state as { board: unknown }).board;
}

interface KlondikeTable {
  readonly tableau: readonly (readonly { readonly card: Card; readonly faceUp: boolean }[])[];
  readonly foundations: readonly (readonly Card[])[];
  readonly stock: readonly Card[];
  readonly waste: readonly Card[];
}
interface FreeCellTable {
  readonly columns: readonly (readonly Card[])[];
  readonly cells: readonly (Card | null)[];
  readonly foundations: readonly (readonly Card[])[];
}
interface SpiderTable {
  readonly columns: readonly (readonly { readonly card: Card; readonly faceUp: boolean }[])[];
  readonly stock: readonly Card[];
  readonly runs: readonly Suit[];
}
interface PyramidTable {
  readonly cards: readonly (Card | null)[];
  readonly stock: readonly Card[];
  readonly waste: readonly Card[];
}
interface TriPeaksTable {
  readonly tableau: readonly (Card | null)[];
  readonly waste: readonly Card[];
  readonly stock: readonly Card[];
}
interface GolfTable {
  readonly columns: readonly (readonly Card[])[];
  readonly foundation: readonly Card[];
  readonly stock: readonly Card[];
}
