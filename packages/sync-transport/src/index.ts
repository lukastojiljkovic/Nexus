/**
 * `@nexus/sync-transport` — the wire, and only the wire.
 *
 * `@nexus/sync` decides WHAT to send and what an arriving row means.
 * `@nexus/sync-crypto` decides what it is sealed with. This package decides how
 * either of those crosses an HTTP connection to PostgREST and a WebSocket to
 * Realtime — column names, `bytea` spelling, paging, which SQLSTATE means what,
 * and the Phoenix frames.
 *
 * **It holds no origin, no key, no `fetch` and no `WebSocket`.** Requests are
 * built and handed to an injected {@link HttpPort}; Realtime frames are produced
 * as strings for a socket the caller owns. That is what makes the cloud-off
 * guarantee structural rather than remembered: a desktop with cloud off simply
 * never constructs a port, and there is nothing in here that could go looking
 * for one.
 *
 * The eleven pieces:
 *
 *  - `http.ts`     the three port seams, and `filterValue` — the measured rule
 *                  that keeps a PATCH from silently matching nothing.
 *  - `auth.ts`     GoTrue as six requests and the answers to them, with no
 *                  session store and no clock — because which sessions exist,
 *                  and for how long, is the part with the argument in it.
 *  - `enable.ts`   the one Edge Function call — minting the account's master key
 *                  — and the byte comparison that proves the server stored what
 *                  this desktop sent.
 *  - `devices.ts`  the two writes a desktop may make to its own device row, and
 *                  the one it may not — `session_id`, which is why a revoked
 *                  desktop cannot rescue itself.
 *  - `bytea.ts`    hex `bytea` ↔ base64url, the one translation nobody else can do.
 *  - `rows.ts`     column names ↔ `PushRow`/`PulledRow`, and the explicit select list.
 *  - `outcome.ts`  every way a write can end, named, with the SQLSTATE map.
 *  - `pull.ts`     paging by `seq`, with the overlap the cursor design requires.
 *  - `push.ts`     POST for a creation, PATCH for an update, one row per request.
 *  - `cursor.ts`   `sync_state`, the server's advisory copy of the watermark.
 *  - `signal.ts`   the Realtime broadcast that says „pull again", as a state
 *                  machine with no socket and no clock in it.
 */

// ── The port ────────────────────────────────────────────────────────────────
export {
  filterValue,
  jsonHeaders,
  parseFailure,
  parseRows,
  postgrestPath,
  queryString,
} from "./http.js";
export type {
  AuthPort,
  AuthRequest,
  FunctionPort,
  FunctionRequest,
  HttpMethod,
  HttpPort,
  HttpRequest,
  HttpResponse,
  PostgrestFailure,
  QueryParam,
} from "./http.js";

// ── Signing in ──────────────────────────────────────────────────────────────
export {
  challengeRequest,
  listTotpFactors,
  parseChallengeId,
  parseFactors,
  parseSession,
  parseSignOut,
  readTokenClaims,
  refreshRequest,
  refreshSession,
  signIn,
  signInRequest,
  signOut,
  signOutRequest,
  startChallenge,
  userRequest,
  verifyChallenge,
  verifyRequest,
} from "./auth.js";
export type { AuthRefusal, AuthResult, AuthSession, TokenClaims, TotpFactor } from "./auth.js";

// ── Turning sync on ─────────────────────────────────────────────────────────
export {
  AUTHORISING_TOKEN_HEADER,
  KEY_WRAP_COLUMNS,
  SYNC_ENABLE_FUNCTION,
  enableSync,
  keyWrapReadbackRequest,
  parseSyncEnableResponse,
  syncEnableBody,
  syncEnableRequest,
  syncEnableRoundTripProblem,
} from "./enable.js";
export type {
  SealedKeyFields,
  SealedNameFields,
  SyncEnableBody,
  SyncEnableInput,
  SyncEnableRefusal,
  SyncEnableResult,
} from "./enable.js";

// ── This computer's device row ──────────────────────────────────────────────
export { retireDeviceRequest, touchDeviceRequest } from "./devices.js";

// ── bytea ───────────────────────────────────────────────────────────────────
export { base64urlToBytea, byteaToBase64url } from "./bytea.js";

// ── Column mapping ──────────────────────────────────────────────────────────
export { IDENTITY_COLUMNS, PULL_COLUMNS, PULL_SELECT, fromColumns, toInsert, toPatch } from "./rows.js";

// ── Pull ────────────────────────────────────────────────────────────────────
export { PULL_OVERLAP, PULL_PAGE_ROWS, advanceCursor, pullPage, pullWindow } from "./pull.js";
export type { PullFailure, PullFailureReason, PullPage, PullPageResult } from "./pull.js";

// ── Push ────────────────────────────────────────────────────────────────────
export { pushRow, pushRows } from "./push.js";
export { classifyPush, needsReread } from "./outcome.js";
export type { PushCode, PushResult } from "./outcome.js";

// ── The server's copy of the cursor ─────────────────────────────────────────
export { readCursors, writeCursor } from "./cursor.js";
export type { CursorFailure, CursorFailureReason, CursorRow, CursorWritten, CursorsRead } from "./cursor.js";

// ── The change signal ───────────────────────────────────────────────────────
export {
  HEARTBEAT_INTERVAL_MS,
  JOIN_TIMEOUT_MS,
  MAX_HINT_COLLECTIONS,
  SIGNAL_EVENT,
  SIGNAL_PROTOCOL_VERSION,
  SIGNAL_SOCKET_PATH,
  SIGNAL_TOPIC_PREFIX,
  SignalSession,
} from "./signal.js";
export type { SignalEvent, SignalHint, SignalOptions, SignalState, SignalStep } from "./signal.js";
