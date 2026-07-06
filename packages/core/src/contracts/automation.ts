/**
 * A trigger a module publishes for the automation engine's `trigger → action`
 * rules (PRD 34 AUTO). Only identity is modelled here.
 */
export interface AutomationTrigger {
  /** Stable trigger id, unique within its module. */
  id: string;
  /** i18n key for the trigger's display label. */
  labelKey: string;
  // The event payload and condition typing are resolved when the AUTO engine
  // lands (PRD 34 AUTO).
}

/**
 * An action a module publishes for automation rules (PRD 34 AUTO). Only
 * identity is modelled here.
 */
export interface AutomationAction {
  /** Stable action id, unique within its module. */
  id: string;
  /** i18n key for the action's display label. */
  labelKey: string;
  // The parameter schema and execution signature are resolved when the AUTO
  // engine lands (PRD 34 AUTO).
}

/** The triggers and actions a module exposes to automation (PRD 34 AUTO). */
export interface AutomationCatalog {
  triggers: AutomationTrigger[];
  actions: AutomationAction[];
}
