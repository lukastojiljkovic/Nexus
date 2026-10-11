import {
  HEARTS_SEATS,
  SPADES_SEATS,
  isHeartsMove,
  isSpadesMove,
  isTablicMove,
  tablicSeats,
  type Card,
  type CardOpponentLevel,
  type HeartsState,
  type SpadesState,
  type TablicState,
} from "@nexus/core";
import { Button } from "@nexus/ui";
import { copy } from "./copy.js";
import type { CardSession } from "./rules.js";
import { CardButton, CardFace, cardLabel, CardSlot, EmptySlot } from "./table.js";

/**
 * The three games against the computer (ADR-090 stage 2).
 *
 * **A hidden-hand game is not a solitaire, and the difference is what this file
 * draws.** Everything a solitaire shows, the engine made public; here, the hands are
 * the player's own and the machine's are faces down, the trick in play is a row of
 * cards the seat order explains, and the only control is „which card do I play" —
 * every legal answer narrows to one card out of a hand, which the engines' move lists
 * already enumerate.
 *
 * **The page plays one seat and the worker plays the rest.** These boards never ask
 * the engine for a move: they draw the position and call back, and the page decides
 * whether the next action is a person's click or the computer's search.
 */

export interface TrickProps {
  readonly session: CardSession;
  readonly moves: readonly unknown[];
  readonly onMove: (move: unknown) => void;
  readonly lastMove: unknown;
  /** The cards a person has set aside for the pass, before committing to it. */
  readonly passSelection: readonly Card[];
  readonly onPassSelection: (cards: readonly Card[]) => void;
}

const seatName = (seat: number): string =>
  seat === 0 ? copy.play.you : copy.play.computer;

function sameCard(left: Card, right: Card): boolean {
  return left.suit === right.suit && left.rank === right.rank;
}

function trickCards(trick: readonly { readonly seat: number; readonly card: Card }[]): readonly { readonly seat: number; readonly card: Card }[] {
  return trick;
}

// --- Hearts -----------------------------------------------------------------

export function HeartsBoard(props: TrickProps) {
  const state = props.session.state as HeartsState;
  const board = state.board;
  const moves = props.moves.filter(isHeartsMove);
  const passing = board.phase === "passing";
  const hand = board.hands[0] ?? [];
  const trick = trickCards(board.trick as readonly { readonly seat: number; readonly card: Card }[]);
  const passMoves = moves.filter(
    (move): move is { readonly kind: "pass"; readonly cards: readonly Card[] } => move.kind === "pass",
  );
  const playMoves = moves.filter(
    (move): move is { readonly kind: "play"; readonly card: Card } => move.kind === "play",
  );
  const myPass = passing && passMoves.length > 0;
  const myTurn = !passing && playMoves.length > 0;
  const chosenKeys = new Set(props.passSelection.map((card) => `${card.suit}${card.rank}`));

  const pickCard = (card: Card): void => {
    if (myPass) {
      const already = props.passSelection.some((held) => sameCard(held, card));
      if (already) {
        props.onPassSelection(props.passSelection.filter((held) => !sameCard(held, card)));
        return;
      }
      if (props.passSelection.length >= 3) return;
      props.onPassSelection([...props.passSelection, card]);
      return;
    }
    const move = playMoves.find((entry) => sameCard(entry.card, card));
    if (move !== undefined) props.onMove(move);
  };

  return (
    <div className="cards__trick">
      <TrickRow trick={trick} title={copy.play.trick} />
      <div className="cards__row cards__row--hand">
        {hand.map((card, index) => (
          <HandCard
            key={`${card.suit}-${card.rank}-${index}`}
            card={card}
            clickable={myPass || (myTurn && playMoves.some((move) => sameCard(move.card, card)))}
            chosen={chosenKeys.has(`${card.suit}${card.rank}`)}
            onClick={() => pickCard(card)}
          />
        ))}
      </div>
      <div className="cards__row">
        {SEATS.slice(0, HEARTS_SEATS).map((seat) => (
          <span key={seat} className="cards__seat">
            {seatName(seat)}: {board.scores[seat] ?? 0}
          </span>
        ))}
        {myPass && (
          <span className="nx-hint">{copy.play.pickPass}</span>
        )}
        {board.heartsBroken && <span className="cards__seat">{copy.play.heartsBroken}</span>}
      </div>
      {myPass && props.passSelection.length === 3 && (
        <div className="cards__row">
          <Button
            variant="primary"
            onClick={() => {
              const move = passMoves.find(
                (entry) =>
                  entry.cards.length === 3 &&
                  entry.cards.every((card) => props.passSelection.some((held) => sameCard(held, card))),
              );
              if (move !== undefined) {
                props.onPassSelection([]);
                props.onMove(move);
              }
            }}
          >
            {copy.play.passThree}
          </Button>
        </div>
      )}
    </div>
  );
}

const SEATS = [0, 1, 2, 3] as const;

// --- Spades -----------------------------------------------------------------

