# Nexus — LLM Agent Prompt Pipeline

> **Historical. Do not run these.** This pipeline produced `prd/`, `research/`,
> `architecture/` and `roadmap.md` over 2026-07-04/05 and has done its job. It
> is kept because several documents cite it as their provenance („drafted per
> `docs/prompts/04-architecture.md`"), and because the reasoning about *how* the
> documentation phase was sequenced is worth not re-deriving. Re-running any
> phase would regenerate documents the product has since overtaken.
>
> How the project works now is `CLAUDE.md` at the repository root.

Prompts for driving an LLM agent (Claude Code or similar — needs file access and
web search) through the documentation and planning phases of Nexus. Run the
phases in order; each produces files that the next consumes. Files in this repo,
not chat history, are the source of truth.

| Phase | Prompt | Produces |
| ----- | ------ | -------- |
| 1. Research | `01-research.md` — once per domain | `docs/research/<domain>.md` |
| 2. PRD setup | `02-prd-system.md` — once | `docs/prd/00-overview.md` (vision, personas, module registry, glossary) |
| 3. PRD modules | `03-prd-module.md` — once per module | `docs/prd/<nn>-<module>.md` |
| 4. Architecture | `04-architecture.md` — once, after PRD review | `docs/architecture/` + ADRs |
| 5. Roadmap | `05-roadmap.md` — once | `docs/roadmap.md` |
| 6. Implementation | `06-implementation-template.md` — fill in after 4–5 | standing instructions for coding agents |

## Rules of use

- All product ideas live in `docs/notes/` — raw ideas in `raw-spec.md` (append-only),
  detailed module elaborations in `razrade.md`. Never carried only in prompts or
  chat.
- **One module per session.** Fresh session, load `02-prd-system.md` as the
  agent's instructions, then send a filled-in `03-prd-module.md`. Long sessions
  degrade quality; the file-based glossary and registry keep modules consistent
  across sessions instead.
- Review each phase's output before starting the next. All documentation is
  private: it stays local and untracked (see `.gitignore`) and is never
  committed or pushed — founder decision, 2026-07-04.
- Phases 2–3 deliberately forbid technology choices. All "how" decisions happen
  in phase 4, recorded as ADRs, so the PRD stays valid even if the stack changes.
- Research (phase 1) must exist for a domain before its PRD module is written —
  `03-prd-module.md` enforces this.
- `docs/VISION.md` is the approved north star for all phases.
  `docs/security/baseline.md` is the binding security standard (`SEC-*` rules)
  for phases 4–6; deviations require founder sign-off in `docs/deviations.md`.
