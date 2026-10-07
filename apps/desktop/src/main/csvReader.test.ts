import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CSV_IMPORT_MAX_FILE_BYTES } from "../shared/ipc.js";
import { CsvReadError, readCsvText } from "./csvReader.js";

/**
 * The CSV reader's two named refusals and the size gate behind them (#25).
 *
 * The gate is the one thing here that cannot be checked by reading the text
 * back: a file over the cap has to be refused by NAME, before its bytes are
 * loaded, and the path it is refused by has to be the same file the cap was
 * measured on.
 */
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-csv-reader-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("readCsvText", () => {
  it("reads a UTF-8 file whole and strips a leading BOM", async () => {
    const path = join(dir, "tasks.csv");
    writeFileSync(path, "\uFEFFnaziv,status\nProjekat,open\n", "utf8");

    expect(await readCsvText(path)).toBe("naziv,status\nProjekat,open\n");
  });

  it("refuses a file over the cap by name, before it is read", async () => {
    const path = join(dir, "big.csv");
    // Sparse, so a five-megabyte refusal costs no disk.
    writeFileSync(path, "");
    truncateSync(path, CSV_IMPORT_MAX_FILE_BYTES + 1);

    await expect(readCsvText(path)).rejects.toBeInstanceOf(CsvReadError);
    await expect(readCsvText(path)).rejects.toMatchObject({ code: "too-large" });
  });

  it("refuses a path that is not there", async () => {
    await expect(readCsvText(join(dir, "gone.csv"))).rejects.toMatchObject({
      code: "unreadable",
    });
  });

  it("refuses a directory where a file was expected", async () => {
    const path = join(dir, "a-directory");
    mkdirSync(path);

    await expect(readCsvText(path)).rejects.toMatchObject({ code: "unreadable" });
  });
});
