# PRD 16 — Fitness Hub (FIT)

**Status:** draft 2026-07-05. Inputs: raw-spec §§14–15 + fitness razrada
(saved meals, Serbian markets), `docs/research/nutrition-data.md`, founder
decision #7 (reference-only, moderation, hybrid sourcing).

## 1. Purpose

One hub for training and nutrition: log workouts and meals with minimal
friction, track weight and goals, see progress — built on a provenance-
tracked food database with real Serbian retail coverage as the moat, and a
structured exercise base. All health data is reference-only by decision.

## 2. User stories

- As a lifter, I want to log exercises with sets/reps/kg fast (last-session
  memory), so that logging never interrupts training.
- As a meal-repeater, I want "jelo br. 1" saved meals, so that daily logging
  is one tap (founder's core UX).
- As a Serbian shopper, I want LIDL/Maxi/Roda/Idea products findable, so
  that tracking matches my real groceries.
- As a data-conscious user, I want to see where a food's numbers come from
  and report wrong ones, so that I can trust what I track.
- As a progress-tracker, I want weight, calories, and strength trends as
  charts, so that effort becomes visible.

## 3. User experience & flows

Two tabs: **Trening** and **Ishrana**, plus Pregled (charts). Trening:
workout templates (user-built or from exercise base), active-workout mode
(large touch targets, per-set logging with previous values ghosted, rest
timer), history per exercise with PR badges. Ishrana: daily log by meals
(doručak/ručak/večera/užina), add via search (foods + saved meals first),
recent/favorites, portion picker (per 100 g / per serving / custom), saved
meal builder (compose foods → name → one-tap logging), macro day summary
ring vs targets. Weight log with quick entry. Reference-only disclaimer at
first nutrition use; every food entry shows provenance badge + "prijavi
netačan podatak".

## 4. Functional requirements

### Nutrition
- **FIT-001 (M)** Food database per nutrition-data research: generic foods
  (USDA-derived, localized names), curated Serbian entries, user customs;
  provenance block mandatory per entry (source, link/photo, verification
  status, last-verified); OFF stays an isolated lookup source (research
  conclusion #3 — never merged).
- **FIT-002 (M)** Meal logging: per-day, per-meal entries with portion
  math; macro + kcal rollups vs user targets; day/week summaries.
- **FIT-003 (M)** Saved meals: named compositions of foods with default
  portions; one-tap log; editing a saved meal never rewrites past logs
  (logs snapshot composition).
- **FIT-004 (M)** Custom foods and "report incorrect data" on every entry →
  moderation queue (cloud) or local-only edit (local accounts).
- **FIT-005 (M)** Reference-only framing: disclaimer at first use, "values
  may differ from packaging" copy near macros (decision #7); no medical
  advice anywhere.
- **FIT-006 (M)** Targets: kcal + macro goals (manual v1; BMR/TDEE
  calculator as UTIL-integrated helper with formula disclosure).
- **FIT-007 (S)** Label-photo submission: photograph nutrition label →
  OCR/LLM extraction → prefilled custom food → optional submit to
  moderation (cloud) — the Serbian-coverage growth engine (research
  conclusion #5; recommended v1 of FIT).
- **FIT-008 (S)** Water intake quick log.

### Training
- **FIT-009 (M)** Exercise base: name (sr/en), muscle groups, equipment,
  instructions; curated starter set + user-added exercises.
- **FIT-010 (M)** Workouts: templates (exercises + target sets/reps/weight),
  active logging with previous-session ghost values, rest timer (NTF local),
  notes per set; history per exercise (all sets ever, PRs: max weight, reps,
  volume).
- **FIT-011 (M)** Weight/body log: weight (+ optional measurements) with
  trend chart (moving average, not day noise).
- **FIT-012 (S)** Workout programs (multi-week templates); profession/goal
  presets later via packs.

### Progress
- **FIT-013 (M)** Pregled charts (chart kit): weight trend, kcal/macros
  adherence, volume per muscle group per week, exercise PR progression.
- **FIT-014 (C)** Correlations with HABIT/mood journal (post-v1, STATS).

## 5. Options & settings

Units (kg/lbs; ml); meal names/count; macro target mode (grams/percent);
rest-timer defaults; disclaimer re-show.

## 6. Integrations

UTIL (BMR/TDEE calculators); SHOP (recept/saved-meal → shopping list via
meal-planner idea, post-v1); CAL (workout schedule as events, optional);
DASH (today's macros ring, next workout widgets); NTF (rest timer, meal
reminders opt-in); IMEX (MyFitnessPal-class import prompt; full export);
SRCH (foods, exercises, meals); moderation backend (cloud service — its own
lightweight spec in architecture).

## 7. Edge cases & error states

- Food found in OFF lookup but not curated DB → usable with OFF attribution
  badge; copying into curated store is a moderation action, not automatic
  (ODbL isolation).
- Portion edge cases: missing serving size → per-100g only; zero-macro
  entries (water, coffee) fine.
- Editing a food that's in past logs → logs keep snapshot values; a
  "recalculate history" is deliberately absent (data honesty).
- Workout app killed mid-session → active workout state persists, resumes.
- Same exercise different equipment → variants, history separate with
  merge-view toggle.
- Timezone travel: day boundary local; no double-logged days.
- Moderation queue offline (local account) → all edits local; no submission
  path (explained).

## 8. Acceptance criteria (key)

- Logging a saved meal = two interactions from Ishrana tab; day macros
  update instantly.
- A LIDL product entered via label photo yields a prefilled food whose
  provenance shows the photo; submission lands in the moderation queue.
- Active workout: previous session's 3×8×60 kg ghosts under new inputs;
  rest timer fires locally offline.
- Editing saved meal composition today does not change last week's logged
  macros.
- Weight chart shows trend line over noisy daily entries.
- Every food detail view displays provenance and the report action.

## 9. Open questions

1. Curated starter exercise base size and source (license-clean) —
   architecture/content task; proposal ~150 exercises hand-curated.
2. Label OCR: on-device vs cloud model for v1 (privacy vs quality) —
   architecture ADR; local accounts need on-device or manual-only.
3. ~~Barcode scanning timing.~~ **Confirmed (founder 2026-07-05): desktop
   v1 skips it; arrives with Android.** Also signed off same date: Open Food
   Facts stays an isolated lookup source, never merged into the curated DB
   (ODbL protection — nutrition research conclusion now binding).
4. IMR/CAPNUTRA licensing outcome may reshape curated-DB seeding (founder
   action item).

## 10. Future extensions

Meal planner week view → shopping list (raw-spec idea); trainer/client
sharing (PRO pack); wearable imports; recipe nutrition auto-calc from
ingredients; community verified-food contributions program.
