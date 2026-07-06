/**
 * A metric a module contributes to the analytics surface (PRD 33 STATS). Only
 * identity is modelled here.
 */
export interface StatsContribution {
  /** Stable metric id, unique within its module. */
  id: string;
  /** i18n key for the metric's display label. */
  labelKey: string;
  // The metric computation and aggregation signatures are resolved when the
  // STATS engine lands (PRD 33 STATS, ADR-001 typed query interface).
}
