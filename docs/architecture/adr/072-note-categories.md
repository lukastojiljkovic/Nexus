# ADR-072 — Note categories: NOTE-002's last unbuilt half (migration 049, interchange 1.27.0)

**Status:** accepted (2026-07-31) · **Owner:** supervisor · **Requested by the
founder** (asked directly whether he wanted it at all; answer: „može").

## 1. Three axes, and why the third is not a fourth spelling of "tag"

NOTE-002 named folders, tags and a **category**. Folders (migration 011's
self-referencing tree with swatch colours) and tags (`note_tags` +
`note_tag_links`, the „Oznake" filter chips) shipped long ago; the per-folder
default view followed in migration 039. The category was the remainder, and it
only earns its place if it stays distinguishable:

- a **folder** is *where a note lives* — one per note, hierarchical, a place;
- a **tag** is *what a note is about* — many per note, flat, a subject;
- a **category** is *what KIND of thing this note is* — **exactly one per note,
  optional, flat** (sastanak, ideja, dnevnik, recept…). Its type, not its topic
  and not its location.

That definition goes into the store's module doc, because the next reader will
otherwise "simplify" it into tags.

## 2. Shape

Migration **049**: a per-profile `note_categories` table borrowing
`note_folders`' vocabulary exactly where the two genuinely coincide (id,
profile_id, name, a swatch from the same closed palette, ordering, the siblings'
soft-delete semantics) — but **flat, with no `parent_id`**. A category tree is a
folder tree, and shipping two of those is the mistake this design exists to
avoid. Plus one nullable `category_id` on `notes`.

- **Deleting a category never deletes notes** — they become uncategorized. The
  rule is matched to whatever the codebase already does for a deleted tag or
  folder rather than invented as a third behaviour.
- Name uniqueness per profile reuses the comparison the existing tag and folder
  rules already use.
- Methods sit on `NoteOrgStore` beside the folder and tag ones, same idioms,
  same named errors, every statement `profile_id`-scoped; channels alongside the
  existing organization channels, validated like their siblings.

## 3. UI

The organizer gains a third section using the folder tree's own row markup,
inline edit and swatch recolour — no new visual language. A note's category is
set from the same popover that already carries move-to-folder and tag
attach/detach; filtering works like the tag chips; the row shows it as a muted
chip. Serbian copy in `strings.ts`, sorted with `Intl.Collator(["sr-Latn","sr"])`.

## 4. Travel

Categories are profile content, so they travel: a new record type on the
existing shape, with the note's `category_id` carried and **remapped on foreign
import** exactly as folder ids are. Restore, foreign import and the parser must
agree, and the parser rejects a note naming a category its own archive does not
contain, with a line number. Interchange **1.27.0**; too-new fixtures move to
`1.28.0`.

Foreign-import dedup is decided from the existing precedents rather than picked
at random — tags dedupe by exact name, the source's default list collapses into
yours, and a task template whose name you hold is skipped because additive-only
forbids overwriting — and the choice is argued in the code.
