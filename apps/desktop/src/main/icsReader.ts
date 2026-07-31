import { open } from "node:fs/promises";

import { ICS_IMPORT_MAX_FILE_BYTES, type IcsImportReadErrorCode } from "../shared/ipc.js";

/**
 * The untrusted-input boundary for the `.ics` import (ADR-061): turns a FILE on
 * disk into the TEXT `@nexus/core`'s `parseIcsCalendar` consumes. The smallest
 * sibling `apkgReader.ts` has, and deliberately so — an `.ics` is plain text
 * with no zip to walk, no SQLite image to hand to C code and no per-entry
 * bookkeeping, so the whole trust boundary is one stat and one bounded read.
 *
 * The stat comes BEFORE the read, exactly as the `.apkg` reader's does: the cap
 * must be enforced against what the filesystem says is there, never against
 * bytes already sitting in this process's heap. What is read is returned and
 * NOT retained — the caller parses it and drops it, so the pending session
 * holds parsed events rather than a file's worth of somebody's text.
 *
 * UTF-8 only, which is what RFC 5545 §3.1.4 defaults to and what every real
 * exporter writes; a UTF-16 file decodes into text with no `BEGIN:VCALENDAR` in
 * it and is refused by the parser AS not-a-calendar, which is the honest name
 * for a file this build cannot read. `parseIcsCalendar` strips the BOM.
 *
 * Deliberately Electron-free, like every reader beside it, so the whole path is
 * exercisable under plain Node/Vitest against fixtures the tests write.
 */

export class IcsReadError extends Error {
  constructor(
    public readonly code: IcsImportReadErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "IcsReadError";
  }
}

/**
 * The whole file as text, or an `IcsReadError` naming why not. `maxBytes` is
 * injectable for the `.apkg` limits' reason: a test can prove the cap fires
 * without writing a twenty-mebibyte fixture, then re-run the same fixture under
 * the default to prove it was the limit and not the fixture.
 */
export async function readIcsText(
  filePath: string,
  maxBytes: number = ICS_IMPORT_MAX_FILE_BYTES,
): Promise<string> {
  const handle = await open(filePath, "r");
  try {
    const { size } = await handle.stat();
    if (size > maxBytes) {
      throw new IcsReadError("too-large", `The file is ${size} bytes, past the ${maxBytes}-byte cap.`);
    }
    const bytes = await handle.readFile();
    return bytes.toString("utf8");
  } finally {
    await handle.close();
  }
}
