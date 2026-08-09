/**
 * The hybrid logical clock (Kulkarni et al., 2014): a timestamp that reads like
 * a wall clock but orders like a Lamport clock.
 *
 * Sync needs a stamp with three properties at once, and no single clock has
 * them. It must be TOTAL (any two writes compare, so a merge has an answer),
 * DETERMINISTIC (every device computes the same answer, or devices converge to
 * different states and never stop fighting), and roughly MEANINGFUL to a human
 * (10:05 beat 10:00, because that is what the user will be told). A pure
 * Lamport counter gives the first two and none of the third. A wall clock gives
 * the third and neither of the first two — clocks disagree, clocks jump, and
 * two devices can genuinely produce the same millisecond.
 *
 * An HLC is a wall clock that is not allowed to go backwards, plus a counter
 * that breaks ties within a millisecond, plus a node id that breaks ties
 * between devices. The node id is what makes the order TOTAL rather than
 * merely partial, and it is compared by UTF-16 code unit — never
 * `localeCompare` or `Intl.Collator`, whose result depends on the locale and on
 * the ICU version the runtime happens to carry. Two devices disagreeing about
 * whether "š-device" sorts before "z-device" would resolve one merge two ways,
 * which is exactly the divergence the whole clock exists to prevent.
 *
 * The stamp travels INSIDE the row ciphertext (see `row.ts`): a server that
 * could rewrite a clock could decide every conflict.
 *
 * ─── The 24-hour forward clamp, and the one thing it must never be used for ──
 *
 * A device whose clock says 2099 stamps every write in 2099 and wins every
 * merge it ever participates in, forever. The clamp bounds that: a remote stamp
 * more than {@link HLC_MAX_FORWARD_DRIFT_MS} ahead of the receipt time is
 * pulled back to exactly the window edge.
 *
 * **It has exactly ONE legitimate use, and it is local.** {@link hlcReceive}
 * clamps against this device's physical clock, because the question it answers
 * is „how far may this message drag MY clock forward", and that is a purely
 * local question whose answer never has to match another device. That is why
 * the clamp is private to this module.
 *
 * The use it must never have is deciding the stamp a received row is STORED
 * with — rewriting a peer's field stamp on the way into the database. That
 * sounds like the same operation and is not, because a stored stamp has to be
 * IDENTICAL on every device or the field it stamps orders two ways and the two
 * devices converge to different states, which is the one failure this clock
 * exists to rule out. Clamping at store time cannot be identical everywhere,
 * and it is worth being precise about why, because the obvious repair does not
 * work:
 *
 *  - Clamping against the local `Date.now()` is plainly non-deterministic: a
 *    row received at 10:00 on one device and 11:00 on another gets two ceilings.
 *  - Clamping against the SERVER's attested receipt time looks deterministic
 *    and is not. A field stamp travels inside the row ciphertext and is carried
 *    forward by every later version — but `sync_objects.updated_at` is
 *    re-stamped by the server on each version. A device that pulled the stamp
 *    at version 3 clamps it against `updated_at(v3)`; a device that first sees
 *    it inside version 7 clamps the SAME stamp against `updated_at(v7)`. Two
 *    ceilings again, and now permanently, because each device stores what it
 *    computed.
 *
 * So a received stamp is stored exactly as it arrived. The bound against a
 * lying clock therefore has to be applied where it CAN be applied once: at the
 * origin, before the stamp is sealed. A device compares its own clock against
 * the server time it last observed and refuses to stamp a write implausibly far
 * ahead of it; the pull side treats a stamp beyond the window as a peer to
 * report, not a value to silently rewrite. Both belong to the sync engine,
 * which knows the server time and has a user to tell; neither belongs here.
 */

/** How far ahead of the receipt time a remote stamp may sit before it is pulled back. */
export const HLC_MAX_FORWARD_DRIFT_MS = 24 * 60 * 60 * 1000;

/** The counter is 32 bits, matching the fixed-width string form. */
const MAX_COUNTER = 0xffffffff;

/** Wall milliseconds are 48 bits in the string form: good past the year 10000. */
const MAX_WALL_MS = 0xffffffffffff;

const WALL_HEX_DIGITS = 12;
const COUNTER_HEX_DIGITS = 8;

