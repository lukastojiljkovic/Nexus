import { describe, expect, it } from "vitest";
import { bytesToBase64url } from "@nexus/sync-crypto";
import type { PushRow, SyncScope } from "@nexus/sync";

import { pushRow, pushRows } from "./push.js";
import { created, failed, failingPort, ok, recordingPort } from "./testing.js";

const SCOPE: SyncScope = {
  userId: "11111111-1111-1111-1111-111111111111",
  profileId: "22222222-2222-2222-2222-222222222222",
};

const filled = (length: number, value: number): string =>
  bytesToBase64url(Uint8Array.from({ length }, () => value));

const row = (over: Partial<PushRow> = {}): PushRow => ({
  collection: "tasks",
  objectId: "task-1",
  parentId: null,
  version: 1,
  deleted: false,
  ckEpoch: 1,
  sealed: { v: 2, nonce: filled(24, 0x0a), ciphertext: filled(17, 0x41) },
  ...over,
});

const STORED = JSON.stringify([{ collection: "tasks", object_id: "task-1", seq: 77 }]);

const NX = (code: string, message: string): string =>
  JSON.stringify({ code, details: null, hint: null, message });

describe("pushRow — a creation", () => {
  it("is a POST of an array, because PostgREST's insert takes a collection", async () => {
    const { port, requests } = recordingPort([created(STORED)]);
    await pushRow(port, SCOPE, row());
    expect(requests[0]!.method).toBe("POST");
    expect(JSON.parse(requests[0]!.body ?? "null")).toHaveLength(1);
    expect(requests[0]!.headers["Prefer"]).toBe("return=representation");
  });

  it("carries no filter, since there is nothing yet to filter", async () => {
    const { port, requests } = recordingPort([created(STORED)]);
    await pushRow(port, SCOPE, row());
    expect(requests[0]!.path.includes("object_id=")).toBe(false);
  });

  it("reports the server's own seq, which is what a cursor is made of", async () => {
    const { port } = recordingPort([created(STORED)]);
    expect(await pushRow(port, SCOPE, row())).toMatchObject({ code: "accepted", seq: 77 });
  });

  it("reads a primary-key duplicate as another device having created it first", async () => {
    const { port } = recordingPort([
      failed(409, NX("23505", 'duplicate key value violates unique constraint "sync_objects_pkey"')),
    ]);
    expect((await pushRow(port, SCOPE, row())).code).toBe("duplicate");
  });
});

describe("pushRow — an update", () => {
  it("is a PATCH of a bare object filtered by the four identity columns", async () => {
    const { port, requests } = recordingPort([ok(STORED)]);
    await pushRow(port, SCOPE, row({ version: 2 }));
    const request = requests[0]!;
    expect(request.method).toBe("PATCH");
    expect(Array.isArray(JSON.parse(request.body ?? "null"))).toBe(false);
    for (const fragment of [
      `user_id=eq.${SCOPE.userId}`,
      `profile_id=eq.${SCOPE.profileId}`,
      "collection=eq.tasks",
      "object_id=eq.task-1",
    ]) {
      expect(request.path).toContain(fragment);
    }
  });

  it("filters an empty object id as an empty value, never as quotes", async () => {
    // The six per-profile singletons. `eq.""` matched no row at all, and a PATCH
    // that matches nothing is a silent success.
    const { port, requests } = recordingPort([ok(STORED)]);
    await pushRow(port, SCOPE, row({ collection: "calendar_settings", objectId: "", version: 2 }));
    expect(requests[0]!.path).toContain("object_id=eq.&");
    expect(requests[0]!.path.includes("%22")).toBe(false);
  });

  it("turns an empty representation into `absent` rather than into success", async () => {
    // THE SILENT ONE. HTTP 200, `[]`, no error at any layer, and the edit is
    // gone with no record that it failed.
    const { port } = recordingPort([ok("[]")]);
    expect((await pushRow(port, SCOPE, row({ version: 2 }))).code).toBe("absent");
  });

  it("reads NX001 as a conflict to re-read, not as something to retry", async () => {
    const { port } = recordingPort([
      failed(400, NX("NX001", "sync_objects.version must be exactly one more than the stored version")),
    ]);
    const result = await pushRow(port, SCOPE, row({ version: 9 }));
    expect(result.code).toBe("conflict");
    expect(result.sqlstate).toBe("NX001");
  });

  it("reads NX005 as an alarm rather than as a rejection", async () => {
    const { port } = recordingPort([
      failed(400, NX("NX005", "sync_objects.nonce must be freshly drawn for every version")),
    ]);
    expect((await pushRow(port, SCOPE, row({ version: 2 }))).code).toBe("nonce-reuse");
  });
});

describe("pushRow — the port itself failing", () => {
  it("says `unavailable`, because nothing was learned about the row", async () => {
    const result = await pushRow(failingPort("no route to host"), SCOPE, row());
    expect(result.code).toBe("unavailable");
    expect(result.message).toBe("no route to host");
  });

  it("names the row in every outcome, so a caller never has to correlate by position", async () => {
    const result = await pushRow(failingPort(), SCOPE, row({ collection: "notes", objectId: "n-9" }));
    expect(result).toMatchObject({ collection: "notes", objectId: "n-9" });
  });
});

describe("pushRows", () => {
  it("sends one request per row, in order", async () => {
    const { port, requests } = recordingPort([created(STORED), created(STORED), created(STORED)]);
    const results = await pushRows(port, SCOPE, [
      row({ objectId: "a" }),
      row({ objectId: "b" }),
      row({ objectId: "c" }),
    ]);
    expect(results.map((result) => result.objectId)).toEqual(["a", "b", "c"]);
    expect(requests).toHaveLength(3);
  });

  it("stops at the first outcome that makes the rest of the plan stale", async () => {
    // Every row after a conflict was planned against the same stale picture of
    // the server, so pushing them would either fail identically or succeed at a
    // version derived from a state the server has already moved past.
    const { port, requests } = recordingPort([
      created(STORED),
      failed(400, NX("NX001", "version")),
      created(STORED),
    ]);
    const results = await pushRows(port, SCOPE, [row({ objectId: "a" }), row({ objectId: "b" }), row({ objectId: "c" })]);
    expect(results.map((result) => result.code)).toEqual(["accepted", "conflict"]);
    expect(requests).toHaveLength(2);
  });

  it("stops on a repeated nonce, which is not a race but a broken generator", async () => {
    const { port } = recordingPort([failed(400, NX("NX005", "nonce")), created(STORED)]);
    const results = await pushRows(port, SCOPE, [row({ objectId: "a" }), row({ objectId: "b" })]);
    expect(results.map((result) => result.code)).toEqual(["nonce-reuse"]);
  });

  it("keeps going past a failure that is about one row alone", async () => {
    const { port } = recordingPort([
      failed(400, NX("NX007", "sync_objects.ck_epoch names no content-key wrap")),
      created(STORED),
    ]);
    const results = await pushRows(port, SCOPE, [row({ objectId: "a" }), row({ objectId: "b" })]);
    expect(results.map((result) => result.code)).toEqual(["no-epoch", "accepted"]);
  });
});
