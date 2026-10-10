import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import type { KnowledgeHit, KnowledgeQuery, SourceKind } from "@nexus/core";
import type { NexusDatabase } from "@nexus/db";
import { createKnowledgeService } from "./index.js";
import type { ManualPage } from "./types.js";
import {
  NOW,
  fixedEmbedder,
  insertNote,
  insertProfile,
  insertTask,
  tempDatabase,
} from "./testFixtures.js";

const LATER = "2026-10-10T11:00:00.000Z";
const NEVER = new AbortController().signal;

const MANUAL: readonly ManualPage[] = [
  {
    path: "assistant/manual/sr/podesavanja.md",
    text: ["---", "id: podesavanja", "title: Podesavanja", "location: { module: settings }", "---", "# Podesavanja", "", "Ovde se bira sta je ukljuceno."].join("\n"),
  },
  {
    path: "assistant/manual/en/settings.md",
    text: ["---", "id: settings", "title: Settings", "location: { module: settings }", "---", "# Settings", "", "Here you choose what is on."].join("\n"),
  },
];

const query = (text: string, extra: Partial<KnowledgeQuery> = {}): KnowledgeQuery => ({
  text,
  limit: 10,
  locale: "sr",
  ...extra,
});

const ids = (hits: readonly KnowledgeHit[]): string[] =>
  hits.map((hit) => `${hit.citation.kind}:${hit.citation.id}`);

let db: NexusDatabase;
let dir: string;
let profileId: string;
let profileCount = 0;

beforeAll(() => {
  const created = tempDatabase();
  db = created.db;
  dir = created.dir;
});

beforeEach(() => {
  // One database for the whole file and one fresh PROFILE per case: opening a
  // migrated encrypted file per test would make this suite measure the
  // migration runner rather than the service, and nothing in these cases reads
  // another profile's rows.
  profileCount += 1;
  profileId = insertProfile(db, `p${String(profileCount)}`);
});

