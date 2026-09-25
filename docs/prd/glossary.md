# Nexus PRD — Glossary

Every product term defined once; all PRD modules use these terms exactly.
Add new terms alphabetically as modules are written.

- **Blob store** — content-addressed storage for file attachments, synced
  separately from structured data and documents.
- **Business profile** — the work-side profile of an account; data fully
  separate from the personal profile except the shared calendar overlay.
- **Cloud account** — account with nickname/email/password, sync, sharing,
  and backup; server-backed.
- **Conflict copy** — the preserved "both versions" result when sync cannot
  safely merge; visible, diffable, never a modal.
- **Dashboard** — the configurable home screen composed of widgets.
- **Essentials preset** — the default module set (DASH, TASK, NOTE, CAL)
  applied when onboarding is skipped.
- **Feature flag** — per-user switch controlling a module's visibility;
  disabling never deletes data.
- **Local account** — fully offline account, PIN-protected, zero network
  traffic, no email or server involvement.
- **Module** — a self-contained feature area with an ID prefix in the module
  registry (e.g. TASK, STUDY); user-visible per feature flags.
- **Note-mirror card** — a canvas card that live-mirrors a note (or note
  section); edits flow both ways, one source of truth.
- **Onboarding questionnaire** — the 4-screen blocking flow plus progressive
  in-module questions that personalize the app (see ONB).
- **Private note** — zero-knowledge encrypted note in the Private section;
  server and operators can never read it.
- **Problem card** — a flashcard whose front is an exercise/problem and whose
  back is the worked solution; used in interleaved practice.
- **Productivity booster** — optional short break activity offered during
  Pomodoro breaks (mini-games, stretching, eye rest).
- **Profession pack** — a preset of modules, mini-tools, calculators, and
  templates for a profession (business profiles; PRO module).
- **Provenance** — per-entry record of data origin (source, link/photo,
  verification status, last-verified date); mandatory for food DB entries.
- **Quick capture inbox** — the single global capture target (hotkey/share);
  items are triaged into modules later.
- **Recovery Kit** — user-held file/printout containing the private-notes
  recovery key; the only data-recovery path for private notes.
- **Reference-only data** — informational data (e.g. nutrition values) with
  an explicit disclaimer and a "report incorrect data" action.
- **Saved meal** — user-defined composition of food entries logged with one
  tap ("jelo br. 1").
- **Views engine** — the shared component rendering one dataset as list /
  kanban / cards / calendar (charts via the chart kit); per-view filters and
  sort.
- **Widget** — a dashboard building block (agenda, countdown, stats, quick
  actions…), added/removed/arranged by the user.
