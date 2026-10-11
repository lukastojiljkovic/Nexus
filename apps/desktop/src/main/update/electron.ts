import { createHash } from "node:crypto";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import type { Session } from "electron";

import { openExternalUrl } from "../external.js";
import { assertDeclaredLength, readWithin, UPDATE_LIMITS } from "./limits.js";
import type { UpdateHttp } from "./service.js";

/**
 * The Electron half of the updater: everything that needs a browser process is
 * here and NOTHING that decides anything. `service.ts` chooses what to fetch
 * and refuses what does not verify; this file only turns an injected session
 * into the `UpdateHttp` port and opens a page or a file the service has
 * already vouched for.
 *
 * The session is the dedicated `nexus-update` partition created in `index.ts`:
 * in-memory (no `persist:` prefix, so nothing survives the process), with its
 * own `onBeforeRequest` allowlist and a DIRECT connection rather than the
 * system proxy — see that file for why direct mode is what keeps the launch's
 * `host-resolver-rules` in force here. The renderer's session is not touched by
 * any of this.
 *
 * Every reply is read under `limits.ts`'s caps, and every request carries a
 * deadline. `ses.fetch` is only the wire; how much of the wire this process
 * will hold is a decision made here so a hostile server cannot make an
 * installed copy allocate a gigabyte to answer a version question.
 */
export function createUpdateHttp(ses: Session): UpdateHttp {
  return {
    async json(url, headers) {
      const response = await ses.fetch(url, {
        headers,
        signal: AbortSignal.timeout(UPDATE_LIMITS.requestMs),
      });
      assertDeclaredLength(
        response.headers.get("content-length"),
        UPDATE_LIMITS.jsonBytes,
      );
      const stream = response.body;
      if (stream === null) return { status: response.status, body: null };
      const decoder = new TextDecoder();
      let text = "";
      await readWithin(stream, UPDATE_LIMITS.jsonBytes, (chunk) => {
        text += decoder.decode(chunk, { stream: true });
      });
      text += decoder.decode();
      try {
        return { status: response.status, body: JSON.parse(text) as unknown };
      } catch {
        return { status: response.status, body: null };
      }
    },

    async bytes(url) {
      const response = await ses.fetch(url, {
        signal: AbortSignal.timeout(UPDATE_LIMITS.requestMs),
      });
      assertDeclaredLength(
        response.headers.get("content-length"),
        UPDATE_LIMITS.smallFileBytes,
      );
      const stream = response.body;
      const chunks: Uint8Array[] = [];
      if (stream !== null) {
        await readWithin(stream, UPDATE_LIMITS.smallFileBytes, (chunk) => {
          chunks.push(chunk);
        });
      }
      return { status: response.status, body: Buffer.concat(chunks) };
    },

    async download(url, destination) {
      // The installer is the one reply of unbounded size, so it gets an IDLE
      // deadline rather than a whole-request one: a slow but live download may
      // take as long as it takes, while a connection that has stopped sending
      // must not hold the file open for ever. The timer is reset on every
      // chunk for exactly that reason.
      const controller = new AbortController();
      let idle = setTimeout(() => controller.abort(), UPDATE_LIMITS.downloadIdleMs);
      const resetIdle = (): void => {
        clearTimeout(idle);
        idle = setTimeout(() => controller.abort(), UPDATE_LIMITS.downloadIdleMs);
      };
      // A refusal before the body is read drops the connection with it, rather
      // than leaving the reply open until the idle timer gets to it.
      const stop = (): void => {
        clearTimeout(idle);
        controller.abort();
      };

      let response: Response;
      try {
        response = await ses.fetch(url, { signal: controller.signal });
      } catch (error) {
        clearTimeout(idle);
        throw error;
      }
      const body = response.body;
      if (response.status !== 200 || body === null) {
        stop();
        throw new Error(`Nexus update: download answered ${String(response.status)}`);
      }
      try {
        assertDeclaredLength(response.headers.get("content-length"), UPDATE_LIMITS.installerBytes);
      } catch (error) {
        stop();
        throw error;
      }

      const hash = createHash("sha256");
      const file = createWriteStream(destination);
      // Closes the write handle and waits for it to be really closed, so the
      // service can delete the partial file on Windows: an open handle blocks
      // the delete, and a `close` event that had already fired would otherwise
      // be waited for for ever.
      const abandonFile = async (): Promise<void> => {
        await new Promise<void>((resolve) => {
          if (file.closed) {
            resolve();
            return;
          }
          file.once("close", () => resolve());
          file.destroy();
        });
      };
      try {
        await readWithin(body, UPDATE_LIMITS.installerBytes, async (chunk) => {
          resetIdle();
          const bytes = Buffer.from(chunk);
          hash.update(bytes);
          if (!file.write(bytes)) await once(file, "drain");
        });
        await new Promise<void>((resolve, reject) => {
          file.once("error", reject);
          file.end(() => {
            resolve();
          });
        });
      } catch (error) {
        // A limit crossed or an abort thrown leaves the write stream OPEN, and
        // on Windows an open handle blocks the delete the service performs on
        // its failure path — so the handle is closed HERE, before the throw
        // unwinds, and the wait for `close` is what makes the close real. A
        // failure from `end` itself lands here too.
        clearTimeout(idle);
        await abandonFile();
        throw error;
      }
      clearTimeout(idle);
      return { status: response.status, sha256: hash.digest("hex") };
    },
  };
}

/**
 * Opens the pinned release page in the user's browser — never in this app.
 *
 * This is the one place the update feature names a URL directly, and the address
 * goes through the app's ONE external-link door (`main/external.ts`, ADR-107)
 * rather than to `shell.openExternal`: whether the app may hand an address to
 * the OS is a rule with one home, and a second call site in this file would be a
 * second version of it. The loader is still the user's own browser rather than
 * this process's network stack, and nothing here fetches anything.
 *
 * The literal must stay identical to `RELEASES_PAGE_URL` in `release.ts`;
 * `release.test.ts` reads this file and asserts it, so the two cannot drift.
 */
export async function openReleasePage(): Promise<void> {
  await openExternalUrl("https://github.com/lukastojiljkovic/Nexus/releases/latest");
}
