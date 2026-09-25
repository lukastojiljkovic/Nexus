# PRD 34 — Automation (AUTO) — compact (C-tier)

**Status:** draft 2026-07-05. Inputs: raw-spec §26 (trigger → action
example), SEC-EXT sandbox spirit (user rules are constrained, not code).

## Purpose

Cross-module glue rules: "kad se desi X → uradi Y" from a curated trigger/
action catalog — declarative, safe, local. Not a scripting engine (that's
PLUG's future job).

## Functional requirements

- **AUTO-001 (M)** Rule builder: trigger (from catalog: task completed with
  tag, habit streak hit N, exam ≤ 7 days, budget envelope > 90%, document
  expiry status change, timer stopped…) + optional condition + action(s)
  (create task, send notification, add calendar event, tag entity, mark
  milestone, enable widget) — all declarative, versioned like ONB mapping.
- **AUTO-002 (M)** Execution: local, synchronous with the triggering event
  or on next app activity; execution log (šta je pokrenuto, kada, zašto)
  with per-rule disable.
- **AUTO-003 (M)** Safety rails: no loops (rule actions can't trigger rules
  transitively beyond depth 1 v1), rate cap per rule, dry-run preview when
  saving.
- **AUTO-004 (S)** Starter recipes gallery (founder-curated): "završi
  zadatak sa #milestone → označi milestone u GOAL → notifikacija" (the
  raw-spec example verbatim), "registracija ističe → kreiraj task".
- **AUTO-005 (C)** Time-based triggers (svakog ponedeljka u 8) — overlaps
  recurring tasks; catalog-gated to avoid duplication confusion.

## Integrations

Trigger/action providers registered by modules (same pattern as widgets/
stats contracts); NTF (action + storm guard applies); STATS (execution
counts).

## Edge cases

Rule references deleted entity → auto-pause with notice; conflicting rules
→ deterministic order (creation time) + log transparency; sync: rules are
settings-class data, execution is device-local (no double-fire across
devices — executed-marker synced).

## Open questions

1. ~~v1 catalog size.~~ **Confirmed (founder 2026-07-05): ~10 triggers,
   ~8 actions — depth via combinations, not surface area.**
