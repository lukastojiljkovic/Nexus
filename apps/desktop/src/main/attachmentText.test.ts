import { afterEach, describe, expect, it, vi } from "vitest";
import type { AttachmentTextCandidate } from "@nexus/db";
import { DOC_TEXT_PREVIEW_MAX_BYTES } from "../shared/ipc.js";
import {
  ATTACHMENT_TEXT_BACKFILL_LIMIT,
  backfillAttachmentText,
  extractAttachmentText,
  isTextIndexableAttachment,
  type AttachmentTextTarget,
} from "./attachmentText.js";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

/**
 * One attachment table's worth of pending rows, standing in for a real store.
 * Records what was written so a test can assert the CLAIM as well as the text —
 * the empty string is a first-class outcome here, not an absence.
 */
class FakeTarget implements AttachmentTextTarget {
  readonly written = new Map<string, string>();
  listCalls = 0;

  constructor(private readonly rows: AttachmentTextCandidate[]) {}

  listTextIndexCandidates(limit: number, maxSizeBytes: number): AttachmentTextCandidate[] {
    this.listCalls += 1;
    return this.rows
      .filter((row) => !this.written.has(row.id) && row.sizeBytes <= maxSizeBytes)
      .slice(0, limit);
  }

  setExtractedText(id: string, text: string): void {
    this.written.set(id, text);
  }
}

function candidate(overrides: Partial<AttachmentTextCandidate> = {}): AttachmentTextCandidate {
  return {
    id: "a1",
    fileName: "beleske.txt",
    mime: "text/plain",
    sizeBytes: 42,
    sha256: "a".repeat(64),
    ...overrides,
  };
}

let consoleError: ReturnType<typeof vi.spyOn> | null = null;

afterEach(() => {
  consoleError?.mockRestore();
  consoleError = null;
});

function silenceErrors(): ReturnType<typeof vi.spyOn> {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  return consoleError;
}

describe("isTextIndexableAttachment", () => {
  it("accepts exactly what the file preview accepts, within the preview's own size cap", () => {
    expect(isTextIndexableAttachment("text/plain", "beleske.txt", 42)).toBe(true);
    expect(isTextIndexableAttachment("text/plain", "README.md", 42)).toBe(true);
    // The pre-sniff rows: octet-stream by storage, text by name.
    expect(isTextIndexableAttachment("application/octet-stream", "staro.md", 42)).toBe(true);
    expect(isTextIndexableAttachment("application/octet-stream", "program.exe", 42)).toBe(false);
  });

  it("refuses PDF and the zip a DOCX/XLSX sniffs as — by name, because reading them needs a parser", () => {
    expect(isTextIndexableAttachment("application/pdf", "ugovor.pdf", 42)).toBe(false);
    expect(isTextIndexableAttachment("application/zip", "tabela.xlsx", 42)).toBe(false);
    expect(isTextIndexableAttachment("image/png", "slika.png", 42)).toBe(false);
  });

  it("refuses anything past the preview cap — a bigger text file simply has no indexed content", () => {
    expect(isTextIndexableAttachment("text/plain", "veliko.txt", DOC_TEXT_PREVIEW_MAX_BYTES)).toBe(
      true,
    );
    expect(
      isTextIndexableAttachment("text/plain", "veliko.txt", DOC_TEXT_PREVIEW_MAX_BYTES + 1),
    ).toBe(false);
  });
});

describe("extractAttachmentText", () => {
  it("decodes an eligible attachment's UTF-8, BOM stripped, diacritics intact", () => {
    const bytes = encode("\ufeffRešenje za Đorđa");
    expect(extractAttachmentText(candidate(), bytes)).toBe("Rešenje za Đorđa");
  });

  it("answers the empty string for an ineligible row — an honest absence, never a guess at the bytes", () => {
    const bytes = encode("%PDF-1.4 sadržaj");
    expect(extractAttachmentText(candidate({ mime: "application/pdf" }), bytes)).toBe("");
  });

  it("answers the empty string when the blob is gone", () => {
    expect(extractAttachmentText(candidate(), null)).toBe("");
  });

  it("re-checks the BYTES against the cap, not just the row's recorded size", () => {
    // The index row is metadata; the bytes are the truth. `doc:read-text`
    // checks both for the same reason.
    const bytes = new Uint8Array(DOC_TEXT_PREVIEW_MAX_BYTES + 1).fill(0x61);
    expect(extractAttachmentText(candidate({ sizeBytes: 10 }), bytes)).toBe("");
  });
});

