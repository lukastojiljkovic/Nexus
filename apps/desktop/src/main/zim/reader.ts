import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { createHash } from "node:crypto";
import { zstdDecompressSync } from "node:zlib";

import { ZimError } from "./errors.js";
import {
  MAX_HEADER_READ_BYTES,
  ZIM_HEADER_BYTES,
  parseMimeList,
  parseZimHeader,
  type ZimHeader,
} from "./header.js";
import { compareKeys, displayTitle, parseDirent, pathKey, type ZimDirent } from "./dirent.js";
import {
  CLUSTER_NONE,
  MAX_DECOMPRESSED_CLUSTER_BYTES,
  MAX_TABLE_BYTES,
  blobRange,
  parseClusterInfo,
  tableBytesOf,
  tableEntryBytes,
} from "./cluster.js";
import { ByteLruCache } from "./lru.js";
import { joinZimPath, splitZimPath } from "./paths.js";

/**
 * THE ZIM READER: a file, positioned reads, and no more of it in memory than one
 * blob at a time.
 *
 * **Why this is written from the specification rather than linked from a
 * library.** Every existing ZIM reader — libzim, kiwix-js, the WASM build of
 * libzim — and Xapian behind the full-text index are GPL, and linking any of
 * them would make Nexus GPL. The format is documented at
 * <https://wiki.openzim.org/wiki/ZIM_file_format>, so this is a clean-room
 * implementation of **format 6 (and the format 5 files still in the catalogue)**
 * from that page and from the observable behaviour of real files. ADR-098
 * records the licence reasoning in full.
 *
 * **Positioned reads, always.** A Wikipedia pack is 100+ GB and the English
 * one's full-text index cluster alone is 9.5 GB, so nothing here ever reads the
 * file whole: the header is 80 bytes, a directory entry is at most
 * `direntChunkBytes`, a pointer-list probe is 8 bytes, and a blob is cut out by
 * reading its own offset range. The one place a whole cluster IS read is a
 * compressed one, because that is what decompression means — and it is bounded
 * by `clusterReadBytes`, which a host can only raise to a value it is willing to
 * allocate.
 *
 * **Why synchronous.** The reader is called from an Electron protocol handler,
 * which is async, and from a page's search handler. A synchronous read of a few
 * kilobytes from a local file is faster than the promise plumbing around it, and
 * it makes the caps (below) the only thing that decides how long a call can
 * take. Nothing here awaits, so nothing here can interleave, which is why the
 * LRU cache needs no lock.
 *
 * **Every bound is stated once, in `DEFAULT_LIMITS`.** A hostile file is a file
 * whose every number is an offset, and the caps are what turn "reads forever" or
 * "allocates a terabyte" into a `ZimError` with a code. `fuzz.test.ts` walks
 * corrupted headers and pointer lists through this class and asserts it answers
 * rather than hangs.
 */

export interface ZimReaderLimits {
  /** How much decoded cluster to keep. Clusters are ~1–2 MB, so this is a few dozen. */
  readonly clusterCacheBytes: number;
  /** How much of the file one directory entry read may take. */
  readonly direntChunkBytes: number;
  /** The largest COMPRESSED cluster this reader will read in order to decompress it. */
  readonly clusterReadBytes: number;
  /** How many redirect hops `resolve` will follow before refusing. */
  readonly maxRedirects: number;
  /** The largest single table read, and the largest single blob. */
  readonly tableBytes: number;
  readonly blobBytes: number;
}

/**
 * The caps this build runs under.
 *
 * `clusterCacheBytes` is 64 MB: several clusters of a real Wikipedia pack, and
 * small enough that the cache is never the reason the process grows.
 * `clusterReadBytes` and `blobBytes` are 64 MB each, which is two orders of
 * magnitude more than the largest real one measured (2.09 MB decoded, 105 KB
 * compressed) and still a bound worth having.
 */
export const DEFAULT_LIMITS: ZimReaderLimits = {
  clusterCacheBytes: 64 * 1024 * 1024,
  direntChunkBytes: 8 * 1024,
  clusterReadBytes: 64 * 1024 * 1024,
  maxRedirects: 8,
  tableBytes: MAX_TABLE_BYTES,
  blobBytes: 64 * 1024 * 1024,
};

