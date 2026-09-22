/**
 * „Something changed — pull again", as a state machine that owns no socket and
 * no clock.
 *
 * ─── The hint is a hint. The pull is the truth ──────────────────────────────
 *
 * This channel carries no data. A device that has pushed broadcasts which
 * profile and which collections it touched, and every other device of the same
 * account answers by PULLING — through the authenticated path, where the AAD is
 * rebuilt from the server's own claim and a rewrite fails to open. So the worst
 * a forged or replayed hint can do is cost a round trip, and the worst a
 * SUPPRESSED hint can do is delay one: the engine polls anyway, because a device
 * that was asleep when the broadcast went out was never going to receive it.
 * Realtime is a latency improvement over a correct design, not a component of
 * one, and treating it as anything more is how a sync engine acquires a failure
 * mode nobody can reproduce.
 *
 * That is also why the payload is not encrypted. It names a `profile_id` and
 * some collection names — two facts the server already stores in the clear on
 * every row of `sync_objects`, and concedes in those columns' comments. Sealing
 * them here would hide nothing from the party that holds the database.
 *
 * ─── Broadcast, not `postgres_changes` ──────────────────────────────────────
 *
 * Migration 006 wrote the wall for `realtime.messages` — RLS confining topic
 * `nexus:<user_id>` to that user's own live session — and not for the replication
 * stream. That was the right choice and this file follows it: `postgres_changes`
 * would push row payloads out of the WAL to every subscriber, which is a second
 * path by which the ciphertext and its metadata leave the database, with its own
 * filtering rules to get right. A broadcast that says only „look again" has
 * nothing in it to leak.
 *
 * ─── Everything below was measured against a running Realtime ───────────────
 *
 * The Phoenix framing here is not from documentation. Against the Supabase stack
 * this repository configures: a join is answered with `phx_reply` /
 * `{status:"ok", response:{postgres_changes:[]}}`; a topic the caller may not
 * read is answered with `phx_reply` / `{status:"error", response:{reason:
 * "Unauthorized: You do not have permissions to read from this Channel topic:
 * …"}}` — for another user's topic, for an invented topic, and for a session the
 * gate predicate refuses; a broadcast arrives as `{ref:null, event:"broadcast",
 * payload:{type:"broadcast", event:…, payload:…}}`; a heartbeat is answered on
 * topic `phoenix`.
 *
 * {@link SIGNAL_PROTOCOL_VERSION} is exported because it is not cosmetic: `vsn`
 * `2.0.0` frames every message as a five-element ARRAY, and a port that opened
 * the socket with a different version would hand this parser a shape it silently
 * matches nothing in. The port must use the constant.
 *
 * ─── There is no `access_token` refresh frame ───────────────────────────────
 *
 * An access token expires, and a long-lived channel has to do something about
 * it. Phoenix clients send an `access_token` event; this one does not, because
 * the join above is the only frame whose authorisation behaviour has been
 * measured, and a refresh path that is merely plausible is worse than none — it
 * fails by going quiet, which is indistinguishable from „nobody is editing".
 * A new token means a new {@link SignalSession} over a new socket, which is the
 * path that is tested. Constructing one is free.
 */

/** The socket path under the project origin. The ORIGIN belongs to the port; this does not. */
export const SIGNAL_SOCKET_PATH = "/realtime/v1/websocket";

/** The framing version this parser implements. See the header — 2.0.0 is arrays. */
export const SIGNAL_PROTOCOL_VERSION = "1.0.0";

/**
 * The topic namespace, fixed by the realtime policies in
 * `20260808090300_storage_realtime_rls.sql`: `realtime.topic()` sees
 * `nexus:<user_id>`, and the channel a client joins is that with Phoenix's own
 * `realtime:` prefix.
 *
 * Cited by FILENAME rather than by number because this repository has TWO
 * migration series — the local SQLite one in `packages/db/src/migrations/` and
 * this server one — and both number from 001. „Migration 006" was written here
 * once already and resolves to nothing: the server series carries no 006, and
 * the only 006 in the tree is the local flashcards migration.
 */
export const SIGNAL_TOPIC_PREFIX = "realtime:nexus:";

/** The broadcast event name. One event; the payload says which profile. */
export const SIGNAL_EVENT = "nexus_sync";

/** Phoenix's own topic, which is where heartbeats and their replies live. */
const PHOENIX_TOPIC = "phoenix";

/** How often a heartbeat is due once joined. Phoenix's own default, and its server expects it. */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** How long a join may go unanswered before the session is declared stalled. */
export const JOIN_TIMEOUT_MS = 10_000;

/**
 * The most collection names one hint may carry.
 *
 * A bound because the payload is the SERVER's to rewrite: without one, a hostile
 * instance could hand every device a hint naming a million collections and make
 * the client allocate for it. Sixty-four is comfortably above the number of
 * collections the product has.
 */
