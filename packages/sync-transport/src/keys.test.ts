import { describe, expect, it } from "vitest";
import { bytesToBase64url } from "@nexus/sync-crypto/web";

import {
  CONTENT_KEY_COLUMNS,
  contentKeyWrapOf,
  contentKeyWrapsRequest,
  mintContentKeyWrap,
  mintContentKeyWrapRequest,
  parseContentKeyWraps,
  readContentKeyWraps,
} from "./keys.js";
import { failed, ok, recordingPort } from "./testing.js";

const PROFILE = "8f1c2f52-3b6a-4d0e-9c1b-1f7a5c0e2d34";
const USER = "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d";

const SEALED = {
  commitment: bytesToBase64url(new Uint8Array(32).fill(0x11)),
  nonce: bytesToBase64url(new Uint8Array(24).fill(0x22)),
  ciphertext: bytesToBase64url(new Uint8Array(48).fill(0x33)),
};

/** The same wrap as PostgREST serves it: three `bytea` columns in hex. */
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    profile_id: PROFILE,
    epoch: 1,
    nonce: `\\x${"22".repeat(24)}`,
    wrapped: `\\x${"33".repeat(48)}`,
    commit_tag: `\\x${"11".repeat(32)}`,
    disabled_at: null,
    ...over,
  };
}

describe("reading a profile's content-key wraps", () => {
  it("asks for every generation of one profile, in epoch order", () => {
    const request = contentKeyWrapsRequest(PROFILE);
    expect(request.method).toBe("GET");
    expect(request.path).toContain("kind=eq.ck_under_mk");
    expect(request.path).toContain(`profile_id=eq.${PROFILE}`);
    expect(request.path).toContain("order=epoch.asc");
    expect(request.path).toContain(encodeURIComponent(CONTENT_KEY_COLUMNS));
    // The account is decided by the token and by row level security, never by a
    // filter this package writes.
    expect(request.path).not.toContain("user_id");
  });

  it("does not filter out a retired generation", () => {
    // A log still holds rows sealed at an epoch a rotation has retired. Filtering
    // them away would answer `no-key` to every one of those rows. `disabled_at`
    // is SELECTED — the caller has to know — and never used as a filter.
    const path = contentKeyWrapsRequest(PROFILE).path;
    expect(path).toContain(encodeURIComponent("disabled_at"));
    expect(path).not.toContain("disabled_at=");
  });

  it("turns the columns into a wrap", () => {
    const parsed = contentKeyWrapOf(row());
    expect(parsed?.profileId).toBe(PROFILE);
    expect(parsed?.epoch).toBe(1);
    expect(parsed?.disabled).toBe(false);
    expect(parsed?.sealed).toEqual(SEALED);
  });

  it("reads a retired generation as retired, not as absent", () => {
    const parsed = contentKeyWrapOf(row({ disabled_at: "2026-08-17T09:00:00Z" }));
    expect(parsed?.disabled).toBe(true);
    expect(parsed?.sealed).toEqual(SEALED);
  });

  it("leaves the byte LENGTHS to the layer that owns that rule", () => {
    // A short nonce is a perfectly well-formed `bytea`, and this file cannot say
    // otherwise without importing `wrap.ts` — which is the one import that would
    // put the master-key unwrap inside the web bundle's reach. `parseSealedKey`
    // refuses it at the desktop, where the key is actually assembled.
    const short = contentKeyWrapOf(row({ nonce: `\\x${"22".repeat(12)}` }));
    expect(short?.sealed.nonce).toBe(bytesToBase64url(new Uint8Array(12).fill(0x22)));
  });

  it.each([
    ["a bytea that is not hex", { nonce: "22".repeat(24) }],
    ["a bytea that is not a string", { wrapped: 17 }],
    ["an epoch of zero", { epoch: 0 }],
    ["an epoch past what a smallint holds", { epoch: 32_768 }],
    ["a fractional epoch", { epoch: 1.5 }],
    ["an epoch as a string", { epoch: "1" }],
    ["no profile", { profile_id: "" }],
    ["a disabled_at that is not a timestamp", { disabled_at: 17 }],
  ])("refuses %s", (_name, tamper) => {
    expect(contentKeyWrapOf(row(tamper))).toBeNull();
  });

  it("fails the whole response when one row is not a wrap", () => {
    // Skipping it would leave „this profile has no content key", and the
    // caller's answer to that is to mint a second one.
    expect(parseContentKeyWraps(JSON.stringify([row(), row({ epoch: 0 })]))).toBeNull();
  });

  it("reads an empty slot as an empty list, not as a failure", async () => {
    const port = recordingPort([ok("[]")]);
    const result = await readContentKeyWraps(port.port, PROFILE);
    expect(result).toEqual({ ok: true, wraps: [] });
  });

  it("reads every generation the account holds", async () => {
    const body = JSON.stringify([row(), row({ epoch: 2, disabled_at: null })]);
    const result = await readContentKeyWraps(recordingPort([ok(body)]).port, PROFILE);
    expect(result.ok).toBe(true);
    expect(result.ok && result.wraps.map((wrap) => wrap.epoch)).toEqual([1, 2]);
  });

  it.each([
    [401, "forbidden"],
    [403, "forbidden"],
    [500, "unavailable"],
    [503, "unavailable"],
  ])("names a %d as %s", async (status, reason) => {
    const port = recordingPort([failed(status, "{}")]);
    const result = await readContentKeyWraps(port.port, PROFILE);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe(reason);
  });

  it("names a privilege refusal as forbidden even at 200-adjacent statuses", async () => {
    const body = JSON.stringify({ code: "42501", message: "permission denied", details: null });
    const result = await readContentKeyWraps(recordingPort([failed(400, body)]).port, PROFILE);
    expect(!result.ok && result.reason).toBe("forbidden");
  });

  it("names a 200 that is not a list of wraps as malformed", async () => {
    const port = recordingPort([ok(JSON.stringify([row({ nonce: "nonsense" })]))]);
    const result = await readContentKeyWraps(port.port, PROFILE);
    expect(!result.ok && result.reason).toBe("malformed");
  });
});

