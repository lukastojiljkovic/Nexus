# ADR-058 — The business profile (AUTH-023..026, SET-003, CAL-005, DASH-006, ONB-011 v1; no migration, interchange 1.22.0)

> Version note (2026-07-31): interchange renumbered 1.23.0 → **1.22.0** at
> dispatch — this ADR's manifest `kind` ships in slice a, ahead of PRIV's
> interchange slice (ADR-057 takes 1.23.0). §6's fixture number follows.

**Status:** accepted (2026-07-31) · **Owner:** supervisor · **Implements:** the
founder's batch answer 6: a SEPARATE profile kind, reusing whichever existing
modules make sense. Grounded in the 2026-07-31 terrain recon (nine numbered
requirements found, not the remembered six; all cited below).

## 1. What already exists (and therefore is NOT built here)

The recon's central finding: **the substrate is done.** `profiles.kind`
already accepts `'business'` (migration 001), every feature table is
profile-scoped, every store is constructed per profile, `feature_flags` is
`(profile_id, module_id)`, and export/restore/undo/foreign-import all take a
profileId. What is missing is exactly the top layer: create, delete, select,
switch — plus the ONE requirement that crosses profiles (the calendar
overlay). **Zero schema migration.** The personal/business axis is orthogonal
to the occupation/persona axis (ONB screen 3) — this ADR builds the former
and does not touch the latter.

## 2. Creation, seeding, deletion (AUTH-023, SET-003)

