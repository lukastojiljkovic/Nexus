# ADR-033 — NTF-008's one-time appetite ask at the first notification moment

**Status:** accepted · 2026-07-30
**Drives:** the NTF-008 remainder (STATUS §4): the presets exist in Settings;
this is the one-time prompt at the first notification. Wave-2 Lane E.

## Decision

1. **Flag:** migration 026 adds `ntf_settings.appetite_asked` (0/1, default 0).
   `NotificationStore` exposes it on `getSettings` and gains
   `markAppetiteAsked()`.
2. **Ask-and-hold, only when the ask can be seen.** In the scheduler, per
   profile, when `appetite_asked = 0` and the cycle has deliverable survivors
   (after quiet-hours):
   - window **visible and not minimized** → nothing is recorded or fired this
     cycle; one payload-free `notifications:appetite-ask` push goes to the
     renderer. Holding is free because reminders are derived, never
     materialized — the same mechanism quiet hours already use.
   - window not visible → **deliver normally and leave the flag unset**: the
     ask waits for the next visible delivery moment. A reminder must never be
     held hostage by a dialog nobody can see.
3. **The dialog** (house dialog recipe, no default): Minimalno / Normalno /
   Sve, plus a quiet "Zadrži podrazumevano". Every path — including dismiss —
   marks the flag: the question is asked once, ever. A preset choice writes
   the same source toggles Settings' presets write. After marking, main runs
   one immediate check so the held reminders fire under the chosen appetite
   without waiting out the 60 s tick.
4. **IPC:** the one push channel above plus one `notifications:appetite-asked`
   invoke (optionally carrying the chosen preset's sources so the write and
   the mark are one round trip); frozen one-method-per-channel bridge as
   always. The renderer guards against a duplicate dialog while one is open.

**Accepted during implementation (2026-07-30, `4c96924`):**

- "Deliverable survivors" includes **due snoozed re-fires**, not only fresh
  candidates — otherwise a profile first delivered while hidden might never
  reach a "visible delivery moment" again. Fresh/refiring are computed before
  anything is written, which is what lets a cycle be held cleanly.
- The hold covers the **whole profile cycle including `max`-priority** final
  warnings — unlike quiet hours. Deliberate: the window is visible and the
  dialog is the only thing on it; every path answers, and the immediate
  post-answer check fires the warning seconds later.
- The **search palette closes when the ask opens** — both listen for document
  Escape, and one keypress must not spend the once-ever question.
- Escape and the backdrop **answer** (`null` = keep current), never cancel —
  the one deliberate departure from the scope-dialog recipe, recorded in the
  component.

## Consequences

- A brand-new profile with reminders due while the user is away gets its
  reminders on time and the ask later — order of honesty: reminders first.
- The flag survives restore as part of `ntf_settings` (interchange already
  carries notification settings; absent on older archives → unasked, which
  re-asks — the harmless direction).