/**
 * One entry, as everything above the reader sees it.
 *
 * `title` is the DISPLAY title (`dirent.ts`'s rule: the path when the file
 * carries no title), and `zimPath` is the `namespace + "/" + path` name — the
 * one string that can be turned back into a URL, a bookmark or a history row.
 * The blob's size is deliberately absent: it costs a cluster table read, and a
 * list of a hundred thousand search hits must not cost a hundred thousand
 * reads.
 */
export interface ZimEntry {
  readonly index: number;
  readonly namespace: string;
  readonly path: string;
  readonly title: string;
  readonly zimPath: string;
  readonly mimetype: string;
}

export interface ZimReaderStats {
  readonly reads: number;
  readonly bytesRead: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly cacheBytes: number;
  readonly cachedClusters: number;
}

export class ZimReader {
  private readonly fd: number;
  private readonly cache: ByteLruCache<number, Uint8Array>;
  private readonly limits: ZimReaderLimits;
  private reads = 0;
  private bytesRead = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private closed = false;

  private constructor(
    private readonly path: string,
    private readonly size: number,
    private readonly header: ZimHeader,
    private readonly mimeTypes: readonly string[],
    fd: number,
    limits: ZimReaderLimits,
  ) {
    this.fd = fd;
    this.limits = limits;
    this.cache = new ByteLruCache(limits.clusterCacheBytes, (cluster) => cluster.byteLength);
  }

  /**
   * Opens a ZIM and reads everything the header makes answerable without
   * touching a cluster: the header itself, the MIME list and the two page
   * indexes. A refusal here is a `ZimError`, and every field it read has been
   * checked against the file's own size.
   */
  static open(filePath: string, overrides: Partial<ZimReaderLimits> = {}): ZimReader {
    const limits: ZimReaderLimits = { ...DEFAULT_LIMITS, ...overrides };
    let fd: number;
    let size: number;
    try {
      fd = openSync(filePath, "r");
      size = fstatSync(fd).size;
    } catch (error) {
      throw new ZimError("io", `The file could not be opened: ${messageOf(error)}`);
    }
    try {
      const headerBytes = readExact(fd, 0, Math.min(ZIM_HEADER_BYTES, size));
      const header = parseZimHeader(headerBytes, size);
      const mimeLength = Math.min(MAX_HEADER_READ_BYTES, header.checksumPos - header.mimeListPos);
      if (mimeLength <= 0) {
        throw new ZimError("out-of-range", "The MIME list does not fit inside the file.");
      }
      const mimeBytes = readExact(fd, header.mimeListPos, mimeLength);
      const mimeTypes = parseMimeList(mimeBytes);
      return new ZimReader(filePath, size, header, mimeTypes, fd, limits);
    } catch (error) {
      closeSync(fd);
      throw error;
    }
  }

  get filePath(): string {
    return this.path;
  }

  get fileSize(): number {
    return this.size;
  }

  get format(): ZimHeader {
    return this.header;
  }

  get mimeList(): readonly string[] {
    return this.mimeTypes;
  }

  get entryCount(): number {
    return this.header.entryCount;
  }

