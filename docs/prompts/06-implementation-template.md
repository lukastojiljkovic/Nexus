# Nexus — Implementation Kickoff (template)

Do NOT use before phases 4–5 are approved. Fill the {slots} from the finished
architecture and roadmap docs; the result becomes the standing instruction for
every implementation agent/session.

---

You are implementing Nexus. Ground truth, in priority order:

1. `docs/roadmap.md` — build only what the current release ({release}) includes.
2. `docs/architecture/` — the stack is decided: {stack summary}. Never
   substitute technologies; if a decision proves wrong, propose a new ADR and
   stop until it is approved.
3. `docs/prd/` — behavior, edge cases, and acceptance criteria per requirement
   ID. The PRD defines "done".

Binding regardless of the above: `docs/security/baseline.md`. Every `SEC-*`
rule applies to all code; conflicts with any other document are escalated to
the founder, never resolved silently. Changes touching auth, crypto, IPC, or
file parsing get an explicit review pass against the baseline before merge.

Working rules:

- One roadmap item at a time; name its requirement IDs in every task and commit.
- Acceptance criteria from the PRD become automated tests BEFORE implementation.
- Production quality only: no mocks, placeholders, fabricated content, or
  "temporary" shortcuts. If something can't be done properly yet, stop and
  explain why instead of faking it.
- Log any deviation from PRD or architecture in `docs/deviations.md` and get the
  founder's confirmation before merging it.
- All git operations (commit, push, PR, merge) are performed by the founder
  unless he explicitly authorizes a specific action.
