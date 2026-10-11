import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ZimError } from "./errors.js";
import { ZimReader, type ZimEntry } from "./reader.js";
import { buildZim } from "./testing/zimBuilder.js";

/**
 * The reader against two kinds of real file.
 *
 * `fixtures/wikibooks_be_all_nopic_2017-02.zim` is openZIM's own test pack — a
 * file Nexus did not write, in **format 5.0**, with an LZMA cluster. Every
 * expected value below was read off that file with an independent probe before
 * this test existed (its length, its 118 entries, its five redirects, its
 * 2091-byte favicon blob, its MD5 trailer), which is what makes it an oracle
 * rather than a snapshot of whatever the reader happens to do.
 *
 * The built files cover what the fixture cannot: zstd (every current Kiwix pack
 * uses it, and the fixture predates it), the extended 8-byte offset table, a
 * redirect written on purpose, and a checksum that is wrong.
 */
const FIXTURE = fileURLToPath(
  new URL("./fixtures/wikibooks_be_all_nopic_2017-02.zim", import.meta.url),
);

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe("ZimReader over openZIM's Wikibooks fixture", () => {
  it("reads the header, the MIME list and both page indexes", () => {
    const reader = ZimReader.open(FIXTURE);
    try {
      expect(reader.fileSize).toBe(152_865);
      expect(reader.format.majorVersion).toBe(5);
      expect(reader.format.minorVersion).toBe(0);
      expect(reader.entryCount).toBe(118);
      expect(reader.format.clusterCount).toBe(2);
      expect(reader.format.mainPage).not.toBeNull();
      expect(reader.format.layoutPage).toBeNull();
      expect(reader.mimeList).toEqual([
        "application/javascript",
        "image/gif",
        "image/png",
        "text/css",
        "text/html",
        "text/plain",
      ]);
    } finally {
      reader.close();
    }
  });

  it("finds an entry by its path", () => {
    const reader = ZimReader.open(FIXTURE);
    try {
      const entry = reader.entryByPath("A/Кава.html");
      expect(entry).not.toBeNull();
      expect(entry?.title).toBe("Кава");
      expect(entry?.mimetype).toBe("text/html");
      expect(entry?.zimPath).toBe("A/Кава.html");
    } finally {
      reader.close();
    }
  });

  it("finds an entry by its title, through the title pointer list", () => {
    const reader = ZimReader.open(FIXTURE);
    try {
      expect(reader.entryByTitle("Першая старонка")?.zimPath).toBe("A/Першая_старонка.html");
      expect(reader.entryByTitle("no such title at all")).toBeNull();
    } finally {
      reader.close();
    }
  });

  it("resolves the fixture's main page, and the redirect that stands in front of it", () => {
    const reader = ZimReader.open(FIXTURE);
    try {
      expect(reader.mainPage()?.zimPath).toBe("A/Першая_старонка.html");
      // `A/Main_Page.html` and `A/index.htm` are both REDIRECT entries pointing
      // at entry 40; a reader that read a redirect with a content entry's
      // 16-byte header would land on a different entry entirely.
      expect(reader.entryByPath("A/Main_Page.html")?.zimPath).toBe("A/Першая_старонка.html");
      expect(reader.entryByPath("A/index.htm")?.zimPath).toBe("A/Першая_старонка.html");
      expect(reader.entryByPath("A/nothing-here.html")).toBeNull();
    } finally {
      reader.close();
    }
  });

  it("answers titles by prefix in the file's own byte order", () => {
    const reader = ZimReader.open(FIXTURE);
    try {
      // Byte order, not locale order: "Урок 1" is followed by "Урок 10" and only
      // then by "Урок 2", because "1" (0x31) sorts before "2" (0x32). No
      // collator would produce this list, and the index is only searchable in
      // the order it is written in.
      expect(reader.titlesFrom("Італьянская мова/Урок 1", 10).map((entry) => entry.title)).toEqual([
        "Італьянская мова/Урок 1",
        "Італьянская мова/Урок 10",
      ]);
      expect(reader.titlesFrom("Кава", 10).map((entry) => entry.title)).toEqual(["Кава"]);
      expect(reader.titlesFrom("", 10)).toEqual([]);
    } finally {
      reader.close();
    }
  });

  it("reads a blob out of the uncompressed cluster", () => {
    const reader = ZimReader.open(FIXTURE);
    try {
      const icon = reader.entryByPath("I/favicon.png");
      expect(icon?.mimetype).toBe("image/png");
      expect(reader.blobLength(icon as NonNullable<typeof icon>)).toBe(2091);
      const bytes = reader.blob(icon as NonNullable<typeof icon>);
      expect(bytes.byteLength).toBe(2091);
      expect([...bytes.subarray(0, 8)]).toEqual(PNG_MAGIC);

      const watch = reader.entryByPath("I/s/watch-icon-loading.png");
      expect(reader.blobLength(watch as NonNullable<typeof watch>)).toBe(364);
      expect([...reader.blob(watch as NonNullable<typeof watch>).subarray(0, 8)]).toEqual(PNG_MAGIC);
    } finally {
      reader.close();
    }
  });

  it("refuses this format-5 file's LZMA cluster by name, and only when content is asked for", () => {
    const reader = ZimReader.open(FIXTURE);
    try {
      const article = reader.entryByPath("A/Кава.html");
      expect(article).not.toBeNull();
      let thrown: unknown = null;
      try {
        reader.blob(article as NonNullable<typeof article>);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ZimError);
      expect((thrown as ZimError).problem).toBe("compression");
      expect((thrown as ZimError).message).toContain("LZMA");
    } finally {
      reader.close();
    }
  });

  it("verifies the file's own MD5 trailer", () => {
    const reader = ZimReader.open(FIXTURE);
    try {
      // The MD5 of the file's first 152849 bytes, computed independently.
      expect(reader.embeddedChecksum()).toBe("2fb62a7110deffd3b192d922dffa02c1");
      expect(reader.checksumMatches()).toBe(true);
      // This pack has no full-text index, which is the normal case for a
      // nopic Wikibooks pack — and the reader says so rather than guessing.
      expect(reader.hasFullTextIndex()).toBe(false);
    } finally {
      reader.close();
    }
  });

  it("reads only the bytes a question needs, and counts them", () => {
    const reader = ZimReader.open(FIXTURE);
    try {
      const entry = reader.entryByPath("I/favicon.png") as ZimEntry;
      expect(reader.stats().reads).toBeGreaterThan(0);
      // A blob read reads only its own range, measured: one 8 KiB dirent chunk
      // (the cap `direntChunkBytes` sets), the cluster's info byte, the head of
      // its 140-byte offset table, the table itself and the blob's 2091 bytes.
      const before = reader.stats().bytesRead;
      const bytes = reader.blob(entry);
      const delta = reader.stats().bytesRead - before;
      expect(bytes.byteLength).toBe(2091);
      expect(delta).toBeLessThan(12 * 1024);
      // And far below the 127 108-byte LZMA cluster that shares the file with it
      // — a reader that decompressed a cluster to answer a question about a
      // different one would be visible right here.
      expect(delta).toBeLessThan(127_108);
    } finally {
      reader.close();
    }
  });
});

