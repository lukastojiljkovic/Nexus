# Nexus documentation

These documents describe the product, how it is built and why. They are
version-controlled with the code. The repository is private; several of these
files describe security posture or unreleased product, so that stays true.

## Start here

| If you want to know | Read |
| --- | --- |
| **Where the project is right now**, and what is left | [STATUS.md](STATUS.md) |
| **What Nexus is**, in everyday language | [OVERVIEW.md](OVERVIEW.md) |
| **What Nexus will be** — every module and system | [SPECIFICATION.md](SPECIFICATION.md) |
| **Why** — the north star the rest must not contradict | [VISION.md](VISION.md) |
| **In what order** | [roadmap.md](roadmap.md) |

Those five are the live documents. If two of them disagree, `STATUS.md` is
right about today and `VISION.md` is right about intent.

## Reference

| | |
| --- | --- |
| [defect-classes.md](defect-classes.md) | The recurring failure shapes. A defect is worked as a *sample of a class*, and the class earns a line here the first time it is recognised. The file's own header states how many classes and how many gates there are, and how it counts them — no figure is copied here, because copies go stale. |
| [security/baseline.md](security/baseline.md) | The binding `SEC-*` rules. Deviations need founder sign-off in [deviations.md](deviations.md). |
| [security/sync-hardening-spec-2026-08-08.md](security/sync-hardening-spec-2026-08-08.md) | The red-team pass over the sync design, and the blockers B1–B10 it produced. |
| [architecture/overview.md](architecture/overview.md) | The shape of the system, and the index of every ADR in [architecture/adr/](architecture/adr/). |
| [prd/00-overview.md](prd/00-overview.md) | The module registry and the way into `prd/` — one requirements document per module plus a glossary. Still the requirement IDs everything cites. |
| [deviations.md](deviations.md) | Where the build knowingly departs from a PRD or an ADR, and who signed it off. |
| [ops/github-setup.md](ops/github-setup.md) | One-time repository setup that has to happen in the GitHub web UI. |

## History

Kept, not live. Read these for *why* a decision was made, which is the part that
does not usually survive in the code.

| | |
| --- | --- |
| [log/README.md](log/README.md) | The engineering journal, by month. It also holds the sections cut out of `STATUS.md` when it was reorganised, including the finished-work sections moved out on 2026-09-26. |
| [notes/raw-spec.md](notes/raw-spec.md) | The founder's raw brain-dump, with the module elaborations in [razrade.md](notes/razrade.md) beside it. In Serbian. |
| `research/` | Nine domain research passes from 2026-07 that fed the ADRs. Their conclusions live on in the ADRs; the workings are here. |
| [prompts/README.md](prompts/README.md) | The prompt pipeline that produced `prd/`, `research/`, `architecture/` and `roadmap.md` in 2026-07. It has done its job and is not re-run. |
| [design/direction-brief.md](design/direction-brief.md) | The 2026-07-05 direction brief and its four HTML mockups. The direction that won is now in `packages/tokens`. |
| [dc42-findings.md](dc42-findings.md) | The full 168-finding list behind DC-42. Read the `reach` column first — 163 of the 168 need an input no user can produce. |

## Conventions

- **Documents are English. User-facing copy is Serbian** and lives in
  `strings.ts`, never here.
- **A document that has stopped being true is worse than a missing one.** When
  work finishes, the status moves in `STATUS.md` and the narrative moves to
  `log/` — in the same pass, not later.
- **Never fabricate a number.** No invented statistics, foods, benchmarks or
  citations anywhere in here, including in a document nobody will read.
- ADRs are immutable once accepted. A decision that changes gets a *new* ADR
  that says what it supersedes; the old one keeps its number and gains a banner.