  stats(): ZimReaderStats {
    return {
      reads: this.reads,
      bytesRead: this.bytesRead,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      cacheBytes: this.cache.bytes,
      cachedClusters: this.cache.count,
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.cache.clear();
    closeSync(this.fd);
  }

  // --- The two pointer lists ------------------------------------------------

  /** The URL pointer list's entry `index`. Every dirent lookup starts here. */
  private urlPointer(index: number): number {
    if (!Number.isInteger(index) || index < 0 || index >= this.header.entryCount) {
      throw new ZimError("not-found", `The file has no entry number ${String(index)}.`);
    }
    return readUint64(this.readAt(this.header.urlPtrPos + index * 8, 8), 0);
  }

  /** The title pointer list's entry `position`: an ENTRY INDEX, not an offset. */
  private titlePointer(position: number): number {
    const bytes = this.readAt(this.header.titlePtrPos + position * 4, 4);
    return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
  }

  // --- Directory entries ----------------------------------------------------

  private direntAt(offset: number): ZimDirent {
    const available = this.header.checksumPos - offset;
    if (available <= 0) {
      throw new ZimError("out-of-range", "A directory entry points past the file's data.");
    }
    return parseDirent(this.readAt(offset, Math.min(this.limits.direntChunkBytes, available)));
  }

  /**
   * The entry a redirect points at, and the one `entryByPath` answers with.
   *
   * A redirect chain is followed with a hop cap AND a visited set: the cap is
   * what a hostile file cannot exceed, and the set is what makes a two-entry
   * loop (`A → B → A`) refuse instead of being walked until the cap. Both refuse
   * with `redirect`, and the message is the same because the user's answer is
   * the same: this file's link is broken.
   */
  resolve(index: number): ZimEntry {
    const visited = new Set<number>();
    let at = index;
    for (let hop = 0; hop <= this.limits.maxRedirects; hop += 1) {
      if (visited.has(at)) {
        throw new ZimError("redirect", "This entry's redirects point at each other in a loop.");
      }
      visited.add(at);
      const dirent = this.direntAt(this.urlPointer(at));
      if (dirent.kind === "content") return this.view(at, dirent);
      if (dirent.kind === "ignored") {
        throw new ZimError("not-found", `Entry ${String(index)} is a deleted or link-target entry.`);
      }
      at = dirent.redirectIndex;
      if (at >= this.header.entryCount) {
        throw new ZimError("corrupt", "A redirect names an entry the file does not have.");
      }
    }
    throw new ZimError("redirect", "This entry's redirect chain is longer than this reader follows.");
  }

  /**
   * A binary search over the URL pointer list, which the format requires to be
   * sorted by `namespace + path` as bytes.
   *
   * No index is built and no list is scanned: `log2(entryCount)` dirent reads,
   * which is 24 for the 16-million-entry English pack and one positioned read of
   * eight bytes plus one of eight kilobytes per step. A full scan is what a
   * 30-million-entry file cannot afford, and this is the method that avoids it.
   */
  entryByPath(zimPath: string): ZimEntry | null {
    const { namespace, path } = splitZimPath(zimPath);
    const target = pathKey(namespace, path);
    let low = 0;
    let high = this.header.entryCount - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const dirent = this.direntAt(this.urlPointer(middle));
      if (dirent.kind === "ignored") {
        // The list is still sorted; an entry this reader does not understand
        // cannot be compared, so the search narrows away from it instead of
        // guessing where it belongs.
        high = middle - 1;
        continue;
      }
      const order = compareKeys(target, pathKey(dirent.namespace, dirent.path));
      if (order === 0) return this.resolve(middle);
      if (order < 0) high = middle - 1;
      else low = middle + 1;
    }
    return null;
  }

  /**
   * The entry whose display title is exactly `title`, or `null`.
   *
   * The title pointer list is sorted by title and holds entry INDEXES, so this
   * is the same binary search over a different list — and, as above, it is the
   * only way to answer a title question without reading every entry.
   */
  entryByTitle(title: string): ZimEntry | null {
    if (this.header.entryCount === 0) return null;
    const at = this.lowerBoundByTitle(title);
    for (let position = at; position < this.header.entryCount; position += 1) {
      const index = this.titlePointer(position);
      const dirent = this.direntAt(this.urlPointer(index));
      if (dirent.kind === "ignored") continue;
      const display = displayTitle(dirent);
      if (compareText(display, title) !== 0) return null;
      return this.resolve(index);
    }
    return null;
  }

  /**
   * Up to `limit` entries whose title STARTS WITH `prefix`, in the file's own
   * title order.
   *
   * The lower bound is a binary search; the walk forward is bounded by `limit`
   * and stops at the first title that no longer matches, so a search of a
   * 30-million-entry pack reads `log2(n) + limit` dirents and never a list. The
   * comparison is on the raw title, so the ordering is the file's rather than
   * `Intl.Collator`'s: a title index is only sorted one way and binary search is
   * only correct against that way.
   */
  titlesFrom(prefix: string, limit: number): readonly ZimEntry[] {
    if (prefix === "" || !Number.isInteger(limit) || limit <= 0) return [];
    if (this.header.entryCount === 0) return [];
    const results: ZimEntry[] = [];
    for (let position = this.lowerBoundByTitle(prefix); position < this.header.entryCount; position += 1) {
      const index = this.titlePointer(position);
      const dirent = this.direntAt(this.urlPointer(index));
      if (dirent.kind === "ignored") continue;
      if (!displayTitle(dirent).startsWith(prefix)) break;
      try {
        results.push(this.resolve(index));
      } catch {
        // One broken redirect must not fail a search: the honest answer to "find
        // my article" is the pages that open, not an error about one that does
        // not.
        continue;
      }
      if (results.length >= limit) break;
    }
    return results;
  }

