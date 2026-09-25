# ADR-066 — The four PRIV refinements: sealed history, close-capture, the unlock-lifetime search index, and blob GC (no migration, no interchange change)

**Status:** accepted (2026-07-31) · **Owner:** supervisor · **Based on:** the four
remainders ADR-057 recorded when PRIV closed (STATUS §4's PRIV paragraph names
them verbatim). Nothing here changes the schema: migration 045 already holds
every column and table these four need.

## 1. Why these four, and why together

ADR-057 shipped the *guarantee* — zero-knowledge notes under a per-profile DEK,
invisible to FTS by construction because the sealed tables get no projection
views. Four things were left standing, each one a place where the guarantee is
honoured but the product is not yet finished:

1. sealed version rows are written, evicted, travel in the archive and restore —
   and **no surface opens one**;
2. versions are captured on an every-Nth-write cadence, so the last edits before
   you walk away can be unrepresented;
3. private notes are unsearchable *at all*, which is the correct default and the
   wrong end state;
4. an un-undone restore can strand `private-blobs/<id>` files with no row.

They are one ADR because they share one lifetime — the unlock. Each is
"something the unlocked section may do that the locked section must not", so
each one's correctness argument is the same argument about `performLock`.

## 2. History (1) — main unseals, the renderer displays

`PrivateNoteStore.listVersions` / `readVersion` / `maxVersionSeq` already exist.
The surface is built on top with no new storage:

- **The listing crosses as the two cleartext facts a version row has** — `seq`
  and `created_at`. Sealed bytes never reach the renderer, in either direction.
- **Reading a version returns cleartext, exactly as the open note already
  does.** This is not a weakening: while the section is unlocked the renderer is
  already holding the note's plaintext, so a version's plaintext is the same
  trust boundary, not a wider one. What must never cross is the *container*.
- **Restore is an edit, not an overwrite.** Restoring version N writes the
  unsealed content as the current sealed state through the ordinary write path,
  so the pre-restore state is captured as a version first and the action undoes
  itself by restoring that. A destructive restore would be the one operation in
  a zero-knowledge store with no recovery, which is exactly the wrong place to
  put one.
- Every local DEK and cleartext copy is zeroed in a `finally`, reusing the
  private main-process zeroing idiom rather than a second one.
- The panel exists only while unlocked and dies with the section.

The public NOTE version-history UI (ADR-015) is the visual model, so the two
histories read as one app; sealing constrains the plumbing, not the shape.

## 3. Close-capture (2) — cadence plus event, with the ordering as the whole point

The every-Nth-write cadence stays; an explicit capture is added when the surface
is left — note switched away, section locked, app locked, window closed —
**if and only if there has been at least one write since the last capture.**
That condition is what makes it idempotent: closing twice, or locking right
after a switch, cannot produce two identical adjacent versions.

The load-bearing detail is ordering: **a capture that runs after the key is
zeroed is a lost capture.** The capture is therefore sequenced ahead of
`performLock`'s teardown, and the ordering itself is tested — not just the
capture.

## 4. The search index (3) — it lives and dies with the unlock

Private notes must stay invisible to FTS *by construction*. So they get their
own search that cannot outlive the unlock:

- built in **main** at unlock (each note unsealed once, title + text indexed in
  memory), dropped and zeroed in `performLock` beside everything else that dies
  there;
- one channel searching it, returning matching ids plus the metadata the private
  list already renders;
- **never registered with the palette, the search page, or FTS.** The
  invisibility stays structural — a filter someone can forget to apply is not
  the same guarantee;
- Serbian folding and `Intl.Collator(["sr-Latn","sr"])` shared with global
  search, so ranking and sorting do not diverge between the two searches.

An in-memory index is also the honest storage answer: a persisted private index
would be a plaintext shadow of the thing whose whole point is that it has none.

## 5. Blob GC (4) — the sweep may not race the undo

A restore or import that is never undone can leave `private-blobs/<id>` files
with no referring row. The sweep diffs the directory against the ids the sealed
store references and deletes the remainder.

**The ordering is the entire correctness argument:** the restore/import undo is
a one-slot snapshot, and a sweep that runs while that slot can still bring rows
back deletes blobs an undo will then need. The sweep hangs off the moment the
slot is discarded, plus a boot-time pass for the crash case. The test that
proves it is the one that restores after a sweep.

Failures while deleting are logged and skipped, never thrown: garbage collection
must not be able to fail the operation that triggered it.

## 6. Consequences

- No migration (047 belongs to ADR-068), no interchange change, no new record
  type. Sealed version rows already travel and already restore — the surface is
  what was missing, and surfaces do not version.
- New channels: list-versions, read-version, restore-version, private search.
  All four are unlock-gated in main, not merely hidden in the renderer.
- The remaining PRIV item after this ADR is v1's recorded exclusion of private
  attachments from the DOC preview window (ADR-064 §Tier 1), which stays out by
  decision, not by omission.
