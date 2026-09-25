# ADR-008 — Module System, Feature Flags & the Plugin Path

**Status:** accepted (draft pending founder sign-off) · 2026-07-05
**Drives:** ONB flag mapping, SET module gallery, every module's
registration; PLUG stub discipline ("build the contracts, not the door");
SEC-EXT-01 (constrains the future, not v1).

## Context

37 modules, each hideable per user/profile, onboarding-driven defaults,
and a future plugin API that must not require re-architecting. The PRD
already forces the key idea: internal contracts (widgets, views, settings,
search, stats, triggers/actions, IMEX, tools) that every internal module
consumes *as if external*.

## Decision

- **Static registry, dynamic flags.** v1 modules are compiled in and
  declared in a typed **module manifest** (in `packages/core`): id +
  permanent prefix, category (registry groups drive the sidebar separators,
  decision #11), default-flag logic (ONB mapping), and the contract
  implementations it exports — widgets (DASH), views/collections (views
  engine), settings schema (SET, with a per-setting `device|synced` scope
  flag — SET OQ#3), search indexers (SRCH), stats contributions (STATS),
  triggers/actions (AUTO), IMEX handlers, tool registrations (UTIL).
- **Flags are data:** per-profile rows (synced like any row, ADR-002);
  disabling a module unmounts UI, widgets, and indexers but never touches
  data (ONB-008/SET-007 semantics — acceptance-tested round-trip).
- **Contract discipline is enforced, not aspirational:** modules may import
  `core` contracts and their own package — a lint rule forbids
  cross-module imports. If TASK needs NOTE data, it goes through a
  published contract or doesn't happen. This is the real plugin
  groundwork: the day PLUG revives, third-party code targets the same
  contracts.
- **Deliberately NOT built now** (PLUG stub revival gate): plugin loading,
  sandboxing, capability grants, signing, marketplace. When revived, the
  execution model must satisfy SEC-EXT-01 (out-of-process/worker sandbox,
  capability-based API, declared permissions, user approval); the typed
  IPC query interface from ADR-001 is the natural data-access boundary to
  wrap capabilities around. PRO pack distribution (PRO OQ#2) is the
  stepping stone.

## Consequences

- Slightly more ceremony per module (manifest + contracts instead of
  direct imports) — the price of the plugin future and of ONB/SET working
  uniformly; templates in the implementation prompts keep it cheap.
- The manifest is introspectable: SET's module gallery, ONB's mapping, and
  SRCH's indexer wiring are all generated from it — one source of truth.
- Contract versioning starts at v1 as plain semver on the TS types;
  breaking a contract is a reviewed event even pre-plugins.
