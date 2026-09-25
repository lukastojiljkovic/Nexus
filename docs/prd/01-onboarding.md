# PRD 01 — Onboarding & Personalization (ONB)

**Status:** draft 2026-07-05. Inputs: `docs/notes/razrade.md` (onboarding
razrada + 2026-07-05 revision), `docs/research/onboarding-ux.md`,
`docs/prd/00-overview.md` module registry, founder decisions #4/#9.

## 1. Purpose

ONB is the mechanism behind the product philosophy: dozens of modules, but
each user sees only what fits them. It converts a short questionnaire into a
personalized module set, dashboard, and starter content — and continues
working after day one through progressive, in-module questions and empty
states. Success metric: completion rate of the blocking flow and D7 retention
of onboarded vs skipped users.

## 2. User stories

- As a new user, I want to start using the app in under two minutes, so that
  I see value before answering anything.
- As a student, I want the app to look like a student tool after I say I'm a
  student, so that I don't wade through business features.
- As a user who skipped setup, I want a sensible default app, so that
  skipping is a valid choice.
- As an established user, I want to re-run or adjust personalization later
  without losing anything, so that my app grows with me.

## 3. User experience & flows

**Blocking core (4 screens, target < 2 min, progress bar, skip always
visible):**
1. **Welcome + account** — "Počni odmah (lokalno)" primary CTA; cloud
   registration/login secondary (see AUTH §3); one-line honest comparison.
2. **Profile type** — Personal / Business / Both. "Both" configures personal
   now; business mini-questionnaire runs on first business-profile entry.
3. **Ko si + šta organizuješ** — one screen: occupation chips (student,
   programer, arhitekta, dizajner, freelancer, profesor, preduzetnik,
   zdravstvo, pravo, finansije, ostalo+custom; multi-select) auto-suggest
   area cards below (Obaveze / Učenje / Posao i projekti / Finansije /
   Fitnes i ishrana / Beleške i znanje / Životna administracija / Vizuelno
   planiranje); user confirms/adjusts the multi-select.
4. **"Tvoj Nexus"** — live preview of the generated dashboard + enabled
   module list with per-module toggles; theme (system/dark/light) and accent
   picker inline with live preview; CTA "Kreni".

**Progressive layer (after entering the app):**
- Module first-open depth questions (max 2, from that module's PRD).
- Empty states: what belongs here, why, one primary action.
- Contextual hints on first encounter of non-obvious features; each
  dismissible, never a forced tour.
- Natural-moment upsells: cloud/sync suggested at second-device intent,
  share attempt, or after N days of meaningful data (backup nudge).

## 4. Functional requirements

- **ONB-001 (M)** The blocking flow shall consist of exactly the four screens
  above, with a visible progress indicator and an always-available skip.
- **ONB-002 (M)** Skipping (at any point) shall apply the Essentials preset
  (DASH, TASK, NOTE, CAL) and proceed to the app.
- **ONB-003 (M)** Answer→configuration mapping shall be declarative data
  (answer → feature flags + widgets + starter content), versioned, and
  editable without code changes.
- **ONB-004 (M)** After onboarding, at most ~7 modules plus Dashboard shall
  be visible; everything else remains available via Settings (anti-clutter
  rule).
- **ONB-005 (M)** The system shall pre-populate the first-run experience:
  one guided creation of a real first task, one sample canvas board, and
  persona-matched widgets; sample content is marked and removable with one
  action.
- **ONB-006 (M)** Occupation selections shall auto-suggest (not force) area
  selections; the user always confirms.
- **ONB-007 (M)** Interrupted onboarding shall resume where it stopped on
  next launch.
- **ONB-008 (M)** Re-running the questionnaire (from Settings) shall merge:
  it may enable modules and suggest widgets, but never disables modules the
  user enabled manually, never removes data, and never rearranges a
  customized dashboard without confirmation.
- **ONB-009 (M)** Depth questions shall be owned by modules and asked at
  module first-open (max 2 per module); ONB provides the framework
  (question card UI, answer storage, mapping hooks).
- **ONB-010 (M)** Questionnaire answers shall be stored locally; for local
  accounts they never leave the device (SEC-PRIV-02); for cloud accounts
  they sync as normal settings data.
- **ONB-011 (S)** The business profile should get a mini-questionnaire on
  first entry: delatnost → profession-pack suggestion + which shared
  surfaces apply (calendar per decision #4).
- **ONB-012 (S)** Empty states across the app should follow the ONB pattern
  (explanation + single primary action); ONB PRD owns the pattern spec,
  modules own their content.
- **ONB-013 (C)** Contextual feature hints framework (first-encounter,
  dismissible, per-feature shown-once tracking).
- **ONB-014 (W v1)** A/B testing of onboarding variants (needs STATS +
  telemetry consent framework).

## 5. Options & settings

Re-run questionnaire; per-module enable/disable by category (SET owns the
screen, ONB owns the mapping); reset hints ("show tips again"); remove all
sample content.

## 6. Integrations

AUTH (screen 1 is the account gate; business mini-questionnaire trigger);
SET (feature flags, theme/accent chosen on screen 4 persist to SET);
DASH (generated layout + widgets); TASK/CANV (starter content); every module
(depth questions, empty states); PRO (business pack suggestions); NTF
(notification-appetite question moved to first notification moment —
*revision: the razrada's "stil rada" screen is dropped from the blocking
core; its questions distribute to natural moments*).

## 7. Edge cases & error states

- Nothing selected on screen 3 → Essentials preset, no nagging.
- Everything selected → allowed; gentle note that more can be enabled later;
  visible-module cap still applies with user's picks prioritized by
  selection order.
- Custom occupation text → maps to closest chips' suggestions; stored for
  future pack development (local only unless telemetry consent).
- Re-run after heavy customization → merge rules of ONB-008; show a diff
  preview before applying.
- Crash/kill mid-onboarding → ONB-007 resume; partial answers preserved.
- Accessibility: full keyboard navigation and screen-reader labels on all
  cards (cross-cutting, but onboarding is the first impression).

## 8. Acceptance criteria (key)

- A user can go from first launch to a populated dashboard in under 2
  minutes on the reference machine, including local-account creation.
- Skipping at screen 1 yields Essentials with a usable, non-empty dashboard.
- Choosing "student + učenje + ispiti" yields STUDY enabled, exam countdown
  widget present, guided first-task prompt referencing studying.
- Re-running the questionnaire with different answers never removes existing
  user data (verified per module).
- With telemetry off (default), no onboarding answer appears in any network
  payload (test with traffic capture on cloud account).

## 9. Open questions

1. Exact starter-content set per persona — finalize with design-direction
   session (needs the visual system).
2. Does screen 3's occupation list localize per market later (professions
   differ)? v1: same list, localized labels.
3. ~~Visible-module cap: hard or soft?~~ **Decided (founder 2026-07-05):
   soft — warn above 7, never block.**

## 10. Future extensions

LLM-assisted onboarding conversation (AI module, post-v1); template
marketplace for starter setups; org onboarding for teams.
