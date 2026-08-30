/**
 * The one session this desktop keeps, and the rule for when its token is too old
 * to send.
 *
 * ─── Why the session is a holder and not a value ────────────────────────────
 *
 * `port.ts` reads the access token on every call rather than capturing one,
 * because a token has a lifetime and a captured copy keeps being presented after
 * it expires — a failure that arrives as 401 on everything, an hour in, and
 * reads as a server problem. Something has to be on the other side of that
 * `accessToken()` call. This is it: a single mutable cell, owned by the main
 * process, whose contents no renderer can read.
 *
 * ─── One session, and specifically the aal1 one ─────────────────────────────
 *
 * The enable flow briefly holds two, and `sync-enable`'s header explains at
 * length why they must be two: GoTrue writes the assurance level on the SESSION
 * row and it survives every refresh, so a desktop that ever stepped up would be
 * `aal2` for the rest of its life — and an `aal2` session can read and write
 * every device row on the account and act as a pairing initiator. Those are
 * browser powers. The ephemeral authorising session never reaches this holder;
 * it lives in a local variable for the length of one function and is signed out
 * at the end of it. {@link setSession} refuses an `aal2` session outright, so
 * "the kept session is aal1" is a property of this file rather than of whoever
 * writes the next caller.
 *
 * ─── Refresh is a decision, not a timer ─────────────────────────────────────
 *
 * There is no interval here and nothing that fires on its own. A background
 * refresh loop in the main process would keep an account signed in — and keep a
 * socket warm — on a machine whose user has closed every window and believes the
 * app is idle. {@link freshAccessToken} refreshes when a call is about to be
 * made and the token would not survive it, so the network is used when something
 * is actually about to be sent.
 *
 * The sync loop repeats, so „something is about to be sent" now happens without
 * the user doing anything — and the difference still holds: the loop decides
 * when a ROUND runs, and a round asks for a token because it has a request to
 * make. Nothing here keeps a session alive on its own account. What the loop did
 * add is {@link accessTokenForRound}, because a refresh spends the STORED token
 * and a repeating caller that never writes the new one back leaves the next
 * launch unable to resume.
 */

import { parseSession, refreshRequest, type AuthPort, type AuthSession } from "@nexus/sync-transport";

/**
 * How much life a token must have left to be sent.
 *
 * A token that expires in four seconds passes any „is it expired" test and then
 * fails at the server, because the request still has to travel, wait behind
 * Argon2id in the case of `sync-enable`, and come back. Sixty seconds is the
 * margin, which is longer than any call this product makes.
 */
export const REFRESH_MARGIN_SECONDS = 60;

export interface SessionHolder {
  /** The session, or null when this desktop is not signed in. */
  readonly current: () => AuthSession | null;
  /** For `port.ts`, which reads it on every call. */
  readonly accessToken: () => string | null;
  /** Refuses an `aal2` session — see the header. */
  readonly setSession: (session: AuthSession) => void;
  readonly clear: () => void;
}

export function createSessionHolder(): SessionHolder {
  let session: AuthSession | null = null;
  return {
    current: () => session,
    accessToken: () => session?.accessToken ?? null,
    setSession: (next) => {
      if (next.aal === "aal2") {
        throw new TypeError(
          "sync: an aal2 session must not become this desktop's kept session. " +
            "The step-up session authorises one call and is signed out immediately.",
        );
      }
      session = next;
    },
    clear: () => {
      session = null;
    },
  };
}

/** True when the token has less than {@link REFRESH_MARGIN_SECONDS} of life left. */
export function needsRefresh(session: AuthSession, nowSeconds: number): boolean {
  // A token with no `exp` claim is not one this auth server issued in any shape
  // this client understands, and treating „unknown expiry" as „still good" is
  // how a client ends up retrying a dead token forever. Refresh it.
  if (session.expiresAt === null) return true;
  return session.expiresAt - nowSeconds < REFRESH_MARGIN_SECONDS;
}

/**
 * The token to put on the next request, refreshing first if it would not survive
 * it — or `null`, which means signed out and is not an error.
 *
 * The holder is UPDATED on a successful refresh and CLEARED on a failed one.
 * Clearing is the right answer to every refusal a refresh can meet: a refresh
 * token is single-use and single-purpose, so „it did not work" means the session
 * is over, and keeping a dead one would turn one failed call into every
 * subsequent call failing the same way while the app still shows itself as
 * signed in.
 */
export async function freshAccessToken(
  port: AuthPort,
  holder: SessionHolder,
  nowSeconds: number,
): Promise<string | null> {
  const session = holder.current();
  if (session === null) return null;
  if (!needsRefresh(session, nowSeconds)) return session.accessToken;

  const refreshed = parseSession(await port(refreshRequest(session.refreshToken)));
  if (!refreshed.ok) {
    holder.clear();
    return null;
  }
  // A refresh preserves the session row, so `aal` comes back whatever it was —
  // and `setSession` refuses `aal2` for the reason in the header. That cannot
  // happen for a session this holder accepted, and if it ever does, throwing is
  // right: it means the session was stepped up somewhere else, and the desktop
  // must not go on using it as though it had not been.
  holder.setSession(refreshed.value);
  return refreshed.value.accessToken;
}

/**
 * What {@link accessTokenForRound} needs besides the ports: somewhere to write a
 * refresh token that has just been rotated away.
 */
export interface RotationSink {
  /** Store the token the next launch must resume from. Called only on a rotation. */
  readonly persist: (refreshToken: string) => void;
}

/**
 * {@link freshAccessToken}, plus the write-back a repeating caller cannot do
 * without.
 *
 * GoTrue rotates the refresh token on every use, so a refresh SPENDS the stored
 * one. That was harmless while every refresh happened inside a user's own action
 * — `resume` writes the new token back in the same breath — and it stops being
 * harmless the moment something repeats on a timer: a loop that refreshes twelve
 * times an hour and a machine that is then closed leaves `sync_account` holding a
 * token twelve rotations dead, and the next launch's one-request resume fails.
 * The user is asked for a password to fix a problem the app made for itself.
 *
 * A FAILED refresh writes nothing, deliberately. `freshAccessToken` clears the
 * in-memory holder on any refusal, which is right for a value that costs one
 * request to rebuild — but a refusal can be a server having a bad minute, and
 * erasing the stored token on one would turn a 502 into „type your password
 * again". The stored token stays; the next attempt spends it or learns it is
 * gone.
 */
export async function accessTokenForRound(
  port: AuthPort,
  holder: SessionHolder,
  sink: RotationSink,
  nowSeconds: number,
): Promise<string | null> {
  const before = holder.current()?.refreshToken ?? null;
  const token = await freshAccessToken(port, holder, nowSeconds);
  const after = holder.current()?.refreshToken ?? null;
  if (after !== null && after !== before) sink.persist(after);
  return token;
}
