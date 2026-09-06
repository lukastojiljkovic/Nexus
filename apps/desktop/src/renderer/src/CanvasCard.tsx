import type { CanvasRef } from "@nexus/core";
import type { CanvasCardInteraction, CanvasCardView } from "./canvasCards.js";
import { strings } from "./strings.js";

/**
 * One card on „Tabla" (CANV slice c) — a Nexus object drawn where Excalidraw
 * would otherwise have put an iframe.
 *
 * **This component may never fail to render, and that is a security property
 * rather than a style rule.** The editor's call site is, verbatim from the
 * installed `dist/prod/index.js`:
 *
 * ```
 * (Et(a)?this.props.renderEmbeddable?.(a,this.state):null)??Ie("iframe",{…,src:p?.type!=="document"?p?.link??"":void 0,…})
 * ```
 *
 * — a NULLISH return falls through to a real `<iframe>` pointed at the element's
 * link, inside a sandboxed renderer. So every path through this file returns an
 * element: `canvasCardView` is total over `string | null | undefined`, the switch
 * below covers its four arms, and `canvasCards.test.ts` proves the first half
 * rather than this file's reader having to trust the second.
 *
 * **What the refusal arm is actually for.** `validateEmbeddable` is
 * `isCanvasRefText` and nothing else, and the editor only mounts an overlay for
 * an embeddable whose validation status is `true` (`renderEmbeddables()` filters
 * on `embedsValidationStatus.get(a.id)===!0`), so in ordinary use a foreign link
 * never reaches this component OR an iframe — it is simply not drawn. The
 * „foreign" arm exists because that status is cached BY ELEMENT ID and computed
 * once (`updateEmbeddables` only asks when `!embedsValidationStatus.has(n.id)`),
 * so a link that changed under an id that was already approved is a state the
 * cache admits. Defence in depth for a narrow window, said plainly rather than
 * left as a `null`.
 *
 * **The two-click gesture is the editor's, not ours.** Excalidraw keeps an
 * embeddable's DOM inert (`pointerEvents` disabled) until `activeEmbeddable`
 * names it „active", which a short click in its middle third does; hovering
 * that middle third first marks it „hover". So a card takes one click to arm
 * and a second to press. Fighting that would mean intercepting pointer events on
 * the canvas, which is the editor's own input pipeline. What we do change is the
 * HINT it draws on hover: upstream's is the English
 * `buttons.embeddableInteractionButton`, so `app.css` hides it and this draws
 * the Serbian one in its place — the same trade `CanvasToolbar` makes for the
 * whole of the editor's chrome.
 *
 * Purely presentational: every decision arrives as a prop, and the actions are
 * the page's (`CanvasPage` owns the editor and the intents alike).
 */

export interface CanvasCardProps {
  /** The element this card is drawn for — the id is what „Ukloni karticu" removes. */
  elementId: string;
  view: CanvasCardView;
  interaction: CanvasCardInteraction;
  /** Follows the pointer: the object's own module's page reveals it (021-e's intents). */
  onOpen: (ref: CanvasRef) => void;
  /** Takes the card off the board. Never called by Nexus itself — see „missing" below. */
  onRemove: (elementId: string) => void;
}

export function CanvasCard({ elementId, view, interaction, onOpen, onRemove }: CanvasCardProps) {
  const s = strings.canvas.card;

  return (
    <div className={cardClass(view.state, interaction)}>
      {view.state !== "foreign" && (
        <span className="canv-card__kind">{strings.search.kindSingular[view.ref.kind]}</span>
      )}

      {view.state === "ready" && (
        <>
          <p className="canv-card__title">{view.title}</p>
          {view.detail !== null && <p className="nx-hint">{view.detail}</p>}
          <div className="canv-card__actions">
            <button
              type="button"
              className="canv-card__action"
              onClick={() => onOpen(view.ref)}
            >
              {s.open}
            </button>
          </div>
        </>
      )}

      {view.state === "loading" && <p className="nx-hint">{strings.app.loading}</p>}

      {/*
        Said, never acted on. A card whose object is gone is still a card the
        user put there, and pruning it for them would be Nexus deciding that a
        deleted note means a deleted card. So the board keeps it and offers the
        removal instead.
      */}
      {view.state === "missing" && (
        <>
          <p className="canv-card__title">{s.missingTitle}</p>
          <p className="nx-hint">{s.missingBody}</p>
          <div className="canv-card__actions">
            <button
              type="button"
              className="canv-card__action"
              onClick={() => onRemove(elementId)}
            >
              {s.remove}
            </button>
          </div>
        </>
      )}

      {view.state === "foreign" && (
        <>
          <p className="canv-card__title">{s.foreignTitle}</p>
          <p className="nx-hint">{s.foreignBody}</p>
          <div className="canv-card__actions">
            <button
              type="button"
              className="canv-card__action"
              onClick={() => onRemove(elementId)}
            >
              {s.remove}
            </button>
          </div>
        </>
      )}

      {interaction === "hint" && <p className="canv-card__hint">{s.hint}</p>}
    </div>
  );
}

/**
 * The card's classes: one for the state it is in, one for whether the editor has
 * armed it.
 *
 * Armed is an ACCENT BORDER and nothing else — the drop-target rule, which is
 * the closest thing this app has to „this element is now taking your clicks".
 * No glow, no inset bar.
 */
function cardClass(state: CanvasCardView["state"], interaction: CanvasCardInteraction): string {
  const armed = interaction === "active" ? " canv-card--active" : "";
  return `canv-card canv-card--${state}${armed}`;
}
