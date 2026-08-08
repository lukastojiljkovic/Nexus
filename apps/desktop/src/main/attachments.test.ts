import { describe, expect, it } from "vitest";
import { extensionForMime } from "@nexus/core";

import { safeOpenName, sanitizeFileName } from "./attachments.js";

/**
 * The execution path this file exists to keep shut.
 *
 * `openExternally` ends in `shell.openPath`, which on Windows is ShellExecute:
 * the OS decides what to RUN from the extension and from nothing else. The name
 * it was handed used to be `sanitizeFileName(attachment.fileName)` — and
 * `fileName` is a renderer-supplied display string validated only as „a
 * non-empty string", while `sanitizeFileName` deliberately PRESERVES the final
 * extension so a user's `.pdf` still looks like a `.pdf`.
 *
 * Put together: a renderer with a scripting foothold attaches arbitrary bytes
 * under the name `Ugovor.pdf.exe`, the user clicks „otvori", and native code
 * runs OUTSIDE the `sandbox: true` renderer — defeating the control the whole
 * Electron design leans on hardest, from inside the process that control exists
 * to contain.
 *
 * `safeOpenName` takes the extension from the sniffed bytes instead. The bytes
 * are already decrypted and in hand at that point, so there is nothing for the
 * renderer to influence.
 */
describe("safeOpenName", () => {
  it("discards an executable extension the renderer asked for", () => {
    // The attack, stated as a test. PDF bytes under an .exe name.
    expect(safeOpenName("Ugovor.pdf.exe", "application/pdf")).toBe("Ugovor.pdf.pdf");
    expect(safeOpenName("racun.exe", "application/pdf")).toBe("racun.pdf");
  });

  it("discards every other extension Windows would execute", () => {
    // Not only `.exe`: ShellExecute runs all of these, and `.lnk` and `.url`
    // do it while displaying an icon of the attacker's choosing.
    for (const name of [
      "a.bat",
      "a.cmd",
      "a.com",
      "a.scr",
      "a.msi",
      "a.ps1",
      "a.vbs",
      "a.js",
      "a.hta",
      "a.lnk",
      "a.url",
      "a.reg",
    ]) {
      expect(safeOpenName(name, "image/png")).toBe("a.png");
    }
  });

  it("gives unidentifiable bytes NO extension, so Windows asks a human", () => {
    // `sniffMime` knows seven types; everything else is
    // `application/octet-stream`. An extensionless file makes Windows show its
    // „open with" chooser, which puts a person in front of the decision — the
    // correct authority for bytes this product could not identify. Guessing
    // here would be inventing the claim the sniffer refused to make.
    expect(safeOpenName("nepoznato.exe", "application/octet-stream")).toBe("nepoznato");
    expect(safeOpenName("payload.scr", "application/octet-stream")).toBe("payload");
  });

  it("keeps the name the user recognises when the type agrees", () => {
    expect(safeOpenName("Ugovor.pdf", "application/pdf")).toBe("Ugovor.pdf");
    expect(safeOpenName("slika.png", "image/png")).toBe("slika.png");
    // `.jpeg` normalises to `.jpg`: same handler, and the shorter form is what
    // Windows registers and what a user expects to see.
    expect(safeOpenName("slika.jpeg", "image/jpeg")).toBe("slika.jpg");
  });

  it("keeps interior dots, because they are part of the name", () => {
    // `arhiva.tar` sniffed as zip becomes `arhiva.tar.zip`. Truncating at the
    // first dot would rename files the user recognises; only the LAST extension
    // has to be ours.
    expect(safeOpenName("arhiva.tar.gz", "application/zip")).toBe("arhiva.tar.zip");
    expect(safeOpenName("v1.2.3-beleske.txt", "text/plain")).toBe("v1.2.3-beleske.txt");
  });

  it("treats a leading-dot name as a name, and still puts its own extension last", () => {
    // `extname(".exe")` is `""` — POSIX says a leading dot starts a hidden
    // FILE NAME, not an extension, and Node agrees. So the whole string is the
    // stem and the result is `.exe.pdf`.
    //
    // That is the right outcome twice over. The security property is unchanged
    // — ShellExecute reads the LAST extension, which is ours — and the user
    // keeps a name they recognise, which is why `.gitignore` staying
    // `.gitignore.txt` beats collapsing it to `prilog.txt`.
    expect(safeOpenName(".exe", "application/pdf")).toBe(".exe.pdf");
    expect(safeOpenName(".gitignore", "text/plain")).toBe(".gitignore.txt");
  });

  it("always puts its own extension last, whatever the display name was", () => {
    // The property, asserted as a property rather than case by case: whatever
    // the renderer sends, the extension ShellExecute will read is the one the
    // BYTES earned. This is the assertion that would fail first if somebody
    // „simplified" the stem handling later.
    for (const name of ["a.exe", "a.b.exe", ".exe", "a.", "a", "a.exe.pdf.exe", "..a.exe"]) {
      expect(safeOpenName(name, "application/pdf").endsWith(".pdf"), name).toBe(true);
      expect(safeOpenName(name, "image/png").endsWith(".png"), name).toBe(true);
    }
  });

  it("still strips path separators, because sanitizing comes first", () => {
    // The traversal defence is unchanged and still runs before any of this —
    // an extension policy that reintroduced a separator would be a new hole in
    // place of the old one.
    const name = safeOpenName("..\\..\\Windows\\System32\\evil.exe", "application/pdf");
    expect(name).not.toContain("\\");
    expect(name).not.toContain("/");
    expect(name.endsWith(".pdf")).toBe(true);
  });

  it("keeps Serbian names intact", () => {
    expect(safeOpenName("Račun — jun 2026.pdf", "application/pdf")).toBe("Račun — jun 2026.pdf");
    expect(safeOpenName("Ugovor o zakupu.docx", "application/zip")).toBe("Ugovor o zakupu.zip");
  });

  it("bounds the length however long the display name was", () => {
    const long = `${"a".repeat(500)}.exe`;
    const out = safeOpenName(long, "application/pdf");
    expect(out.length).toBeLessThanOrEqual(210);
    expect(out.endsWith(".pdf")).toBe(true);
  });
});

