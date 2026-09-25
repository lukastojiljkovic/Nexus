# Research: Study Hub — Spaced Repetition, Exam Planning, Focus Tracking

**Domain:** flashcard/SRS systems, exam-preparation planners, study time
tracking.
**Session:** 2026-07-05 (research phase 1, session 4).
**Nexus context:** STUDY is an (M) module and the MVP's success test — the
founder runs his own exam prep (Algebra, Linear Algebra & Analytic Geometry,
Combinatorics & Graph Theory, ~mid-August 2026) entirely in Nexus. Spec asks
for study plans, exams, subjects, materials, flashcards, spaced repetition,
progress, time tracking, Pomodoro.

## 1. Conclusions

1. **Use FSRS, not SM-2, for scheduling — this is settled.** FSRS (Free
   Spaced Repetition Scheduler) fits a memory model (difficulty, stability,
   retrievability) to real review history; benchmarked on hundreds of
   millions of Anki reviews it needs roughly 20–30% fewer reviews than SM-2
   for the same retention and predicts recall more accurately for ~99.5% of
   users. Anki made it the default in v23.10 (Nov 2023); RemNote and newer
   apps have adopted it
   ([FSRS vs SM-2](https://flica.app/article/fsrs-vs-sm2),
   [Diane guide](https://www.diane.app/en/guides/fsrs-vs-sm2),
   [RemNote on FSRS](https://help.remnote.com/en/articles/9124137-the-fsrs-spaced-repetition-algorithm)).
   Open-source implementations exist (the open-spaced-repetition project,
   `ts-fsrs`) — verify license in the architecture phase, but there is no
   reason to implement SM-2 in 2026. User-facing knob: target retention
   (default 0.9).
2. **Create cards inside notes — the RemNote pattern is the all-in-one
   advantage.** RemNote turns a bullet into a card with `::` and cloze with
   `{{…}}`, merging note-taking and card creation into one step, versus
   Anki's read-then-retype workflow
   ([RemNote vs Anki](https://www.mindomax.com/remnote-vs-anki)). Nexus does
   the same in the NOTE editor: a card lives where the knowledge lives, and
   the Study Hub aggregates cards across notes per subject. This is exactly
   the kind of module integration no standalone flashcard app can match.
3. **Anki `.apkg` import is table stakes for serious students.** RemNote
   imports most Anki note types (basic, cloze, image occlusion) while
   custom CSS/JS doesn't carry over — set the same expectation
   ([RemNote Anki import](https://help.remnote.com/en/articles/6751471-importing-from-anki)).
   Scope v1 to basic + cloze; feeds the IMEX module.
4. **The exam planner works backward from the exam date.** The proven
   pattern (StudyPilot, MyStudyPlanner): enter exam dates, subjects, and
   available weekly hours → get a day-by-day plan with spaced revision
   passes built in, deadline-first with realistic daily loads
   ([StudyPilot](https://studypilot.site/),
   [MyStudyPlanner](https://www.mystudyplanner.online/blog/best-ai-study-planner-app-for-students-guide)).
   Nexus's planner emits real TASK items and CAL entries (not a parallel
   universe), and — critically — **auto-replans when days slip** instead of
   letting the plan die on first contact (see pitfalls).
5. **Math is not vocabulary — design for problem practice, not just recall.**
   The spacing effect holds for math, but with caveats: interleaved/random
   problem order beats blocked practice on delayed tests, and formula
   memorization must not be confused with procedural mastery; for math the
   recommended card form is a worked problem (problem front, full solution
   back) ([Justin Skycak on spaced repetition](https://www.justinmath.com/cognitive-science-of-learning-spaced-repetition/),
   [Brainscape on math SRS](https://www.brainscape.com/academy/spaced-repetition-math/)).
   Nexus adds a **problem-card type** and interleaved practice sets per
   subject — directly what the founder's three math exams need, and a real
   differentiator over vocabulary-oriented apps.
6. **Focus stats: honest analytics, gentle gamification.** Forest-style
   streaks help people start but push metric-chasing over learning quality;
   Toggl-style clean per-tag time reporting is what students actually keep
   using ([Athenify comparison](https://athenify.io/best-study-apps),
   [CuFlow on study trackers](https://cuflow.ai/blog/study-time-tracker)).
   Nexus: Pomodoro sessions tagged by subject → time-per-subject/week
   reports and a gentle streak, no leaderboards; break slots hook into the
   existing productivity-boosters decision.

## 2. Landscape

| Product | Model | Take for Nexus |
| --- | --- | --- |
| Anki | Pure SRS engine, FSRS default, huge shared-deck ecosystem, dated UX | The scheduler standard to match; import source |
| RemNote | Notes-with-cards knowledge system, FSRS option | The integration pattern to copy (cards born in notes) |
| Quizlet | Mass-market decks, freemium walls, weak SRS | What to avoid: engagement features over learning |
| StudyPilot / MyStudyLife | Exam planners (backward planning, day-by-day loads) | Planner mechanics; ours writes into TASK/CAL |
| Forest / Toggl | Focus gamification vs honest time analytics | Combine: tagged Pomodoro + clean reports, streak as garnish |

## 3. Expected feature checklist

**Table stakes:** subjects; exams with countdown (DASH widget); materials
attached per subject/topic (→ DOC previews); notes linked per topic (→ NOTE);
flashcards: basic + cloze, created inline in notes; FSRS queue with daily
review, load smoothing, and target-retention setting; study timer/Pomodoro
with per-subject stats; progress views (cards matured, hours per subject,
plan adherence). **Differentiators:** problem cards with worked solutions and
interleaved practice sets; exam planner that emits real tasks and auto-replans
on slippage; everything offline; canvas visualization of a subject's topics
(→ CANV note-mirror cards).

## 4. Offline-first implications

Entirely local-friendly: FSRS runs client-side; review logs are append-only
rows (trivial sync per `offline-sync.md`); decks/cards are structured rows,
review history never conflicts (append-only). Shared decks (post-v1, via
SHARE) would be read-only publications — no merge complexity.

## 5. Pitfalls

- **The overdue-card avalanche:** after a week off, a 400-card backlog kills
  motivation and the habit. Mitigations: load balancing/fuzz in scheduling, a
  catch-up mode that spreads backlog over days, and honest messaging over
  guilt-tripping.
- **Plans that die on first slip:** static day-by-day plans collapse when one
  day is missed; auto-replan (redistribute remaining work, flag if the target
  becomes unrealistic) is the feature that separates a used planner from an
  abandoned one.
- **Card-creation friction:** if making a card takes more than marking text
  in a note, users make ten cards and stop (why RemNote's inline syntax won).
- **Gamification backfire:** streak-chasing displaces learning; keep streaks
  soft (repairable, no shaming), stats primary.
- **Cramming reality:** near the exam date spaced schedules compress anyway —
  planner should switch to exam-priority mode rather than pretending
  long-term retention is the goal that week.

## 6. Open questions → PRD (STUDY)

1. Problem-card v1 format: plain text + images vs LaTeX/math rendering —
   math rendering is near-mandatory for the founder's subjects; scope it.
2. Planner ↔ TASK/CAL contract: planner-generated tasks editable like normal
   tasks, or managed (regenerated on replan)? Recommendation: managed, with
   manual pinning.
3. Default target retention (0.9) exposed at what level — per deck, per
   subject, global?
4. Anki import v1 scope: basic + cloze confirmed; media files in decks
   (audio/images) — include or defer?
5. FSRS implementation and parameter-fitting cadence (initial defaults →
   personal optimization after N reviews) — architecture phase, with license
   check of the open-spaced-repetition packages.
