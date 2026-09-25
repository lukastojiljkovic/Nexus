# ADR-036 — The NOTE preferences pass

**Status:** accepted · 2026-07-30
**Drives:** the NOTE remainder STATUS §4 batches as "one coherent
NOTE-preferences pass": the default new-note template per folder (PRD 09 §5,
deferred by ADR-016), editor width, the markdown-shortcut toggle, and the
default folder for quick captures. Wave-3 Lane H.

## Decision

### 1. Per-folder default template (migration 028)

- `note_folders.default_template_id TEXT NULL` — **deliberately not a foreign
  key**: built-in templates are code constants (ADR-016), so the column may
  name a constant's id or a `note_templates` row id. The store validates the
  id against the union at SET time; at APPLY time a dangling id (template
  deleted since) quietly means "no template" — a folder must never refuse to
  create a note.
- `NoteOrgStore.setDefaultTemplate(folderId, templateId | null)`; folder rows
  carry `defaultTemplateId`. The organizer's folder menu gains "Podrazumevani
  šablon" → the same template list the Šabloni pane shows (built-ins +
  user's), plus "Bez šablona".
- **Create-then-apply handshake:** creating a note *in a folder that has one*
  applies the template into the EMPTY new note through the exact insert path
  the Šabloni pane already uses (append into an empty doc = the whole
  content). Only on create-in-folder; "Sve beleške"/"Bez fascikle" creates
  stay blank.

### 2. Default quick-capture folder (same migration)

- `note_folders.is_capture_default INTEGER NOT NULL DEFAULT 0 CHECK (0,1)` —
  at most one per profile, enforced by the store in a transaction (setting
  one clears the others; deleting that folder simply leaves none).
  `NoteOrgStore.setCaptureDefault(folderId | null)`.
- The palette command "Nova beleška" and any other create-without-context
  path creates INTO that folder when set (and then the folder's default
  template applies — the two features compose). The organizer's folder menu
  gains the toggle ("Fascikla za brzi unos").

### 3. Renderer-only preferences (no schema)

- **Editor width** — `nexus.noteWidth` in localStorage (the theme/accent
  idiom): `uska` (55ch) / `normalna` (70ch, today's value, default) /
  `siroka` (90ch), applied to the editor column's measure.
- **Markdown shortcuts toggle** — `nexus.noteMarkdownShortcuts`, default on;
  off disables TipTap's input-rule shortcuts while the slash menu keeps
  working (the menu is discoverable, the rules are the surprise someone might
  want off). Read at editor mount; page switching remounts.
- Both controls live in a new **"Beleške" card in Settings** (between Izgled
  and Moduli), with `settingsSearch.ts` entries so SET-014 finds them.

### 4. Interchange 1.6.0 → 1.7.0 with an era flag

`ExportNoteFolder` gains required `defaultTemplateId` (string | null — may
name a built-in constant) and `isCaptureDefault` (boolean). Era flag
`writesNoteFolderPrefs` (minor ≥ 7, the ADR-028 rule): absence defaults to
null/false in older eras, PRESENT keys strict everywhere. `RestoreStore`
writes both columns. A restored `defaultTemplateId` that names a template the
archive did not carry falls back to "no template" at apply time by §1's
dangling-id rule — no restore-time validation needed.

## Consequences

- The two db features ride `note_folders` — no new table, no new module.
- Width/shortcut prefs are device-local by design (they are about this
  screen and this keyboard, not the data); recorded so nobody "fixes" them
  into the archive.
- The Settings "Beleške" card is the first module-specific card — the
  hand-composed page grows one more section; the per-module settings
  CONTRACT (SET remainder) stays future work.
