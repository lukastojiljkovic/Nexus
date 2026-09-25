# ADR-065 — The four-screen onboarding questionnaire (ONB-001..012; no migration, no interchange change)

**Status:** accepted (2026-07-31), **§3–§4 superseded 2026-08-23 by
[ADR-086](086-profile-plan.md)** · **Owner:** supervisor · **Based on:** the
2026-07-31 ONB recon (all citations there). **Replaces** ONB-lite's single
screen — the IOU its own doc comment records.

> **What still holds.** §1 is the load-bearing part and is untouched: the name
> sentinel is still the completion fact, completion is still the one
> `renameProfile` write at the end, and in-progress state still lives in
> `nexus.onb.<profileId>`. **What went** is the two checkbox screens — „Tvoja
> nedelja" and „Šta ti treba?" — which ADR-086 replaces with four organic
> questions and keeps as the „Napredno" manual override. Read §1, §2 and §5
> here; read §3–§4 as history.

## 1. The load-bearing insight: the name sentinel stays the completion fact

The gate (App.tsx: shell withheld while the active profile's name is empty)
already gives us, for free: per-profile gating, resume-on-relaunch, resume
across a lock cycle, correct restore behaviour (a restored profile has a
name and is never re-gated), and correct business-profile re-entry. So:

- **Completion = the one `renameProfile` write, at the END of the flow.**
  No screen before the last commits the name; the gate cannot un-gate early
  (the recon's risk #1 dissolves).
- **In-progress state** (current screen + partial answers) lives in
  device-level localStorage under a per-profile key (`nexus.onb.<profileId>`
  — the accent.ts idiom), validated against the live profile list on read
  (the profilePrefs rule), cleared on completion. It survives the auto-lock
  cycle (risk #2) and legitimately never travels: an interrupted first-run
  belongs to this machine.
- **No migration, no interchange change.** The questionnaire's durable
  output IS the explicit flag rows (below) plus the name/theme/appetite it
  writes through existing channels; the raw answers have no second consumer
  in v1, so a table for them would be storage without a reader — ONB-010's
  "stored locally" is satisfied by those materialized rows and the
  in-progress key. Recorded reading; a re-run initializes from live flags,
  not from replayed answers.

## 2. The four screens (ONB-001), all skippable (ONB-002)

Rendered by a grown `Onboarding.tsx` on its existing `.onb` shell (AuthGate
mirrors it — the first and second screens a user ever sees keep matching).
A quiet „Preskoči" on every screen completes IMMEDIATELY with the
**Osnovno (Essentials) preset**; screen 1's name field is required even on
skip (a profile needs its name; one field is not a flow).

1. **Ime + tema** — exactly ONB-lite's content today (name; Dan/Noć on
   personal first run). Business branch keeps its own wording and no theme
   group, as now.
2. **Uloga** — one single-select (Student / Zaposleni / Preduzetnik /
   Nešto drugo). Its ONLY effect: pre-checking screen 3 (ONB-006 —
   suggests, never forces). Business profiles skip this screen (their
   suggestion is the business preset itself) — their flow is three screens,
   recorded divergence from the literal four.
3. **Oblasti** — the module choice: a checkbox list over the REGISTERED
   manifests only (the only-built-modules rule keeps ONB-004 satisfied by
   construction), pre-checked from screen 2's suggestion table,
   `LOCKED_MODULES` (dashboard/settings) shown as always-on chips exactly
   as the Settings gallery shows them. PRIV is never pre-checked (it stays
   the opt-in module).
4. **Podsetnici + start** — the NTF appetite choice reusing
   `NOTIFICATION_PRESETS` verbatim (Minimalno/Normalno/Sve — the same
   three the Settings row and the first-ask dialog already share), plus
   „Počni". Choosing here ALSO answers NTF-008's once-ever question
   (writes the appetite and `appetite_asked`), so the queued first-ask
   dialog never pops the moment onboarding ends (risk #3 resolved by
   answering, not suppressing). Skipping this screen leaves the NTF-008
   first-moment ask armed, untouched.

## 3. Declarative mapping (ONB-003) and the Essentials preset

One data module (`onboardingPresets.ts` beside `modules.ts` in `shared/` —
main and renderer read the same facts): the **Osnovno** flag set (tasks,
calendar, notes, study on; priv off — today's personal defaults made
explicit) and the **occupation → suggestion** table (each role listing its
pre-checked module ids). Completion writes flags as EXPLICIT STORED ROWS
via the existing upsert — the `BUSINESS_DEFAULT_FLAGS` argument ("a stored
fact of the profile rather than an accident of this build's manifests") —
never writing rows for `LOCKED_MODULES`. Both tables tested; adding a
module to the registry without deciding its Essentials/suggestion place is
a test failure, not a silent default.

## 4. Starter content (ONB-005) — the honest minimum

No fabricated sample data, ever (the house rule). Two things only:
- The **EmptyState pattern already standing across 13 files IS the
  first-run experience** (ONB-012 — its stylesheet says "onboarding
  pattern" verbatim); nothing new to build there.
- ONE genuine starter row: a welcome note („Dobro došli u Nexus") written
  on completion through the real note-creation path (the LLM-import
  precedent proves main can author note content) — real, useful,
  deletable content, not sample data. Business profiles get none.

## 5. Re-run (ONB-008) and depth questions (ONB-009)

- Settings gains one card row („Podešavanje modula — ponovo pokreni
  upitnik") opening the SAME flow in rerun mode: screen 1 shows the
  current name editable, screen 3 initializes from the LIVE resolved
  flags (the honest merge — what you have is what you start from), and
  completion upserts only what changed. Flags rows already travel in the
  archive and restore already rewrites them — ONB-008's restore clause
  holds with zero new work.
- ONB-009 is already the codebase's shape (PRIV's status-driven
  first-entry setup; `appetite_asked` as the asked-once idiom) — recorded,
  nothing to build.

## 6. Consequences

- No migration (047 stays free), no interchange change, no new IPC beyond
  possibly zero — name/theme/flags/appetite all have channels; verify and
  reuse. The business creation-time preset stays (upsert reconciles it
  with the flow's screen-3 output; ONB-011 satisfied by the business
  branch of this same flow).
- Touch list: `Onboarding.tsx` (the four-screen machine on the restore
  flow's discriminated-union idiom), `shared/onboardingPresets.ts`
  (+tests), `strings.ts`, `app.css`, the Settings rerun row, the
  completion writes in App/main through existing channels.
- The smoke run is unaffected (`__nexusReady` fires before the gate).
