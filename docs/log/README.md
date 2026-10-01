# The engineering journal

**This is an archive. Nothing in it is a statement about the present.**

Every entry here was true on the day it was written and is kept for one reason:
it records *why* a decision was made, which is the part that does not survive in
the code. What is true **now** lives in [STATUS.md](../STATUS.md); the recurring
failure shapes those entries produced live in
[defect-classes.md](../defect-classes.md).

## Why this exists at all

`STATUS.md` used to be four documents wearing one name: a status, an
append-only wave journal, a defect-class reference, and a queue of open
questions. Only the first is what the document is for. The journal was the part
that grew — 2 122 lines had accumulated *in the header*, above the first
section — and while everything was being appended there, the documents that were
supposed to state the product's direction (`SPECIFICATION.md`, `roadmap.md`, the
root `README.md`) were never touched and drifted into saying the opposite of the
truth.

Splitting them is the fix. A status document that cannot be read in one sitting
stops being read, and then it stops being true.

## What is in here

| File | Covers |
| --- | --- |
| [2026-07.md](2026-07.md) | The docs-first phase, the monorepo, and modules ONE through TEN — through 2026-07-31. |
| [2026-08.md](2026-08.md) | The polish arcs, v1.0.0, the sync subsystem, the professional drawer, v1.1.0, „Elektronika" through E4a — to 2026-08-31. |
| [2026-09.md](2026-09.md) | Through 2026-09-30: the loose ends, E6, the 1.3.0 installer, and the documentation entering version control. |
| [2026-10.md](2026-10.md) | The open-source preparation: the licence premise, the policies, the release pipeline, and the name check. |

## How to read it

Newest first, in both files. The entries are verbatim — relocating them was a
move, not a rewrite, so wording that has since been superseded is left standing
rather than quietly corrected. When an entry and `STATUS.md` disagree,
`STATUS.md` is right and the entry is a record of what was believed at the time.
