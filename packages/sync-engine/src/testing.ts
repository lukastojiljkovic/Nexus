/**
 * `sync_objects` as an in-memory server, for this package's own tests.
 *
 * Reachable only as `@nexus/sync-engine/testing`, the way
 * `@nexus/sync-crypto` publishes its fake port: a subpath nothing but a test
 * imports, so the fixture cannot reach a bundle by accident. It earns the
 * subpath rather than staying private because `@nexus/db` needs it — the only
 * way to prove the loop is to run two real databases against one server, and
 * a second hand-written copy of this file would be a second set of rules.
 *
 * It answers the three requests the round makes — the paged GET, the POST that
 * creates and the PATCH that updates — and it enforces the two server rules the
 * loop is built on: `seq` is assigned by the server and re-stamped on every
 * write, and a version that is not exactly one past the stored one is refused
 * with `NX001`. Everything else about a real PostgREST is out of scope here; the
 * wire itself was measured against a running one in `@nexus/sync-transport`.
 */

import type { PushRow } from "@nexus/sync";
import type { HttpPort, HttpRequest, HttpResponse } from "@nexus/sync-transport";

interface StoredRow {
  collection: string;
  object_id: string;
  parent_id: string | null;
  version: number;
  deleted: boolean;
  ck_epoch: number;
  seq: number;
  nonce: string;
  ciphertext: string;
}

export interface FakeServer {
  readonly port: HttpPort;
  readonly requests: readonly HttpRequest[];
  /** Put a row in as a peer would have left it, and answer with its `seq`. */
  place(row: PushRow): number;
  rows(): readonly StoredRow[];
  /** Refuse the next `count` writes with this status and body. */
  refuseWrites(count: number, status: number, body: string): void;
  /** Corrupt one stored row's ciphertext, so it arrives and cannot be opened. */
  corrupt(collection: string, objectId: string): void;
  /**
   * Serve at most `rows` per page whatever the client asked for — PostgREST's
   * `max_rows`, which truncates without saying so. It is why a page is „done"
   * only when it comes back EMPTY.
   */
  pageCap(rows: number): void;
}

export function fakeServer(): FakeServer {
  const stored = new Map<string, StoredRow>();
  const requests: HttpRequest[] = [];
  let seq = 0;
  let cap = Number.POSITIVE_INFINITY;
  let refusals: { left: number; status: number; body: string } | null = null;

  const key = (collection: string, objectId: string): string => `${collection}/${objectId}`;

  const store = (row: PushRow, body: Record<string, unknown>): StoredRow => {
    seq += 1;
    const next: StoredRow = {
      collection: row.collection,
      object_id: row.objectId,
      parent_id: row.parentId,
      version: row.version,
      deleted: row.deleted,
      ck_epoch: row.ckEpoch,
      seq,
      nonce: String(body["nonce"]),
      ciphertext: String(body["ciphertext"]),
    };
    stored.set(key(row.collection, row.objectId), next);
    return next;
  };

  const failure = (status: number, code: string, message: string): HttpResponse => ({
    status,
    body: JSON.stringify({ code, message, details: null, hint: null }),
  });

  const port: HttpPort = async (request) => {
    requests.push(request);
    if (request.method === "GET") return get(request);
    return write(request);
  };

  function get(request: HttpRequest): HttpResponse {
    const url = new URL(`http://server${request.path}`);
    const collection = eq(url, "collection");
    const from = Number((url.searchParams.get("seq") ?? "gt.0").slice("gt.".length));
    const limit = Number(url.searchParams.get("limit") ?? "500");
    const page = [...stored.values()]
      .filter((row) => row.collection === collection && row.seq > from)
      .sort((a, b) => a.seq - b.seq)
      .slice(0, Math.min(limit, cap));
    return { status: 200, body: JSON.stringify(page) };
  }

  function write(request: HttpRequest): HttpResponse {
    if (refusals !== null && refusals.left > 0) {
      refusals.left -= 1;
      return { status: refusals.status, body: refusals.body };
    }

    const parsed: unknown = JSON.parse(request.body ?? "null");
    const url = new URL(`http://server${request.path}`);

    if (request.method === "POST") {
      const body = (parsed as Record<string, unknown>[])[0]!;
      const id = key(String(body["collection"]), String(body["object_id"]));
      if (stored.has(id)) {
        return failure(
          409,
          "23505",
          'duplicate key value violates unique constraint "sync_objects_pkey"',
        );
      }
      return one(store(asPushRow(body), body));
    }

    const body = parsed as Record<string, unknown>;
    const collection = eq(url, "collection");
    const objectId = eq(url, "object_id");
    const current = stored.get(key(collection, objectId));
    // A PATCH that matched nothing is an HTTP 200 with an empty array — the
    // silent outcome the transport's own header calls out.
    if (current === undefined) return { status: 200, body: "[]" };

    const version = Number(body["version"]);
    if (version !== current.version + 1) {
      return failure(409, "NX001", `expected version ${String(current.version + 1)}`);
    }
    return one(store({ ...asPushRow(body), collection, objectId }, body));
  }

  function asPushRow(body: Record<string, unknown>): PushRow {
    return {
      collection: String(body["collection"] ?? ""),
      objectId: String(body["object_id"] ?? ""),
      parentId: body["parent_id"] === null ? null : String(body["parent_id"] ?? ""),
      version: Number(body["version"]),
      deleted: Boolean(body["deleted"]),
      ckEpoch: Number(body["ck_epoch"]),
      sealed: { v: 2, nonce: "", ciphertext: "" },
    };
  }

  const one = (row: StoredRow): HttpResponse => ({
    status: 200,
    body: JSON.stringify([row]),
  });

  return {
    port,
    requests,
    place(row) {
      seq += 1;
      stored.set(key(row.collection, row.objectId), {
        collection: row.collection,
        object_id: row.objectId,
        parent_id: row.parentId,
        version: row.version,
        deleted: row.deleted,
        ck_epoch: row.ckEpoch,
        seq,
        nonce: hex(row.sealed.nonce),
        ciphertext: hex(row.sealed.ciphertext),
      });
      return seq;
    },
    rows: () => [...stored.values()],
    pageCap(rows) {
      cap = rows;
    },
    refuseWrites(count, status, body) {
      refusals = { left: count, status, body };
    },
    corrupt(collection, objectId) {
      const row = stored.get(key(collection, objectId));
      if (row === undefined) throw new Error(`no row ${collection}/${objectId}`);
      // Flip the last byte of the tag. It still decodes as hex and still has a
      // legal length, so it fails at the AEAD and nowhere earlier.
      const flipped = row.ciphertext.slice(0, -1) + (row.ciphertext.endsWith("0") ? "1" : "0");
      row.ciphertext = flipped;
    },
  };
}

/** The value of an `eq.` filter, already percent-decoded by `URL`. */
function eq(url: URL, column: string): string {
  return (url.searchParams.get(column) ?? "").slice("eq.".length);
}

/** base64url → the hex `bytea` PostgREST serves, which is what the client parses back. */
function hex(base64url: string): string {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  let out = "\\x";
  for (let i = 0; i < binary.length; i += 1) {
    out += binary.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return out;
}
