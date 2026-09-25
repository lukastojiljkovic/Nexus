# ADR-063 — Exam topics & the honest planner (STUDY-003/004/005 closed; migration 046, interchange 1.25.0)

**Status:** accepted (2026-07-31) · **Owner:** supervisor · **Implements:** the
unmet clauses of STUDY-003 (topics, per-weekday hours, confidence, spaced
revision), STUDY-004 (overload honesty + scope cuts) and STUDY-005 (weak-topic
recall exam week). Based on the 2026-07-31 planner recon. Two slices:
**a** = engine + migration + stores + interchange (core/db), **b** = IPC + UI.

## 1. The topic model (migration 046)

- **`exam_topics`** — exam-scoped (planning is per-exam; the one-active-plan-
  per-exam invariant stays the anchor): `id` (uuidv7), `profile_id` FK,
  `exam_id` FK exams CASCADE, `name` (non-empty), `sort_order` (the user's
  RANK — curriculum order AND scope-cut priority, lowest rank cut first…
  highest rank = most important is `sort_order` 0, the list's top),
  `confidence INTEGER NULL` CHECK 0–100 (manual, optional — NULL means
  unknown, treated as low-middle), `deck_id TEXT NULL` FK decks (links the
  topic to its flashcard deck for FSRS-derived weakness and exam-week recall),
  `cut INTEGER 0/1 DEFAULT 0` (set ONLY by the user accepting a scope-cut
  proposal — never by the machine), `created_at/updated_at/deleted_at`.
  No `estimated_minutes` in v1 — coverage weight derives from confidence;
  a per-topic minutes estimate is a refinement the form should not demand
  up front (recorded refusal).
- **`study_blocks` rebuild** (safe: no children, no `deleted_at`): gains
  `topic_id TEXT NULL` (references exam_topics; NULL = the old undifferentiated
  block, still legal — a plan with zero topics keeps today's behaviour
  exactly), `kind TEXT NOT NULL DEFAULT 'coverage'` CHECK in
  (`coverage`,`revision`,`recall`), `pinned INTEGER 0/1 DEFAULT 0`; the
  `UNIQUE(plan_id, block_date)` identity is replaced by
  `UNIQUE(plan_id, block_date, topic_id, kind)` — a day may now hold one
  topic's coverage beside another's revision.
- **`study_plans`** gains `weekday_minutes TEXT NULL` — a validated JSON
  7-vector (Mon..Sun, each 0–480, at least one positive). NULL means "every
  day = `daily_minutes`", which is every existing plan's exact semantics, so
  no rebuild and no data migration; `daily_minutes` stays as the base the
  form fills the vector from.

## 2. Engine v2 (pure, table-tested, clock-free — the existing discipline)

`planBlockDates` grows to take the weekday vector and the topic list
(`{id, rank, confidence|null, cut}`); output rows carry `topicId|null` and
`kind`. Invariants the tests must pin (internals are the lane's):

- **Capacity is law**: a day's scheduled minutes never exceed its vector
  capacity (exam-week boost multiplies the vector, as it multiplied the
  scalar). Cut topics are excluded from generation entirely.
- **Coverage order** = user rank; **weight** = inverse confidence (lower
  confidence ⇒ more minutes), NULL confidence between low and middle.
- **Spaced revision**: after a topic's coverage completes, short revision
  passes at growing gaps (+1/+3/+7 days, clamped to exam-eve; ~25% of the
  topic's coverage minutes, floor 15) — the STUDY-003 "initial coverage +
  spaced revision passes" clause, deterministic.
- **Exam week (STUDY-005)**: inside the final-7-days window no NEW coverage
  is placed when it can be placed earlier; the window fills with `recall`
  blocks over the WEAKEST topics (lowest effective confidence). With zero
  topics the window keeps today's doubled undifferentiated blocks.
- **Overload is a return value, never a silent stretch**: the capped
  distributor returns `{blocks, overflowMinutes}`; `distributeBacklog`'s
  no-cap behaviour survives only for zero-topic plans (compat), and even
  there the overflow past a sane ceiling is REPORTED.
- Zero-topic plans reproduce today's output byte-for-byte (pinned by test).

**FSRS-derived weakness** (topic with `deck_id`): effective confidence =
manual confidence if set, else derived from the deck — a new store query
aggregating per-deck Again-rate over recent `review_log` + mature-card
fraction (the recon's metrics; exact blend is the lane's, pinned by test).
Derivation happens store-side at sync/read time; the engine stays pure and
takes numbers.

## 3. Store + honesty (STUDY-004)

- `PlanStore.sync` keeps its shape (idempotent per `today`, runs before every
  StudyPage/CalendarPage read) but RETURNS `PlanHealth`:
  `{planId, overflowMinutes, examPassedBacklogMinutes}` per plan
  (`syncAll` returns the list). Regeneration respects `pinned` rows (skipped
  exactly as done/missed rows are — the TASK-contract "pinnable" property,
  delivered on the block substrate).
- **STUDY-003's "output as managed tasks" is deliberately satisfied on
  `study_blocks`, not by minting `tasks` rows** — the contract's properties
  (regenerable, pinnable, calendar presence, check-off) all exist on blocks;
  real task rows would collide wholesale regeneration with stable task
  identity, reminders and dependencies (the recon's option (a); recorded
  divergence from the spec's literal wording).
- **Scope cuts**: the store exposes the PROPOSAL computation (topics in
  ascending rank, dropping the lowest-ranked topics' remaining non-done
  minutes until projected load fits capacity) and an explicit
  `acceptScopeCut(topicIds)` that sets `cut=1`. The machine never cuts on
  its own — the proposal is presented, accepted or declined (honesty over
  fiction).
- `TopicStore` (or a PlanStore extension — lane's choice, one owner): CRUD
  scoped by exam, rank moves via the sort_order idiom, confidence set,
  deck link set/clear; delete promotes its blocks' `topic_id` to NULL.

## 4. Interchange 1.25.0 (fixtures → 1.26.0)

New record type `exam-topic` riding in `data/study.ndjson` ahead of plans;
`plan` gains OPTIONAL `weekdayMinutes`; `block` gains OPTIONAL
`topicId`/`kind`/`pinned` (absent = NULL/`coverage`/unpinned — every earlier
archive's blocks, so no era flag anywhere). Reference rules: topic→exam
dangling-drop like plan→exam; block→topic dangling-drop to NULL. CSV mirror
`tables/exam-topics.csv`. Restore inserts + wipe-list row; foreign import
imports topics with remapped exam/deck refs (additive, like plans). MINOR
bump by the standing honesty rule: an older reader would silently lose the
user's curriculum.

## 5. UI (slice b)

- Plan form: a topics editor (name rows, rank ↑/↓ via the sort_order idiom,
  confidence select 0–100 in steps, optional deck link), per-weekday minutes
  row (defaulted from `daily_minutes`, editable).
- Plan card: block rows say their topic and kind; the health line renders
  `overflowMinutes` as an honest sentence and offers „Predlog skraćenja" —
  a house dialog listing the proposal's topics with accept/decline; accepted
  topics show a „van plana" chip and can be un-cut.
- Exam-week visual mode: a distinct (token-only) chip/row variant on
  StudyPage rows and the calendar agenda row; a `recall` block with a linked
  deck deep-links into the existing review session via
  `ReviewQueueScope{deckIds}`.
- Calendar blocks stay read-only (the recorded posture).

## 6. Consequences

- STUDY-003/004/005 close; the planner's honesty surface (overflow, scope
  cuts, exam-passed backlog) finally exists.
- `exams.scope` free text stays as-is (the founder's field); topics do not
  replace it in v1 — recorded.
- Migration 046, interchange 1.25.0; the 021-class rebuild hazard does not
  apply to `study_blocks` (no cascading children — verified in recon).