afterEach(() => {
  // The records those cases wrote go, so `n1` is a free id again in the next
  // one. Hard deletes: what they leave in a former profile's knowledge rows is
  // invisible to a search that is scoped by profile id.
  db.raw.exec("DELETE FROM notes; DELETE FROM tasks; DELETE FROM events;");
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function service(options: { readonly embedder?: () => Promise<ReturnType<typeof fixedEmbedder> | null> } = {}) {
  return createKnowledgeService({
    profileId,
    db: db.raw,
    userData: dir,
    packPublicKeyPem: null,
    manualPages: MANUAL,
    embedder: options.embedder ?? (() => Promise.resolve(null)),
    autoIndex: false,
  });
}

describe("createKnowledgeService", () => {
  it("indexes the sources and reports what it indexed", async () => {
    insertNote(db, { id: "n1", profileId, title: "Kupovina", plaintext: "Mleko, hleb i jaja." });
    insertTask(db, { id: "t1", profileId, title: "Racun", description: "Struja za oktobar" });
    const svc = service();

    // Five sources: the manual, the three record kinds and attachment text.
    // No packs (no release key) and no wiki (no reader configured).
    expect(await svc.status()).toEqual({ indexedChunks: 0, pendingSources: 5, embedderId: null });

    await svc.sync(NEVER);

    const status = await svc.status();
    // Two manual pages, one note, one task: four passages, one each.
    expect(status).toEqual({ indexedChunks: 4, pendingSources: 0, embedderId: null });
  });

  it("retrieves a note by its words, with the citation that opens it", async () => {
    insertNote(db, { id: "n1", profileId, title: "Kupovina", plaintext: "Mleko, hleb i jaja." });
    const svc = service();
    await svc.sync(NEVER);

    const hits = await svc.search(query("mleko"), NEVER);

    expect(ids(hits)).toEqual(["note:n1"]);
    expect(hits[0]?.citation).toEqual({ kind: "note", id: "n1", title: "Kupovina" });
    expect(hits[0]?.text).toBe("Mleko, hleb i jaja.");
    // Reciprocal rank fusion of a single list: 1 / (60 + 1).
    expect(hits[0]?.score).toBeCloseTo(1 / 61, 12);
  });

  it("answers in the language the query is in - the manual is indexed in both", async () => {
    const svc = service();
    await svc.sync(NEVER);

    const serbian = await svc.search(query("ukljuceno", { kinds: ["app-manual"] }), NEVER);
    const english = await svc.search(query("choose", { kinds: ["app-manual"], locale: "en" }), NEVER);

    expect(ids(serbian)).toEqual(["app-manual:sr/podesavanja"]);
    expect(ids(english)).toEqual(["app-manual:en/settings"]);
    expect(serbian[0]?.citation.location).toEqual({ module: "settings" });
    expect(serbian[0]?.citation.locator).toBe("Podesavanja");
  });

  it("finds a passage from a whole question, through the one term they share", async () => {
    insertNote(db, {
      id: "n1",
      profileId,
      title: "Moduli",
      plaintext: "Modul se iskljucuje u podesavanjima.",
    });
    const svc = service();
    await svc.sync(NEVER);

    // Not one word of the question appears in the passage in that form:
    // `iskljuciti` is not `iskljucuje`. The terms are ORed (query.ts), so the one
    // term they share is enough to retrieve it - an AND over a sentence would
    // return nothing here, and an assistant that finds nothing answers from the
    // model's memory instead of from the user's own material.
    const hits = await svc.search(query("kako iskljuciti modul"), NEVER);

    expect(ids(hits)).toEqual(["note:n1"]);
    expect(hits[0]?.text).toBe("Modul se iskljucuje u podesavanjima.");
  });

  it("filters by kind, and returns nothing for a query with no searchable words", async () => {
    insertNote(db, { id: "n1", profileId, title: "Kupovina", plaintext: "Mleko i hleb." });
    const svc = service();
    await svc.sync(NEVER);

    expect(ids(await svc.search(query("hleb", { kinds: ["task"] }), NEVER))).toEqual([]);
    // A kind this build does not index narrows to nothing, never to everything.
    expect(await svc.search(query("hleb", { kinds: ["elsewhere" as SourceKind] }), NEVER)).toEqual([]);
    expect(await svc.search(query("..."), NEVER)).toEqual([]);
    expect(await svc.search(query("hleb", { limit: 0 }), NEVER)).toEqual([]);
  });

  it("never surfaces the private vault", async () => {
    insertNote(db, { id: "public", profileId, title: "Javna", plaintext: "Vidljivo svima." });
    db.raw
      .prepare(
        "INSERT INTO private_notes (id, profile_id, sealed, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("sealed", profileId, Buffer.from("tajno"), NOW, NOW);
    const svc = service();
    await svc.sync(NEVER);

    const hits = await svc.search(query("vidljivo"), NEVER);
    expect(ids(hits)).toEqual(["note:public"]);
    // And the sealed row is not in the index in any form.
    const stored = db.raw
      .prepare("SELECT count(*) AS n FROM knowledge_chunks WHERE profile_id = ? AND kind = 'note'")
      .get(profileId) as { n: number };
    expect(stored.n).toBe(1);
  });

  it("re-indexes an edited note and forgets the text it no longer says", async () => {
    insertNote(db, { id: "n1", profileId, title: "Kupovina", plaintext: "Staro: mleko i hleb." });
    const svc = service();
    await svc.sync(NEVER);
    expect(ids(await svc.search(query("staro"), NEVER))).toEqual(["note:n1"]);

    db.raw
      .prepare("UPDATE note_snapshots SET plaintext = ?, updated_at = ? WHERE note_id = 'n1'")
      .run("Novo: jogurt i sir.", LATER);
    db.raw.prepare("UPDATE notes SET updated_at = ? WHERE id = 'n1'").run(LATER);
    await svc.sync(NEVER);

    expect(await svc.search(query("staro"), NEVER)).toEqual([]);
    const hits = await svc.search(query("jogurt"), NEVER);
    expect(ids(hits)).toEqual(["note:n1"]);
    expect(hits[0]?.text).toBe("Novo: jogurt i sir.");
  });

  it("drops a deleted note out of the index", async () => {
    insertNote(db, { id: "n1", profileId, title: "Kupovina", plaintext: "Mleko i hleb." });
    insertNote(db, { id: "n2", profileId, title: "Posao", plaintext: "Mleko za kafu u kancelariji." });
    const svc = service();
    await svc.sync(NEVER);
    expect(ids(await svc.search(query("mleko"), NEVER)).sort()).toEqual(["note:n1", "note:n2"]);

    // A soft delete: migration 017's triggers take the note's row out of
    // `search_entries` the same moment, and the pass prunes against that table.
    db.raw.prepare("UPDATE notes SET deleted_at = ?, updated_at = ? WHERE id = 'n1'").run(LATER, LATER);
    await svc.sync(NEVER);

    expect(ids(await svc.search(query("mleko"), NEVER))).toEqual(["note:n2"]);
    const stored = db.raw
      .prepare(
        "SELECT count(*) AS n FROM knowledge_chunks WHERE profile_id = ? AND kind = 'note' AND source_id = 'n1'",
      )
      .get(profileId) as { n: number };
    expect(stored.n).toBe(0);
  });

  it("finds a passage by vector alone when the words do not overlap", async () => {
    insertNote(db, { id: "n1", profileId, title: "Ponasanje", plaintext: "Pravila ponasanja u prirodi." });
    // A fixed embedder: the passage and the question land on the same axis, and
    // the question shares no term with the passage.
    const embedder = fixedEmbedder({
      "Pravila ponasanja u prirodi.": [1, 0],
      "kako postupiti napolju": [1, 0],
    });
    const svc = service({ embedder: () => Promise.resolve(embedder) });
    await svc.sync(NEVER);

    // No term of the question appears in any indexed passage, so the text list
    // is empty and the vector list is the whole answer.
    const hits = await svc.search(query("kako postupiti napolju"), NEVER);

    expect(ids(hits)).toEqual(["note:n1"]);
    expect(hits[0]?.text).toBe("Pravila ponasanja u prirodi.");
    expect((await svc.status()).embedderId).toBe("fake-embed-small");
  });

  it("scores a passage the text search AND the vectors both found above either alone", async () => {
    insertNote(db, { id: "both", profileId, title: "Mleko", plaintext: "Mleko i hleb." });
    const embedder = fixedEmbedder({
      "Mleko i hleb.": [1, 0],
      "mleko": [1, 0],
    });
    const svc = service({ embedder: () => Promise.resolve(embedder) });
    await svc.sync(NEVER);

    const hits = await svc.search(query("mleko"), NEVER);

    // The one passage is rank 1 of the text list and rank 1 of the vector list,
    // so it carries 1/61 + 1/61. The manual's passages embed to zero and are
    // dropped by the vector floor, which is what keeps one query from returning
    // every passage in the corpus at the bottom of the list.
    expect(ids(hits)).toEqual(["note:both"]);
    expect(hits[0]?.score).toBeCloseTo(2 / 61, 12);
  });

  it("rebuilds everything on reindex", async () => {
    insertNote(db, { id: "n1", profileId, title: "Kupovina", plaintext: "Mleko i hleb." });
    const svc = service();
    await svc.sync(NEVER);
    const before = await svc.status();

    await svc.reindex(NEVER);

    expect(await svc.status()).toEqual(before);
    expect(ids(await svc.search(query("hleb"), NEVER))).toEqual(["note:n1"]);
  });

  it("does nothing at all while the profile's database is locked, and stops a pass mid-flight", async () => {
    insertNote(db, { id: "n1", profileId, title: "Kupovina", plaintext: "Mleko i hleb." });
    const svc = createKnowledgeService({
      profileId,
      db: db.raw,
      userData: dir,
      packPublicKeyPem: null,
      manualPages: MANUAL,
      embedder: () => Promise.resolve(null),
      autoIndex: false,
      isSessionLive: () => false,
    });

    await svc.sync(NEVER);

    expect(await svc.status()).toEqual({ indexedChunks: 0, pendingSources: 5, embedderId: null });
  });

  it("does nothing with an already-aborted signal", async () => {
    insertNote(db, { id: "n1", profileId, title: "Kupovina", plaintext: "Mleko i hleb." });
    const svc = service();
    const aborted = new AbortController();
    aborted.abort();

    await svc.sync(aborted.signal);

    expect((await svc.status()).indexedChunks).toBe(0);
  });

  it("starts a pass of its own when autoIndex is left on", async () => {
    insertNote(db, { id: "n1", profileId, title: "Kupovina", plaintext: "Mleko i hleb." });
    const svc = createKnowledgeService({
      profileId,
      db: db.raw,
      userData: dir,
      packPublicKeyPem: null,
      manualPages: MANUAL,
      embedder: () => Promise.resolve(null),
    });

    // No `sync` call anywhere: the pass is background work the module starts.
    const deadline = Date.now() + 5_000;
    while ((await svc.status()).indexedChunks < 3 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(await svc.status()).toEqual({ indexedChunks: 3, pendingSources: 0, embedderId: null });
  });
});
