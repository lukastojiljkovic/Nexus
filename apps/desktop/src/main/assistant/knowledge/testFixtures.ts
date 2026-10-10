import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Embedder } from "@nexus/core";
import { openDatabase, type NexusDatabase } from "@nexus/db";
import type { WikiSource, WikiTitle } from "./types.js";

/**
 * TEST-ONLY helpers - imported by the `*.test.ts` files beside them and by
 * nothing in the app, `main/packs/fixtures.ts`'s arrangement.
 *
 * Every suite here needs the same three things: a throwaway encrypted database
 * with the real migrations applied, rows in the tables the sources read (put
 * there through SQL, because what is being tested is the READING, not the
 * stores that wrote them), and a fake embedder and wiki reader with fixed
 * answers. Written out per file, the three would be three copies of the same
 * insert statements - and a copy that drifted would make one suite's fixture a
 * different document than another's.
 */

export const NOW = "2026-10-10T10:00:00.000Z";

/** A fresh database in a temp directory, migrated to the newest schema. */
export function tempDatabase(): { readonly db: NexusDatabase; readonly dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "nexus-knowledge-"));
  return { db: openDatabase({ path: join(dir, "profile.db") }), dir };
}

export function insertProfile(db: NexusDatabase, id = "p1"): string {
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", NOW);
  return id;
}

/**
 * One note with its compacted plaintext - the two rows migration 017's note
 * projection reads. The note first, because the snapshot's own trigger refreshes
 * the note's entry and there has to be a note for it to refresh.
 */
export function insertNote(
  db: NexusDatabase,
  input: {
    readonly id: string;
    readonly profileId: string;
    readonly title: string;
    readonly plaintext: string;
    readonly updatedAt?: string;
    readonly deletedAt?: string | null;
  },
): void {
  const at = input.updatedAt ?? NOW;
  db.raw
    .prepare(
      `INSERT INTO notes (id, profile_id, title, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(input.id, input.profileId, input.title, at, at, input.deletedAt ?? null);
  db.raw
    .prepare(
      `INSERT INTO note_snapshots (note_id, snapshot, plaintext, covered_seq, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(input.id, Buffer.from([0]), input.plaintext, 1, at);
}

export function insertTask(
  db: NexusDatabase,
  input: {
    readonly id: string;
    readonly profileId: string;
    readonly title: string;
    readonly description?: string;
    readonly updatedAt?: string;
    readonly deletedAt?: string | null;
  },
): void {
  const at = input.updatedAt ?? NOW;
  db.raw
    .prepare(
      `INSERT INTO tasks (id, profile_id, title, description, status, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, 'todo', ?, ?, ?)`,
    )
    .run(input.id, input.profileId, input.title, input.description ?? null, at, at, input.deletedAt ?? null);
}

export function insertEvent(
  db: NexusDatabase,
  input: {
    readonly id: string;
    readonly profileId: string;
    readonly title: string;
    readonly description?: string;
    readonly updatedAt?: string;
  },
): void {
  const at = input.updatedAt ?? NOW;
  db.raw
    .prepare(
      `INSERT INTO events (id, profile_id, title, description, start_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(input.id, input.profileId, input.title, input.description ?? null, at, at, at);
}

/** One note attachment whose text main already extracted (migration 048's column, written here directly). */
export function insertNoteAttachment(
  db: NexusDatabase,
  input: {
    readonly id: string;
    readonly noteId: string;
    readonly fileName: string;
    readonly text: string;
  },
): void {
  db.raw
    .prepare(
      `INSERT INTO note_attachments
         (id, note_id, file_name, mime, size_bytes, sha256, created_at, extracted_text)
       VALUES (?, ?, ?, 'text/plain', ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.noteId,
      input.fileName,
      Buffer.byteLength(input.text, "utf8") + 1,
      "0".repeat(64),
      NOW,
      input.text,
    );
}

/** A sealed private-vault row: the assistant must never see one, and this is the row that proves it. */
export function insertPrivateNote(db: NexusDatabase, id: string, profileId: string): void {
  db.raw
    .prepare(
      "INSERT INTO private_notes (id, profile_id, sealed, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(id, profileId, Buffer.from("sealed"), NOW, NOW);
}

/**
 * An embedder with FIXED vectors: the text is looked up in a table, and anything
 * not in it embeds to zeroes. Deterministic on purpose - a test that asserts a
 * ranking has to know what the vectors are.
 */
export function fixedEmbedder(
  vectors: Readonly<Record<string, readonly number[]>>,
  modelId = "fake-embed-small",
): Embedder {
  const dimensions = Object.values(vectors)[0]?.length ?? 0;
  return {
    modelId,
    dimensions,
    embed(texts: readonly string[]): Promise<Float32Array[]> {
      return Promise.resolve(
        texts.map((text) => {
          const values = vectors[text];
          return new Float32Array(values ?? new Array<number>(dimensions).fill(0));
        }),
      );
    },
  };
}

/** A wiki reader over a fixed table of articles, with titles answered in the order they were declared. */
export function fakeWiki(input: {
  readonly titles: readonly WikiTitle[];
  readonly articles: Readonly<Record<string, string>>;
}): WikiSource {
  return {
    searchTitles: (): Promise<readonly WikiTitle[]> => Promise.resolve(input.titles),
    readArticle: (path: string): Promise<string> => Promise.resolve(input.articles[path] ?? ""),
  };
}
