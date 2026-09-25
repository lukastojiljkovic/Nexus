# PRD 15 — Study Hub (STUDY)

**Status:** draft 2026-07-05. Inputs: raw-spec §5, `docs/research/study-hub.md`,
onboarding research (depth questions), MVP anchor (founder's exams
~mid-August 2026 are the success test).

## 1. Purpose

A complete studying system: subjects and exams, materials, plans that
survive reality, flashcards with modern spaced repetition, problem practice
for math-heavy subjects, and honest time tracking. STUDY is the MVP's
centerpiece module and the student persona's home.

## 2. User stories

- As a student, I want subjects with exams, materials, and notes in one
  place, so that each course has a single hub.
- As an exam-taker, I want a plan built backward from the exam date that
  replans when I slip, so that the plan stays alive.
- As a learner, I want FSRS-scheduled flashcards made inline in my notes,
  so that reviewing is efficient and card-making is free.
- As a math student, I want problem cards with worked solutions and mixed
  practice, so that I practice solving, not reciting.
- As a self-tracker, I want per-subject time stats from Pomodoro sessions,
  so that I know where my hours go.

## 3. User experience & flows

Subject hub page: exams (with countdowns), materials (files → DOC previews),
linked notes, decks, plan section, stats. **Exam planner:** create exam
(date, subject, scope) → enter available hours/week → planner generates
day-by-day plan (topics + spaced revision passes) as *managed* TASK items
and CAL blocks; missing a day triggers auto-replan (redistribute, warn if
target becomes unrealistic; exam-week switches to cram-priority mode).
**Review:** daily queue (FSRS) with load smoothing; review UI keyboard-first
(space reveal, 1–4 grade); problem cards render math (LaTeX) and show worked
solutions stepwise. **Practice sets:** interleaved problems across topics of
a subject. **Focus:** Pomodoro timer bound to subject (→ UTIL timer engine),
break slots offer boosters (FUN).

## 4. Functional requirements

### Structure
- **STUDY-001 (M)** Subjects with: name, color, semester/period, exams
  (multiple, dated, type: pismeni/usmeni/kolokvijum), materials
  (attachments), linked notes, decks, archived state.
- **STUDY-002 (M)** Exams shall appear on CAL with countdown chips and DASH
  countdown widgets.

### Planner
- **STUDY-003 (M)** Backward exam planning: inputs (exam date, topics list,
  available hours per weekday, current confidence per topic optional) →
  day-by-day plan with initial coverage + spaced revision passes; output as
  managed tasks (TASK contract: regenerable, pinnable per study-hub OQ#2)
  and calendar blocks.
- **STUDY-004 (M)** Auto-replan on slippage: uncompleted plan items
  redistribute over remaining days; if projected load exceeds available
  hours, the planner says so and proposes scope cuts (topics ranked by
  user-set priority) — honesty over fiction.
- **STUDY-005 (M)** Exam-week mode: final days prioritize weak topics and
  active recall over new coverage; visual mode change.

### Flashcards & SRS
- **STUDY-006 (M)** Card types: basic (front/back), cloze, and **problem
  card** (problem statement front; worked solution back, optionally
  stepwise). Math rendering (LaTeX) in all card fields (study-hub OQ#1 —
  scoped into v1).
- **STUDY-007 (M)** Scheduling via FSRS with target retention setting
  (default 0.9); per-deck or per-subject override; load smoothing and a
  catch-up mode that spreads backlog (avalanche mitigation).
- **STUDY-008 (M)** Cards link back to their source note/section when
  created inline (NOTE-006); orphan decks exist for standalone cards.
- **STUDY-009 (M)** Review sessions: keyboard-first grading, session caps,
  end-of-session summary; review history append-only (sync-trivial).
- **STUDY-010 (S)** Interleaved practice sets: user selects topics → mixed,
  randomized problem-card session (study-hub research conclusion #5).
- **STUDY-011 (S)** Anki `.apkg` import: basic + cloze note types v1, media
  included, styling not preserved (expectations per RemNote precedent);
  via IMEX.
- **STUDY-012 (C)** Image occlusion cards.

### Time & stats
- **STUDY-013 (M)** Pomodoro/focus sessions taggable by subject; stats:
  hours per subject/day/week, review counts, cards matured, plan adherence —
  charts via the chart kit; gentle streak (repairable, no shaming).
- **STUDY-014 (S)** Study log timeline per subject (sessions, reviews,
  plan events).

## 5. Options & settings

Target retention; daily review cap; new-cards-per-day; catch-up mode
behavior; Pomodoro durations (inherits UTIL defaults); planner defaults
(hours/weekday template); exam-week mode threshold (default 7 days).

## 6. Integrations

NOTE (inline card creation; notes attached to subjects); TASK/CAL (managed
plan items; exams on calendar); NTF (review nudge at preferred time, plan
reminders); DASH (Study today widget, countdowns); UTIL (timer engine);
FUN (boosters in breaks); IMEX (Anki import; study data export); DOC
(materials preview); SRCH (subjects, cards, materials indexed).

## 7. Edge cases & error states

- Exam date moved → planner regenerates with diff preview; history of the
  old plan kept.
- Two exams overlapping in time budget → planner allocates by priority and
  flags the conflict explicitly.
- 3-week gap (user was sick) → catch-up mode spreads backlog; streak repair
  offered once; no guilt copy.
- FSRS parameters personalize only after sufficient review history; until
  then defaults (study-hub OQ#5); parameter updates never invalidate
  history.
- Deleting a subject with cards/history → archive strongly suggested;
  deletion demands typed confirmation and exports history first.
- Card edited during review session → re-render, grading unaffected.
- Timezone shifts don't double/skip daily queues (day boundary = local
  midnight with grace).

## 8. Acceptance criteria (key)

- Creating "Algebra — pismeni 2026-08-17" with 6 topics and 2h/day yields a
  plan ending before the exam with ≥2 revision passes per topic; skipping
  two days produces a valid redistributed plan and a load warning if
  applicable.
- `::` card made in a note appears in the subject's deck and schedules per
  FSRS; grading it updates next due per target retention.
- A problem card with LaTeX (matrices, sums) renders correctly on desktop
  and web.
- 400-card backlog after 10 days away enters catch-up mode: daily queue
  stays ≤ configured cap while clearing within projected days shown to the
  user.
- Anki import of a basic+cloze deck with images produces reviewable cards
  with media; import report lists anything skipped.
- Study stats show per-subject hours matching logged Pomodoro sessions.

## 9. Open questions

1. Topic model granularity (flat topic list per exam vs hierarchical) —
   v1 flat, confirm with founder's real exam prep.
2. ~~Confidence self-rating at plan creation?~~ **Decided (founder
   2026-07-05): included, optional/skippable.**
3. Shared/community decks — post-v1 via SHARE; licensing of imported
   content is user's responsibility (ToS note).

## 10. Future extensions

AI: generate cards/problems from materials (AI module); handwriting/photo
solution capture; community deck library; SM-alternative schedulers as
plugins.
