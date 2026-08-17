/**
 * `@nexus/sync-engine` — the loop that drives everything else.
 *
 * Four packages existed and nothing put them together: `@nexus/sync` decides
 * what a row means, `@nexus/sync-crypto` seals it, `@nexus/sync-transport`
 * carries it, and a local store remembers what has happened. This one owns the
 * order they run in, the arithmetic that says how far a device has got, and —
 * in `loop.ts` — when the next round happens and which failures mean „later"
 * rather than „stop".
 *
 * It holds no `fetch`, no database and no clock — all three arrive in
 * {@link SyncDeps}. That is the same rule `@nexus/sync-transport` follows, for
 * the same reason: a desktop with cloud off never constructs the ports, and
 * there is nothing in here that could go looking for one.
 */

export { PUSH_BATCH_ROWS, syncOnce } from "./round.js";
export type { SyncDeps, SyncHalt, SyncRoundOptions, SyncRoundReport } from "./round.js";

export { SYNC_LOOP_DEFAULTS, createSyncLoop } from "./loop.js";
export type {
  SyncLoop,
  SyncLoopDeps,
  SyncLoopPhase,
  SyncLoopSettings,
  SyncLoopStatus,
  Timer,
} from "./loop.js";

export type {
  ApplyOutcome,
  ApplyRequest,
  ApplyStatus,
  OwedObject,
  QuarantinedObject,
  SyncStore,
} from "./store.js";
