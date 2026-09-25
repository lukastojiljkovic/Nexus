# Nexus PRD — Module Request

Use in a fresh session together with `02-prd-system.md` (loaded as the agent's
instructions). Fill in the slots, send, review the output, commit, repeat for
the next module.

---

Write the PRD module: **{MODULE NAME}** → `docs/prd/{NN}-{slug}.md`, ID prefix
`{PREFIX}`.

Before writing:

1. Re-read the sections of `docs/notes/raw-spec.md` and `docs/notes/razrade.md` relevant
   to this module.
2. Read `docs/research/{domain-slug}.md`. If it does not exist, STOP and say so
   — research comes first (`docs/prompts/01-research.md`).
3. Read `docs/prd/00-overview.md` and `docs/prd/glossary.md`.
4. Skim the **Integrations** sections of already-written modules that touch this
   one, so cross-references stay bidirectional and consistent.

While writing:

- Follow the module template from the master instructions exactly.
- Use only this module's ID prefix; number requirements from 001.
- Update `docs/prd/glossary.md` with new terms, and the module registry in
  `00-overview.md` if this module's scope shifted while writing.

When done, report in chat (not in the file): requirement counts by MoSCoW tag,
new glossary terms, open questions added. Then stop — do not begin another
module.
