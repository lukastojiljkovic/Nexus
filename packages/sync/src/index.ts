/**
 * `@nexus/sync` — the sync engine's pure half.
 *
 * ─── Every source file here imports `@nexus/sync-crypto/web`, not the root ──
 *
 * This package runs in the Electron main process AND in a browser tab, so it is
 * part of the web bundle's import graph. The root barrel of `@nexus/sync-crypto`
 * reaches `wrap.ts`, and `unwrapKey` plus a key wrap the browser is allowed to
 * fetch is the master key — which is the one thing `scripts/web-key-surface.test.mjs`
 * exists to make unreachable. Importing the `/web` subpath makes that structural
 * here too: nothing this package can name leads to `wrap.ts`.
 *
 * It costs nothing, because everything this package uses — `sealRowFields`,
 * `openRowFields`, the HLC, the merge, the byte helpers — is in both barrels.
 * The `/web` one is a strict subset, so the desktop loses nothing by being handed
 * the smaller surface.
 *
 * The test files still import the root barrel and `@nexus/sync-crypto/testing`,
 * which is correct: a `*.test.ts` is not in any app's import graph and the fake
 * port must never be. The gate walks whole package directories rather than import
 * graphs, so it will have to decide about test files on the day `apps/web`
 * depends on this package — recorded in `docs/STATUS.md` rather than pre-empted
 * here with a guess.
 */

export {
  ATTACHMENT_COLLECTIONS,
  classify,
  collections,
  OPEN_QUESTIONS,
  parentFields,
  SYNC_MAP,
} from "./collections.js";
export type {
  CollectionShape,
  DerivedTable,
  ParentField,
  SyncClassification,
  SyncCollection,
} from "./collections.js";

export {
  COLLECTION_COUPLED,
  COLLECTION_DERIVED,
  deriveColumns,
  fieldColumns,
  newestStamp,
  projectRow,
  stampToIso,
  sweepRow,
  UNIVERSAL_DERIVED,
} from "./projection.js";
export type { CoupledCheck, SweepInput } from "./projection.js";

export { repairCoupled, REPAIRED_TABLES } from "./repair.js";
export type { CoupledRepair } from "./repair.js";

export {
  COLLECTION_PATTERN,
  MAX_CIPHERTEXT_BYTES,
  MAX_OBJECT_ID_BYTES,
  MAX_PARENT_ID_BYTES,
  MAX_VERSION,
  MIN_CIPHERTEXT_BYTES,
  NONCE_BYTES,
  parsePulledRow,
} from "./wire.js";
export type { PulledRow, PushRow } from "./wire.js";

export { planPush } from "./push.js";
export type {
  PushAccepted,
  PushCandidate,
  PushOutcome,
  PushRefusal,
  PushRefusalReason,
  SyncScope,
} from "./push.js";

export { applyPull } from "./pull.js";
export type {
  ContentKeyForEpoch,
  LocalStateLookup,
  PullApplied,
  PullOutcome,
  PullRefusalReason,
  PullRefused,
  PullResult,
} from "./pull.js";
