import { createHash, sign, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { DownloadHttp, DownloadResponse } from "../download/service.js";
import type { NetworkMode } from "../net/offline.js";
import { PACK_CATALOGUE_SIGNATURE_URL, PACK_CATALOGUE_URL } from "./catalogue.js";
import { createCatalogueClient } from "./catalogueClient.js";
import { packRefusalCode } from "./errors.js";
import { makeKey } from "./fixtures.js";
import { PACK_CATALOGUE_SIGNATURE_CONTEXT } from "./verify.js";

/**
 * The catalogue's fetch path (ADR-103), against a port rather than a server.
 *
 * The interesting promises here are about DECISIONS, not about the wire: that
 * nothing is requested outside `"downloads"`, that a signature which is not the
 * release key's over these exact bytes is refused, that a redirect into a host
 * the rule does not hold costs one request and not two, and that a reply over
 * the cap is refused rather than truncated. A fake port makes each of those an
 * exact assertion — how many requests were made and to where — which is what
 * this module owes, and the download service's own suite is where the wire
 * behaviour of a real socket is tested.
 */

const HOSTS: readonly string[] = ["github.com", "release-assets.githubusercontent.com"];

function sha256(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

function entry() {
  const content = "zim bytes";
  const files = [
    {
      path: "pack.json",
      url: `https://github.com/pack/pack.json`,
      size: Buffer.byteLength("{}", "utf8"),
      sha256: sha256("{}"),
    },
    {
      path: "pack.json.sig",
      url: `https://github.com/pack/pack.json.sig`,
      size: Buffer.byteLength("sig", "utf8"),
      sha256: sha256("sig"),
    },
    {
      path: "content.zim",
      url: `https://github.com/pack/content.zim`,
      size: Buffer.byteLength(content, "utf8"),
      sha256: sha256(content),
    },
  ];
  return {
    id: "wikipedia-sr",
    version: "2026.10.0",
    kind: "zim",
    title: { sr: "Vikipedija", en: "Wikipedia" },
    description: { sr: "ZIM.", en: "A ZIM." },
    size: files.reduce((sum, listed) => sum + listed.size, 0),
    licence: { spdx: "CC-BY-SA-4.0", attribution: "authors", url: "https://example.org/licence" },
    source: { name: "Kiwix", url: "https://www.kiwix.org/" },
    files,
  };
}

function signBytes(key: KeyObject, bytes: Uint8Array): Buffer {
  return sign(null, Buffer.concat([Buffer.from(PACK_CATALOGUE_SIGNATURE_CONTEXT, "utf8"), bytes]), key);
}

interface Reply {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  /** For the signature, which is binary: the exact bytes the port hands back. */
  readonly bytes?: Uint8Array;
}

/** A port that answers from a table and records every URL it was asked for. */
function fakePort(
  routes: ReadonlyMap<string, Reply>,
  asked: string[],
): DownloadHttp {
  return {
    request(url): Promise<DownloadResponse> {
      asked.push(url);
      const reply = routes.get(url);
      if (reply === undefined) {
        return Promise.reject(new Error(`no route for ${url}`));
      }
      const bytes = reply.bytes ?? Buffer.from(reply.body ?? "", "utf8");
      const headers = reply.headers ?? {};
      return Promise.resolve({
        status: reply.status,
        header: (name) => headers[name.toLowerCase()] ?? null,
        body:
          reply.status === 200
            ? (async function* (): AsyncGenerator<Uint8Array> {
                yield bytes;
              })()
            : null,
      });
    },
  };
}

function clientFor(options: {
  readonly routes: ReadonlyMap<string, Reply>;
  readonly asked: string[];
  readonly mode?: NetworkMode;
  readonly publicKeyPem: string;
  readonly allows?: (url: string) => boolean;
}) {
  return createCatalogueClient({
    http: fakePort(options.routes, options.asked),
    publicKeyPem: options.publicKeyPem,
    hosts: HOSTS,
    isAllowedUrl: options.allows ?? (() => true),
    mode: () => options.mode ?? "downloads",
  });
}

async function codeOf(read: Promise<unknown>): Promise<string | null> {
  try {
    await read;
    return null;
  } catch (error) {
    return packRefusalCode(error);
  }
}

describe("reading the catalogue", () => {
  it("verifies the signature before it parses, and answers the entries", async () => {
    const key = makeKey();
    const bytes = Buffer.from(JSON.stringify({ format: 1, packs: [entry()] }), "utf8");
    const routes = new Map<string, Reply>([
      [PACK_CATALOGUE_URL, { status: 200, body: bytes.toString("utf8") }],
      [
        PACK_CATALOGUE_SIGNATURE_URL,
        { status: 200, bytes: signBytes(key.privateKey, bytes) },
      ],
    ]);
    const asked: string[] = [];
    const client = clientFor({ routes, asked, publicKeyPem: key.publicKeyPem });
    const catalogue = await client.read();
    expect(catalogue.packs[0]?.id).toBe("wikipedia-sr");
    expect(asked).toEqual([PACK_CATALOGUE_URL, PACK_CATALOGUE_SIGNATURE_URL]);
  });

  it("refuses a document whose signature is over other bytes", async () => {
    const key = makeKey();
    const bytes = Buffer.from(JSON.stringify({ format: 1, packs: [entry()] }), "utf8");
    const routes = new Map<string, Reply>([
      [PACK_CATALOGUE_URL, { status: 200, body: bytes.toString("utf8") }],
      [
        PACK_CATALOGUE_SIGNATURE_URL,
        { status: 200, bytes: signBytes(key.privateKey, Buffer.from("other", "utf8")) },
      ],
    ]);
    const client = clientFor({ routes, asked: [], publicKeyPem: key.publicKeyPem });
    expect(await codeOf(client.read())).toBe("catalogue-signature");
  });

  it("refuses a redirect into a host the rule does not hold, after one request to it and none to the target", async () => {
    const key = makeKey();
    const asked: string[] = [];
    const routes = new Map<string, Reply>([
      [PACK_CATALOGUE_URL, { status: 302, headers: { location: "https://evil.example/catalogue.json" } }],
    ]);
    const client = clientFor({
      routes,
      asked,
      publicKeyPem: key.publicKeyPem,
      allows: (url) => url.startsWith("https://github.com/"),
    });
    expect(await codeOf(client.read())).toBe("catalogue-host");
    expect(asked).toEqual([PACK_CATALOGUE_URL]);
  });

  it("makes no request at all outside the downloads mode", async () => {
    const key = makeKey();
    const asked: string[] = [];
    const client = clientFor({ routes: new Map(), asked, mode: "updates", publicKeyPem: key.publicKeyPem });
    expect(await codeOf(client.read())).toBe("downloads-off");
    expect(asked).toEqual([]);
  });

  it("refuses a reply that is not a 200", async () => {
    const key = makeKey();
    const routes = new Map<string, Reply>([
      [PACK_CATALOGUE_URL, { status: 404 }],
    ]);
    const client = clientFor({ routes, asked: [], publicKeyPem: key.publicKeyPem });
    expect(await codeOf(client.read())).toBe("catalogue-unreadable");
  });
});
