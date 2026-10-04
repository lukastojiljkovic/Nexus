# Nexus documentation

**This is the map of the record.** The specification, the decisions, the
journal, the defect ledger, the security rules and the research that produced
them are all version-controlled beside the code. The repository is public, and
this tree is written to be read by someone who has never seen the project.

Two kinds of document live here. **Current-state documents** — `STATUS.md`,
`OVERVIEW.md`, `SPECIFICATION.md`, `VISION.md`, `roadmap.md`, the security
baseline, the defect ledger — say what is true now and are kept current. **Dated
records** — the journal in `log/`, the ADR bodies, the prompt files, the dated
PRDs and research notes — say what was true the day they were written and are
not rewritten; a record that no longer describes the present is still evidence
of why the present looks the way it does.

**Seven documents were moved out of the repository on 2026-10-02**, when the
project was being prepared for its public release: the open-source readiness
audit, the name and trademark check, the DC-42 findings list, the sync-hardening
specification, the landing-page PRD, and the founder's raw specification and its
module elaborations. They were working documents that described security posture
or unreleased product, or that belonged to the author rather than the project;
the decisions taken from them live on in the ADRs and in `STATUS.md`. Dated
records still cite them by name as the inputs they were written from — that is
history, not a live link.

## Understand the product

| Read | What it is, and when |
| --- | --- |
| [OVERVIEW.md](OVERVIEW.md) | The product in everyday language, module by module. Start here if you have just heard of Nexus. |
| [SPECIFICATION.md](SPECIFICATION.md) | The full specification behind the product: architecture, data model, security posture, module contracts. Read it after `OVERVIEW.md` when you need the detail a feature rests on. |
| [VISION.md](VISION.md) | The founder-approved north star, and the one document the others may not contradict. Read it first when a decision looks arbitrary. |
| [prd/00-overview.md](prd/00-overview.md) | The module registry and the way into `prd/` — 37 numbered requirements documents plus a glossary. Read the overview, then the module you care about; the requirement IDs there are what the ADRs and tests cite. |
| [roadmap.md](roadmap.md) | What order the work happens in, and why. Read it for sequence; `STATUS.md` is what is true today. |

## Understand the architecture

| Read | What it is, and when |
| --- | --- |
| [architecture/overview.md](architecture/overview.md) | The shape of the system — surfaces, monorepo layout, build and test strategy, and the risks still open. Read it to see how the parts fit together. |
| [architecture/adr/README.md](architecture/adr/README.md) | One table of every architecture decision: number, title, status and date, each read from the ADR's own status line. Read it to find the decision behind any part of the system. |
| [prd/glossary.md](prd/glossary.md) | The shared vocabulary the specification and the code use. Read it when a term in an ADR or a PRD is not obvious. |

## Follow the work

| Read | What it is, and when |
| --- | --- |
| [STATUS.md](STATUS.md) | What exists, what works, what is missing, and which open items are blocking. Read it first when you want the project's real state. |
| [log/README.md](log/README.md) | The engineering journal, kept by month, recording why each decision was made. Read it when you want the reasoning rather than the outcome. |
| [defect-classes.md](defect-classes.md) | The recurring failure shapes — a defect is worked as a sample of a class — and the gates that enforce the ones a check can answer. Read it before fixing a bug, and add a class when a defect turns out to be a shape. |
| [deviations.md](deviations.md) | Where the build knowingly departs from a PRD or an ADR, and who signed it off. Read it before "correcting" something that looks wrong. |
| [log/superseded-status-sections.md](log/superseded-status-sections.md) | The sections cut out of `STATUS.md` when it was reorganised, kept verbatim. Read it when an old status report is quoted and you need the text it came from. |

## Security

| Read | What it is, and when |
| --- | --- |
| [security/baseline.md](security/baseline.md) | The binding `SEC-*` rules every change has to satisfy. Read it before touching storage, crypto, IPC or the wire. |
| [security/threat-models/ELEC-E6-runner.md](security/threat-models/ELEC-E6-runner.md) | The threat model for the one capability that runs a program Nexus did not write. Read it before changing the electronics runner or its permissions. |
| [deviations.md](deviations.md) | Signed departures from a security rule or a PRD requirement, with the reason and the owner. Read it when a rule appears to be broken on purpose. |

## Design

| Read | What it is, and when |
| --- | --- |
| [design/direction-brief.md](design/direction-brief.md) | The 2026-07-05 visual direction brief and its four mockups. Read it before changing the design system; the direction that won is now the token set in `packages/tokens`. |

## Research

| Read | What it is, and when |
| --- | --- |
| [research/](research/) | Nine domain research passes from 2026-07 (offline sync, private-note crypto, the design system, the canvas, file preview, finance, study, nutrition, onboarding) that fed the ADRs. Read a pass when an ADR's conclusion is not enough and you want the workings. |

## How the specification was produced

| Read | What it is, and when |
| --- | --- |
| [prompts/README.md](prompts/README.md) | The prompt pipeline that produced `prd/`, `research/`, `architecture/` and `roadmap.md` in 2026-07. Read it to see how the specification was written; it has done its job and is not re-run. |

## Operations

| Read | What it is, and when |
| --- | --- |
| [ops/github-setup.md](ops/github-setup.md) | The repository settings that live in the GitHub web UI rather than in a file. Read it when a check, a scan or a branch rule behaves differently from what the workflows promise. |

## Conventions

- **Documents are English. User-facing copy is Serbian** and lives in
  `strings.sr.ts`, never here.
- **A document that has stopped being true is worse than a missing one.** When
  work finishes, the status moves in `STATUS.md` and the narrative moves to
  `log/` — in the same pass, not later.
- **Never fabricate a number.** No invented statistics, foods, benchmarks or
  citations anywhere in here, including in a document nobody will read. Figures
  are counted from the repository, never copied from another sentence that was
  already carrying one.
- **ADRs are immutable once accepted.** A decision that changes gets a *new*
  ADR that says what it supersedes; the old one keeps its number and its status
  line records the supersession.
