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
 * The eight pieces:
 *
 *  - `http.ts`     the port seam, and `filterValue` — the measured rule that
 *                  keeps a PATCH from silently matching nothing.
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
  HttpMethod,
  HttpPort,
  HttpRequest,
  HttpResponse,
  PostgrestFailure,
  QueryParam,
} from "./http.js";

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
