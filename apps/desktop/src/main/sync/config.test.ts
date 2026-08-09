import { describe, expect, it } from "vitest";
import {
  CLOUD_ANON_KEY_VAR,
  CLOUD_URL_VAR,
  cloudOrigins,
  parseCloudConfig,
  type CloudConfig,
} from "./config.js";

/** JWT-shaped and meaningless. Never a real key, in this file or any other. */
const KEY = "aaaa.bbbb.cccc";

/**
 * `null` means „this variable is not set at all". Not `undefined`: a default
 * parameter fires on `undefined`, so `env(url, undefined)` would silently mean
 * „the usual key" — which is how the first version of this helper asserted that
 * a fully-configured environment was unconfigured, and passed.
 */
const env = (url: string | null, key: string | null = KEY): Record<string, string | undefined> => ({
  ...(url === null ? {} : { [CLOUD_URL_VAR]: url }),
  ...(key === null ? {} : { [CLOUD_ANON_KEY_VAR]: key }),
});

describe("parseCloudConfig", () => {
  it("reads a well-formed project", () => {
    expect(parseCloudConfig(env("https://abcdefghijkl.supabase.co"))).toEqual({
      url: "https://abcdefghijkl.supabase.co",
      anonKey: KEY,
    });
  });

  it("normalises a trailing slash away, so the origin is the only spelling", () => {
    expect(parseCloudConfig(env("https://abc.supabase.co/"))?.url).toBe("https://abc.supabase.co");
  });

  it("keeps a non-default port, which a self-hosted project may use", () => {
    expect(parseCloudConfig(env("https://sync.example.test:8443"))?.url).toBe(
      "https://sync.example.test:8443",
    );
  });

  it("is unconfigured when either half is missing", () => {
    expect(parseCloudConfig({})).toBeNull();
    expect(parseCloudConfig(env("https://abc.supabase.co", null))).toBeNull();
    expect(parseCloudConfig(env(null, KEY))).toBeNull();
  });

  it("treats blank and whitespace-only values as absent", () => {
    expect(parseCloudConfig(env("   ", KEY))).toBeNull();
    expect(parseCloudConfig(env("https://abc.supabase.co", "  "))).toBeNull();
  });

  /** A value pasted out of a terminal carries whitespace, and that is not a typo. */
  it("trims surrounding whitespace off both values", () => {
    const padded = `${String.fromCodePoint(0x09)}${KEY}${String.fromCodePoint(0x0a)}`;
    expect(parseCloudConfig(env("  https://abc.supabase.co  ", padded))).toEqual({
      url: "https://abc.supabase.co",
      anonKey: KEY,
    });
  });

  /**
   * A wrong value here is not a broken feature — it is ciphertext posted to
   * somebody else's server. Every one of these is refused rather than repaired.
   */
  it("refuses a URL that is not a bare https origin", () => {
    for (const url of [
      "http://abc.supabase.co",
      "ws://abc.supabase.co",
      "wss://abc.supabase.co",
      "file:///etc/passwd",
      "https://user:pass@abc.supabase.co",
      "https://abc.supabase.co/rest/v1",
      "https://abc.supabase.co/?apikey=x",
      "https://abc.supabase.co/#fragment",
      "not a url",
      "abc.supabase.co",
    ]) {
      expect(parseCloudConfig(env(url)), url).toBeNull();
    }
  });

  /**
   * The local stack is `http://127.0.0.1:54321`, and it is refused with
   * everything else. Anything testing against it drives the port directly rather
   * than teaching this function a second scheme.
   */
  it("refuses the local development stack", () => {
    expect(parseCloudConfig(env("http://127.0.0.1:54321"))).toBeNull();
  });

  it("refuses a key that is not shaped like a JWT", () => {
    for (const key of ["", "not-a-jwt", "aaaa.bbbb", "aaaa.bbbb.cccc.dddd", "aa.bb.cc=", "a.b c"]) {
      expect(parseCloudConfig(env("https://abc.supabase.co", key)), JSON.stringify(key)).toBeNull();
    }
  });
});

describe("cloudOrigins", () => {
  const config: CloudConfig = { url: "https://abc.supabase.co", anonKey: KEY };

  /**
   * Two entries for one host. `URL.origin` includes the scheme, Realtime is a
   * WebSocket, and listing only `https://` would block the change signal in a
   * way that looks exactly like a server that never sends one.
   */
  it("admits the REST origin and the Realtime origin, and nothing else", () => {
    expect(cloudOrigins(config)).toEqual(["https://abc.supabase.co", "wss://abc.supabase.co"]);
  });

  it("carries the port into both, or neither would match", () => {
    expect(cloudOrigins({ ...config, url: "https://sync.example.test:8443" })).toEqual([
      "https://sync.example.test:8443",
      "wss://sync.example.test:8443",
    ]);
  });

  /** „No project" and „cloud off" are the same boundary, not two. */
  it("admits nothing for an unconfigured build", () => {
    expect(cloudOrigins(null)).toEqual([]);
  });
});
