# Architecture decision records

**Every decision that shapes the system, in one table.** Each ADR is one file here,
`NNN-slug.md`, numbered in the order it was accepted. A decision is never
rewritten: when a later ADR changes an earlier one, its own status line says so
and the earlier file keeps its text. The status and date columns are read from
each file's `**Status:**` line, and from its `**Date:**` line where the status
line carries no date.

[Architecture overview](../overview.md) is the prose map of the system; this
directory is the decision log behind it.

| # | Title | Status | Date |
| --- | --- | --- | --- |
| [001](001-local-storage-engine.md) | Local Storage Engine & Data Model | Accepted (draft pending founder sign-off) | 2026-07-05 |
| [002](002-sync-engine.md) | Sync & Conflict Resolution | Superseded on the choice of engine and backend; the rest stands | 2026-08-08 (accepted 2026-07-05) |
| [003](003-backend-stack.md) | Backend Stack | Superseded — the backend is Supabase | 2026-08-08 (accepted 2026-07-05) |
| [004](004-auth.md) | Authentication: Cloud & Local Accounts | Local accounts built as designed; the cloud half superseded (Supabase auth) | 2026-08-08 (accepted 2026-07-05) |
| [005](005-private-notes-crypto.md) | Zero-Knowledge Crypto for Private Notes | Accepted (draft pending founder sign-off) | 2026-07-05 |
| [006](006-code-sharing.md) | Code Sharing Across Electron / Web / Android | Accepted for desktop + web; Android carries a mandatory re-check at kickoff | 2026-07-05 |
| [007](007-file-preview-pipeline.md) | File Preview Pipeline | Accepted (draft pending founder sign-off) | 2026-07-05 |
| [008](008-feature-flags-and-plugins.md) | Module System, Feature Flags & the Plugin Path | Accepted (draft pending founder sign-off) | 2026-07-05 |
| [009](009-import-export-formats.md) | Import/Export Formats & Versioning | Accepted (draft pending founder sign-off) | 2026-07-05 |
| [010](010-landing-page-stack.md) | Landing Page Stack | Superseded on the hosting target (Cloudflare Workers with static assets) | 2026-08-08 (accepted 2026-07-05) |
| [011](011-canvas-engine-spikes.md) | Canvas Engine (Decision Deferred to Spikes) | Closed — resolved by ADR-079 (Excalidraw) | 2026-08-01 (protocol 2026-07-05) |
| [012](012-note-editor-and-substrate.md) | NOTE Block Editor & Yjs Substrate | Accepted | 2026-07-12 |
| [013](013-note-wiki-links.md) | NOTE Wiki-Links & Backlinks | Accepted | 2026-07-17 |
| [014](014-note-attachments.md) | NOTE Attachments & Blob Store | Accepted | 2026-07-18 |
| [015](015-note-version-history.md) | NOTE Version History (CRDT checkpoints) | Accepted | 2026-07-18 |
| [016](016-note-templates.md) | NOTE Templates (built-in + user-defined) | Accepted | 2026-07-25 |
| [017](017-inline-flashcards.md) | Inline flashcards (NOTE ↔ STUDY) | Accepted | 2026-07-25 |
| [018](018-local-account-passcode.md) | The local account: passcode, key chain, encryption at rest | Accepted | 2026-07-26 |
| [019](019-encrypted-blob-store.md) | The encrypted attachment blob store | Accepted | 2026-07-26 |
| [020](020-calendar-grid-views.md) | Calendar grid views (month / week / day) | Accepted | 2026-07-26 |
| [021](021-global-search.md) | Global search (index, analyzer, palette) | Accepted | 2026-07-26 |
| [022](022-export-completeness-and-encryption.md) | Export completeness, the archive's shape, and its passphrase | Accepted | 2026-07-27 |
| [023](023-archive-restore.md) | Restoring a Nexus archive | Accepted | 2026-07-28 |
| [024](024-recurrence.md) | Recurrence for tasks and events | Accepted | 2026-07-29 |
| [025](025-event-reminders.md) | Event reminders through NTF | Accepted | 2026-07-29 |
| [026](026-people-lite-birthdays.md) | People-lite and birthdays on the calendar | Accepted | 2026-07-29 |
| [027](027-quick-add-dates.md) | Natural-language dates in task quick-add | Accepted | 2026-07-30 |
| [028](028-task-reminders.md) | Per-task reminders through NTF | Accepted | 2026-07-30 |
| [029](029-task-lists.md) | Task lists, sections, and manual ordering | Accepted | 2026-07-30 |
| [030](030-search-operators.md) | Search operators: `#tag` and `rok:`/`due:` | Accepted | 2026-07-30 |
| [031](031-task-attachments.md) | Task attachments (the ADR-014 model, applied to TASK) | Accepted | 2026-07-30 |
| [032](032-task-attachment-search.md) | Task attachments in global search (through the task's own entry) | Accepted | 2026-07-30 |
| [033](033-ntf-first-ask.md) | NTF-008's one-time appetite ask at the first notification moment | Accepted | 2026-07-30 |
| [034](034-time-grid-drag.md) | Pointer drag & resize inside the calendar time grid | Accepted | 2026-07-30 |
| [035](035-task-templates.md) | Task templates | Accepted | 2026-07-30 |
| [036](036-note-preferences.md) | The NOTE preferences pass | Accepted | 2026-07-30 |
| [037](037-task-dependencies.md) | Task dependencies | Accepted | 2026-07-30 |
| [038](038-task-batch-operations.md) | Task batch operations | Accepted | 2026-07-30 |
| [039](039-search-facets-page.md) | The full search page with facets | Accepted | 2026-07-30 |
| [040](040-keyboard-shortcuts.md) | Keyboard shortcuts: reference + remapping (SET-013) | Accepted | 2026-07-30 |
| [041](041-dashboard-background.md) | Custom dashboard background + dim (SET-006) | Accepted | 2026-07-30 |
| [042](042-cloze-cards.md) | First-class cloze cards (STUDY-006) · migration 031 · interchange 1.10.0 | Accepted | 2026-07-30 |
| [043](043-foreign-import.md) | Foreign import: merging another account's archive | Accepted | 2026-07-30 |
| [044](044-multiple-local-accounts.md) | Multiple local accounts on one device (AUTH-006) | Accepted | 2026-07-30 |
| [045](045-dashboard-edit-mode.md) | Dashboard edit mode, widget instances, and the widget contract made real | Accepted | 2026-07-31 |
| [046](046-problem-cards.md) | Problem cards: stepwise solutions without a third kind | Accepted | 2026-07-31 |
| [047](047-interleaved-practice.md) | Interleaved practice (STUDY-010): mixed, randomized sessions over chosen decks | Accepted | 2026-07-31 |
| [048](048-account-deletion.md) | In-app account deletion (addendum to ADR-044 / AUTH-022) | Accepted | 2026-07-31 |
| [049](049-task-smart-lists.md) | Task smart lists (TASK-003): Danas, Sledećih 7 dana, Hitno, Kasni, Završeno | Accepted | 2026-07-31 |
| [050](050-task-views.md) | The views-engine iteration (TASK-005): configurable kanban, cards, calendar, persisted view config | Accepted | 2026-07-31 |
| [051](051-import-duplicates.md) | Duplicate detection in the foreign-import preview (IMEX-008) | Accepted | 2026-07-31 |
| [052](052-anki-import.md) | Anki .apkg import (STUDY-011): basic + cloze, honestly | Accepted | 2026-07-31 |
| [053](053-completed-archive.md) | Završeno ages into an archive (TASK, PRD 04 OQ) | Accepted | 2026-07-31 |
| [054](054-fixed-semester.md) | Fixed semester dates (CAL-010 follow-up; migration 042, interchange 1.20.0) | Accepted | 2026-07-31 |
| [055](055-named-dashboards.md) | Named dashboards (DASH-008; migration 043, interchange 1.21.0) | Accepted | 2026-07-31 |
| [056](056-scheduled-backups.md) | Scheduled encrypted backups (SET-011; migration 044, no interchange change) | Accepted | 2026-07-31 |
| [057](057-private-notes-local.md) | Private notes, local-first (PRIV v1; supersedes ADR-005's primitives; migration 045, interchange 1.23.0) | Accepted | 2026-07-31 |
| [058](058-business-profile.md) | The business profile (AUTH-023..026, SET-003, CAL-005, DASH-006, ONB-011 v1; no migration, interchange 1.22.0) | Accepted | 2026-07-31 |
| [059](059-widget-config.md) | Per-widget configuration (DASH-004; no migration, no interchange change) | Accepted | 2026-07-31 |
| [060](060-kanban-columns.md) | Kanban column configuration (TASK-005's last clause; interchange gate inside) | Accepted | 2026-07-31 |
| [061](061-ics-import.md) | ICS calendar import (the last CAL leg of IMEX's direct importers) | Accepted | 2026-07-31 |
| [062](062-csv-task-import.md) | CSV column-mapping import → TASK (IMEX's last TASK leg) | Accepted | 2026-07-31 |
| [063](063-exam-topics-planner.md) | Exam topics & the honest planner (STUDY-003/004/005 closed; migration 046, interchange 1.25.0) | Accepted | 2026-07-31 |
| [064](064-file-preview.md) | In-app file preview (DOC tier 0 + tier 1; no dependencies, no migration) | Accepted | 2026-07-31 |
| [065](065-onboarding-questionnaire.md) | The four-screen onboarding questionnaire (ONB-001..012; no migration, no interchange change) | Accepted; §3–§4 superseded by ADR-086 | 2026-07-31 |
| [066](066-priv-refinements.md) | The four PRIV refinements: sealed history, close-capture, the unlock-lifetime search index, and blob GC (no migration, no interchange change) | Accepted | 2026-07-31 |
| [067](067-planner-refinements.md) | The two planner refinements: „Vrati u plan" and „Nedostupan špil" (no migration, no interchange change) | Accepted | 2026-07-31 |
| [068](068-explicit-cloze-numbering.md) | Explicit cloze numbering `{{c1::…}}` (NOTE-006's last exclusion; migration 047, interchange 1.26.0) | Accepted | 2026-07-31 |
| [069](069-attachment-content-search.md) | Attachment CONTENT in the search index, for the formats that need no dependency (SRCH-008, migration 048) | Accepted | 2026-07-31 |
| [070](070-note-version-thinning.md) | Tiered age thinning of note checkpoints (NOTE-008's last refinement; no migration, no interchange change) | Accepted | 2026-07-31 |
| [071](071-module-settings-contract.md) | The per-module settings contract (SET; no migration, no interchange change) | Accepted | 2026-07-31 |
| [072](072-note-categories.md) | Note categories: NOTE-002's last unbuilt half (migration 049, interchange 1.27.0) | Accepted | 2026-07-31 |
| [073](073-fin-module.md) | FIN, the finance module: the arc design (migrations 050+, interchange 1.28.0+) | Accepted | 2026-07-31 |
| [074](074-subscription-pause.md) | Pausing a subscription (FIN, migration 054, interchange 1.31.0) | Accepted | 2026-08-01 |
| [075](075-doc-module-page.md) | The DOC module page: „Datoteke" (no migration, no interchange change) | Accepted | 2026-08-01 |
| [076](076-habit-module.md) | The HABIT module: habits, gentle streaks, and what a streak is allowed to mean | Accepted | 2026-08-01 |
| [077](077-focus-timer.md) | One focus timer: absorbing STUDY's session into UTIL's Pomodoro | Accepted | 2026-08-01 |
| [078](078-nutrition.md) | The FIT nutrition layer: provenance, snapshots, and a catalogue that is not a table | Accepted | 2026-08-01 |
| [079](079-canvas-engine.md) | CANV's engine: Excalidraw as a canvas, not as a UI | Accepted | 2026-08-01 |
| [080](080-third-party-notices.md) | Third-party notices: generated from disk, never written | Accepted; §1 superseded by ADR-087 | 2026-08-01 |
| [081](081-fitness-training.md) | FIT: training, and the measurements that tell you whether it worked | Accepted | 2026-08-02 |
| [082](082-sync-collection-map.md) | What syncs, and as what | Accepted (design), unimplemented | 2026-08-08 |
| [083](083-change-journal.md) | How a local edit becomes something to push | Partially implemented — the journal is built, the APPLY direction is not | 2026-08-08, amended 2026-08-09 |
| [084](084-web-readiness.md) | Preparing for the web app, without building it | Accepted | 2026-08-02 |
| [085](085-electronics-module.md) | „Elektronika": a wiring board, its rules, and the machine it becomes | Accepted | 2026-08-19 |
| [086](086-profile-plan.md) | „Priprema": four organic questions that compose a different app | Accepted | 2026-08-23 |
| [087](087-apache-2.0-open-source.md) | Nexus is Apache-2.0, and the repository becomes public | Accepted; supersedes ADR-080 §1 | 2026-10-02 |
| [088](088-settings-categories.md) | „Podešavanja" becomes eight categories with sub-pages | Accepted | 2026-10-07 |
| [089](089-network-mode-and-update-check.md) | A network mode and an opt-in update check | Accepted | 2026-10-07 |
