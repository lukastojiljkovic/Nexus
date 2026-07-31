import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";

import { mergeNoteState } from "@nexus/core";
import {
  CardStore,
  DeckStore,
  NexusDatabase,
  NoteAttachmentStore,
  NoteNotFoundError,
  NoteOrgStore,
  NoteStore,
  SubjectStore,
  openDatabase,
  uuidv7,
} from "@nexus/db";
import type { NoteMeta } from "@nexus/db";

import { duplicateNote, NOTE_COPY_SUFFIX } from "./noteDuplicate.js";
import type { NoteDuplicateDeps } from "./noteDuplicate.js";

/**
 * The whole „Dupliraj belešku" operation (NOTE-010) over REAL stores on a real
 * database — the copy's value is entirely in which rows it does and does not
 * write, so a doubled store would test nothing worth testing here. Only the
 * Electron shell is absent.
 */

let dir: string;
let db: NexusDatabase;
let profileId: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nexus-note-duplicate-"));
  db = openDatabase({ path: join(dir, "notes.db") });
  profileId = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(profileId, "personal", "Test", new Date().toISOString());
});

afterEach(async () => {
  db.close();
  await rm(dir, { recursive: true, force: true });
});

function stores(): {
  notes: NoteStore;
  org: NoteOrgStore;
  attachments: NoteAttachmentStore;
} {
  return {
    notes: new NoteStore(db.raw, profileId),
    org: new NoteOrgStore(db.raw, profileId),
    attachments: new NoteAttachmentStore(db.raw, profileId),
  };
}

/** The deps `main/index.ts` builds for this channel, minus Electron: real stores, a real transaction. */
function makeDeps(): NoteDuplicateDeps {
  return { ...stores(), runInTransaction: (write) => db.raw.transaction(write)() };
}

function now(): string {
  return new Date().toISOString();
}

/** A note carrying `build`'s document, created the way the editor creates one. */
function seedNote(build: (fragment: Y.XmlFragment) => void, title: string): NoteMeta {
  const { notes } = stores();
  const note = notes.create(now());
  const doc = new Y.Doc();
  build(doc.getXmlFragment("default"));
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  notes.appendUpdate(note.id, update, title, now());
  return note;
}

/** One note's merged document, as the app itself reads it. */
function documentOf(noteId: string): { snapshot: Uint8Array; plaintext: string } {
  const read = stores().notes.readForCompaction(noteId);
  return mergeNoteState(
    read.snapshot,
    read.updates.map((update) => update.bytes),
  );
}

function stateOf(noteId: string): Uint8Array {
  return documentOf(noteId).snapshot;
}

/** Every value of one attribute in a note's document, in document order. */
function attributesOf(noteId: string, attribute: string): string[] {
  const values: string[] = [];
  const doc = new Y.Doc();
  Y.applyUpdate(doc, stateOf(noteId));
  const walk = (node: Y.XmlElement | Y.XmlText | Y.XmlHook): void => {
    if (!(node instanceof Y.XmlElement)) return;
    const value = node.getAttribute(attribute);
    if (typeof value === "string") values.push(value);
    for (const child of node.toArray()) walk(child);
  };
  for (const child of doc.getXmlFragment("default").toArray()) walk(child);
  doc.destroy();
  return values;
}

/** A block carrying text and, optionally, an ADR-017 card key. */
function block(nodeName: string, text: string, cardKey?: string): Y.XmlElement {
  const element = new Y.XmlElement(nodeName);
  element.insert(0, [new Y.XmlText(text)]);
  if (cardKey !== undefined) element.setAttribute("cardKey", cardKey);
  return element;
}

function noteLink(noteId: string): Y.XmlElement {
  const link = new Y.XmlElement("noteLink");
  link.setAttribute("noteId", noteId);
  return link;
}

function attachmentImage(attachmentId: string): Y.XmlElement {
  const image = new Y.XmlElement("attachmentImage");
  image.setAttribute("attachmentId", attachmentId);
  return image;
}

