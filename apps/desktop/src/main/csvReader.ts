import { readFile, stat } from "node:fs/promises";
import { CSV_IMPORT_MAX_FILE_BYTES } from "../shared/ipc.js";

/**
 * The untrusted-input reader for the CSV task import (ADR-062) — the smallest
 * sibling of `apkgReader.ts` and `archiveReader.ts`, because a CSV is the
 * smallest thing this app opens: one text file, no zip, no SQLite, no KDF.
 * What survives of the family's discipline is exactly what still applies:
 *
 *  - **Stat before read.** The size gate runs against the file's stat, so an
 *    oversized file is refused before a byte of it enters main's heap — a CSV
 *    past `CSV_IMPORT_MAX_FILE_BYTES` is not a hand-kept table.
 *  - **Named refusals.** Every failure is a `CsvReadError` with a code the
 *    screen has a sentence for, never a truncation: half of somebody's task
 *    list arriving silently is the one outcome an import must never produce.
 *
 * The PARSE — delimiter sniffing, header detection, cells — is `@nexus/core`'s
 * pure `csvImport.ts`; this module only produces the text, BOM stripped, so
 * the first header cell is never an invisible U+FEFF ahead of `naziv`.
 */

/** Why the file could not be read at all. `"too-large"`/`"unreadable"` are this reader's; the session layer adds the parse-level codes on the same wire domain. */
export class CsvReadError extends Error {
  constructor(readonly code: "too-large" | "unreadable") {
    super(`CSV import: ${code}`);
    this.name = "CsvReadError";
  }
}

/**
 * Reads one CSV file whole, under the stat-first size gate, decoded as UTF-8
 * with a leading BOM stripped. UTF-8 is the one encoding this import reads —
 * a legacy single-byte file decodes into replacement characters rather than
 * throwing, which the mapping step's samples then SHOW, so the user sees what
 * the file actually holds before anything is written.
 */
export async function readCsvText(filePath: string): Promise<string> {
  let size: number;
  try {
    size = (await stat(filePath)).size;
  } catch {
    throw new CsvReadError("unreadable");
  }
  if (size > CSV_IMPORT_MAX_FILE_BYTES) throw new CsvReadError("too-large");

  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch {
    throw new CsvReadError("unreadable");
  }
  const text = bytes.toString("utf8");
  // U+FEFF as an escape: a raw BOM in source is invisible and every tool in
  // the chain treats it differently.
  return text.startsWith("\uFEFF") ? text.slice(1) : text;
}
