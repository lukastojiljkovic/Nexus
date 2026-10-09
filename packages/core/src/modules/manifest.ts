import type { WidgetContract } from "../contracts/widgets.js";
import type { SettingsPanel } from "../contracts/settings.js";
import type { SearchIndexer } from "../contracts/search.js";
import type { StatsContribution } from "../contracts/stats.js";
import type { AutomationCatalog } from "../contracts/automation.js";
import type { ImexHandler } from "../contracts/imex.js";
import type { ToolRegistration } from "../contracts/tools.js";
import type { ModuleCopyDeclaration } from "./copy.js";

/**
 * The registry's navigation groups, in the order they appear in the sidebar
 * (ADR-093). Order is canonical and drives both the sidebar blocks and the
 * launcher's sections; membership is declared by each manifest.
 *
 * These replace the five `category` values ADR-008 took from PRD 00. The five
 * said where a module sat in a SIXTEEN-module rail; with roughly thirty-five
 * coming, a flat group of eight is the same problem one level down, and the
 * six feature groups say what a person is doing rather than which department
 * built it. The ids are ASCII slugs and carry no copy: the labels a user reads
 * live in each locale's table (`strings.app.navGroups`), for the same reason
 * `WidgetContract.title` is a strings path rather than Serbian text.
 *
 * `shell` is not a heading. Its two members are the app's own permanent rows â€”
 * â€žKontrolna tabla" and â€žPodeÅ¡avanja" â€” which the sidebar draws at its two
 * ends, outside every group, because neither can be switched off and neither
 * belongs to a subject. It is a member of this list anyway, so that every
 * manifest declares its place and a test can assert that the shell's members
 * are exactly `LOCKED_MODULE_IDS`.
 */
export const MODULE_GROUPS = [
  "plan",
  "knowledge",
  "life",
  "culture",
  "make",
  "play",
  "shell",
] as const;

export type ModuleGroup = (typeof MODULE_GROUPS)[number];

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
  /** Which navigation group the module is drawn under (ADR-093), in `MODULE_GROUPS` order. */
  group: ModuleGroup;
  /** Whether the module is on when no feature flag is set for it. */
  defaultEnabled: boolean;
  /**
   * Where this module sits among the DISCOVERED (module-kit) modules, ascending,
   * ties broken by id.
   *
   * A kit module is registered after every compiled-in one, on the rule that
   * turns twenty-way conflicts into zero: the shell's own sixteen keep the order
   * they were written in, and the modules that arrive as folders order
   * themselves. Left unset by a compiled-in module, which is what makes "after
   * the existing ones" true by construction rather than by a number.
   */
  order?: number;
  /**
   * The words the shell needs before this module's page loads (see
   * `ModuleCopyDeclaration`). Unset by every compiled-in module: their copy
   * lives in the renderer's `strings` table, which the shell can already read.
   */
  copy?: ModuleCopyDeclaration;

  widgets?: WidgetContract[];
  /** The module's own settings card (SET), composed from this declaration rather than hand-written into the page. */
  settings?: SettingsPanel;
  /** The search kinds this module owns (SRCH): its flag gates their hits, its page opens them. One owner per kind. */
  searchIndexers?: SearchIndexer[];
  statsContributions?: StatsContribution[];
  automation?: AutomationCatalog;
  imex?: ImexHandler;
  tools?: ToolRegistration[];
}