/** One hybrid logical clock reading. Immutable; every operation returns a new one. */
export interface Hlc {
  /** Milliseconds since the Unix epoch, monotonic by construction. */
  readonly wallMs: number;
  /** Ties within one millisecond. */
  readonly counter: number;
  /** Ties between devices, and the reason the order is total. */
  readonly nodeId: string;
}

function assertClockMs(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_WALL_MS) {
    throw new TypeError(`${what} must be a non-negative safe integer of at most 2^48-1 ms, got: ${String(value)}`);
  }
}

/**
 * Line terminators, which `formatHlc` must refuse in a node id.
 *
 * `HLC_PATTERN`'s node-id group is `(.+)$`, and `.` does not match a line
 * terminator — so a stamp formatted with one in its node id parses back to
 * `null`. Rejecting it here rather than there is the difference between "this
 * row's clock cannot be read" discovered at write time and discovered after the
 * row has been stored and synced.
 */
const NODE_ID_UNREADABLE = /[\n\r\u2028\u2029]/;

/**
 * Everything {@link formatHlc}'s central claim depends on.
 *
 * `Hlc` is a plain interface, so any caller — the sync engine, a migration, a
 * test — can build one; nothing forces a stamp to have come out of `hlcSend` or
 * `parseHlc`. The claim that lexicographic order over the string form equals
 * {@link compareHlc} holds only while both numeric fields fit their fixed
 * widths, and a stamp that overflows one does not fail loudly: `padStart` simply
 * emits a wider field, and `2^49` then sorts BEFORE `2^48-1` as a string because
 * "2" precedes "f". A SQLite `ORDER BY` over that column would silently return
 * the wrong newest row. An invariant a comment asserts and no code checks is a
 * rumour, so this checks it at the one boundary where it is claimed.
 */
function assertFormattable(stamp: Hlc): void {
  assertClockMs(stamp.wallMs, "Hlc.wallMs");
  if (!Number.isSafeInteger(stamp.counter) || stamp.counter < 0 || stamp.counter > MAX_COUNTER) {
    throw new TypeError(
      `Hlc.counter must be a non-negative safe integer of at most 2^32-1, got: ${String(stamp.counter)}`,
    );
  }
  if (stamp.nodeId.length === 0 || NODE_ID_UNREADABLE.test(stamp.nodeId)) {
    throw new TypeError("An HLC node id must be non-empty and free of line terminators.");
  }
}

function bumped(counter: number): number {
  if (counter >= MAX_COUNTER) {
    // Wrapping would put a later write behind an earlier one with no way to
    // notice. Reaching 2^32 events inside one millisecond is not a real
    // condition; it is a bug somewhere, and it should say so.
    throw new RangeError("HLC counter overflow — 2^32 events within a single millisecond.");
  }
  return counter + 1;
}

/** The starting stamp for a device that has never written. */
export function hlcZero(nodeId: string): Hlc {
  if (nodeId.length === 0) throw new TypeError("An HLC node id must not be empty.");
  return { wallMs: 0, counter: 0, nodeId };
}

/**
 * The stamp for a local write.
 *
 * `nowMs` is only ever allowed to push the clock FORWARD. When it is equal to
 * or behind the current reading — a stalled clock, an NTP correction, a time
 * zone change, a laptop waking with a dead RTC — the counter carries the
 * ordering instead. That is what makes a sequence of local writes strictly
 * increasing no matter what the hardware does.
 */
export function hlcSend(state: Hlc, nowMs: number): Hlc {
  assertClockMs(nowMs, "nowMs");
  if (nowMs > state.wallMs) {
    return { wallMs: nowMs, counter: 0, nodeId: state.nodeId };
  }
  return { wallMs: state.wallMs, counter: bumped(state.counter), nodeId: state.nodeId };
}

/**
 * Pulls a remote stamp back inside the drift window, for the sole purpose of
 * deciding how far it may move THIS device's clock. Deliberately not exported:
 * see the file header on the store-time use that looks identical and diverges.
 */
function clampAgainstLocalClock(remote: Hlc, nowMs: number): Hlc {
  const ceiling = Math.min(nowMs + HLC_MAX_FORWARD_DRIFT_MS, MAX_WALL_MS);
  if (remote.wallMs <= ceiling) return remote;
  return { wallMs: ceiling, counter: remote.counter, nodeId: remote.nodeId };
}

