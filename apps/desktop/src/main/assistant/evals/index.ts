/**
 * The evals' public surface: the scenario format and its validator, the
 * detectors, the harness, and the two report writers.
 *
 * The scripted mode (`scripted.ts`) and the runner under `scripts/` are the two
 * callers; nothing else imports this directory yet, which is expected — the
 * assistant's own module is built in the wave that follows this one.
 */

export { detectDoesNotKnow, detectLanguage, type ReplyLanguage } from "./language.js";
export {
  parseScenario,
  parseScenarioFile,
  ScenarioError,
  type ArgumentConstraint,
  type Scenario,
  type ScenarioCitation,
  type ScenarioExpectation,
  type ScenarioHit,
  type ScenarioMessage,
  type ScenarioStep,
  type ScenarioTool,
  type ToolCallExpectation,
} from "./scenario.js";
export {
  checkExpectations,
  type ExpectationResult,
  type SafetyNotice,
  type TurnTrace,
} from "./expectations.js";
export {
  createKnowledgeBase,
  createFakeTools,
  KNOWLEDGE_SEARCH,
  searchResult,
  toCitation,
} from "./fakes.js";
export {
  DEFAULT_MODEL_CONTEXT_TOKENS,
  createScriptedModel,
  estimateTokens,
  referenceRunAgentTurn,
  type ScriptedModel,
} from "./scripted.js";
export {
  createHarness,
  defaultScenariosDirectory,
  loadScenarios,
  loadSafetyNotice,
  type Harness,
  type HarnessOptions,
  type ScenarioResult,
  type SuiteResult,
  type SuiteTotals,
} from "./harness.js";
export { reportJson, reportMarkdown, toReport, type Report, type ReportScenario } from "./report.js";
