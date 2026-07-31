import type { WidgetContract } from "../contracts/widgets.js";
import type { SettingsPanel } from "../contracts/settings.js";
import type { SearchIndexer } from "../contracts/search.js";
import type { StatsContribution } from "../contracts/stats.js";
import type { AutomationCatalog } from "../contracts/automation.js";
import type { ImexHandler } from "../contracts/imex.js";
import type { ToolRegistration } from "../contracts/tools.js";

/**
 * The registry category groups, in the order they appear in the navigation
 * sidebar. Order is canonical and drives the sidebar separators (ADR-008
 * decision #11, DASH-008). Source of truth: PRD 00 module registry.
 */
export const MODULE_CATEGORIES = [
  "Core experience",
  "Content & knowledge",
  "Life hubs",
  "Professional & utilities",
  "Growth & platform",
] as const;

export type ModuleCategory = (typeof MODULE_CATEGORIES)[number];

/**
 * The typed declaration every feature module exports (ADR-008). Identity is
 * required; contract slots are optional — a module fills only the ones it
 * participates in. Shapes are fixed here so ONB, SET, SRCH, etc. can be
 * generated from the manifest as the single source of truth.
 */
export interface ModuleManifest {
  /** Kebab-case module id, unique across the registry. */
  id: string;
  /** Permanent PRD prefix, e.g. "TASK" (PRD 00 module registry). */
  prefix: string;
  category: ModuleCategory;
  /** Whether the module is on when no feature flag is set for it. */
  defaultEnabled: boolean;

  widgets?: WidgetContract[];
  /** The module's own settings card (SET), composed from this declaration rather than hand-written into the page. */
  settings?: SettingsPanel;
  searchIndexers?: SearchIndexer[];
  statsContributions?: StatsContribution[];
  automation?: AutomationCatalog;
  imex?: ImexHandler;
  tools?: ToolRegistration[];
}