export const MAX_HINT_COLLECTIONS = 64;

/** The same shape `sync_objects.collection` is constrained to, server-side. */
const COLLECTION_SHAPE = /^[a-z][a-z0-9_]{0,63}$/;

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What one device tells the others it touched. */
export interface SignalHint {
  readonly profileId: string;
  readonly collections: readonly string[];
}

export type SignalState = "idle" | "joining" | "joined" | "failed" | "closed";

export type SignalEvent =
  /** The channel is live: hints will arrive and may be sent. */
  | { readonly kind: "joined" }
  /** A peer of this account pushed. Pull the named collections. */
  | { readonly kind: "hint"; readonly hint: SignalHint }
  /** The server refused the join. Never retried here — the reason is authorisation, not luck. */
  | { readonly kind: "refused"; readonly reason: string }
  /** The join went unanswered, or a heartbeat did. The socket is up and the channel is not. */
  | { readonly kind: "stalled" }
  /** A broadcast this device sent was not accepted. Peers did not hear it; they will still poll. */
  | { readonly kind: "undelivered" }
  /** The socket went away. */
  | { readonly kind: "closed" };

/** Frames to put on the wire, and what the caller should be told, from one input. */
export interface SignalStep {
  readonly send: readonly string[];
  readonly events: readonly SignalEvent[];
}

const NOTHING: SignalStep = { send: [], events: [] };

export interface SignalOptions {
  readonly userId: string;
  /** The session's access token. Sent once, in the join; see the header. */
  readonly accessToken: string;
}

/**
 * One channel's worth of protocol, as a function of inputs.
 *
 * No socket, no timer, no clock: the caller pumps {@link tick} with a time it
 * chose, hands over what arrived, and puts the returned frames on the wire. That
 * is what makes the refusal path, the stall path and the heartbeat path
 * testable — all three are states a real Realtime server takes seconds or
 * minutes to produce, and none of them is reachable from a unit test that owns a
 * socket.
 */
export class SignalSession {
  #state: SignalState = "idle";
  #ref = 0;
  #joinRef: string | null = null;
  #joinDeadline = 0;
  #heartbeatDue = 0;
  #heartbeatRef: string | null = null;
  readonly #topic: string;
  readonly #token: string;

  constructor(options: SignalOptions) {
    if (!UUID_SHAPE.test(options.userId)) {
      // This client's own id, not an input: a bad one here is a bug that would
      // otherwise become a channel name nobody can explain.
      throw new TypeError("SignalSession: userId must be a uuid");
    }
    this.#topic = `${SIGNAL_TOPIC_PREFIX}${options.userId}`;
    this.#token = options.accessToken;
  }

  get state(): SignalState {
    return this.#state;
  }

  /** The channel this session joins. Exported for the port's logging and for tests. */
  get topic(): string {
    return this.#topic;
  }

  /** The socket is open. Emit the join. */
  open(nowMs: number): SignalStep {
    if (this.#state !== "idle") return NOTHING;
    this.#state = "joining";
    this.#joinRef = this.#nextRef();
    this.#joinDeadline = nowMs + JOIN_TIMEOUT_MS;
    return {
      send: [
        frame(this.#topic, "phx_join", this.#joinRef, {
          // `self: false` — a device does not need to hear its own push.
          // `ack: true` — so a broadcast the INSERT policy refuses is reported
          // rather than dropped. Migration 006 writes the read and the write as
          // two separate policies, so they can be changed apart, and a send that
          // silently went nowhere is the failure that would follow.
          config: { broadcast: { self: false, ack: true }, private: true },
          access_token: this.#token,
        }),
      ],
      events: [],
    };
  }