describe("extensionForMime", () => {
  it("answers for every type the sniffer can produce", () => {
    // Paired with `sniffMime`'s own list. If a magic is added there without an
    // entry here, its files open with no extension — safe, but a silent
    // regression in usefulness, and this is where it shows.
    expect(extensionForMime("image/png")).toBe(".png");
    expect(extensionForMime("image/jpeg")).toBe(".jpg");
    expect(extensionForMime("image/gif")).toBe(".gif");
    expect(extensionForMime("image/webp")).toBe(".webp");
    expect(extensionForMime("application/pdf")).toBe(".pdf");
    expect(extensionForMime("application/zip")).toBe(".zip");
    expect(extensionForMime("text/plain")).toBe(".txt");
  });

  it("answers with nothing for anything else", () => {
    expect(extensionForMime("application/octet-stream")).toBe("");
    expect(extensionForMime("text/html")).toBe("");
    expect(extensionForMime("application/x-msdownload")).toBe("");
    expect(extensionForMime("")).toBe("");
  });
});

describe("sanitizeFileName still does its own job", () => {
  // `safeOpenName` builds on it; these pin that the base behaviour did not
  // shift underneath. `saveAttachmentAs` still uses it directly, where the
  // user sees and confirms the name in a Save dialog.
  it("collapses unsafe runs and never returns empty", () => {
    expect(sanitizeFileName("a//b\\\\c")).toBe("a_b_c");
    expect(sanitizeFileName("///")).toBe("prilog");
    expect(sanitizeFileName("..")).toBe("prilog");
  });
});
