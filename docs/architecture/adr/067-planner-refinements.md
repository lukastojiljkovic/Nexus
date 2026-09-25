# ADR-067 — The two planner refinements: „Vrati u plan" and „Nedostupan špil" (no migration, no interchange change)

**Status:** accepted (2026-07-31) · **Owner:** supervisor · **Based on:** the
remainders ADR-063 recorded when the topic-aware planner closed STUDY-003/004/005.
Both columns already exist (migration 046), so neither needs schema change.

## 1. The un-cut path — a decision the user can take back

ADR-063's central honesty move was that **the machine never applies a scope
cut**: it proposes, and `PlanStore.acceptScopeCut` — the single writer of
`exam_topics.cut` — records that the user accepted. That made „cut" a decision
rather than a drift, and it left „Vrati u plan" honestly disabled, because a
decision you cannot reverse is not really a decision.

So the store gains the inverse, and it is deliberately built as the *mirror* of
`acceptScopeCut` rather than a second idiom: same transaction shape, same
profile scoping, same clock handling, same named refusals (not this profile's
id; an id that is not cut; an exam with no cut topics), same return value — the
fresh effective list and plan health — so the renderer never has to guess what
changed. `cut` now has exactly two writers, one per direction, and no third way
in.

**The consequence must stay visible.** Bringing a topic back can push the plan
over capacity again, and ADR-063's redistribution already reports overflow as a
number rather than silently absorbing it. The arc that proves the feature is
therefore the round trip: cut → over-capacity proposal → accept → un-cut → the
topic is generated again and the proposal names it again.

> **Correction (2026-07-31, found by the lane and pinned by test).** The
> overflow *number* is invariant to scope cuts, so the round trip above cannot
> be written as "the overflow returns". The engine consumes 100% of every day's
> capacity — recall absorbs whatever the coverage passes leave — so
> `overflowMinutes` equals the unabsorbable *missed backlog* on both the capped
> and the uncapped path. Cutting a topic frees no capacity: the survivors'
> budgets simply grow, and no missed row goes away. The scope-cut conversation
> therefore changes **which topics get the time**, not **how much backlog is
> unabsorbable** — worth knowing before anyone reads the number as "what
> cutting saved you". Recorded here as an ADR-063 observation; the test pins
> the invariance explicitly rather than leaving it to be rediscovered.

**Where the wire lives.** `topics:restore-to-plan`, not a `plans:*` sibling.
A topic can be cut and its plan then deleted, after which the exam's topics
editor is still reachable from the add-plan form — and a cut topic is excluded
from a brand-new plan's generation too. A `planId`-carrying channel would have
put „Vrati u plan" back into the disabled state exactly where the user most
needs it. The store method keeps the mirror shape (an id array, one
transaction, void); only the wire is per-topic, and it answers with the fresh
effective list every other `topics:*` channel already returns.

UI: a cut topic's row carries a muted „Isečeno" chip and the now-live „Vrati u
plan" action; the health line reports how many topics are cut; the restore
re-runs the *same* refresh path the accept flow runs — one code path for "the
plan changed", not two that can disagree.

## 2. „Nedostupan špil" — telling the user why the signal went quiet

`TopicStore.resolveDeck` validates a `deckId` **at set time only**. A deck
deleted afterwards leaves a live topic pointing at a dead deck, and the user is
never told.

> **Correction (2026-07-31, found by the lane and pinned by test).** This ADR
> first claimed the derivation "finds nothing and the topic falls back to its
> manual confidence". It does not. `DeckStore.softDelete` does not cascade to
> `cards`, and the census and again-rate queries filter on the *card's* own
> `deleted_at`, not the deck's — so a topic linked to a deleted deck **keeps
> deriving the same number**. The defect is therefore not a signal that went
> quiet; it is a picker that silently showed a deck which no longer exists, and
> a confidence still being derived from a deck the user believes they deleted.
> Whether a soft-deleted deck's cards *should* keep feeding confidence is a
> separate question — it is consistent with the deck delete being undoable, so
> the derivation is left exactly as it was and the question is recorded for the
> founder rather than answered by a lane.

> **Amendment (2026-07-31, founder decision).** Asked directly, the founder
> chose to end the inconsistency: **a soft-deleted deck stops feeding derived
> confidence.** A topic whose link no longer resolves to an active deck derives
> nothing and falls back to its manual confidence, or to null — the same answer
> a topic with no link at all gives — so the „Nedostupan špil" chip and the
> weakness column can no longer say opposite things about the same row. The
> stored link is untouched (this is a read-path rule, not a write), and because
> the deck delete is soft, restoring the deck restores the derivation with no
> further action. The liveness set is the one already resolved per exam in a
> single query, so nothing becomes an N+1.

- Liveness is reported **on the record the UI already receives** — one boolean
  beside the existing fields. Not a second query the callers must remember to
  make, and not an N+1: it resolves for the whole listed set in one query, in
  the same shape as the store's existing batch derivation.
- The derivation itself is untouched. What changes is that the user is told: a
  muted „Nedostupan špil" chip on the row, and the topic's deck picker offering
  to clear the link (through the existing `setDeck(id, null)`) or pick a live
  deck.

## 3. Consequences

- No migration, no interchange change, no new stored state — `cut` and `deck_id`
  are both already there and both already travel.
- One new channel for the un-cut path, validated exactly like its sibling.
- The one planner item still deliberately out is **per-topic estimated minutes**,
  refused in v1 because weight derives from confidence; that refusal stands
  until the founder asks for it, and is recorded here so it is not mistaken for
  an oversight.
