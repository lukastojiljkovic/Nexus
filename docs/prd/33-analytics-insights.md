# PRD 33 — Analytics & Insights (STATS) — compact (C-tier)

**Status:** draft 2026-07-05. Inputs: raw-spec §26 (statistika korišćenja,
heatmap), Nexus Wrapped idea, chart mini-design-system, SEC-PRIV (all
computation local).

## Purpose

The user's mirror, not our telemetry: personal statistics across modules —
activity heatmap, trends, correlations, and the yearly "Nexus Wrapped".
Everything computed locally from the user's own data.

## Functional requirements

- **STATS-001 (M)** Personal stats hub: per-module stat pages aggregate
  through a stats contract (each module declares metrics + queries);
  cross-module overview (activity heatmap of all completions/entries,
  GitHub-style).
- **STATS-002 (M)** Semantic-metric consistency: one definition per metric
  app-wide (design-system research conclusion #5) — the contract enforces
  it.
- **STATS-003 (S)** Correlations view (opt-in compute): sleep-proxy/mood
  (HABIT) × focus hours (STUDY/TIME) × training (FIT) — shown as "uočeno",
  never as causal claims.
- **STATS-004 (S)** "Nexus Wrapped": auto-generated yearly review (tasks
  done, exams passed, hours focused, books finished, kilometers, savings) —
  shareable as image (user-triggered, local render).
- **STATS-005 (C)** Weekly digest screen (opt-in NTF Sunday summary).

## Integrations

All modules (stats contract); DASH (mini-chart widgets reuse queries); NTF
(digest); chart kit (all rendering).

## Edge cases

Sparse data → honest empty/partial states, no extrapolation; heatmap with
years of data → aggregation performance budget; Wrapped with < 3 months of
data → "prerano je" state.

## Open questions

1. ~~First correlation.~~ **Decided (founder 2026-07-05): mood × focus.**
2. Wrapped share-image branding (ties to LAND/design session).