export function SpadesBoard(props: TrickProps) {
  const state = props.session.state as SpadesState;
  const board = state.board;
  const moves = props.moves.filter(isSpadesMove);
  const hand = board.hands[0] ?? [];
  const plays = moves.filter((move): move is { readonly kind: "play"; readonly card: Card } => move.kind === "play");
  const bids = moves.filter((move): move is { readonly kind: "bid"; readonly bid: number } => move.kind === "bid");
  const bidding = board.phase === "bidding" && bids.length > 0;

  return (
    <div className="cards__trick">
      <TrickRow trick={trickCards(board.trick as readonly { readonly seat: number; readonly card: Card }[])} title={copy.play.trick} />
      <div className="cards__row cards__row--hand">
        {hand.map((card, index) => (
          <HandCard
            key={`${card.suit}-${card.rank}-${index}`}
            card={card}
            clickable={plays.some((move) => sameCard(move.card, card))}
            chosen={false}
            onClick={() => {
              const move = plays.find((entry) => sameCard(entry.card, card));
              if (move !== undefined) props.onMove(move);
            }}
          />
        ))}
      </div>
      {bidding && (
        <div className="cards__row cards__row--bids">
          {bids.map((move) => (
            <button
              key={move.bid}
              type="button"
              className="nx-segmented__option"
              onClick={() => props.onMove(move)}
            >
              {move.bid === 0 ? copy.moves.bidNil : copy.moves.bid.replace("{value}", String(move.bid))}
            </button>
          ))}
        </div>
      )}
      <div className="cards__row">
        {SEATS.slice(0, SPADES_SEATS).map((seat) => (
          <span key={seat} className="cards__seat">
            {seatName(seat)}: {board.scores[seat % 2] ?? 0} · {board.bids[seat] ?? 0}
          </span>
        ))}
        {board.spadesBroken && <span className="cards__seat">{copy.play.spadesBroken}</span>}
      </div>
    </div>
  );
}

// --- Tablić -----------------------------------------------------------------

export function TablicBoard(props: TrickProps) {
  const state = props.session.state as TablicState;
  const board = state.board;
  const seats = tablicSeats(props.session.variant === "pairs" ? "pairs" : "duo");
  const hand = board.hands[0] ?? [];
  const plays = props.moves.filter(
    (move): move is { readonly kind: "play"; readonly card: Card; readonly capture: readonly number[] } =>
      isTablicMove(move) && move.kind === "play",
  );
  const myTurn = board.seat === 0;

  return (
    <div className="cards__trick">
      <div className="cards__row">
        <CardSlot title={copy.play.table}>
          {board.table.length === 0 ? (
            <EmptySlot />
          ) : (
            board.table.map((card, index) => (
              <span className="cards__table-card" key={index}>
                <span className="cards__rank" aria-hidden="true">
                  {index + 1}
                </span>
                <CardFaceLite card={card} />
              </span>
            ))
          )}
        </CardSlot>
        <CardSlot title={`${copy.play.stock}: ${board.deck.length}`}>
          <EmptySlot />
        </CardSlot>
      </div>
      <div className="cards__row cards__row--hand">
        {hand.map((card, index) => (
          <HandCard
            key={`${card.suit}-${card.rank}-${index}`}
            card={card}
            clickable={myTurn && plays.some((move) => sameCard(move.card, card))}
            chosen={false}
            onClick={() => {
              const move = plays.find((entry) => sameCard(entry.card, card));
              if (move !== undefined && move.capture.length === 0) props.onMove(move);
            }}
          />
        ))}
      </div>
      {myTurn && (
        <div className="cards__row cards__row--bids">
          {captureChoices(plays).map((choice) => (
            <button
              key={choice.key}
              type="button"
              className="nx-segmented__option"
              onClick={() => props.onMove(choice.move)}
            >
              {choice.label}
            </button>
          ))}
        </div>
      )}
      <div className="cards__row">
        {SEATS.slice(0, seats).map((seat) => (
          <span key={seat} className="cards__seat">
            {seatName(seat)}: {board.scores[seat % 2] ?? 0}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Every capture a person's cards can make, as one button each.
 *
 * The engine enumerates the capture GROUPS (a card can take more than one
 * combination, and a player picks which), so this is the one place a move is more
 * than a card — and the buttons are the engine's own list rather than a choice the
 * page worked out.
 */
function captureChoices(
  plays: readonly { readonly kind: "play"; readonly card: Card; readonly capture: readonly number[] }[],
): readonly { readonly key: string; readonly label: string; readonly move: unknown }[] {
  const choices: { key: string; label: string; move: unknown }[] = [];
  for (const move of plays) {
    if (move.capture.length === 0) continue;
    choices.push({
      key: `${move.card.suit}${move.card.rank}-${move.capture.join("_")}`,
      label: `${cardLabel(move.card)} → ${move.capture.map((index) => index + 1).join(", ")}`,
      move,
    });
  }
  return choices;
}

// --- shared -----------------------------------------------------------------

/** The trick in play, in the order the cards fell. */
function TrickRow({
  trick,
  title,
}: {
  readonly trick: readonly { readonly seat: number; readonly card: Card }[];
  readonly title: string;
}) {
  return (
    <CardSlot title={title} label={title}>
      {trick.length === 0 ? (
        <EmptySlot />
      ) : (
        trick.map((entry, index) => (
          <span className="cards__table-card" key={index}>
            <span className="cards__seat">{seatName(entry.seat)}</span>
            <CardFaceLite card={entry.card} />
          </span>
        ))
      )}
    </CardSlot>
  );
}

function HandCard({
  card,
  clickable,
  chosen,
  onClick,
}: {
  readonly card: Card;
  readonly clickable: boolean;
  readonly chosen: boolean;
  readonly onClick: () => void;
}) {
  if (!clickable) return <CardFaceLite card={card} />;
  return <CardButton card={card} state={chosen ? "selected" : "plain"} pressed={chosen} onClick={onClick} />;
}

/** A card that is drawn but is not a control — anything in a trick, or a card that is not the player's turn. */
function CardFaceLite({ card }: { readonly card: Card }) {
  return <CardFace card={card} faceUp />;
}

/** The level a computer game opens at, read once so the page and the panel agree. */
export const DEFAULT_LEVEL: CardOpponentLevel = "medium";
