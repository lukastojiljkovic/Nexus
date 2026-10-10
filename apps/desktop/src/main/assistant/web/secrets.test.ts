import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createWebSecrets,
  normalizeApiKey,
  WebSecretError,
  webSecretsPath,
  type SecretCipher,
} from "./secrets.js";

/**
 * The key store: the ciphertext on disk, the shapes it refuses, and the claim
 * that the key is never logged.
 *
 * The cipher here is a REVERSIBLE STAND-IN for `safeStorage` - it reverses the
 * bytes and base64s them - and it is enough to assert both halves of what the
 * store promises: reading back what was written, and the plaintext key not
 * being in the file. The real cipher is `electron.ts`, which needs a browser
 * process and is deliberately untestable here.
 */

const KEY = "BSA-key-abcdefghijklmno";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-web-secrets-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const cipher: SecretCipher = {
  available: () => true,
  encrypt: (plaintext) => Buffer.from(plaintext, "utf8").reverse().toString("base64"),
  decrypt: (ciphertext) => Buffer.from(ciphertext, "base64").reverse().toString("utf8"),
};

describe("the web secret store", () => {
  it("round-trips a key without ever writing it in the clear", () => {
    const secrets = createWebSecrets(dir, cipher);
    expect(secrets.apiKey("brave")).toBeNull();

    secrets.setApiKey("brave", KEY);
    expect(secrets.apiKey("brave")).toBe(KEY);

    // The claim, on the bytes: what is on disk is the cipher's output, and the
    // key is not in it.
    const file = readFileSync(webSecretsPath(dir));
    expect(file.toString("utf8")).not.toContain(KEY);
    expect(JSON.parse(file.toString("utf8"))).toEqual({
      version: 1,
      keys: { brave: Buffer.from(KEY, "utf8").reverse().toString("base64") },
    });

    secrets.clearApiKey("brave");
    expect(secrets.apiKey("brave")).toBeNull();
  });

  it("trims a pasted key, because the newline a copy leaves behind is invisible", () => {
    const secrets = createWebSecrets(dir, cipher);
    secrets.setApiKey("brave", `  ${KEY}\n`);
    expect(secrets.apiKey("brave")).toBe(KEY);
  });

  it("refuses a value that is not shaped like a key, and writes nothing", () => {
    const secrets = createWebSecrets(dir, cipher);
    for (const bad of ["", "   ", "short", `${KEY} ${KEY}`, `${KEY}\n${KEY}`, "x".repeat(513), 42, null]) {
      expect(() => {
        secrets.setApiKey("brave", bad as string);
      }, JSON.stringify(bad)).toThrow(WebSecretError);
      expect(existsSync(webSecretsPath(dir)), JSON.stringify(bad)).toBe(false);
    }
    // The reason is machine-readable, so a settings surface can say which of
    // the two refusals it was.
    try {
      secrets.setApiKey("brave", "bad");
    } catch (error) {
      expect((error as WebSecretError).problem).toBe("key");
    }
  });

  it("refuses to store anything when the OS key store cannot encrypt", () => {
    // No plaintext fallback, which is `auth.ts`'s rule for the account key too.
    const secrets = createWebSecrets(dir, { ...cipher, available: () => false });
    expect(() => {
      secrets.setApiKey("brave", KEY);
    }).toThrow(WebSecretError);
    expect(existsSync(webSecretsPath(dir))).toBe(false);
    try {
      secrets.setApiKey("brave", KEY);
    } catch (error) {
      expect((error as WebSecretError).problem).toBe("keystore-unavailable");
    }
  });

  it("reads a blob this device cannot decrypt as no key, not as an error", () => {
    // The copied-from-another-machine case, exactly `decryptGuard`'s.
    const secrets = createWebSecrets(dir, { ...cipher, decrypt: () => null });
    secrets.setApiKey("brave", KEY);
    expect(secrets.apiKey("brave")).toBeNull();
  });

  it("reads every shape of damage as no keys", () => {
    for (const contents of [
      "",
      "{",
      "null",
      "[]",
      '"key"',
      "42",
      "{}",
      '{"keys":{"brave":"x"}}',
      '{"version":2,"keys":{"brave":"x"}}',
      '{"version":"1","keys":{"brave":"x"}}',
      '{"version":1,"keys":[]}',
      '{"version":1,"keys":{"brave":42}}',
      '{"version":1,"keys":{"brave":""}}',
    ]) {
      writeFileSync(webSecretsPath(dir), contents, "utf8");
      const secrets = createWebSecrets(dir, cipher);
      expect(secrets.apiKey("brave"), `contents: ${contents}`).toBeNull();
    }
  });

  it("has no logging call in its source, which is the other half of «never logged»", () => {
    // A claim about what a module does not do is worth exactly one assertion,
    // and this is the one that reads the file: the key travels in a header
    // (`providers.ts`) and in a ciphertext blob, and nothing here writes it to a
    // log, a console or a stream.
    const source = readFileSync(fileURLToPath(new URL("./secrets.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/console\.\w/);
    expect(source).not.toMatch(/process\.(stdout|stderr)/);
  });
});

describe("normalizeApiKey", () => {
  it("accepts a token and refuses whitespace, control characters and lengths that are not keys", () => {
    expect(normalizeApiKey(KEY)).toBe(KEY);
    expect(normalizeApiKey("12345678")).toBe("12345678");
    expect(normalizeApiKey("key_with.dots-and-dashes")).toBe("key_with.dots-and-dashes");
    expect(normalizeApiKey(` ${KEY} `)).toBe(KEY);

    for (const bad of ["", "  ", "short", "with space", "with\ttab", "with\nnewline", "x".repeat(513)]) {
      expect(normalizeApiKey(bad), JSON.stringify(bad)).toBeNull();
    }
    for (const notAString of [42, null, undefined, {}, ["k"]]) {
      expect(normalizeApiKey(notAString), JSON.stringify(notAString)).toBeNull();
    }
  });
});
