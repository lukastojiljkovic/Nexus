# PRD 19 — Goals (GOAL) — compact (C-tier)

**Status:** draft 2026-07-05. Inputs: raw-spec §26 (SMART, OKR, milestones).

## Purpose

Long-horizon direction above daily tasks: SMART goals and lightweight OKRs
with milestones, linked to the work that advances them.

## Functional requirements

- **GOAL-001 (M)** Goals: title, description, category, target date,
  measurable target (number+unit / checklist / milestone list), status
  (aktivan/pauziran/ostvaren/napušten), review cadence.
- **GOAL-002 (M)** Milestones: ordered sub-targets with dates; progress
  roll-up to the goal.
- **GOAL-003 (M)** Progress sources: manual update, linked TASK completion
  (tasks tagged to a goal), linked HABIT adherence, linked FIN savings
  target — declarative links, not automation magic.
- **GOAL-004 (S)** OKR mode: objective + 3–5 key results (each a measurable
  target), quarterly framing; personal-scale copy (no corporate jargon).
- **GOAL-005 (S)** Review ritual: cadence-driven NTF prompt opens a review
  screen (progress, blockers note, adjust) — the feature that keeps goals
  alive.
- **GOAL-006 (C)** Goal → plan assist: break a goal into suggested tasks
  (heuristic v1; AI later).

## Integrations

TASK (linked tasks, progress); HABIT/FIN/STUDY (linked measures); DASH
(goal progress widget); CAL (target dates); NTF (review prompts); STATS
(yearly review).

## Edge cases

Measure changed mid-goal → history kept, chart annotated; overdue goal →
status prompt, never auto-fail; linked task deleted → progress recalcs.

## Open questions

1. ~~OKR in module v1?~~ **Decided (founder 2026-07-05): SMART + milestones
   first; OKR fast-follow.**
