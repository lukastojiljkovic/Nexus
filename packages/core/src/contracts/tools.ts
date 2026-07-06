/**
 * A tool a module registers with the utilities host (PRD 29 UTIL). Only
 * identity is modelled here.
 */
export interface ToolRegistration {
  /** Stable tool id, unique within the UTIL registry. */
  id: string;
  /** i18n key for the tool's display name. */
  titleKey: string;
  // The invocation and embedding signatures are resolved when the UTIL tool
  // host lands (PRD 29 UTIL).
}