describe("backfillAttachmentText", () => {
  const bytesFor = (map: Record<string, string>) => async (sha256: string) => {
    const text = map[sha256];
    return text === undefined ? null : encode(text);
  };

  it("claims every eligible row with its text, across every target", async () => {
    const notes = new FakeTarget([candidate({ id: "n1", sha256: "n".repeat(64) })]);
    const tasks = new FakeTarget([candidate({ id: "t1", sha256: "t".repeat(64) })]);

    const claimed = await backfillAttachmentText({
      targets: [notes, tasks],
      readBytes: bytesFor({ [`${"n".repeat(64)}`]: "beleška", [`${"t".repeat(64)}`]: "zadatak" }),
      stillThisSession: () => true,
    });

    expect(claimed).toBe(2);
    expect(notes.written.get("n1")).toBe("beleška");
    expect(tasks.written.get("t1")).toBe("zadatak");
  });

  it("claims a row whose blob is missing as ATTEMPTED, so the next pass does not retry it forever", async () => {
    const target = new FakeTarget([candidate({ id: "gone" })]);

    const claimed = await backfillAttachmentText({
      targets: [target],
      readBytes: async () => null,
      stillThisSession: () => true,
    });

    expect(claimed).toBe(1);
    expect(target.written.get("gone")).toBe("");
    // Idempotent: nothing is left pending, so a second pass is a no-op.
    expect(
      await backfillAttachmentText({
        targets: [target],
        readBytes: async () => null,
        stillThisSession: () => true,
      }),
    ).toBe(0);
  });

  it("logs a per-row read failure, marks it attempted, and carries on with the rest", async () => {
    const errors = silenceErrors();
    const target = new FakeTarget([
      candidate({ id: "bad", sha256: "b".repeat(64) }),
      candidate({ id: "good", sha256: "g".repeat(64) }),
    ]);

    const claimed = await backfillAttachmentText({
      targets: [target],
      readBytes: async (sha256) => {
        if (sha256 === "b".repeat(64)) throw new Error("decrypt failed");
        return encode("dobar");
      },
      stillThisSession: () => true,
    });

    expect(claimed).toBe(2);
    expect(target.written.get("bad")).toBe("");
    expect(target.written.get("good")).toBe("dobar");
    expect(errors).toHaveBeenCalled();
  });

  it("survives a target whose own read throws, without abandoning the other targets", async () => {
    const errors = silenceErrors();
    const broken: AttachmentTextTarget = {
      listTextIndexCandidates: () => {
        throw new Error("database is locked");
      },
      setExtractedText: () => undefined,
    };
    const healthy = new FakeTarget([candidate({ id: "t1" })]);

    const claimed = await backfillAttachmentText({
      targets: [broken, healthy],
      readBytes: bytesFor({ [`${"a".repeat(64)}`]: "tekst" }),
      stillThisSession: () => true,
    });

    expect(claimed).toBe(1);
    expect(healthy.written.get("t1")).toBe("tekst");
    expect(errors).toHaveBeenCalled();
  });

  it("is bounded per pass: never claims more rows than the budget, however many are pending", async () => {
    const rows = Array.from({ length: ATTACHMENT_TEXT_BACKFILL_LIMIT + 25 }, (_, index) =>
      candidate({ id: `a${index}`, sha256: "a".repeat(64) }),
    );
    const target = new FakeTarget(rows);

    const claimed = await backfillAttachmentText({
      targets: [target],
      readBytes: bytesFor({ [`${"a".repeat(64)}`]: "tekst" }),
      stillThisSession: () => true,
    });

    expect(claimed).toBe(ATTACHMENT_TEXT_BACKFILL_LIMIT);
    expect(target.written.size).toBe(ATTACHMENT_TEXT_BACKFILL_LIMIT);
  });

  it("shares one budget across targets rather than handing each its own", async () => {
    const first = new FakeTarget(
      Array.from({ length: ATTACHMENT_TEXT_BACKFILL_LIMIT }, (_, index) =>
        candidate({ id: `f${index}` }),
      ),
    );
    const second = new FakeTarget([candidate({ id: "s1" })]);

    const claimed = await backfillAttachmentText({
      targets: [first, second],
      readBytes: bytesFor({ [`${"a".repeat(64)}`]: "tekst" }),
      stillThisSession: () => true,
    });

    expect(claimed).toBe(ATTACHMENT_TEXT_BACKFILL_LIMIT);
    expect(second.written.size).toBe(0);
    expect(second.listCalls).toBe(0);
  });

  it("stops the moment the session it started in is gone, and writes nothing more", async () => {
    // A lock closes the database out from under background work; the pass must
    // stop rather than throw against a closed connection.
    const target = new FakeTarget([
      candidate({ id: "a0" }),
      candidate({ id: "a1" }),
      candidate({ id: "a2" }),
    ]);
    let alive = true;

    const claimed = await backfillAttachmentText({
      targets: [target],
      readBytes: async () => {
        alive = false; // the lock lands during the very first read
        return encode("tekst");
      },
      stillThisSession: () => alive,
    });

    expect(claimed).toBe(0);
    expect(target.written.size).toBe(0);
  });

  it("does not mark a row attempted when the failure was the lock, not the row", async () => {
    // Marking here would permanently write off rows that were never really
    // looked at — the one way a bounded, resumable pass can lose data.
    const errors = silenceErrors();
    const target = new FakeTarget([candidate({ id: "a0" })]);
    let alive = true;

    await backfillAttachmentText({
      targets: [target],
      readBytes: async () => {
        alive = false;
        throw new Error("The data key is locked.");
      },
      stillThisSession: () => alive,
    });

    expect(target.written.size).toBe(0);
    expect(errors).toHaveBeenCalled();
  });

  it("claims a candidate the eligibility rule rejects, rather than looking at it again next pass", async () => {
    // The SQL narrowing is a coarse superset (`ATTACHMENT_TEXT_CANDIDATE_MIMES`)
    // — an octet-stream binary reaches the pass and is refused by the rule. It
    // still has to be claimed, or every pass forever spends budget on it.
    const target = new FakeTarget([
      candidate({ id: "bin", mime: "application/octet-stream", fileName: "program.exe" }),
    ]);
    const readBytes = vi.fn(async () => encode("nikad"));

    const claimed = await backfillAttachmentText({
      targets: [target],
      readBytes,
      stillThisSession: () => true,
    });

    expect(claimed).toBe(1);
    expect(target.written.get("bin")).toBe("");
    // And its blob was never read: ineligibility is decided before any IO.
    expect(readBytes).not.toHaveBeenCalled();
  });
});