/**
 * Whether `stamp` sits further ahead of `referenceMs` than the drift window
 * allows — the question the sync engine asks on both sides of the wire.
 *
 * At send time the reference is the server time this device last observed, and
 * a `true` answer means „do not seal this write, this machine's clock is
 * wrong". At pull time it is the row's server-attested receipt time, and a
 * `true` answer means „tell the user which device is stamping from the future".
 * It never means „rewrite the stamp": that is the store-time clamp the header
 * rules out.
 */
export function hlcExceedsDriftWindow(stamp: Hlc, referenceMs: number): boolean {
  assertClockMs(referenceMs, "referenceMs");
  return stamp.wallMs > Math.min(referenceMs + HLC_MAX_FORWARD_DRIFT_MS, MAX_WALL_MS);
}

/**
 * The local clock after observing a remote stamp. Takes the greatest of the
 * three readings (local, clamped remote, physical) and derives the counter from
 * whichever of them won, so causality is preserved: anything this device does
 * next is ordered after everything it has seen.
 *
 * Clamps the remote first, so a peer with a broken clock cannot drag THIS
 * device's clock into the future and poison every stamp it writes afterwards.
 * The clamp is against the LOCAL clock deliberately, and it changes only what
 * this device's clock becomes — never what the received row is stored with.
 */
export function hlcReceive(state: Hlc, remote: Hlc, nowMs: number): Hlc {
  assertClockMs(nowMs, "nowMs");
  const clamped = clampAgainstLocalClock(remote, nowMs);
  const wallMs = Math.max(state.wallMs, clamped.wallMs, nowMs);

  let counter: number;
  if (wallMs === state.wallMs && wallMs === clamped.wallMs) {
    counter = bumped(Math.max(state.counter, clamped.counter));
  } else if (wallMs === state.wallMs) {
    counter = bumped(state.counter);
  } else if (wallMs === clamped.wallMs) {
    counter = bumped(clamped.counter);
  } else {
    counter = 0;
  }
  return { wallMs, counter, nodeId: state.nodeId };
}

/**
 * The total order: wall clock, then counter, then node id by UTF-16 code unit.
 * Shaped as a `-1 | 0 | 1` comparator so it drops straight into `Array.sort`.
 */
export function compareHlc(a: Hlc, b: Hlc): -1 | 0 | 1 {
  if (a.wallMs !== b.wallMs) return a.wallMs < b.wallMs ? -1 : 1;
  if (a.counter !== b.counter) return a.counter < b.counter ? -1 : 1;
  if (a.nodeId !== b.nodeId) return a.nodeId < b.nodeId ? -1 : 1;
  return 0;
}

/**
 * The storage form: `wall(12 hex) ":" counter(8 hex) ":" nodeId`.
 *
 * Fixed-width, zero-padded, lower-case hex, so **lexicographic string ordering
 * is identical to {@link compareHlc}**. That is not cosmetic — it means SQLite
 * can `ORDER BY` the stamp column directly, and a caller that sorts strings
 * because it forgot the comparator still gets the right answer. Decimal would
 * not have that property, and neither would an unpadded encoding.
 *
 * Throws for a stamp that cannot be written at those widths, or whose node id
 * {@link parseHlc} could not read back — see {@link assertFormattable}. Both are
 * caller bugs, and both are silent data corruption if they are allowed through.
 */
export function formatHlc(stamp: Hlc): string {
  assertFormattable(stamp);
  const wall = stamp.wallMs.toString(16).padStart(WALL_HEX_DIGITS, "0");
  const counter = stamp.counter.toString(16).padStart(COUNTER_HEX_DIGITS, "0");
  return `${wall}:${counter}:${stamp.nodeId}`;
}

const HLC_PATTERN = /^([0-9a-f]{12}):([0-9a-f]{8}):(.+)$/;

/**
 * The inverse, or `null`. Strict: an unpadded or upper-case field is rejected
 * rather than accepted, because two spellings of one stamp would sort
 * differently as strings and defeat the point of the format. The node id is
 * everything after the second colon, so an id containing a colon survives.
 */
export function parseHlc(value: string): Hlc | null {
  const match = HLC_PATTERN.exec(value);
  if (match === null) return null;
  const [, wallHex, counterHex, nodeId] = match;
  if (wallHex === undefined || counterHex === undefined || nodeId === undefined) return null;
  const wallMs = Number.parseInt(wallHex, 16);
  const counter = Number.parseInt(counterHex, 16);
  if (!Number.isSafeInteger(wallMs) || !Number.isSafeInteger(counter)) return null;
  return { wallMs, counter, nodeId };
}
