# PRD 20 — Time Tracking (TIME) — compact (C-tier)

**Status:** draft 2026-07-05. Inputs: raw-spec §26 (rad, projekti, fokus),
finance research (freelancer adjacency), UTIL timer engine.

## Purpose

Where hours go: manual timers and entries per project/client/label — the
freelancer's billing base and everyone's focus mirror. Reuses the UTIL
timer engine; STUDY's focus time stays in STUDY (one-way visible here).

## Functional requirements

- **TIME-001 (M)** Projects (optional client, color, hourly rate optional)
  and time entries: start/stop timer or manual add (start, duration, note,
  labels); one running timer at a time with visible global indicator.
- **TIME-002 (M)** Idle detection (desktop): on return, keep/discard/split
  idle span — honesty tooling.
- **TIME-003 (M)** Reports: per project/label/day/week/month totals, chart
  kit views, CSV export (billing-ready when rate set).
- **TIME-004 (S)** Pomodoro sessions (UTIL) optionally log into a project.
- **TIME-005 (S)** Reminders: "timer još radi?" after configurable hours;
  "ništa nije logovano danas" opt-in nudge.
- **TIME-006 (C)** Calendar overlay of tracked time (CAL source toggle).

## Integrations

UTIL (timer engine); STUDY (read-only visibility of study focus totals);
FIN/PRO (billing export feeds freelancer pack invoicing later); DASH
(running timer widget); CAL (overlay); IMEX (Toggl-class CSV import prompt).

## Edge cases

Timer crosses midnight → split at day boundary for reports, entry intact;
device sleep during timer → idle flow; concurrent timer attempt → offer
switch (stop current); timezone travel — entries store UTC + zone.

## Open questions

1. Multiple simultaneous timers (agency edge case) — v1 no; revisit with
   PRO packs.
