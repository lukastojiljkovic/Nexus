# PRD 18 — Habits (HABIT) — compact (C-tier)

**Status:** draft 2026-07-05. Inputs: raw-spec §26, mood/energy journal idea,
study-hub research (gentle gamification).

## Purpose

Daily habit building with streaks and stats, plus the 10-second mood/energy
journal — the consistency layer of sustainable productivity.

## Functional requirements

- **HABIT-001 (M)** Habits: name, icon/color, schedule (daily / X per week /
  specific days), optional target quantity (2L vode), reminder (NTF),
  archive.
- **HABIT-002 (M)** Check-in UX: one-tap complete from module, dashboard
  widget, or notification action; backfill yesterday allowed (honesty over
  streak-guilt).
- **HABIT-003 (M)** Streaks: current/best, **repairable** (one skip token
  per habit per month, explicit) — no shaming copy ever (research-backed
  gentle model).
- **HABIT-004 (M)** Stats: completion heatmap (chart kit), per-habit trend,
  weekly summary.
- **HABIT-005 (S)** Mood/energy dnevnik: 10-second daily entry (1–5 mood,
  1–5 energy, optional note); private-by-default visibility (excluded from
  SRCH by default).
- **HABIT-006 (C)** Correlations view (habit adherence × mood × study hours)
  — post-v1 with STATS.

## Integrations

DASH (streak widget, check-in quick action); NTF (reminders, check-in
action); STATS (correlations later); STUDY (habit "uči 1h" can bind to
logged focus time — auto-complete).

## Edge cases

Timezone-safe day boundary (same rule as STUDY); vacation mode (pause all,
streaks frozen); habit schedule change mid-week recomputes expected days
prospectively only; deleting a habit archives history.

## Open questions

1. Skip-token default (1/month) — tune in beta.
2. Mood journal in HABIT vs HLTH — kept here (founder note logs it with
   habits); revisit if HLTH grows.