- `ProfileStore` gains `create(kind, name)` / `delete(id)` (today creation
  lives only in `seedFirstRunProfile`'s bootstrap). The single-profile gate
  (`if (count > 0) return`) stays for the SEED; a new `profiles:create` /
  `profiles:delete` IPC pair (validated, trusted-sender) serves the UI.
- **Seeding a business profile** = the `ensureInbox` precedent, extended:
  Inbox row + `feature_flags` rows spelling the business default set —
  **DASH, TASK, CAL, NOTE on; STUDY off** (ONB-002's Essentials preset is the
  declared non-student default; STUDY as shipped is semester/exam-bound —
  recon's module-by-module verdict). Seeded ROWS, not a kind-aware
  `defaultEnabled`: the manifest contract (ADR-008's "one source of truth")
  stays untouched, and the user can re-enable STUDY in the gallery like any
  module (SET-007's disable-hides-never-deletes already holds).
- **Deletion**: business profiles only, typed-name confirm (the ADR-048
  idiom); the personal profile is the account's anchor and undeletable. A
  deleted business profile's rows go with it (`ON DELETE CASCADE` from
  `profiles`), its overlay events disappear (PRD 04 §7 edge), and shared-blob
  refcounts are re-walked before blob GC (the attachments union already
  crosses profiles).
- ONB-011's delatnost questionnaire belongs to profession packs (PRO — not
  built); v1 first entry into a fresh business profile reuses the ONB-lite
  screen (name + theme), which today triggers on the empty-name sentinel —
  the recon's "free seam", now made deliberate with a test.

## 3. Selection and switching (AUTH-024, AUTH-025)

- `App.tsx` gets real `activeProfileId` STATE replacing the six hard-coded
  `profiles[0]` sites (recon lists them). Every page already takes
  `profileId` as a prop — the switch is a state change plus a data reload
  (the restore flow's reload precedent).
- **Switcher**: in the sidebar footer beside „Promeni nalog" (the ACCOUNT
  switcher — a different axis, and the copy must keep them distinct):
  „Profil: <name>" opens the house popover listing the account's profiles.
  Picking one asks for the **account passcode on every switch** (AUTH-024,
  founder decision #4) — main verifies via the existing `auth.ts` verify +
  unlock-throttle machinery (shared counter, deliberately: a passcode guess
  is a passcode guess wherever typed). No concurrent profiles; the DB and
  key never change — this is a gate, not a lock cycle.
- **App-wide distinction (AUTH-025, decision #11)**: the accent preference
  becomes PROFILE-PREFIXED in localStorage (`calendarItems`' profile-prefix
  precedent; migration of the old unprefixed key on first read), and a fresh
  business profile defaults to the RESERVED business accent from the
  direction brief. Plus a quiet „Posao" chip beside the profile name in the
  sidebar — typographic, no new hues.

## 4. The calendar overlay (CAL-005) — the one cross-profile read

- A new read-only main-side query spanning the account's profiles: events
  (and only events — not tasks, not birthdays, not documents) of the OTHER
  profile, merged into the grid as a seventh source chip („Poslovni
  kalendar" / „Privatni kalendar" depending on side), rendered visually
  distinct (muted + origin glyph) and **unopenable** (PRD 04 acceptance:
  clicking names its origin and offers „Prebaci profil", which routes
  through the passcode gate).
- Creating an event ALWAYS targets the active profile explicitly (CAL-005's
  own sentence) — the create form does not offer a profile choice.
- The overlay is a READ seam only: `EventStore` stays per-profile; the query
  lives beside it as `CalendarOverlayStore` taking BOTH profile ids from
  main (the renderer never names the other profile's id — it gets rows
  pre-marked `foreign: true` with title/time/allDay and NO description or
  location; SRCH-005 keeps overlay rows out of search by construction since
  the search index is per-profile).
- The source chip starts OFF for existing profiles (the CAL-007 appended-
  chip rule) and ON for freshly created ones.

## 5. Notifications, dashboards, search (the cross-cutting rules)

- **NTF**: the scheduler serves the ACTIVE profile; the other profile's due
  notifications do not render while it is inactive (PRD 05's unnumbered edge
  — hereby numbered as this ADR's rule) beyond the existing catch-up burst
  („Dok te nije bilo: N") which fires naturally on switch because the ledger
  is per-profile. Calendar-overlay events never notify across (a reminder
  belongs to its profile).
- **DASH-006**: independent dashboards already fall out of `profile_id`
  scoping — verified by test, not built.
- **Search-kind gating fix** (recon's live inconsistency, general not
  business-specific): search RESULTS gain the enabled-module gate the search
  COMMANDS already have — a kind→module map filters hits of disabled
  modules, so a business profile with STUDY off no longer surfaces
  subject/exam/deck/card rows.

## 6. IMEX (interchange 1.22.0)

The export manifest's `profile` object gains `kind` (optional, defaults
`personal` on read — era rule per ADR-028 §7; the repo posture bumps the
minor because an older reader would silently mislabel a business archive).
Restore validates kind: an archive restores only into a profile of the SAME
kind (the "fits only its own profile" rule grows one clause; mismatch is a
named refusal, not a coercion). Foreign import ignores kind (rows are rows).
Too-new refusal fixtures → **1.23.0**.

## 7. Slices

- **a (db+main)**: `ProfileStore.create/delete`, business seeding, IPC pair,
  passcode-gated `profiles:switch` verification, deletion semantics + blob
  re-walk, manifest kind + restore validation, DASH-006 test. TDD.
- **b (renderer)**: `activeProfileId` state + reload, switcher popover +
  passcode prompt, per-profile accent with key migration + business default
  accent, „Posao" chip, business ONB-lite first entry, SET „Profili" card
  (create/delete per SET-003).
- **c (overlay + cross-cutting)**: `CalendarOverlayStore` + seventh chip +
  unopenable foreign rows + „Prebaci profil" route; NTF active-profile rule
  pinned; search-kind gating fix.

## 8. Recorded limits (v1)

One business profile per account (the PRD says "an optional business
profile", singular); no profession packs (PRO is its own arc — the „mini-CRM"
in the razrade notes is PRO work, not this); people-lite stays
birthday/anniversary (no CRM fields); the STUDY module stays available to
business profiles via the gallery (off by default, never forbidden); login-
time profile TAB (decision #4's "bira tabom na loginu") arrives with the full
AuthGate rework when accounts grow profile awareness — v1 always opens the
last-active profile and switches in-app.
