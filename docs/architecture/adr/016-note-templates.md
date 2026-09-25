# ADR-016 — NOTE Templates (built-in + user-defined)

**Status:** accepted · 2026-07-25.
**Drives:** NOTE-009 (PRD 09: "note templates — sastanak, recept, dnevnik,
predmet… with user-defined templates; profession packs may add templates"),
plus PRD 09 §7's binding edge case: **"Template applied over existing content →
insert, never replace."**

## Context

Every note is a Yjs document (ADR-012): an update log plus a merged snapshot,
edited through TipTap's Collaboration binding. A *template* is a different kind
of object entirely — a reusable piece of **content to insert**, with no
identity in the note graph, no history, no concurrent editing, and no
attachments of its own.

That distinction is the whole design. Everything below follows from refusing to
model a template as a note.

## Decision

### Storage: a standalone `note_templates` table, content as ProseMirror JSON

```sql
CREATE TABLE note_templates (
  id          TEXT PRIMARY KEY,
  profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  content     TEXT NOT NULL,          -- a ProseMirror document, JSON-encoded
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX note_templates_profile_name ON note_templates (profile_id, name);
```

Migration 015. No soft delete: a template carries no history worth preserving
and nothing references it, so `deleteTemplate` is a hard delete (the same call
the user can immediately undo by saving the note again as a template). The
UNIQUE index makes the name the user-facing identity of a template and is what
"save under an existing name replaces it" relies on.

**Content is ProseMirror JSON, not a Yjs snapshot.** Templates are never
concurrently edited, so CRDT machinery buys nothing here and costs a conversion
at both ends. With PM JSON, both operations collapse to one TipTap call each:

- apply → `editor.chain().focus(…).insertContent(json).run()` — the
  Collaboration binding turns that into ordinary Yjs ops, so applying a
  template is an ordinary forward edit that the existing debounced flush
  persists. Nothing in the save path learns about templates.
- capture → `editor.getJSON()`.

The cost is that stored JSON is coupled to the editor schema. This is
acceptable and bounded: ProseMirror's parser **drops** unknown nodes and marks
rather than throwing, so a template written by an older build degrades to its
recognizable blocks instead of failing to open. Recorded here so the coupling
is a known one.

### Rejected: template = note with an `is_template` flag

Superficially the most powerful option (templates become editable in the real
editor, for free). Rejected because it forces `is_template = 0` into **every**
existing query over `notes` — the list, the folder scoping, wiki-link
autocomplete, the backlink index, IMEX export, dashboard counts — turning a new
feature into a pervasive edit of the shipped live path, where one missed call
site silently leaks templates into search results or the link graph. The whole
value of NOTE-008's design was leaving the live path untouched; the same
instinct applies.

### Rejected: template content as a Yjs snapshot

Then apply needs Yjs → PM (a throwaway doc plus a headless editor to read JSON
out of it) and capture needs PM → Yjs, and stripping attachment nodes (below)
means walking a `Y.XmlFragment` instead of a plain object. All of it to model
concurrency a template never has.

### Built-in templates are code, not seeded rows

The five v1 templates (**Sastanak, Dnevnik, Recept, Predmet, Projekat** — PRD
09's named set plus one) live as PM-JSON constants in the renderer
(`noteTemplates.ts`), not as rows inserted by a migration. They therefore ship
and evolve with the app, need no per-profile seeding, cannot be corrupted by a
half-run migration, and are the exact shape a future profession pack (PRD 30)
would contribute. They are addressed by a `builtin:` id prefix, which is also
what makes them non-renameable and non-deletable without a flag column.

Their Serbian body text sits inline with the structure rather than in
`strings.ts` — a template body is structure-bearing content, not a label, and
splitting the two would leave both unreadable. `noteTemplates.ts` is part of
the future mechanical i18n extraction, noted in its doc comment. Template
*names* remain in `strings.ts` like every other label.

### Applying: insert, never replace — with two honest placements

PRD 09 §7 forbids replacing existing content. Both entry points insert:

| Entry point | Placement | Why |
| --- | --- | --- |
| Šabloni pane ("Umetni šablon") | appended at the **end** of the note | The editor is not on screen in pane mode; appending is predictable and never pushes existing content down. The pane's caption says so. |
| Slash menu (`/`, slice 009-c) | at the **caret**, replacing the typed `/query` | The precise-placement path, identical to every other slash command. |

The pane mode unmounts `EditorCanvas` (the same ternary "Istorija verzija"
uses), so there is no live editor instance to insert into while the picker is
open. The pane therefore hands the chosen JSON up as a *pending insert*;
`NoteEditor` switches back to edit mode, and `EditorCanvas` applies it in an
effect once its editor exists, then clears it. No hidden-but-mounted editor, no
second Yjs code path.

### Capture: "Sačuvaj kao šablon", with attachment blocks stripped

Saving the current note as a template takes `editor.getJSON()` and removes
every `attachmentImage` node first. Those nodes carry an attachment id owned by
the *source* note; inserted into a different note they resolve to nothing and
render the honest "Prilog je uklonjen" placeholder — a template that always
looks broken. Wiki-link (`noteLink`) nodes are deliberately **kept**: a link to
a real note stays valid from any note, and a template that seeds a link to a
project index is a feature.

The stripping is a renderer-side content decision, the same trust model as the
renderer-declared `title` on `notes:append-update` and `targetIds` on
`notes:set-links` — the renderer authors its own document content. It is not a
security control, and nothing depends on it being one: a template that
smuggled a foreign attachment id would still render the removed-attachment
placeholder, because the `AttachmentImage` NodeView resolves ids against the
*open note's* attachment map and the `nx-blob:` protocol serves by content
hash, never by a renderer-supplied path.

### The IPC boundary (SEC-EL)

Four channels — `notes:templates-list`, `notes:template-save`,
`notes:template-rename`, `notes:template-delete` — each `assertTrustedSender`
first, `asRecord` + per-field validators, one frozen preload method apiece.
Main validates shape and size (`NOTE_TEMPLATE_MAX_BYTES = 262_144`, the same
cap as a note update blob); the store re-validates semantics: trimmed name,
1–100 characters, content that is non-empty, within the cap, and parses to an
object with `type: "doc"`. A rename onto another template's name surfaces as a
domain `NoteTemplateValidationError`, never a raw UNIQUE driver error — the
`renameTag` precedent.

### Naming is the edit mechanism

There is no template editor. A user edits a template by applying it, changing
the note, and saving under the **same name**, which replaces the stored
content (`save` is an upsert on `(profile_id, name)`). The UI states this
plainly before it happens — when the typed name matches an existing template,
the form shows that saving will overwrite it. Renaming and deleting are
per-row actions in the picker, on the established `NotePopover` pattern.

## Slices

- **009-a — substrate.** Migration 015, `NoteTemplateStore` (list / save /
  rename / delete) with TDD tests, `NoteTemplateValidationError` +
  `NoteTemplateNotFoundError`, the four IPC channels, handlers, preload
  methods, and shared wire types.
- **009-b — the Šabloni pane.** Built-in template constants, the in-pane
  picker (grouped list, read-only preview, insert), "Sačuvaj kao šablon" with
  attachment stripping, rename/delete, strings, CSS.
- **009-c — slash-menu insertion.** A "Šabloni" group in the `/` menu that
  inserts at the caret, fed a live template list through a stable ref.

## Explicitly not in v1

**Default new-note template per folder** (PRD 09 §5). It is a *setting*, and it
belongs with the other unbuilt NOTE settings — editor width, markdown-shortcut
toggles, default folder for quick captures — in one coherent NOTE preferences
pass, not bolted onto the templates feature. It also needs a nullable column on
`note_folders` that cannot be a foreign key (built-in ids are not rows) plus a
create-then-apply handshake through the note list. Recorded in STATUS §4.

**Template folders/categories and profession packs.** The picker's two groups
(Ugrađeni / Moji šabloni) carry v1's handful of templates without hierarchy.
PRD 30's packs contribute built-ins through the same constant shape when that
module lands.

## Consequences

- Zero changes to the note read/write path, the link index, or IMEX. The
  feature is additive: one table, four channels, one editor pane.
- A template is not searchable and does not appear in the note list — correct,
  and the direct consequence of not modelling it as a note.
- Stored JSON is editor-schema-coupled; block-set changes degrade old
  templates gracefully (unknown nodes dropped) rather than breaking them.
- Attachments are never part of a template. A user who wants a template with an
  image needs the image in the note; this is stated in the UI copy, not
  discovered.
