import { describe, expect, it } from "vitest";
import type { HttpResponse } from "@nexus/sync-transport";
import type { CloudConfig } from "./config.js";
import {
  authUrl,
  cloudHeaders,
  createAuthPort,
  createCloudPorts,
  createFunctionPort,
  createHttpPort,
  functionUrl,
  restUrl,
  type CloudFetch,
} from "./port.js";

const KEY = "aaaa.bbbb.cccc";
const config: CloudConfig = { url: "https://abc.supabase.co", anonKey: KEY };

interface Sent {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | null;
}

/** Records what a port asked for and answers with whatever the test wants. */
const recorder = (
  response: HttpResponse = { status: 200, body: "[]" },
): { fetch: CloudFetch; sent: Sent[] } => {
  const sent: Sent[] = [];
  return {
    sent,
    fetch: async (request) => {
      sent.push(request);
      return response;
    },
  };
};

describe("restUrl", () => {
  it("puts the PostgREST root between the origin and the path", () => {
    expect(restUrl(config, "/sync_objects?seq=gt.4")).toBe(
      "https://abc.supabase.co/rest/v1/sync_objects?seq=gt.4",
    );
  });

  /**
   * The transport documents its path as being under the PostgREST root and
   * always writes a leading slash. A path without one would concatenate into
   * `…/rest/v1sync_objects`, which is a 404 nobody reads twice.
   */
  it("refuses a path that is not rooted", () => {
    expect(() => restUrl(config, "sync_objects")).toThrow(TypeError);
  });
});

describe("functionUrl", () => {
  it("puts the function root between the origin and the name", () => {
    expect(functionUrl(config, "sync-enable")).toBe(
      "https://abc.supabase.co/functions/v1/sync-enable",
    );
  });

  /**
   * A name reaches a URL path. Every one of these would reach an endpoint other
   * than the one the caller named — which, for a call that mints a master key,
   * is the difference between one function and any function.
   */
  it("refuses anything that is not a bare function name", () => {
    for (const name of [
      "",
      "/sync-enable",
      "sync-enable/",
      "../rest/v1/key_wraps",
      "sync%2Fenable",
      "sync_enable",
      "Sync-Enable",
      "sync enable",
      "-sync",
      "9sync",
      "a".repeat(64),
    ]) {
      expect(() => functionUrl(config, name), JSON.stringify(name)).toThrow(TypeError);
    }
  });

  it("accepts the names this product actually uses", () => {
    expect(() => functionUrl(config, "sync-enable")).not.toThrow();
    expect(() => functionUrl(config, "a".repeat(63))).not.toThrow();
  });
});

describe("cloudHeaders", () => {
  it("carries the caller's headers through untouched", () => {
    expect(cloudHeaders(config, { Prefer: "return=representation" }, null)).toMatchObject({
      Prefer: "return=representation",
    });
  });

  it("sends the anon key as the bearer when there is no session", () => {
    expect(cloudHeaders(config, {}, null)).toEqual({
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
    });
  });

  it("sends the session's token as the bearer when there is one", () => {
    expect(cloudHeaders(config, {}, "token-xyz")).toEqual({
      apikey: KEY,
      Authorization: "Bearer token-xyz",
    });
  });

  /**
   * The credential is the port's, not the caller's. A request object that
   * carried an `Authorization` — from a caller that thought it was helping, or
   * from a header map built out of a server's response — must not be able to
   * replace it.
   */
  it("cannot have its own credentials overwritten by the caller", () => {
    const headers = cloudHeaders(
      config,
      { apikey: "someone-elses", Authorization: "Bearer someone-elses" },
      "token-xyz",
    );
    expect(headers["apikey"]).toBe(KEY);
    expect(headers["Authorization"]).toBe("Bearer token-xyz");
  });

  /**
   * `sync-enable` answers 400 to any request that carries an `Origin`, because a
   * main-process call is not a browsing context. Nothing here may add one.
   */
  it("adds no Origin header", () => {
    expect(Object.keys(cloudHeaders(config, {}, null))).toEqual(["apikey", "Authorization"]);
  });
});

