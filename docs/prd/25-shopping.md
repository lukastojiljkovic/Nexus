# PRD 25 — Shopping & Wishlist (SHOP) — compact (C-tier)

**Status:** draft 2026-07-05. Inputs: raw-spec §26 (shopping lista,
wishlist), gifts idea, meal-planner idea.

## Purpose

Three related lists: groceries (fast, checkable, sharable later), wishlist
(want-to-buy with prices), and gifts (people × occasions × ideas × budget).

## Functional requirements

- **SHOP-001 (M)** Shopping lists: multiple named lists, quick-add with
  autocomplete from history, quantities/units, check-off UX built for the
  store aisle (large targets, recently-checked undo), completed items
  collapse.
- **SHOP-002 (M)** Wishlist: items with price, link, priority, saved-toward
  note; optional FIN savings-goal link (GOAL-003 measure).
- **SHOP-003 (S)** Gifts tracker: people (CAL birthdays link), occasion,
  ideas list, chosen gift, budget vs spent, "nabavi do" reminder ladder —
  the raw-spec gifts idea realized.
- **SHOP-004 (S)** Meal-planner feed: FIT saved meals/recipes → ingredient
  aggregation into a shopping list (raw-spec meal-planner idea; recipe
  composition data from FIT-003).
- **SHOP-005 (C)** Store-section sorting of grocery lists (user-taught
  order per store).

## Integrations

FIT (ingredients); CAL (birthdays, occasions); FIN (wishlist prices, gift
budgets); NTF (gift deadlines); SHARE (shared grocery list — the killer
household feature, but requires cloud + live-ish sync: v1 read-only share,
true co-editing with SHARE-010).

## Edge cases

Duplicate merge on add (mleko + mleko → qty 2 prompt); unit mismatches in
meal aggregation (g + kom) → grouped not summed; person removed → gift
history kept anonymized-locally.

## Open questions

1. ~~Grocery co-editing priority.~~ **Decided (founder 2026-07-05): pull
   real-time co-editing forward for grocery lists only** — the single
   realtime surface in v1 scope planning; SHARE-010 otherwise stays
   post-v1. Roadmap sequences it after core SHARE ships.
