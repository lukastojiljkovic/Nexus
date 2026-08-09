import { describe, expect, it } from "vitest";
import { bytesToBase64url, utf8 } from "@nexus/sync-crypto";
import type { AuthPort, AuthSession, HttpResponse } from "@nexus/sync-transport";

import {
  REFRESH_MARGIN_SECONDS,
  createSessionHolder,
  freshAccessToken,
  needsRefresh,
} from "./session.js";

const USER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const token = (sessionId: string, aal: string, exp: number): string =>
  `h.${bytesToBase64url(utf8(JSON.stringify({ sub: USER, session_id: sessionId, aal, exp })))}.s`;

const session = (
  overrides: Partial<AuthSession> = {},
  exp: number | null = 1_000_000,
): AuthSession => ({
  accessToken: token("session-one", overrides.aal ?? "aal1", exp ?? 0),
  refreshToken: "refresh-one",
  userId: USER,
  sessionId: "session-one",
  aal: "aal1",
  expiresAt: exp,
  ...overrides,
});

describe("createSessionHolder", () => {
  it("starts empty and hands the port a null token", () => {
    const holder = createSessionHolder();
    expect(holder.current()).toBeNull();
    expect(holder.accessToken()).toBeNull();
  });

  it("holds one session and exposes its token to the port", () => {
    const holder = createSessionHolder();
    const kept = session();
    holder.setSession(kept);
    expect(holder.current()).toBe(kept);
    expect(holder.accessToken()).toBe(kept.accessToken);
    holder.clear();
    expect(holder.accessToken()).toBeNull();
  });

  /**
   * GoTrue writes the assurance level on the session row and it survives every
   * refresh, so a kept `aal2` session would carry browser powers — read and
   * write over every device row, and the right to initiate pairing — on a
   * laptop's disk, forever. The step-up session is ephemeral by construction and
   * this is where that is enforced rather than remembered.
   */
  it("refuses to keep a stepped-up session", () => {
    const holder = createSessionHolder();
    expect(() => holder.setSession(session({ aal: "aal2" }))).toThrow(TypeError);
    expect(holder.current()).toBeNull();
  });
});

describe("needsRefresh", () => {
  /**
   * The boundary from both sides, because „at least the margin left" and „more
   * than the margin left" differ by one second and only one of them is what the
   * constant is named for.
   */
  it("is false while the token still has the whole margin left", () => {
    expect(needsRefresh(session({}, 1_000_000), 1_000_000 - REFRESH_MARGIN_SECONDS)).toBe(false);
  });

  /** A token that outlives the test but not the request is an expired token. */
  it("is true one second inside the margin, not only after expiry", () => {
    expect(needsRefresh(session({}, 1_000_000), 1_000_000 - REFRESH_MARGIN_SECONDS + 1)).toBe(true);
    expect(needsRefresh(session({}, 1_000_000), 1_000_000 + 1)).toBe(true);
  });

  /** „Unknown expiry" must not read as „still good" — that is a token retried forever. */
  it("is true when the token carries no expiry at all", () => {
    expect(needsRefresh(session({ expiresAt: null }), 0)).toBe(true);
  });
});

describe("freshAccessToken", () => {
  const port = (responses: readonly HttpResponse[]): { port: AuthPort; paths: string[] } => {
    const paths: string[] = [];
    let index = 0;
    return {
      paths,
      port: async (request) => {
        paths.push(request.path);
        const response = responses[Math.min(index, responses.length - 1)];
        index += 1;
        return response ?? { status: 500, body: "{}" };
      },
    };
  };

  it("answers null when nothing is signed in, which is not an error", async () => {
    const { port: auth, paths } = port([]);
    expect(await freshAccessToken(auth, createSessionHolder(), 0)).toBeNull();
    expect(paths).toEqual([]);
  });

  it("sends no request while the token is still good", async () => {
    const holder = createSessionHolder();
    holder.setSession(session({}, 1_000_000));
    const { port: auth, paths } = port([]);

    expect(await freshAccessToken(auth, holder, 900_000)).toBe(holder.accessToken());
    expect(paths).toEqual([]);
  });

  it("refreshes inside the margin and keeps the new session", async () => {
    const holder = createSessionHolder();
    holder.setSession(session({}, 1_000_000));
    const next = token("session-one", "aal1", 2_000_000);
    const { port: auth, paths } = port([
      { status: 200, body: JSON.stringify({ access_token: next, refresh_token: "refresh-two" }) },
    ]);

    expect(await freshAccessToken(auth, holder, 999_999)).toBe(next);
    expect(paths).toEqual(["/token?grant_type=refresh_token"]);
    expect(holder.current()?.refreshToken).toBe("refresh-two");
    expect(holder.current()?.expiresAt).toBe(2_000_000);
  });

  /**
   * A refresh token is single-use and single-purpose: „it did not work" means
   * the session is over. Keeping a dead one would turn one failed call into
   * every later call failing the same way, with the app still showing itself as
   * signed in.
   */
  it("clears the session when the refresh is refused", async () => {
    const holder = createSessionHolder();
    holder.setSession(session({}, 1_000_000));
    const { port: auth } = port([
      { status: 400, body: JSON.stringify({ error_code: "refresh_token_already_used" }) },
    ]);

    expect(await freshAccessToken(auth, holder, 999_999)).toBeNull();
    expect(holder.current()).toBeNull();
  });
});