  /** One inbound frame, as text. Anything unrecognised is ignored, deliberately. */
  receive(text: string, nowMs: number): SignalStep {
    const message = parseFrame(text);
    if (message === null) return NOTHING;

    if (message.event === "phx_reply" && message.topic === PHOENIX_TOPIC) {
      this.#heartbeatRef = null;
      return NOTHING;
    }

    if (message.topic !== this.#topic) return NOTHING;

    if (message.event === "phx_error" || message.event === "phx_close") {
      // The channel died under us. Not `closed` — the socket may well still be
      // up — but the session is over either way and the caller must rebuild it.
      this.#state = "failed";
      return { send: [], events: [{ kind: "refused", reason: message.event }] };
    }

    if (message.event === "broadcast") {
      const hint = parseBroadcast(message.payload);
      return hint === null ? NOTHING : { send: [], events: [{ kind: "hint", hint }] };
    }

    if (message.event !== "phx_reply") return NOTHING;

    const status = replyStatus(message.payload);
    if (message.ref !== null && message.ref === this.#joinRef) {
      if (status === "ok") {
        this.#state = "joined";
        this.#heartbeatDue = nowMs + HEARTBEAT_INTERVAL_MS;
        return { send: [], events: [{ kind: "joined" }] };
      }
      this.#state = "failed";
      return { send: [], events: [{ kind: "refused", reason: replyReason(message.payload) }] };
    }

    // Any other reply on this topic is the ack for a broadcast this session
    // sent. Only the failures are worth reporting.
    return status === "ok" ? NOTHING : { send: [], events: [{ kind: "undelivered" }] };
  }

  /**
   * Time passed.
   *
   * Two deadlines, and the second is the one that matters: a heartbeat that goes
   * unanswered while the socket stays open is the shape a dead channel actually
   * takes — no close, no error, just silence — and without this check the
   * session would sit in `joined` forever, reporting health it does not have.
   */
  tick(nowMs: number): SignalStep {
    if (this.#state === "joining" && nowMs >= this.#joinDeadline) {
      this.#state = "failed";
      return { send: [], events: [{ kind: "stalled" }] };
    }
    if (this.#state !== "joined" || nowMs < this.#heartbeatDue) return NOTHING;
    if (this.#heartbeatRef !== null) {
      this.#state = "failed";
      return { send: [], events: [{ kind: "stalled" }] };
    }
    this.#heartbeatRef = this.#nextRef();
    this.#heartbeatDue = nowMs + HEARTBEAT_INTERVAL_MS;
    return { send: [frame(PHOENIX_TOPIC, "heartbeat", this.#heartbeatRef, {})], events: [] };
  }

  /**
   * Tell the account's other devices that something moved.
   *
   * Silent when the channel is not joined, and that is correct rather than
   * lenient: a hint is an optimisation, and a caller that had to handle „could
   * not hint" would be handling a case in which the right answer is to do
   * nothing at all.
   */
  notify(hint: SignalHint): SignalStep {
    if (this.#state !== "joined") return NOTHING;
    if (!UUID_SHAPE.test(hint.profileId)) throw new TypeError("SignalSession: profileId must be a uuid");
    const collections = hint.collections.filter((name) => COLLECTION_SHAPE.test(name));
    if (collections.length === 0) return NOTHING;
    return {
      send: [
        frame(this.#topic, "broadcast", this.#nextRef(), {
          type: "broadcast",
          event: SIGNAL_EVENT,
          payload: { profileId: hint.profileId, collections: collections.slice(0, MAX_HINT_COLLECTIONS) },
        }),
      ],
      events: [],
    };
  }

  /** The socket went away, for any reason. */
  close(): SignalStep {
    if (this.#state === "closed") return NOTHING;
    this.#state = "closed";
    return { send: [], events: [{ kind: "closed" }] };
  }

  #nextRef(): string {
    this.#ref += 1;
    return String(this.#ref);
  }
}

interface Frame {
  readonly topic: string;
  readonly event: string;
  readonly ref: string | null;
  readonly payload: unknown;
}

function frame(topic: string, event: string, ref: string, payload: unknown): string {
  return JSON.stringify({ topic, event, payload, ref });
}

function parseFrame(text: string): Frame | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const topic = record["topic"];
  const event = record["event"];
  if (typeof topic !== "string" || typeof event !== "string") return null;
  const ref = record["ref"];
  return { topic, event, ref: typeof ref === "string" ? ref : null, payload: record["payload"] };
}

function replyStatus(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const status = (payload as Record<string, unknown>)["status"];
  return typeof status === "string" ? status : null;
}

function replyReason(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) return "unknown";
  const response = (payload as Record<string, unknown>)["response"];
  if (typeof response !== "object" || response === null) return "unknown";
  const reason = (response as Record<string, unknown>)["reason"];
  return typeof reason === "string" ? reason : "unknown";
}

/**
 * The hint inside a broadcast frame, or `null`.
 *
 * Every field is checked even though the sender is one of this account's own
 * devices, because it does not arrive from that device — it arrives from the
 * server, which relays it and could write it. Nothing here trusts the payload
 * for anything but „which collections to ask about", and asking about the wrong
 * one costs a query that returns nothing.
 */
function parseBroadcast(payload: unknown): SignalHint | null {
  if (typeof payload !== "object" || payload === null) return null;
  const outer = payload as Record<string, unknown>;
  if (outer["event"] !== SIGNAL_EVENT) return null;
  const inner = outer["payload"];
  if (typeof inner !== "object" || inner === null || Array.isArray(inner)) return null;
  const record = inner as Record<string, unknown>;

  const profileId = record["profileId"];
  if (typeof profileId !== "string" || !UUID_SHAPE.test(profileId)) return null;

  const collections = record["collections"];
  if (!Array.isArray(collections) || collections.length > MAX_HINT_COLLECTIONS) return null;
  const named: string[] = [];
  for (const name of collections) {
    if (typeof name !== "string" || !COLLECTION_SHAPE.test(name)) return null;
    named.push(name);
  }
  if (named.length === 0) return null;

  return { profileId, collections: named };
}