describe("minting the first content key for a profile", () => {
  it("sends the wrap as three bytea columns and asks for the row back", () => {
    const request = mintContentKeyWrapRequest({
      userId: USER,
      profileId: PROFILE,
      epoch: 1,
      sealed: SEALED,
    });
    expect(request.method).toBe("POST");
    expect(request.headers["Prefer"]).toContain("return=representation");
    expect(JSON.parse(request.body ?? "null")).toEqual([
      {
        user_id: USER,
        kind: "ck_under_mk",
        profile_id: PROFILE,
        epoch: 1,
        nonce: `\\x${"22".repeat(24)}`,
        wrapped: `\\x${"33".repeat(48)}`,
        commit_tag: `\\x${"11".repeat(32)}`,
      },
    ]);
  });

  it("sends no kdf columns — this slot is refused one", () => {
    const request = mintContentKeyWrapRequest({
      userId: USER,
      profileId: PROFILE,
      epoch: 1,
      sealed: SEALED,
    });
    const sent = (JSON.parse(request.body ?? "null") as Record<string, unknown>[])[0]!;
    expect(Object.keys(sent)).not.toContain("kdf_salt");
    expect(Object.keys(sent)).not.toContain("kdf_params");
    // Nor anything the server states for itself.
    expect(Object.keys(sent)).not.toContain("disabled_at");
    expect(Object.keys(sent)).not.toContain("rotated_at");
    expect(Object.keys(sent)).not.toContain("created_at");
  });

  it("answers with what the server stored", async () => {
    const port = recordingPort([ok(JSON.stringify([row()]))]);
    const result = await mintContentKeyWrap(port.port, {
      userId: USER,
      profileId: PROFILE,
      epoch: 1,
      sealed: SEALED,
    });
    expect(result.ok).toBe(true);
    expect(result.ok && result.wrap.sealed).toEqual(SEALED);
  });

  it("names a slot another device already claimed", async () => {
    const body = JSON.stringify({
      code: "23505",
      message: 'duplicate key value violates unique constraint "key_wraps_one_per_slot"',
      details: null,
    });
    const result = await mintContentKeyWrap(recordingPort([failed(409, body)]).port, {
      userId: USER,
      profileId: PROFILE,
      epoch: 1,
      sealed: SEALED,
    });
    expect(!result.ok && result.reason).toBe("taken");
  });

  it.each([
    ["a different profile", { profile_id: "00000000-0000-4000-8000-000000000000" }],
    ["a different epoch", { epoch: 2 }],
    ["a rewritten nonce", { nonce: `\\x${"44".repeat(24)}` }],
    ["a rewritten ciphertext", { wrapped: `\\x${"55".repeat(48)}` }],
    ["a rewritten commitment", { commit_tag: `\\x${"66".repeat(32)}` }],
  ])("refuses to adopt a stored wrap that is %s", async (_name, tamper) => {
    const port = recordingPort([ok(JSON.stringify([row(tamper)]))]);
    const result = await mintContentKeyWrap(port.port, {
      userId: USER,
      profileId: PROFILE,
      epoch: 1,
      sealed: SEALED,
    });
    expect(!result.ok && result.reason).toBe("malformed");
  });

  it("refuses a representation that is not exactly one row", async () => {
    const port = recordingPort([ok("[]")]);
    const result = await mintContentKeyWrap(port.port, {
      userId: USER,
      profileId: PROFILE,
      epoch: 1,
      sealed: SEALED,
    });
    expect(!result.ok && result.reason).toBe("malformed");
  });
});
