import { open } from "node:fs/promises";

import { BOOKMARKS_IMPORT_MAX_FILE_BYTES, type BookmarksImportReadErrorCode } from "../shared/ipc.js";

/**
 * The untrusted-input boundary for the browser bookmarks import (IMEX-007): the
 * file on disk, turned into the TEXT `@nexus/core`'s `parseBookmarksHtml`
 * consumes. The same one stat and one bounded read `icsReader.ts` makes, for
 * the same reason — a Netscape bookmarks file is plain text, with no archive to
 * walk and nothing to decode but UTF-8.
 *
 * The stat comes before the read, so the cap is enforced against what the
 * filesystem reports. The text is returned and not retained: the caller parses
 * it and drops it.
 *
 * Deliberately Electron-free, so the path is exercisable under plain Node.
 */

export class BookmarksReadError extends Error {
  constructor(
    public readonly code: BookmarksImportReadErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "BookmarksReadError";
  }
}

/**
 * The whole file as text, or a `BookmarksReadError` naming why not. `maxBytes`
 * is injectable so a test can prove the cap fires without writing a
 * twenty-mebibyte fixture.
 */
export async function readBookmarksText(
  filePath: string,
  maxBytes: number = BOOKMARKS_IMPORT_MAX_FILE_BYTES,
): Promise<string> {
  const handle = await open(filePath, "r");
  try {
    const { size } = await handle.stat();
    if (size > maxBytes) {
      throw new BookmarksReadError("too-large", `The file is ${size} bytes, past the ${maxBytes}-byte cap.`);
    }
    const bytes = await handle.readFile();
    return bytes.toString("utf8");
  } finally {
    await handle.close();
  }
}
