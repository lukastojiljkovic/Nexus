/**
 * The transport against a REAL Supabase, or nothing at all.
 *
 * Every other suite in this package drives a fake port, which proves that the
 * requests are shaped the way this code believes PostgREST wants them. That is
 * exactly the thing a fake cannot check. The rules this package is built on —
 * that a filter value is percent-encoded and never quoted, that a PATCH matching
 * nothing is a silent 200, that an upsert is refused by the column grants, that
 * `bytea` is hex in both directions — were all measured against a running
 * server, and a measurement nobody re-runs is a comment.
 *
 * ─── Opt-in, and silent when it is not opted into ───────────────────────────
 *
 * It needs a local stack (`supabase start`), so it SKIPS unless all four
 * variables below are set. That is a deliberate compromise and worth naming: a
 * skipped test proves nothing, and „all green" on a machine without Docker does
 * not include this file. The alternative — failing on the absence of a database
 * — would make the suite unrunnable for everyone and get this file deleted
 * within a month.
 *
 * **What keeps that compromise from becoming an excuse is that CI runs it.** The
 * `database` job in `ci.yml` starts the real stack for pgTAP anyway, and now
 * feeds this suite the stack's own keys out of `supabase status`. So the skip is
 * a local convenience and not the normal state of affairs — which matters,
 * because a suite that only ever skips is indistinguishable from one that passes.
 *
 * Note that the gate is „all four are SET", not „all four are usable": pointed
 * at a stack that is not there, this file fails loudly rather than skipping. That
 * is the right way round. A misconfiguration should never be able to present
 * itself as an opt-out.
 *
 *   NEXUS_LIVE_SUPABASE_URL   http://127.0.0.1:54321
 *   NEXUS_LIVE_ANON_KEY       the project's anon key
 *   NEXUS_LIVE_SERVICE_KEY    the service-role key — used ONLY to create and
 *                             delete the throwaway user this file works with
 *   NEXUS_LIVE_JWT_SECRET     so an aal2 session can be minted without a second
 *                             factor being enrolled
 *
 * All four come out of `supabase status`; none of them is written down anywhere
 * in this repository, and none may be.
 *
 * ─── Why it mints its own JWT ───────────────────────────────────────────────
 *
 * The restrictive gate in migration 002 admits a session that is `aal2`, or one
 * a live `devices` row vouches for. A password sign-in through GoTrue is aal1,
 * and enrolling a TOTP factor from a test would be a page of unrelated protocol.
 * Minting the claim directly is the smallest thing that puts this file on the
 * right side of the wall it is not trying to test.
 */

import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bytesToBase64url } from "@nexus/sync-crypto";
import type { PushRow, SyncScope } from "@nexus/sync";

import { base64urlToBytea } from "./bytea.js";
import { readCursors, writeCursor } from "./cursor.js";
import {
  keyWrapReadbackRequest,
  syncEnableBody,
  syncEnableRoundTripProblem,
  type SyncEnableInput,
} from "./enable.js";
import { jsonHeaders, type HttpPort, type HttpRequest } from "./http.js";
import { advanceCursor, pullPage, pullWindow } from "./pull.js";
import { pushRow } from "./push.js";

const URL_BASE = process.env["NEXUS_LIVE_SUPABASE_URL"];
const ANON = process.env["NEXUS_LIVE_ANON_KEY"];
const SERVICE = process.env["NEXUS_LIVE_SERVICE_KEY"];
const JWT_SECRET = process.env["NEXUS_LIVE_JWT_SECRET"];

const LIVE =
  URL_BASE !== undefined && ANON !== undefined && SERVICE !== undefined && JWT_SECRET !== undefined;

const b64url = (value: string | Uint8Array): string =>
  Buffer.from(typeof value === "string" ? value : value).toString("base64url");

/**
 * `sessionId` is a parameter because the desktop-only wall on `key_wraps` joins
 * `devices.session_id` to the caller's own `session_id` claim. A test that wants
 * to be on the desktop side of that wall has to hold both halves.
 */
