# ADR-011 — Canvas Engine (Decision Deferred to Spikes)

**Status:** **CLOSED — the spikes were run and the decision is
[ADR-079](079-canvas-engine.md): Excalidraw, used as a canvas and not as a UI**
(2026-08-01) · protocol defined 2026-07-05

> Kept for the protocol, which did its job: the engine was chosen by running
> the candidates against the stated criteria rather than by reading their
> READMEs. The finding that decided it is in ADR-079 — Excalidraw ships 54
> locales, none of them Serbian and none addable, and its colour picker offers
> three of the hues this product bans, so it is driven through its imperative
> API behind our own toolbar with its chrome hidden.
**Drives:** CANV PRD (CANV-001..011); canvas research OQ#1.

## Context

Canvas research (2026-07-04) found the offline Milanote-class board is a
real market gap, and that the engine choice cannot be made on paper: the
candidates differ exactly on the dimensions only a prototype reveals
(theming depth, embed model, Yjs fit, perf under load). CANV is S-tier —
we can afford a deferred, evidence-based decision; we cannot afford a
wrong guess baked under a flagship feature.

## Candidates

1. **tldraw SDK** — most complete editor infrastructure; commercial
   license required to remove the watermark (research estimate ~$6k/yr —
   re-verify pricing at spike time); own sync story we would partially
   bypass in favor of Yjs; heavily recognizable default look (anti-slop
   mandate demands deep retheming).
2. **Excalidraw-derived** — MIT; hand-drawn aesthetic is opt-out-able but
   its element model is less designed for foreign embeds (our note-mirror
   cards, CANV-011 live embeds).
3. **Custom on Konva/Pixi** — full control over the object model
   (property-LWW in a Yjs map, exactly the research design), highest cost;
   only justified if both SDKs fail the embed or theming criteria.

## Spike protocol (timeboxed: 1 week per candidate, run before CANV work)

Each spike builds the same probe: a board with pan/zoom, 1,000 mixed
objects, one embedded live Nexus card (a real TASK list component), one
note-mirror card, Yjs persistence of object properties, and full retheme
to our tokens.

Scored exit criteria:

- 60 fps pan/zoom at 1k objects on reference hardware; memory footprint.
- Foreign-component embeds: first-class, hacky, or impossible.
- Yjs integration honesty: native store vs adapter complexity.
- Theming depth: can it stop looking like its default self (binding
  anti-generic requirement)?
- License total cost over 3 years + maintenance outlook.
- Freehand ink quality (CANV OQ#2) and board-size ceiling (CANV OQ#3) —
  measured, not guessed.

## Decision rule

Highest score wins **unless** custom is within striking distance on
effort — tie-breaker goes to the option with fewest external constraints
(license cost, upstream direction). Outcome recorded by updating this ADR
to *accepted* with the scores table; the loser spikes are kept as
reference branches.

## Sources

- `docs/research/infinite-canvas.md` (market gap, candidate analysis,
  object-model design, embed differentiator).
