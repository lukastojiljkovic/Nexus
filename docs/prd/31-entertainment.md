# PRD 31 — Entertainment & Boosters (FUN) — compact (C-tier)

**Status:** draft 2026-07-05. Inputs: raw-spec 2026-07-04 ideas
(entertainment sekcija, productivity boosters), canvas of prior discussion:
small curated set done properly, positioned as break tool.

## Purpose

Quality breaks: a small set of excellent offline mini-games plus non-game
boosters, integrated into Pomodoro breaks — rest as part of the system,
never a distraction engine.

## Functional requirements

- **FUN-001 (M)** Sudoku: real generator with graded difficulties (easy→
  expert), pencil marks, hints (bounded), undo, daily puzzle; per SEC no
  network needed.
- **FUN-002 (M)** One card game v1: Solitaire (Klondike) with proper drag
  physics/animations per motion budget.
- **FUN-003 (M)** Booster framework: Pomodoro break (UTIL-002) offers a
  booster card — game (time-boxed to break length), stretching prompt, eye
  rest (20-20-20), breathing, hydration nudge; always skippable, never
  auto-launching.
- **FUN-004 (M)** Break time-boxing: games launched from a break end/pause
  at break end (gentle, one-tap extend) — the anti-distraction guarantee.
- **FUN-005 (S)** Stats via existing system: puzzles solved, streak on
  daily sudoku (gentle model per HABIT-003 rules).
- **FUN-006 (C)** Additional games (minesweeper, 2048-class) — only when
  each meets the polish bar; never a shallow arcade.

## Integrations

UTIL (Pomodoro breaks); STUDY (break context); STATS (play stats); SET
(module + per-booster toggles); design system (games are themed, not
foreign bodies).

## Edge cases

Game in progress at break end → state saved, resume next break; FUN
disabled mid-Pomodoro → boosters silently skip; daily puzzle offline streak
— local clock rules (HABIT day boundary).

## Open questions

1. ~~Positioning check.~~ **Confirmed (founder 2026-07-05): FUN hidden by
   default and never suggested during onboarding — discovery/settings
   module only.**