describe("createHttpPort", () => {
  it("sends the transport's request at the REST root with both credentials", async () => {
    const { fetch, sent } = recorder({ status: 206, body: "[]" });
    const port = createHttpPort({ config, fetch, accessToken: () => "token-xyz" });

    const response = await port({
      method: "GET",
      path: "/sync_objects?seq=gt.4",
      headers: { Range: "0-499" },
      body: null,
    });

    expect(response).toEqual({ status: 206, body: "[]" });
    expect(sent).toEqual([
      {
        url: "https://abc.supabase.co/rest/v1/sync_objects?seq=gt.4",
        method: "GET",
        headers: { Range: "0-499", apikey: KEY, Authorization: "Bearer token-xyz" },
        body: null,
      },
    ]);
  });

  /**
   * A token has a lifetime. A port that captured one at construction would keep
   * presenting the expired copy after the first refresh, and the failure — 401
   * on everything, an hour in — reads as a server problem.
   */
  it("reads the token again on every call", async () => {
    const { fetch, sent } = recorder();
    let token = "first";
    const port = createHttpPort({ config, fetch, accessToken: () => token });

    await port({ method: "GET", path: "/devices", headers: {}, body: null });
    token = "second";
    await port({ method: "GET", path: "/devices", headers: {}, body: null });

    expect(sent.map((request) => request.headers["Authorization"])).toEqual([
      "Bearer first",
      "Bearer second",
    ]);
  });
});

describe("createFunctionPort", () => {
  it("sends a named function as a POST at the function root", async () => {
    const { fetch, sent } = recorder({ status: 201, body: '{"outcome":"minted"}' });
    const port = createFunctionPort({ config, fetch, accessToken: () => "token-xyz" });

    const response = await port({
      name: "sync-enable",
      headers: { "content-type": "application/json", "x-nexus-authorising-token": "second" },
      body: "{}",
    });

    expect(response).toEqual({ status: 201, body: '{"outcome":"minted"}' });
    expect(sent[0]).toEqual({
      url: "https://abc.supabase.co/functions/v1/sync-enable",
      method: "POST",
      headers: {
        "content-type": "application/json",
        // The ephemeral second token is a PARAMETER of this call, and no port
        // could know it — so it has to survive the port untouched.
        "x-nexus-authorising-token": "second",
        apikey: KEY,
        Authorization: "Bearer token-xyz",
      },
      body: "{}",
    });
  });

  it("refuses to send a name that is not one", async () => {
    const { fetch, sent } = recorder();
    const port = createFunctionPort({ config, fetch, accessToken: () => null });

    await expect(port({ name: "../rest/v1/key_wraps", headers: {}, body: "{}" })).rejects.toThrow(
      TypeError,
    );
    expect(sent).toHaveLength(0);
  });
});

describe("createAuthPort", () => {
  it("sends an auth request at the auth root", async () => {
    const { fetch, sent } = recorder({ status: 200, body: "{}" });
    const port = createAuthPort(config, fetch);

    await port({
      method: "POST",
      path: "/token?grant_type=password",
      headers: { "content-type": "application/json" },
      body: '{"email":"a@b.c"}',
    });

    expect(sent[0]?.url).toBe("https://abc.supabase.co/auth/v1/token?grant_type=password");
  });

  /**
   * The one port that does NOT own the bearer. Writing one here would sign the
   * device session out at the end of the enable flow instead of the ephemeral
   * authorising one — sync enabled, and this desktop locked out of it.
   */
  it("adds the apikey and never an Authorization", async () => {
    const { fetch, sent } = recorder();
    const port = createAuthPort(config, fetch);

    await port({ method: "POST", path: "/logout?scope=local", headers: {}, body: null });
    expect(sent[0]?.headers).toEqual({ apikey: KEY });
  });

  it("carries the caller's own bearer through untouched", async () => {
    const { fetch, sent } = recorder();
    const port = createAuthPort(config, fetch);

    await port({
      method: "POST",
      path: "/logout?scope=local",
      headers: { Authorization: "Bearer authorising-session" },
      body: null,
    });
    expect(sent[0]?.headers["Authorization"]).toBe("Bearer authorising-session");
  });

  it("refuses a path that is not rooted", () => {
    expect(() => authUrl(config, "token")).toThrow(TypeError);
  });
});

describe("createCloudPorts", () => {
  const rest = { accessToken: () => null, fetch: recorder().fetch };

  it("builds all three ports when cloud is on and a project is configured", () => {
    const ports = createCloudPorts(true, config, rest);
    expect(ports).not.toBeNull();
    expect(typeof ports?.http).toBe("function");
    expect(typeof ports?.functions).toBe("function");
    expect(typeof ports?.auth).toBe("function");
  });

  /**
   * The cloud-off guarantee in its structural form. Not „a port that refuses" —
   * an object that does not exist, so there is nothing for a later change to
   * make an exception in.
   */
  it("builds nothing at all when either half is absent", () => {
    expect(createCloudPorts(false, config, rest)).toBeNull();
    expect(createCloudPorts(true, null, rest)).toBeNull();
    expect(createCloudPorts(false, null, rest)).toBeNull();
  });
});