  /** The first position in the title list whose title is not before `title`. */
  private lowerBoundByTitle(title: string): number {
    let low = 0;
    let high = this.header.entryCount - 1;
    let answer = this.header.entryCount;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const index = this.titlePointer(middle);
      const dirent = this.direntAt(this.urlPointer(index));
      if (dirent.kind === "ignored") {
        high = middle - 1;
        continue;
      }
      if (compareText(displayTitle(dirent), title) < 0) low = middle + 1;
      else {
        answer = middle;
        high = middle - 1;
      }
    }
    return answer;
  }

  /** The file's main page, or `null` when it declares none (or its entry is a redirect to nothing). */
  mainPage(): ZimEntry | null {
    const index = this.header.mainPage;
    if (index === null) return null;
    return this.resolve(index);
  }

  /** Whether a `X/fulltext/xapian` entry exists — the file carries a full-text index Nexus cannot open (see ADR-098). */
  hasFullTextIndex(): boolean {
    return this.entryByPath("X/fulltext/xapian") !== null;
  }

  /**
   * One `M/` metadata value, decoded as UTF-8, or `null`.
   *
   * Best-effort by design: a caller drawing a library's title must not fail
   * because the metadata blob sits in an LZMA cluster, and "the file does not
   * say" is the honest answer in every one of those cases rather than an
   * exception thrown at whoever asked.
   */
  metadata(name: string): string | null {
    try {
      const entry = this.entryByPath(joinZimPath("M", name));
      if (entry === null) return null;
      const value = new TextDecoder("utf-8", { fatal: false }).decode(this.blob(entry)).trim();
      return value === "" ? null : value;
    } catch {
      return null;
    }
  }

  // --- Blobs ----------------------------------------------------------------

  /**
   * One entry's bytes.
   *
   * Uncompressed clusters are cut out of the file directly: the table's first
   * value is its own length, so the table can be read on its own and the blob's
   * own range read after it — a 9.5 GB index cluster is then four small reads
   * rather than one enormous one. A zstd cluster is read whole (that IS what
   * decompressing it means), decoded once and cached; the caps are what bound
   * both paths.
   *
   * The answer is always a fresh `Uint8Array`: the compressed path slices a
   * cached buffer, and handing that buffer to a caller would let one write to a
   * page corrupt every later read of the same cluster.
   */
  blob(entry: ZimEntry): Uint8Array {
    const dirent = this.direntAt(this.urlPointer(entry.index));
    if (dirent.kind !== "content") {
      throw new ZimError("not-found", `${entry.zimPath} is not an entry with content.`);
    }
    return this.blobOf(dirent.cluster, dirent.blob, entry.zimPath);
  }

  /** How many bytes `blob(entry)` would answer with, without holding them. */
  blobLength(entry: ZimEntry): number {
    const dirent = this.direntAt(this.urlPointer(entry.index));
    if (dirent.kind !== "content") {
      throw new ZimError("not-found", `${entry.zimPath} is not an entry with content.`);
    }
    const cluster = this.clusterOf(dirent.cluster);
    const range = blobRange(cluster.table, cluster.extended, dirent.blob, cluster.payloadBytes);
    return range.end - range.start;
  }

  private blobOf(cluster: number, blob: number, what: string): Uint8Array {
    const view = this.clusterOf(cluster);
    const range = blobRange(view.table, view.extended, blob, view.payloadBytes);
    if (range.end - range.start > this.limits.blobBytes) {
      throw new ZimError("too-large", `${what} is larger than this reader will return.`);
    }
    // The two paths answer the same bytes from different places, and the
    // difference is the point of the split: a decoded cluster is sliced out of
    // the cached buffer, while an uncompressed blob is read from the file by its
    // own range — which is what keeps a 9.5 GB index cluster from being read.
    if (view.decoded !== null) return view.decoded.slice(range.start, range.end);
    return this.readAt(view.payloadStart + range.start, range.end - range.start);
  }

  /**
   * One cluster's layout: its info byte, its blob-offset table, and the two
   * numbers that turn a table entry into a file position.
   *
   * The offsets are counted in the PAYLOAD — the bytes after the info byte — so
   * `payloadBytes` is the payload's length and `table` is its first
   * `tableBytes` bytes. For an uncompressed cluster the table is a small buffer
   * of its own and `decoded` is `null`; for a compressed one `decoded` is the
   * whole payload, table included, and the table is a prefix of it.
   */
  private clusterOf(cluster: number): ClusterView {
    if (!Number.isInteger(cluster) || cluster < 0 || cluster >= this.header.clusterCount) {
      throw new ZimError("corrupt", `A directory entry names cluster ${String(cluster)}, which the file does not have.`);
    }
    const start = this.clusterStart(cluster);
    const end = this.clusterEnd(cluster);
    const info = parseClusterInfo(this.readAt(start, 1)[0] ?? 0);
    const payloadStart = start + 1;
    if (end <= payloadStart) {
      throw new ZimError("corrupt", "A cluster has no payload.");
    }
    const payloadBytes = end - payloadStart;
    if (info.compression === CLUSTER_NONE) {
      const entryBytes = tableEntryBytes(info.extended);
      const head = this.readAt(payloadStart, Math.min(entryBytes * 2, payloadBytes));
      if (head.byteLength < entryBytes) {
        throw new ZimError("corrupt", "A cluster is too short to hold its blob offset table.");
      }
      const tableBytes = tableBytesOf(head, info.extended);
      if (tableBytes > this.limits.tableBytes || tableBytes > payloadBytes) {
        throw new ZimError("too-large", "A cluster's blob offset table is larger than this reader will read.");
      }
      return {
        extended: info.extended,
        table: this.readAt(payloadStart, tableBytes),
        payloadBytes,
        payloadStart,
        decoded: null,
      };
    }
    const cached = this.cache.get(cluster);
    if (cached !== undefined) {
      this.cacheHits += 1;
      return {
        extended: info.extended,
        table: cached,
        payloadBytes: cached.byteLength,
        payloadStart,
        decoded: cached,
      };
    }
    this.cacheMisses += 1;
    if (payloadBytes > this.limits.clusterReadBytes) {
      throw new ZimError("too-large", "A compressed cluster is larger than this reader will read.");
    }
    const compressed = this.readAt(payloadStart, payloadBytes);
    let decodedBytes: Uint8Array;
    try {
      decodedBytes = zstdDecompressSync(compressed, {
        maxOutputLength: MAX_DECOMPRESSED_CLUSTER_BYTES,
      });
    } catch (error) {
      throw new ZimError("cluster", `A zstd cluster could not be decompressed: ${messageOf(error)}`);
    }
    this.cache.set(cluster, decodedBytes);
    return {
      extended: info.extended,
      table: decodedBytes,
      payloadBytes: decodedBytes.byteLength,
      payloadStart,
      decoded: decodedBytes,
    };
  }

  /**
   * Where a cluster starts, and where the NEXT one starts (`checksumPos` for the
   * last, because the trailer follows the data).
   *
   * The cluster pointer list is sorted, and this is the one place that is
   * checked: a list that runs backwards would make every range below empty or
   * negative, and saying so once here is what keeps the two readers that use it
   * from each inventing a rule.
   */
  private clusterStart(cluster: number): number {
    return readUint64(this.readAt(this.header.clusterPtrPos + cluster * 8, 8), 0);
  }

  private clusterEnd(cluster: number): number {
    if (cluster + 1 < this.header.clusterCount) {
      return readUint64(this.readAt(this.header.clusterPtrPos + (cluster + 1) * 8, 8), 0);
    }
    return this.header.checksumPos;
  }

  // --- Integrity ------------------------------------------------------------

  /**
   * Whether the file's own MD5 — the 16 bytes at `checksumPos`, which are the
   * MD5 of the file without them — is what those bytes say.
   *
   * This is the integrity check the download path ends with, and ADR-098 says
   * plainly what it is: an integrity check, not a signature. A ZIM's checksum
   * comes from the same file it describes, so it catches a truncated or
   * corrupted download and proves nothing about who wrote the bytes. The
   * Kiwix-hosted `.meta4`'s SHA-256 — which the download service verifies
   * against a key-independent published value — is what says the file is the one
   * Kiwix published.
   */
  checksumMatches(): boolean {
    // The trailer is the one structure OUTSIDE the data region `readAt` guards,
    // which is exactly why this method reads it itself rather than through the
    // method that would refuse it.
    const trailer = readExact(this.fd, this.header.checksumPos, 16);
    this.reads += 1;
    this.bytesRead += 16;
    const hash = createHash("md5");
    const chunk = 1024 * 1024;
    for (let at = 0; at < this.header.checksumPos; at += chunk) {
      const length = Math.min(chunk, this.header.checksumPos - at);
      hash.update(readExact(this.fd, at, length));
      this.reads += 1;
      this.bytesRead += length;
    }
    return hash.digest().equals(trailer);
  }

  /** The MD5 the file carries, as lowercase hex. */
  embeddedChecksum(): string {
    // Like `checksumMatches`, this is a read of the trailer — the one region
    // `readAt` refuses.
    return Buffer.from(readExact(this.fd, this.header.checksumPos, 16)).toString("hex");
  }

  // --- Internals ------------------------------------------------------------

  /**
   * One positioned read, with every bound checked before it happens.
   *
   * `position + length` may not pass the checksum: that is the file's data
   * region, and a read that crossed into the trailer would be a read of bytes
   * that are not part of any structure. The one caller that does read the
   * trailer is `checksumMatches`, which goes around this method deliberately.
   */
  private readAt(position: number, length: number): Uint8Array {
    if (this.closed) {
      throw new ZimError("io", "This reader is closed.");
    }
    if (!Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(length) || length <= 0) {
      throw new ZimError("out-of-range", "A read was asked for a position or length the file cannot have.");
    }
    if (position + length > this.header.checksumPos) {
      throw new ZimError("out-of-range", "A read was asked for bytes past the file's data.");
    }
    this.reads += 1;
    this.bytesRead += length;
    return readExact(this.fd, position, length);
  }

  private view(index: number, dirent: ZimContentDirentLike): ZimEntry {
    const mimetype = this.mimeTypes[dirent.mimetype];
    if (mimetype === undefined) {
      throw new ZimError(
        "corrupt",
        `Entry ${String(index)} names MIME type ${String(dirent.mimetype)}, which the file's list does not have.`,
      );
    }
    return {
      index,
      namespace: dirent.namespace,
      path: dirent.path,
      title: displayTitle(dirent),
      zimPath: joinZimPath(dirent.namespace, dirent.path),
      mimetype,
    };
  }
}

