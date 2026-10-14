import { cardCode, type Card, type Suit } from "@nexus/core";
import type { ReactNode } from "react";
import { copy } from "./copy.js";

/**
 * The card itself, and the slot it lies in (ADR-090 stage 2).
 *
 * **A control is drawn ONCE, and a card is not always one.** A slot renders its
 * children as they are, and takes a `target` when the whole slot is a place a card
 * can go — which is how an EMPTY column can be a target at all, a thing no card
 * could otherwise be. A board that needs each card to be addressable gives each
 * card a button itself, so a stack of overlapping cards is still one control per
 * card for a keyboard, and never a nested button for a pointer.
 *
 * **A card's accessible name is the whole card** („As pik", „Ace of spades"), which
 * is the one thing the picture cannot say to somebody who cannot see it. A
 * face-down card says so instead of naming a card nobody can see.
 *
 * **Colour is never the only channel.** The suit's own glyph is drawn on every card
 * and `data-colour` carries the red/ink distinction to the stylesheet's semantic
 * tokens, so nothing here names a hue (`check:colours`).
 */

/** The four suits' own signs, for the corner of a card. */
const SUIT_GLYPH: Record<Suit, string> = {
  clubs: "\u2663",
  diamonds: "\u2666",
  hearts: "\u2665",
  spades: "\u2660",
};

/** The whole card in words, in the language being read: „As pik" / „Ace of spades". */
export function cardLabel(card: Card): string {
  return `${copy.card.rank[String(card.rank) as keyof typeof copy.card.rank]} ${copy.card.suit[card.suit]}`;
}

/** The suit's sign, for a legend or a one-character badge. */
export function suitGlyph(suit: Suit): string {
  return SUIT_GLYPH[suit];
}

export interface CardFaceProps {
  readonly card: Card;
  readonly faceUp: boolean;
  /** How the card is drawn: plain, the last move's card, the chosen one, or part of a run. */
  readonly state?: "plain" | "last" | "selected" | "run";
}

/** One card, as a picture. It is a control only when `CardButton` wraps it. */
export function CardFace({ card, faceUp, state = "plain" }: CardFaceProps) {
  const className = ["cards__card", faceUp ? "cards__card--up" : "cards__card--down"]
    .concat(
      state === "last"
        ? ["cards__card--last"]
        : state === "selected" || state === "run"
          ? ["cards__card--selected"]
          : [],
    )
    .join(" ");
  if (!faceUp) {
    return (
      <div className={className} aria-hidden="true">
        <span className="cards__back" />
      </div>
    );
  }
  return (
    <div className={className} data-colour={colourAttribute(card.suit)} aria-label={cardLabel(card)}>
      <span className="cards__rank">{printRank(card)}</span>
      <span className="cards__suit" aria-hidden="true">
        {SUIT_GLYPH[card.suit]}
      </span>
    </div>
  );
}

/** A face-up card that is a button: one target per card, so a stack stays reachable. */
export interface CardButtonProps {
  readonly card: Card;
  readonly onClick: () => void;
  readonly state?: CardFaceProps["state"];
  readonly pressed?: boolean;
}

export function CardButton({ card, onClick, state = "plain", pressed }: CardButtonProps) {
  const className = ["cards__card", "cards__card--up"]
    .concat(
      state === "last"
        ? ["cards__card--last"]
        : state === "selected" || state === "run"
          ? ["cards__card--selected"]
          : [],
    )
    .join(" ");
  return (
    <button
      type="button"
      className={className}
      data-colour={colourAttribute(card.suit)}
      aria-label={cardLabel(card)}
      aria-pressed={pressed}
      onClick={onClick}
    >
      <span className="cards__rank">{printRank(card)}</span>
      <span className="cards__suit" aria-hidden="true">
        {SUIT_GLYPH[card.suit]}
      </span>
    </button>
  );
}

/** The rank as the table prints it: `A`, `2`…`9`, `10`, `J`, `Q`, `K`. */
function printRank(card: Card): string {
  const code = cardCode(card)[0] ?? "";
  return code === "T" ? "10" : code;
}

function colourAttribute(suit: Suit): "red" | "black" {
  return suit === "diamonds" || suit === "hearts" ? "red" : "black";
}

/**
 * One place in a layout — a column, a cell, a foundation, the waste — that holds a
 * stack of cards.
 *
 * `target` is the slot's own control, drawn when the whole slot is a destination.
 * `accepts` draws a destination whose own cards take the click, so it stays a group.
 * `ariaLabel` names a slot that is not itself a control („Tref: prazno").
 */
export interface CardSlotProps {
  readonly title: string;
  /** Vertical overlap, for a tableau column: the cards lie on one another. */
  readonly stack?: boolean;
  readonly marked?: boolean;
  readonly target?: { readonly onClick: () => void } | undefined;
  readonly accepts?: boolean;
  readonly label?: string | undefined;
  readonly children: ReactNode;
}

export function CardSlot({ title, stack = false, marked = false, target, accepts = false, label, children }: CardSlotProps) {
  const className = [
    "cards__slot",
    marked ? "cards__slot--last" : undefined,
    stack ? "cards__slot--stack" : undefined,
    accepts ? "cards__slot--target" : undefined,
  ]
    .filter((entry): entry is string => entry !== undefined)
    .join(" ");
  if (target !== undefined) {
    return (
      <button type="button" className={`${className} cards__slot--target`} aria-label={label ?? title} onClick={target.onClick}>
        {children}
      </button>
    );
  }
  return (
    <div className={className} role="group" aria-label={label ?? title}>
      {children}
    </div>
  );
}

/** The empty-slot mark, drawn where a slot has no card at all. */
export function EmptySlot() {
  return <span className="cards__empty" aria-hidden="true" />;
}
