# PRD 35 — AI Assistant (AI) — deferred stub (W v1)

**Status:** deferred post-v1 (registry decision). Groundwork already placed
so the drop-in is cheap.

## Recorded intent

In-app assistant for organization, writing, summarization, analysis, and
import (raw-spec §26; "kasnije ubacujemo naš LLM" — IMEX §6). Long-term
vision: the interchange format (IMEX-004) is the stable contract — the
assistant converts/creates through it instead of touching internals.

## Constraints already binding when revived

- SEC-EXT-02: all model output is untrusted input; schema validation before
  any write; explicit confirmation for actions.
- SEC-ZK-06: private notes never enter any AI feature without per-
  interaction opt-in.
- SEC-PRIV: local accounts → local models only (or no AI); cloud AI strictly
  opt-in with visible data-flow disclosure.
- Design system: AI surfaces follow the same tokens; no "magic sparkle"
  clichés (anti-generic mandate).

## Revival gate

Own PRD + ADRs (model strategy: local vs API vs hybrid; cost model), after
v1 ships. Candidate first features (cheap, high-value): import assistant
(replaces copy-paste prompts), note summarization, plan-my-day heuristic
upgrade.