describe("ZimReader over files the builder wrote", () => {
  const article = new TextEncoder().encode("<html><body>Здраво</body></html>");
  const image = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9, 9, 9, 9, 9]);

  function built(options: { zstd?: boolean; extended?: boolean; listing?: boolean } = {}): Buffer {
    return buildZim({
      entries: [
        { namespace: "C", path: "article.html", title: "Članak", mime: "text/html", cluster: 0, blob: 0 },
        { namespace: "I", path: "image.png", title: "Slika", mime: "image/png", cluster: 1, blob: 0 },
        { namespace: "C", path: "old.html", title: "Stari", target: 0 },
        { namespace: "C", path: "auto.html", title: "Auto", target: 2 },
      ],
      clusters: [
        {
          blobs: [article],
          compression: options.zstd === true ? "zstd" : "none",
          ...(options.extended === true ? { extended: true } : {}),
        },
        { blobs: [image], compression: "zstd", extended: options.extended === true },
      ],
      mainPage: 0,
      ...(options.listing === true ? { titleListing: true } : {}),
    });
  }

  function withTemp<T>(name: string, bytes: Buffer, run: (path: string) => T): T {
    const directory = mkdtempSync(join(tmpdir(), "nx-zim-"));
    try {
      const filePath = join(directory, name);
      writeFileSync(filePath, bytes);
      return run(filePath);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  it("decompresses a zstd cluster", () => {
    withTemp("zstd.zim", built({ zstd: true }), (path) => {
      const reader = ZimReader.open(path);
      try {
        const entry = reader.entryByPath("C/article.html");
        expect(entry).not.toBeNull();
        expect(new TextDecoder().decode(reader.blob(entry as ZimEntry))).toBe(
          "<html><body>Здраво</body></html>",
        );
      } finally {
        reader.close();
      }
    });
  });

  it("caches a decompressed cluster instead of decoding it twice", () => {
    withTemp("zstd.zim", built({ zstd: true }), (path) => {
      const reader = ZimReader.open(path);
      try {
        const entry = reader.entryByPath("I/image.png");
        reader.blob(entry as ZimEntry);
        const first = reader.stats();
        reader.blob(entry as ZimEntry);
        const second = reader.stats();
        expect(first.cacheMisses).toBe(1);
        expect(second.cacheMisses).toBe(1);
        expect(second.cacheHits).toBe(first.cacheHits + 1);
      } finally {
        reader.close();
      }
    });
  });

  it("reads an extended (8-byte) offset table", () => {
    withTemp("extended.zim", built({ zstd: true, extended: true }), (path) => {
      const reader = ZimReader.open(path);
      try {
        const entry = reader.entryByPath("C/article.html");
        expect(reader.blobLength(entry as ZimEntry)).toBe(article.byteLength);
        expect([...reader.blob(entry as ZimEntry)]).toEqual([...article]);
      } finally {
        reader.close();
      }
    });
  });

  it("follows a redirect and refuses a redirect loop", () => {
    withTemp("redirect.zim", built(), (path) => {
      const reader = ZimReader.open(path);
      try {
        expect(reader.entryByPath("C/old.html")?.zimPath).toBe("C/article.html");
        expect(reader.entryByPath("C/auto.html")?.zimPath).toBe("C/article.html");
      } finally {
        reader.close();
      }
    });
    // A two-entry loop: the hop cap would stop it, the visited set is what
    // notices it — and the same builder writes both.
    const loop = buildZim({
      entries: [
        { namespace: "C", path: "a.html", title: "A", target: 1 },
        { namespace: "C", path: "b.html", title: "B", target: 0 },
      ],
      clusters: [{ blobs: [article], compression: "none" }],
    });
    withTemp("loop.zim", loop, (path) => {
      const reader = ZimReader.open(path);
      try {
        expect(() => reader.entryByPath("C/a.html")).toThrowError(ZimError);
      } finally {
        reader.close();
      }
    });
  });

  it("reads the file's main page from the header", () => {
    withTemp("main.zim", built(), (path) => {
      const reader = ZimReader.open(path);
      try {
        expect(reader.mainPage()?.zimPath).toBe("C/article.html");
      } finally {
        reader.close();
      }
    });
  });

  it("reports the format-6 title listing as an entry, and no full-text index", () => {
    withTemp("listing.zim", built({ listing: true }), (path) => {
      const reader = ZimReader.open(path);
      try {
        expect(reader.entryByPath("X/listing/titleOrdered/v1")).not.toBeNull();
        expect(reader.hasFullTextIndex()).toBe(false);
        expect(reader.titlesFrom("Čl", 5).map((entry) => entry.title)).toEqual(["Članak"]);
      } finally {
        reader.close();
      }
    });
  });

  it("refuses a checksum that is not the file's own MD5", () => {
    withTemp("bad-md5.zim", buildZim({
      entries: [{ namespace: "C", path: "a.html", mime: "text/html", cluster: 0, blob: 0 }],
      clusters: [{ blobs: [article], compression: "none" }],
      checksum: "wrong",
    }), (path) => {
      const reader = ZimReader.open(path);
      try {
        expect(reader.checksumMatches()).toBe(false);
      } finally {
        reader.close();
      }
    });
  });
});