function mintAal2(userId: string, sessionId: string = randomUUID()): string {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      aud: "authenticated",
      role: "authenticated",
      sub: userId,
      session_id: sessionId,
      aal: "aal2",
      iat: now,
      exp: now + 3600,
    }),
  );
  const signature = createHmac("sha256", JWT_SECRET ?? "")
    .update(`${head}.${claims}`)
    .digest("base64url");
  return `${head}.${claims}.${signature}`;
}

/**
 * The port the desktop and the web app will each build for themselves.
 *
 * It is nine lines, and that is the point of the seam: the whole of „reach the
 * network" is an origin, two headers and a `fetch`, and this package holds none
 * of the three.
 */
function livePort(token: string): HttpPort {
  return async (request: HttpRequest) => {
    // The one place this package is allowed a network call. What permits it is
    // the named `fetch` exemption for this file in `scripts/check-egress.mjs` —
    // not a lint directive, which would have claimed a rule this repository does
    // not have and read as an assurance nothing was actually making.
    const response = await fetch(`${URL_BASE ?? ""}/rest/v1${request.path}`, {
      method: request.method,
      headers: { ...request.headers, apikey: ANON ?? "", Authorization: `Bearer ${token}` },
      ...(request.body === null ? {} : { body: request.body }),
    });
    return { status: response.status, body: await response.text() };
  };
}

const filled = (length: number, value: number): string =>
  bytesToBase64url(Uint8Array.from({ length }, () => value));

/**
 * A fresh nonce AND a fresh ciphertext for every push, because the server
 * requires both and is right to.
 *
 * The first version of this fixture varied only the nonce and was refused with
 * NX003 — „the ciphertext must be re-sealed for every version". That is not a
 * quirk to work around: the version is inside the AEAD associated data, so a
 * real `sealRow` cannot produce the same bytes twice, and identical bytes at a
 * new version are always a row no key-holder wrote. A fixture that kept them
 * constant was modelling a client that does not exist.
 */
let seed = 1;
const freshSeal = (): { nonce: string; ciphertext: string } => {
  seed += 1;
  return {
    nonce: bytesToBase64url(Uint8Array.from({ length: 24 }, (_, index) => (seed * 7 + index) % 251)),
    ciphertext: bytesToBase64url(Uint8Array.from({ length: 17 }, (_, index) => (seed * 13 + index) % 251)),
  };
};

