import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { IcsReadError, readIcsText } from "./icsReader.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nexus-ics-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function fixture(name: string, content: string | Buffer): Promise<string> {
  const filePath = join(dir, name);
  await writeFile(filePath, content);
  return filePath;
}

describe("readIcsText", () => {
  it("reads the whole file as UTF-8 text, Serbian letters intact", async () => {
    const text = "BEGIN:VCALENDAR\r\nSUMMARY:Čas čitanja\r\nEND:VCALENDAR\r\n";
    const filePath = await fixture("kalendar.ics", text);
    await expect(readIcsText(filePath)).resolves.toBe(text);
  });

  it("refuses a file past the cap BY the stat, before a byte is read", async () => {
    const filePath = await fixture("veliki.ics", "a".repeat(64));
    await expect(readIcsText(filePath, 63)).rejects.toThrow(IcsReadError);
    await expect(readIcsText(filePath, 63)).rejects.toMatchObject({ code: "too-large" });
    // The same fixture under the default cap reads fine — it was the limit,
    // not the fixture.
    await expect(readIcsText(filePath)).resolves.toBe("a".repeat(64));
  });

  it("reads a file exactly AT the cap — the bound is 'past', not 'at'", async () => {
    const filePath = await fixture("tacno.ics", "b".repeat(64));
    await expect(readIcsText(filePath, 64)).resolves.toBe("b".repeat(64));
  });

  it("propagates a missing file as the filesystem's own error, not as a read-error code", async () => {
    await expect(readIcsText(join(dir, "nema.ics"))).rejects.toThrow(/ENOENT/);
  });
});
