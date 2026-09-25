# PRD 07 — Profile & Settings (SET)

**Status:** draft 2026-07-05. Inputs: raw-spec §§11–12, design-system
research (tokens, accents, density), founder decisions #2 (languages),
#4 (profiles), ONB (feature flags), baseline (privacy/backup).

## 1. Purpose

The control room: identity (profile), appearance (theme system), modularity
(feature flags by category), privacy, notifications entry point, backup, and
account management. Settings must make the "50 apps in one" feel curated —
everything findable, nothing overwhelming.

## 2. User stories

- As a user, I want to change my picture, nickname, email, and password in
  obvious places, so that account hygiene is easy.
- As a user, I want themes and accent colors with live preview, so that the
  app feels mine.
- As a minimalist, I want to browse all modules by category and toggle them,
  so that my app has exactly what I use.
- As a data owner, I want backup and export controls in one place, so that
  I always know my data is mine.

## 3. User experience & flows

Settings window with search field and sections: Nalog, Profili, Izgled,
Moduli, Notifikacije (→ NTF), Privatnost i bezbednost, Backup i podaci,
Jezik, Tastaturne prečice, O aplikaciji. Module gallery: cards grouped by
category (per module registry groups) with short descriptions, screenshots,
and toggles; search across modules. Appearance: theme (system/dark/light),
accent palette (curated set, per-theme variants auto-applied), density
(comfortable/compact), live preview pane.

## 4. Functional requirements

### Profile & account
- **SET-001 (M)** Profile editing: display name, profile picture (local
  crop; images stripped of EXIF per SEC-FILE-04), nickname change with live
  uniqueness check (cloud; enforces AUTH-009; rate-limited; old nickname
  released per AUTH OQ#1 policy).
- **SET-002 (M)** Email change, password change, 2FA management, sessions
  list, and account deletion — surfaced here, behavior owned by AUTH.
- **SET-003 (M)** Business profile management: create/enter/delete business
  profile (decision #4), per-profile accent (AUTH-025).

### Appearance
- **SET-004 (M)** Theme: system (default) / dark / light with instant apply;
  accent color from the curated palette; density comfortable/compact —
  all implemented via design tokens (design-system research).
- **SET-005 (M)** Every accent × theme combination shall pass contrast
  checks automatically (no user-selectable combination may violate WCAG AA).
- **SET-006 (S)** Custom background image for the dashboard (founder decision
  2026-07-05: in v1) — bundled curated set or user-supplied image, with a
  **transparency/dim slider** in settings so readability tokens hold at any
  setting; contrast checks (SET-005) remain binding over the background.

### Modularity
- **SET-007 (M)** Module gallery by category with per-module enable/disable;
  disabling hides UI and widgets, never deletes data; re-enabling restores
  prior state (ONB-008 semantics).
- **SET-008 (M)** "Ponovo pokreni upitnik" entry (ONB) with merge-diff
  preview.

### Language & locale
- **SET-009 (M)** UI language: Serbian and English at launch (decision #2),
  switchable live; locale settings (first day of week, date/time format,
  number format) independent of language.

### Privacy, backup & data
- **SET-010 (M)** Privacy panel: telemetry opt-in (default off; absent
  entirely for local accounts per SEC-PRIV-02), crash-report opt-in, data
  practices in plain language.
- **SET-011 (M)** Backup panel: local encrypted backup now + scheduled
  (SEC-DAR-02), restore flow with preview; cloud accounts additionally show
  sync status/controls (pause, sync now — sync research UX).
- **SET-012 (M)** Export entry point (→ IMEX): full export always available.
- **SET-013 (S)** Keyboard shortcuts reference + remapping of the core set.
- **SET-014 (S)** Settings search covering every setting label/synonyms.

## 5. Options & settings

This module *is* settings; its own meta-options: settings search history off,
reset all to defaults (per-section, with confirmation).

## 6. Integrations

AUTH (account ops), ONB (flags, re-run), NTF (notification section), IMEX
(export/backup), design system (tokens), every module (its settings register
into a per-module subsection via a settings contract — schema-declared so
the search can index them).

## 7. Edge cases & error states

- Nickname change collision at submit (raced) → inline error + suggestions.
- Disabling a module that another enabled feature depends on (e.g. STUDY's
  planner writing to TASK) → dependency explained, options offered (disable
  both / keep).
- Restore from backup made by a newer app version → refuse with clear
  message (forward-compat policy from architecture).
- Deleting profile picture reverts to generated initials avatar.
- Live language switch with unsaved form state → state preserved.
- Settings search with 0 results → offer full list + feedback link (FDBK).

## 8. Acceptance criteria (key)

- Every setting reachable by keyboard and by search; changes apply without
  restart (language included).
- Accent switch updates all surfaces (including charts) instantly; contrast
  audit passes for all combinations in both themes.
- Disable → re-enable FIT round-trip preserves budgets, entries, and widget
  config.
- Backup → wipe → restore round-trip reproduces the full account state
  (test on reference dataset).
- Telemetry defaults off; enabling shows exactly what is sent (inspectable
  payload description).

## 9. Open questions

1. ~~Accent palette size / business default accent?~~ **Decided (founder
   2026-07-05): 8 curated accents; business profiles automatically get a
   distinct default accent.**
2. ~~Custom background in v1?~~ **Decided (founder 2026-07-05): yes, with
   transparency slider** (SET-006 promoted to S).
3. Settings sync scope for cloud accounts: which settings are per-device
   (density, quiet hours?) vs synced — needs a per-setting flag in the
   settings contract.

## 10. Future extensions

Per-workspace themes; icon packs; advanced keyboard macro layer; settings
profiles (work/home presets).
