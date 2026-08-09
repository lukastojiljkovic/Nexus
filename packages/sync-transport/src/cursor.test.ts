import { describe, expect, it } from "vitest";
import type { SyncScope } from "@nexus/sync";

import { readCursors, writeCursor } from "./cursor.js";
import { created, failed, ok, recordingPort } from "./testing.js";

const SCOPE: SyncScope = {
  userId: "11111111-1111-1111-1111-111111111111",
  profileId: "22222222-2222-2222-2222-222222222222",
};
const DEVICE = "33333333-3333-3333-3333-333333333333";

describe("readCursors", () => {
  it("asks for this device's rows in this profile, and for two columns", async () => {
    const { port, requests } = recordingPort([ok("[]")]);
    await readCursors(port, SCOPE, DEVICE);
    expect(requests[0]!.method).toBe("GET");
    expect(requests[0]!.path).toContain(`device_id=eq.${DEVICE}`);
    expect(requests[0]!.path).toContain("select=collection%2Clast_seq");
  });

  it("reads the rows", async () => {
    const { port } = recordingPort([ok('[{"collection":"tasks","last_seq":40}]')]);
    const result = await readCursors(port, SCOPE, DEVICE);
    expect(result.ok && result.cursors).toEqual([{ collection: "tasks", lastSeq: 40 }]);
  });

  it("refuses a row carrying a column it did not ask for", async () => {
    const { port } = recordingPort([ok('[{"collection":"tasks","last_seq":40,"updated_at":"2026-08-09"}]')]);
    const result = await readCursors(port, SCOPE, DEVICE);
    expect(!result.ok && result.reason).toBe("malformed");
  });

  it("refuses a cursor that is not a whole non-negative number", async () => {
    for (const lastSeq of ["-1", "1.5", '"40"', "null"]) {
      const { port } = recordingPort([ok(`[{"collection":"tasks","last_seq":${lastSeq}}]`)]);
      const result = await readCursors(port, SCOPE, DEVICE);
      expect(!result.ok && result.reason, lastSeq).toBe("malformed");
    }
  });
});

describe("writeCursor", () => {
  it("updates first, because after the first sync that is the only call needed", async () => {
    const { port, requests } = recordingPort([ok('[{"collection":"tasks"}]')]);
    const result = await writeCursor(port, SCOPE, DEVICE, "tasks", 91);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.method).toBe("PATCH");
    expect(JSON.parse(requests[0]!.body ?? "null")).toEqual({ last_seq: 91 });
    expect(result.ok && result.created).toBe(false);
  });

  it("creates the row when the update matched nothing", async () => {
    // The same silent-no-op shape as a push: PostgREST answers a PATCH that
    // matched no row with 200 and an empty array.
    const { port, requests } = recordingPort([ok("[]"), created('[{"collection":"tasks"}]')]);
    const result = await writeCursor(port, SCOPE, DEVICE, "tasks", 91);
    expect(requests.map((request) => request.method)).toEqual(["PATCH", "POST"]);
    expect(JSON.parse(requests[1]!.body ?? "null")).toEqual([
      {
        user_id: SCOPE.userId,
        device_id: DEVICE,
        profile_id: SCOPE.profileId,
        collection: "tasks",
        last_seq: 91,
      },
    ]);
    expect(result.ok && result.created).toBe(true);
  });

  it("never states updated_at, which is the server's clock", async () => {
    const { port, requests } = recordingPort([ok("[]"), created('[{"collection":"tasks"}]')]);
    await writeCursor(port, SCOPE, DEVICE, "tasks", 91);
    for (const request of requests) {
      expect(request.body ?? "").not.toContain("updated_at");
    }
  });

  it("re-runs the update when another writer created the row first", async () => {
    // Two tabs of one device share a `devices` row and therefore share every
    // cursor in it. Both miss on the PATCH, both POST, one loses with 23505.
    // The loser's `lastSeq` was never stored, so „the row exists, call it done"
    // would be a success report for a value nobody wrote.
    const { port, requests } = recordingPort([
      ok("[]"),
      failed(409, '{"code":"23505","message":"duplicate key value","details":null,"hint":null}'),
      ok('[{"collection":"tasks"}]'),
    ]);
    const result = await writeCursor(port, SCOPE, DEVICE, "tasks", 91);
    expect(requests.map((request) => request.method)).toEqual(["PATCH", "POST", "PATCH"]);
    expect(JSON.parse(requests[2]!.body ?? "null")).toEqual({ last_seq: 91 });
    expect(result.ok && result.created).toBe(false);
  });

  it("does not retry a conflict that is not a duplicate key", async () => {
    const { port, requests } = recordingPort([
      ok("[]"),
      failed(400, '{"code":"23514","message":"violates check constraint","details":null,"hint":null}'),
    ]);
    const result = await writeCursor(port, SCOPE, DEVICE, "tasks", 91);
    expect(requests).toHaveLength(2);
    expect(!result.ok && result.sqlstate).toBe("23514");
  });

  it("reports a refusal rather than falling through to the insert", async () => {
    const { port, requests } = recordingPort([
      failed(403, '{"code":"42501","message":"permission denied","details":null,"hint":null}'),
    ]);
    const result = await writeCursor(port, SCOPE, DEVICE, "tasks", 91);
    expect(!result.ok && result.reason).toBe("forbidden");
    expect(requests).toHaveLength(1);
  });
});