/** What `view` needs of a content dirent: the two names and the MIME index. */
type ZimContentDirentLike = Extract<ZimDirent, { kind: "content" }>;

/**
 * One cluster, as the blob path sees it.
 *
 * `table` is the offset table (also the head of the payload, and the whole
 * payload when `decoded` is set), `payloadBytes` is the length the offsets are
 * counted in, and `payloadStart` is the FILE position of payload byte zero —
 * which is what an uncompressed blob's own range is read from.
 */
interface ClusterView {
  readonly extended: boolean;
  readonly table: Uint8Array;
  readonly payloadBytes: number;
  readonly payloadStart: number;
  readonly decoded: Uint8Array | null;
}

/** One exact positioned read, or a refusal when the file is shorter than the header said. */
function readExact(fd: number, position: number, length: number): Uint8Array {
  if (length <= 0) return new Uint8Array(0);
  const buffer = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const got = readSync(fd, buffer, read, length - read, position + read);
    if (got <= 0) {
      throw new ZimError("io", "The file ended before the bytes its own header describes.");
    }
    read += got;
  }
  return buffer;
}

function readUint64(bytes: Uint8Array, at: number): number {
  const value = new DataView(bytes.buffer, bytes.byteOffset + at, 8).getBigUint64(0, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ZimError("too-large", "An offset in this file cannot be addressed by this reader.");
  }
  return Number(value);
}

/** Byte-wise text comparison, the order both pointer lists are in. */
function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return compareKeys(new TextEncoder().encode(left), new TextEncoder().encode(right));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