/** Registers an attachment row on `noteId` for bytes nothing has to actually store here. */
function addAttachment(noteId: string, fileName: string, content: string): string {
  const bytes = Buffer.from(content, "utf8");
  const { attachments } = stores();
  return attachments.add(
    noteId,
    {
      fileName,
      mime: "image/png",
      sizeBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
    now(),
  ).id;
}

/** The `ok: true` branch or a failed test — every assertion below wants the copy itself. */
function duplicateOrFail(noteId: string): NoteMeta {
  const result = duplicateNote(makeDeps(), noteId, now());
  if (!result.ok) throw new Error(`Expected a copy, got a refusal: ${result.reason}`);
  return result.note;
}

describe("duplicateNote — the document", () => {
  it("copies the text and marks the copy's title", () => {
    const source = seedNote((fragment) => {
      fragment.push([block("heading", "Sastanak"), block("paragraph", "Dogovoreno je sve.")]);
    }, "Sastanak");

    const copy = duplicateOrFail(source.id);

    expect(copy.id).not.toBe(source.id);
    expect(copy.title).toBe(`Sastanak${NOTE_COPY_SUFFIX}`);
    // Stored, not merely derivable: `compactNow` ran, so the copy is in the
    // search index from the moment it lands (ADR-021 / SRCH-002).
    expect(stores().notes.storedPlaintext(copy.id)).toBe(
      `Sastanak${NOTE_COPY_SUFFIX}\nDogovoreno je sve.`,
    );
    // The original is untouched by its own copy — including its own snapshot,
    // which a duplicate has no business compacting.
    expect(documentOf(source.id).plaintext).toBe("Sastanak\nDogovoreno je sve.");
    expect(stores().notes.storedPlaintext(source.id)).toBeNull();
  });

  it("re-mints every card key, sharing none with the original", () => {
    const source = seedNote((fragment) => {
      fragment.push([
        block("heading", "Gradivo"),
        block("paragraph", "Glavni grad Srbije :: Beograd", "key-a"),
        block("paragraph", "Najduža reka :: Dunav", "key-b"),
      ]);
    }, "Gradivo");

    const copy = duplicateOrFail(source.id);

    const sourceKeys = attributesOf(source.id, "cardKey");
    const copyKeys = attributesOf(copy.id, "cardKey");
    expect(sourceKeys).toEqual(["key-a", "key-b"]);
    expect(copyKeys).toHaveLength(2);
    expect(new Set(copyKeys).size).toBe(2);
    expect(copyKeys.some((key) => sourceKeys.includes(key))).toBe(false);
  });

  it("repoints a self-link at the copy and leaves a link to another note alone", () => {
    const other = seedNote((fragment) => {
      fragment.push([block("paragraph", "Druga")]);
    }, "Druga");
    const source = seedNote((fragment) => {
      fragment.push([block("paragraph", "Naslov")]);
    }, "Naslov");
    // The self-link can only be written once the note's own id exists, so it
    // arrives as a second update — exactly how the editor would write one.
    const withLinks = new Y.Doc();
    Y.applyUpdate(withLinks, stateOf(source.id));
    const paragraph = new Y.XmlElement("paragraph");
    withLinks.getXmlFragment("default").push([paragraph]);
    paragraph.insert(0, [noteLink(source.id), noteLink(other.id)]);
    const update = Y.encodeStateAsUpdate(withLinks);
    withLinks.destroy();
    stores().notes.appendUpdate(source.id, update, "Naslov", now());

    const copy = duplicateOrFail(source.id);

    expect(attributesOf(copy.id, "noteId")).toEqual([copy.id, other.id]);
    expect(attributesOf(source.id, "noteId")).toEqual([source.id, other.id]);
  });
});

describe("duplicateNote — attachments", () => {
  it("gives the copy its own rows, pointed at the same blobs, and rewrites the document onto them", () => {
    const source = seedNote((fragment) => {
      fragment.push([block("heading", "Sa slikom")]);
    }, "Sa slikom");
    const attachmentId = addAttachment(source.id, "slika.png", "bajtovi");
    const withImage = new Y.Doc();
    Y.applyUpdate(withImage, stateOf(source.id));
    withImage.getXmlFragment("default").push([attachmentImage(attachmentId)]);
    const update = Y.encodeStateAsUpdate(withImage);
    withImage.destroy();
    stores().notes.appendUpdate(source.id, update, "Sa slikom", now());

    const copy = duplicateOrFail(source.id);

    const { attachments } = stores();
    const sourceRows = attachments.list(source.id);
    const copyRows = attachments.list(copy.id);
    expect(copyRows).toHaveLength(1);
    expect(copyRows[0]?.id).not.toBe(sourceRows[0]?.id);
    expect(copyRows[0]?.sha256).toBe(sourceRows[0]?.sha256);
    expect(copyRows[0]?.fileName).toBe("slika.png");
    // The copy's document names the COPY's row, not the original's — the image
    // node resolves through the live per-note list, so a kept id would render
    // as a missing attachment.
    expect(attributesOf(copy.id, "attachmentId")).toEqual([copyRows[0]?.id]);
    expect(attributesOf(source.id, "attachmentId")).toEqual([attachmentId]);
  });

  it("leaves the original's blob referenced when the copy's attachment is removed", () => {
    const source = seedNote((fragment) => {
      fragment.push([block("heading", "Sa slikom")]);
    }, "Sa slikom");
    addAttachment(source.id, "slika.png", "bajtovi");

    const copy = duplicateOrFail(source.id);

    const { attachments } = stores();
    const sha256 = attachments.list(copy.id)[0]?.sha256 ?? "";
    expect(attachments.refCount(sha256)).toBe(2);

    const removed = attachments.remove(copy.id, attachments.list(copy.id)[0]?.id ?? "");
    // Still referenced by the original, so main's GC (which deletes only at a
    // count of zero) leaves the file exactly where it is.
    expect(attachments.refCount(removed.sha256)).toBe(1);
    expect(attachments.list(source.id)).toHaveLength(1);
  });
});

describe("duplicateNote — organization", () => {
  it("keeps the folder and every tag", () => {
    const { notes, org } = stores();
    const folder = org.createFolder({ parentId: null, name: "Fakultet", color: null }, now());
    const posao = org.createTag("posao", now());
    const hitno = org.createTag("hitno", now());
    const source = seedNote((fragment) => {
      fragment.push([block("heading", "Plan")]);
    }, "Plan");
    notes.setFolder(source.id, folder.id);
    org.attachTag(source.id, posao.id);
    org.attachTag(source.id, hitno.id);

    const copy = duplicateOrFail(source.id);

    expect(copy.folderId).toBe(folder.id);
    const copyTags = org
      .listTagLinks()
      .filter((link) => link.noteId === copy.id)
      .map((link) => link.tagId)
      .sort();
    expect(copyTags).toEqual([posao.id, hitno.id].sort());
  });

  // NOTE-002's third axis: a copy of a sastanak is a sastanak.
  it("keeps the category, and returns it on the copy's own meta", () => {
    const { notes, org } = stores();
    const category = org.createCategory({ name: "sastanak", color: "zlato" }, now());
    const source = seedNote((fragment) => {
      fragment.push([block("heading", "Zapisnik")]);
    }, "Zapisnik");
    notes.setCategory(source.id, category.id);

    const copy = duplicateOrFail(source.id);

    expect(copy.categoryId).toBe(category.id);
    expect(notes.list().find((note) => note.id === copy.id)?.categoryId).toBe(category.id);
  });

  it("leaves an uncategorized note's copy uncategorized", () => {
    const source = seedNote((fragment) => {
      fragment.push([block("heading", "Bez vrste")]);
    }, "Bez vrste");

    expect(duplicateOrFail(source.id).categoryId).toBeNull();
  });

  it("never copies the pin — a pin is a curation decision about one row", () => {
    const { notes } = stores();
    const source = seedNote((fragment) => {
      fragment.push([block("heading", "Zakačena")]);
    }, "Zakačena");
    notes.setPinned(source.id, true);

    const copy = duplicateOrFail(source.id);

    expect(copy.pinned).toBe(false);
    expect(notes.list().find((note) => note.id === copy.id)?.pinned).toBe(false);
  });

  it("leaves the copy unmapped from the source's deck, so no cards are silently minted", () => {
    const { notes } = stores();
    const subject = new SubjectStore(db.raw, profileId).create({ name: "Matematika" });
    const deck = new DeckStore(db.raw, profileId).create({ subjectId: subject.id, name: "Osnovno" });
    const source = seedNote((fragment) => {
      fragment.push([block("heading", "Gradivo"), block("paragraph", "Pitanje :: odgovor", "key-a")]);
    }, "Gradivo");
    notes.setCardDeck(source.id, deck.id, now());
    const cards = new CardStore(db.raw, profileId);
    cards.syncFromNote(
      source.id,
      deck.id,
      [{ key: "key-a", front: "Pitanje", back: "odgovor", kind: "basic", clozeText: null, clozeOrdinal: null }],
      now(),
    );

    const copy = duplicateOrFail(source.id);

    expect(copy.cardDeckId).toBeNull();
    expect(notes.list().find((note) => note.id === copy.id)?.cardDeckId).toBeNull();
    // The original's card is the only one in the deck: a duplicate mints none.
    expect(cards.countCardsOfNote(source.id)).toBe(1);
    expect(cards.countCardsOfNote(copy.id)).toBe(0);
  });
});

describe("duplicateNote — history and lifecycle", () => {
  it("gives the copy its own first checkpoint and none of the original's history", () => {
    const source = seedNote((fragment) => {
      fragment.push([block("heading", "Istorija")]);
    }, "Istorija");
    // The original earns a checkpoint of its own first.
    duplicateOrFail(source.id);

    const copy = duplicateOrFail(source.id);

    const versions = stores().notes.listVersions(copy.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]?.coveredSeq).toBe(1);
    expect(versions[0]?.title).toBe(`Istorija${NOTE_COPY_SUFFIX}`);
  });

  it("duplicates a note that has no document state yet", () => {
    const { notes } = stores();
    const source = notes.create(now());

    const copy = duplicateOrFail(source.id);

    expect(copy.title).toBe("");
    expect(notes.list()).toHaveLength(2);
  });

  it("refuses a note that is not an active note of this profile", () => {
    const { notes } = stores();
    const source = seedNote((fragment) => {
      fragment.push([block("heading", "Obrisana")]);
    }, "Obrisana");
    notes.softDelete(source.id, now());

    expect(() => duplicateNote(makeDeps(), source.id, now())).toThrow(NoteNotFoundError);
    expect(() => duplicateNote(makeDeps(), uuidv7(), now())).toThrow(NoteNotFoundError);
  });

  it("refuses a document too large for one append, leaving nothing behind", () => {
    const { notes, attachments } = stores();
    const source = notes.create(now());
    const doc = new Y.Doc();
    doc.getXmlFragment("default").push([block("paragraph", "N".repeat(150_000))]);
    const first = Y.encodeStateAsUpdate(doc);
    const stateVector = Y.encodeStateVector(doc);
    doc.getXmlFragment("default").push([block("paragraph", "D".repeat(150_000))]);
    const second = Y.encodeStateAsUpdate(doc, stateVector);
    doc.destroy();
    notes.appendUpdate(source.id, first, "Velika", now());
    notes.appendUpdate(source.id, second, "Velika", now());
    addAttachment(source.id, "slika.png", "bajtovi");

    const result = duplicateNote(makeDeps(), source.id, now());

    expect(result).toEqual({ ok: false, reason: "too-large" });
    // One transaction: no half-made note, and no attachment row orphaned onto it.
    expect(notes.list()).toHaveLength(1);
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM note_attachments").get() as { n: number }).n,
    ).toBe(1);
    expect(attachments.list(source.id)).toHaveLength(1);
  });
});