describe.skipIf(!LIVE)("the transport against a real PostgREST", () => {
  const profileId = randomUUID();
  /**
   * The session every request in this file is made under, fixed rather than
   * random, because `key_wraps_desktop_only` joins `devices.session_id` to the
   * caller's own `session_id` claim. One session, one desktop device row, both
   * halves in hand — which is what a real desktop holds.
   */
  const sessionId = randomUUID();
  let userId = "";
  let deviceId = "";
  let http: HttpPort;
  let scope: SyncScope;

  const row = (over: Partial<PushRow> = {}): PushRow => ({
    collection: "tasks",
    objectId: "task-1",
    parentId: null,
    version: 1,
    deleted: false,
    ckEpoch: 1,
    sealed: { v: 2, ...freshSeal() },
    ...over,
  });

  async function admin(
    path: string,
    method: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ): Promise<Response> {
    // Permitted by the same exemption as the port above.
    return fetch(`${URL_BASE ?? ""}${path}`, {
      method,
      headers: {
        apikey: SERVICE ?? "",
        Authorization: `Bearer ${SERVICE ?? ""}`,
        "Content-Type": "application/json",
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  beforeAll(async () => {
    const response = await admin("/auth/v1/admin/users", "POST", {
      email: `transport-${randomUUID()}@nexus.local`,
      password: randomUUID(),
      email_confirm: true,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    userId = ((await response.json()) as { id: string }).id;
    scope = { userId, profileId };
    http = livePort(mintAal2(userId, sessionId));

    // THE DESKTOP DEVICE ROW COMES FIRST, and it is written by the SERVICE role.
    //
    // `key_wraps_desktop_only`'s WITH CHECK requires a live `platform =
    // 'desktop'` device bound to the caller's own session for EVERY write to
    // `key_wraps` — `ck_under_mk` included, not only the master-key slots — and
    // `grant insert` on `devices` withholds `platform`, so no client can declare
    // itself a desktop. In production `nexus_mk_mint` writes this row under
    // `service_role`; here that is what the service key stands in for. Seeding it
    // any other way would be modelling a client that cannot exist.
    //
    // `sync_state`'s tenant-scoped foreign key needs this row too, so one device
    // serves both purposes.
    const device = await admin(
      "/rest/v1/devices?select=id",
      "POST",
      [
        {
          user_id: userId,
          session_id: sessionId,
          platform: "desktop",
          name_nonce: base64urlToBytea(filled(24, 0x11)),
          name_ciphertext: base64urlToBytea(filled(32, 0x22)),
          public_key: null,
        },
      ],
      { Prefer: "return=representation" },
    );
    const deviceBody = await device.text();
    expect(device.status, deviceBody).toBe(201);
    deviceId = (JSON.parse(deviceBody) as { id: string }[])[0]!.id;

    // NX007 refuses any row naming an epoch whose `ck_under_mk` wrap does not
    // exist, so the content key has to be stored before anything is sealed under
    // it. The bytes are arbitrary here — the server holds no unwrapping secret
    // and this file is not testing the crypto.
    const wrap = await http({
      method: "POST",
      path: "/key_wraps",
      headers: jsonHeaders("return=minimal"),
      body: JSON.stringify([
        {
          user_id: userId,
          kind: "ck_under_mk",
          profile_id: profileId,
          epoch: 1,
          nonce: base64urlToBytea(filled(24, 0xaa)),
          wrapped: base64urlToBytea(filled(48, 0xbb)),
          commit_tag: base64urlToBytea(filled(32, 0xcc)),
        },
      ]),
    });
    expect(wrap.status, wrap.body).toBe(201);
  }, 30_000);

  afterAll(async () => {
    // `on delete cascade` from `auth.users` takes the ciphertext, the wraps, the
    // device and the cursors with it — which is the erasure guarantee migration
    // 001 builds into the FK graph, exercised here as a side effect.
    if (userId !== "") await admin(`/auth/v1/admin/users/${userId}`, "DELETE");
  });

  it("creates, then reads back byte-for-byte through the bytea round trip", async () => {
    const created = row();
    const push = await pushRow(http, scope, created);
    expect(push.code, push.message ?? "").toBe("accepted");
    expect(push.seq).toBeGreaterThan(0);

    const page = await pullPage(http, scope, "tasks", 0);
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    const pulled = page.rows.find((candidate) => candidate.objectId === "task-1");
    expect(pulled?.nonce).toBe(created.sealed.nonce);
    expect(pulled?.ciphertext).toBe(created.sealed.ciphertext);
    expect(pulled?.version).toBe(1);
    expect(pulled?.parentId).toBeNull();
  });

  it("updates through a PATCH, and refuses the same version twice with NX001", async () => {
    const second = await pushRow(http, scope, row({ version: 2 }));
    expect(second.code, second.message ?? "").toBe("accepted");

    const again = await pushRow(http, scope, row({ version: 2 }));
    expect(again.code).toBe("conflict");
    expect(again.sqlstate).toBe("NX001");
  });

  it("reports a creation of something that exists as a duplicate", async () => {
    const duplicate = await pushRow(http, scope, row());
    expect(duplicate.code).toBe("duplicate");
    expect(duplicate.sqlstate).toBe("23505");
  });

  it("reports an update of something that does not exist, rather than reporting success", async () => {
    // The silent one: HTTP 200 with an empty array, no error at any layer.
    const missing = await pushRow(http, scope, row({ objectId: "never-existed", version: 4 }));
    expect(missing.code).toBe("absent");
  });

  it("round-trips the empty object id of a per-profile singleton", async () => {
    const singleton = { collection: "calendar_settings", objectId: "" } as const;
    expect((await pushRow(http, scope, row({ ...singleton }))).code).toBe("accepted");
    // The PATCH is the half that would fail silently if the filter were quoted.
    const updated = await pushRow(http, scope, row({ ...singleton, version: 2 }));
    expect(updated.code, updated.message ?? "").toBe("accepted");
  });

  it("round-trips an object id made of every character a filter could break on", async () => {
    const ugly = `a,b."c"\\d${String.fromCharCode(31)}e f&g#h%i+j`;
    expect((await pushRow(http, scope, row({ objectId: ugly }))).code).toBe("accepted");
    const updated = await pushRow(http, scope, row({ objectId: ugly, version: 2 }));
    expect(updated.code, updated.message ?? "").toBe("accepted");

    const page = await pullPage(http, scope, "tasks", 0);
    expect(page.ok && page.rows.some((candidate) => candidate.objectId === ugly)).toBe(true);
  });

  it("refuses an epoch whose content key was never stored", async () => {
    const orphan = await pushRow(http, scope, row({ objectId: "orphan-epoch", ckEpoch: 9 }));
    expect(orphan.code).toBe("no-epoch");
    expect(orphan.sqlstate).toBe("NX007");
  });

  it("walks the log in pages until a page comes back empty", async () => {
    for (let index = 0; index < 5; index += 1) {
      const push = await pushRow(http, scope, row({ collection: "notes", objectId: `note-${index}` }));
      expect(push.code, push.message ?? "").toBe("accepted");
    }

    let from = pullWindow(0);
    let pages = 0;
    const seen: string[] = [];
    for (;;) {
      const page = await pullPage(http, scope, "notes", from, 2);
      expect(page.ok).toBe(true);
      if (!page.ok) break;
      pages += 1;
      if (page.exhausted) break;
      for (const pulled of page.rows) seen.push(pulled.objectId);
      from = page.rows[page.rows.length - 1]!.seq;
      expect(pages).toBeLessThan(20);
    }
    // Five rows at two a page: three full-ish pages and the empty one that ends
    // the walk. The count matters because it is the shape that did not
    // terminate when the overlap was applied per request instead of per round.
    expect(pages).toBe(4);
    expect(seen).toEqual(["note-0", "note-1", "note-2", "note-3", "note-4"]);
    expect(advanceCursor(0, from)).toBe(from);
  });

  it("keeps a cursor: an insert on the first write, an update on the next", async () => {
    const first = await writeCursor(http, scope, deviceId, "notes", 5);
    expect(first.ok && first.created).toBe(true);
    const second = await writeCursor(http, scope, deviceId, "notes", 9);
    expect(second.ok && second.created).toBe(false);

    const read = await readCursors(http, scope, deviceId);
    expect(read.ok && read.cursors).toEqual([{ collection: "notes", lastSeq: 9 }]);
  });

  it("survives losing the race to create its own cursor row", async () => {
    // The two-tabs-of-one-device case, staged rather than described: the port
    // below lets the first PATCH miss, then creates the row out of band before
    // the POST goes out, so PostgREST raises a REAL 23505 against a real unique
    // index. What is being proved is that the recovery — re-issue the PATCH,
    // which now matches — actually stores the value, because the alternative
    // („the row exists, call it done") reports success for a write that never
    // happened and is indistinguishable from this one at the call site.
    let intercepted = false;
    const racing: HttpPort = async (request) => {
      const response = await http(request);
      if (!intercepted && request.method === "PATCH" && response.body === "[]") {
        intercepted = true;
        const seeded = await http({
          method: "POST",
          path: "/sync_state",
          headers: jsonHeaders("return=representation"),
          body: JSON.stringify([
            { user_id: userId, device_id: deviceId, profile_id: profileId, collection: "events", last_seq: 2 },
          ]),
        });
        expect(seeded.status).toBe(201);
      }
      return response;
    };

    const written = await writeCursor(racing, scope, deviceId, "events", 77);
    expect(intercepted).toBe(true);
    expect(written.ok && written.created).toBe(false);

    const read = await readCursors(http, scope, deviceId);
    expect(read.ok && read.cursors.find((row) => row.collection === "events")?.lastSeq).toBe(77);
  });

  it("cannot upsert, which is why push is two verbs", async () => {
    // The measurement `push.ts`'s header rests on, re-run rather than recorded:
    // PostgREST's `merge-duplicates` assigns every payload column, including the
    // four the UPDATE grant withholds, so the whole statement is refused.
    const upsert = await http({
      method: "POST",
      path: "/sync_objects?on_conflict=user_id%2Cprofile_id%2Ccollection%2Cobject_id",
      headers: jsonHeaders("resolution=merge-duplicates,return=representation"),
      body: JSON.stringify([
        {
          user_id: userId,
          profile_id: profileId,
          collection: "tasks",
          object_id: "task-1",
          parent_id: null,
          version: 3,
          deleted: false,
          ck_epoch: 1,
          nonce: base64urlToBytea(freshSeal().nonce),
          ciphertext: base64urlToBytea(freshSeal().ciphertext),
        },
      ]),
    });
    expect(upsert.status).toBe(403);
    expect(upsert.body).toContain("42501");
  });

  /**
   * The readback the mint is verified with, against the real thing.
   *
   * Two claims are being measured, and neither is checkable against a fake.
   * First, that `kind=in.(a%2Cb)` is understood: `filterValue` percent-encodes
   * every value, so the list separator arrives encoded, and „PostgREST decodes
   * the whole query string before parsing" being true of `eq.` does not make it
   * true of a list. Second, that the two master-key slots come back and the
   * `ck_under_mk` row `beforeAll` created does NOT — a filter that silently
   * matched everything would still make the round-trip check pass, and would be
   * comparing rows the mint never wrote.
   *
   * It runs on the desktop device `beforeAll` registered — a master-key wrap
   * cannot be written or read any other way, and that wall is migration 010's
   * whole subject.
   */
  it("reads back exactly the two master-key wraps, and the round-trip check passes", async () => {
    const input: SyncEnableInput = {
      authorisingToken: "unused — this test does not call the Edge Function",
      deviceName: { nonce: filled(24, 0x01), ciphertext: filled(40, 0x02) },
      passwordWrap: {
        nonce: filled(24, 0x11),
        ciphertext: filled(48, 0x12),
        commitment: filled(32, 0x13),
      },
      passwordKdfParams: { memoryKiB: 65536, iterations: 3, parallelism: 1 },
      recoveryWrap: {
        nonce: filled(24, 0x21),
        ciphertext: filled(48, 0x22),
        commitment: filled(32, 0x23),
      },
      recoveryKdfParams: { memoryKiB: 65536, iterations: 3, parallelism: 1 },
      recoverySalt: filled(16, 0x31),
    };
    const body = syncEnableBody(input);

    const wrote = await http({
      method: "POST",
      path: "/key_wraps",
      headers: jsonHeaders("return=minimal"),
      body: JSON.stringify([
        {
          user_id: userId,
          kind: "mk_under_kwrap",
          nonce: base64urlToBytea(body.kwrap.nonce),
          wrapped: base64urlToBytea(body.kwrap.wrapped),
          commit_tag: base64urlToBytea(body.kwrap.commit_tag),
          // Spelled out as null rather than omitted: PostgREST refuses a bulk
          // insert whose objects do not carry the same keys (PGRST102, „All
          // object keys must match"), and the two slots differ by exactly this
          // one. The request body this package builds is a JSON body for an Edge
          // Function, not a PostgREST insert, so the rule does not reach it — but
          // it does reach anything that ever writes these two rows side by side.
          kdf_salt: null,
          kdf_params: body.kwrap.kdf_params,
        },
        {
          user_id: userId,
          kind: "mk_under_src",
          nonce: base64urlToBytea(body.src.nonce),
          wrapped: base64urlToBytea(body.src.wrapped),
          commit_tag: base64urlToBytea(body.src.commit_tag),
          kdf_salt: base64urlToBytea(body.src.kdf_salt),
          kdf_params: body.src.kdf_params,
        },
      ]),
    });
    expect(wrote.status, wrote.body).toBe(201);

    const readback = await http(keyWrapReadbackRequest());
    expect(readback.status, readback.body).toBe(200);
    const rows = JSON.parse(readback.body) as unknown[];
    expect(rows).toHaveLength(2);
    expect(syncEnableRoundTripProblem(input, rows)).toBeNull();
  });
});
