# The engineering journal

**This is an archive. Nothing in it is a statement about the present.**

Every entry here was true on the day it was written and is kept for one reason:
it records *why* a decision was made, which is the part that does not survive in
the code. What is true **now** lives in [STATUS.md](../STATUS.md); the recurring
failure shapes those entries produced live in
[defect-classes.md](../defect-classes.md).

## What is in here

| File | Covers |
| --- | --- |
| [2026-07.md](2026-07.md) | The founding: the docs-first phase (vision, PRDs, research, ADRs 001–011), the monorepo and its gates, encryption at rest, and modules one through ten. |
| [2026-08.md](2026-08.md) | The desktop becoming a product: the polish arcs, the drawn-data layer, v1.0.0, twelve sync slices, the eighteen-toolkit professional drawer, Linux packaging, and v1.1.0. |
| [2026-09.md](2026-09.md) | The loose ends and the electronics arc: the editor-exit defects, E4b/E4c/E6, page-level chunking, the screenshot sweep and the gates it produced, the 1.3.0 installer, and the documentation entering version control. |
| [2026-10.md](2026-10.md) | Preparing the public release: Apache-2.0, the policies and issue forms, the release pipeline, the hardened Electron package, two closed server gaps, the website, and the seven working documents moved out of the repository. |
| [superseded-status-sections.md](superseded-status-sections.md) | The sections cut out of `STATUS.md` when it was reorganised, kept verbatim — including the finished-work sections moved out on 2026-09-26 and the roadmap as cut on 2026-08-16. |

## How the journal is kept

- **One file per month.** An entry is appended to the file for the month it
  describes, so the record grows at the end rather than in a single document
  that would swallow `STATUS.md` again.
- **Newest first inside a file.** The most recent entry is the one nearest the
  top, and each file opens with a short summary of its month.
- **Entries are verbatim.** Relocating an entry is a move, not a rewrite, so
  wording that has since been superseded is left standing rather than quietly
  corrected. An entry that disagrees with `STATUS.md` is a record of what was
  believed at the time; `STATUS.md` is right about today.
- **Done work leaves `STATUS.md`.** When a section of `STATUS.md` stops being
  about the present, it moves here in the same pass, rather than staying and
  going stale.
