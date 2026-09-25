# PRD 36 — Plugin System (PLUG) — deferred stub (W v1)

**Status:** deferred post-v1 (registry decision). Architecture must keep
the door open without building the door.

## Recorded intent

Third-party modules without touching the core (raw-spec §26). The internal
contracts already being built are the future plugin API surface: module
registry, feature flags, widget contract (DASH), views engine, tool
registry (UTIL-011), stats contract (STATS-001), trigger/action catalog
(AUTO), settings contract (SET), IMEX module contract, SRCH indexing
contract. Rule for v1 development: **every internal module consumes these
contracts as if it were external** — that discipline is the real plugin
groundwork.

## Constraints already binding when revived

SEC-EXT-01 (sandboxed execution, capability-based API, declared permissions,
user approval, no eval in privileged contexts); signed distribution;
review process; API versioning policy.

## Revival gate

Post-v1 + dedicated PRD + security design review (this is remote-code
territory — highest-risk feature in the registry). PRO pack distribution
(PRO OQ#2) is the natural stepping stone.
