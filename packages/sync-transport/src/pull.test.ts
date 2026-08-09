import { describe, expect, it } from "vitest";
import { bytesToBase64url } from "@nexus/sync-crypto";
import type { SyncScope } from "@nexus/sync";

import { base64urlToBytea } from "./bytea.js";
import { PULL_OVERLAP, PULL_PAGE_ROWS, advanceCursor, pullPage, pullWindow } from "./pull.js";
import { failed, ok, recordingPort } from "./testing.js";

const SCOPE: SyncScope = {
  userId: "11111111-1111-1111-1111-111111111111",
  profileId: "22222222-2222-2222-2222-222222222222",
};

const filled = (length: number, value: number): string =>
  bytesToBase64url(Uint8Array.from({ length }, () => value));

const served = (seq: number, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  collection: "tasks",
  object_id: `task-${seq}`,
  parent_id: null,
  version: 1,
  deleted: false,
  ck_epoch: 1,
  seq,
  nonce: base64urlToBytea(filled(24, seq % 251)),
  ciphertext: base64urlToBytea(filled(17, 0x41)),
  ...over,
});

/** The query of a recorded request, as a map, so an assertion names one parameter. */
const params = (path: string): Map<string, string> => {
  const query = path.slice(path.indexOf("?") + 1);
  return new Map(
    query.split("&").map((pair) => {
      const split = pair.indexOf("=");
      return [pair.slice(0, split), decodeURIComponent(pair.slice(split + 1))];
    }),
  );
};

describe("pullWindow", () => {
  it("starts a round BEHIND the stored watermark", () => {
    // The overlap is the whole reason `seq` is usable as a cursor: an identity
    // value is assigned before commit, so two writes can be numbered 41 and 42
    // and commit in the other order. Without it, 41 is never seen again.
    expect(pullWindow(1000)).toBe(1000 - PULL_OVERLAP);
  });

  it("never asks for a negative seq on a device that has pulled nothing", () => {
    expect(pullWindow(0)).toBe(0);
    expect(pullWindow(PULL_OVERLAP - 1)).toBe(0);
  });
});

describe("pullPage", () => {
  it("takes fromSeq literally, so a walk cannot be pulled backwards by the overlap", async () => {
    // The regression this asserts against: `pullPage` used to subtract the
    // overlap itself, so a walk that advanced to the last row of a page and
    // asked again had 64 taken off the number it had just moved to. With any
    // page limit at or below the overlap the window never moved at all.
    const { port, requests } = recordingPort([ok("[]")]);
    const result = await pullPage(port, SCOPE, "tasks", 1000);
    expect(params(requests[0]!.path).get("seq")).toBe("gt.1000");
    expect(result.ok && result.fromSeq).toBe(1000);
  });

  it("a walk over small pages terminates", async () => {
    // The shape that did not terminate. Two rows a page, an overlap of 64: with
    // the subtraction inside `pullPage` this loop served rows 1 and 2 for ever.
    const { port } = recordingPort([
      ok(JSON.stringify([served(1), served(2)])),
      ok(JSON.stringify([served(3), served(4)])),
      ok("[]"),
    ]);
    let from = pullWindow(0);
    let pages = 0;
    const seen: number[] = [];
    for (;;) {
      const page = await pullPage(port, SCOPE, "tasks", from, 2);
      expect(page.ok).toBe(true);
      if (!page.ok) break;
      pages += 1;
      if (page.exhausted) break;
      for (const row of page.rows) seen.push(row.seq);
      from = page.rows[page.rows.length - 1]!.seq;
      expect(pages).toBeLessThan(10);
    }
    expect(pages).toBe(3);
    expect(seen).toEqual([1, 2, 3, 4]);
  });

  it("asks in seq order, scoped to the account, the profile and the collection", async () => {
    const { port, requests } = recordingPort([ok("[]")]);
    await pullPage(port, SCOPE, "tasks", 0);
    const query = params(requests[0]!.path);
    expect(requests[0]!.method).toBe("GET");
    expect(requests[0]!.path.startsWith("/sync_objects?")).toBe(true);
    expect(query.get("user_id")).toBe(`eq.${SCOPE.userId}`);
    expect(query.get("profile_id")).toBe(`eq.${SCOPE.profileId}`);
    expect(query.get("collection")).toBe("eq.tasks");
    expect(query.get("order")).toBe("seq.asc");
    expect(query.get("limit")).toBe(String(PULL_PAGE_ROWS));
    expect(requests[0]!.body).toBeNull();
  });

  it("is exhausted only when the page is EMPTY, not when it is short", async () => {
    // `max_rows` truncates a response without saying so, so „fewer than I asked
    // for" cannot mean „that is all there is". The loop rule that survives any
    // server-side cap is: keep going while rows arrive.
    const short = await pullPage(port1(), SCOPE, "tasks", 0, 500);
    expect(short.ok && short.rows).toHaveLength(1);
    expect(short.ok && short.exhausted).toBe(false);

    const { port } = recordingPort([ok("[]")]);
    const empty = await pullPage(port, SCOPE, "tasks", 0);
    expect(empty.ok && empty.exhausted).toBe(true);
  });

  it("fails the whole page when one row is not a row", async () => {
    // Not „skip the bad row": skipping would let the server choose which of this
    // account's rows a device never sees. A server that serves nonsense stalls
    // itself, which is the failure to prefer.
    const { port } = recordingPort([ok(JSON.stringify([served(1), { ...served(2), user_id: SCOPE.userId }]))]);
    const result = await pullPage(port, SCOPE, "tasks", 0);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe("malformed");
    expect(!result.ok && result.message).toContain("row 1");
  });

  it("names a dead session apart from a broken server", async () => {
    const forbidden = await pullPage(
      recordingPort([failed(403, '{"code":"42501","message":"permission denied","details":null,"hint":null}')]).port,
      SCOPE,
      "tasks",
      0,
    );
    expect(!forbidden.ok && forbidden.reason).toBe("forbidden");
    expect(!forbidden.ok && forbidden.sqlstate).toBe("42501");

    const broken = await pullPage(recordingPort([failed(502, "<html>bad gateway</html>")]).port, SCOPE, "tasks", 0);
    expect(!broken.ok && broken.reason).toBe("unavailable");
  });

  it("refuses a 200 whose body is not an array", async () => {
    const result = await pullPage(recordingPort([ok('{"seq":1}')]).port, SCOPE, "tasks", 0);
    expect(!result.ok && result.reason).toBe("unavailable");
  });
});

describe("advanceCursor", () => {
  it("never moves the watermark backwards", () => {
    // Every pull starts behind the stored cursor, so a page whose last readable
    // row sits inside the overlap yields a `nextSeq` LOWER than what the device
    // already knows. Storing that would walk the cursor backwards on every sync.
    expect(advanceCursor(1000, 950)).toBe(1000);
    expect(advanceCursor(1000, 1200)).toBe(1200);
    expect(advanceCursor(0, 0)).toBe(0);
  });
});

function port1() {
  return recordingPort([ok(JSON.stringify([served(1)]))]).port;
}
