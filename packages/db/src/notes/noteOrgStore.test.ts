import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NexusDatabase,
  NoteFolderNotFoundError,
  NoteFolderValidationError,
  NoteNotFoundError,
  NoteOrgStore,
  NoteStore,
  NoteTagNotFoundError,
  NoteTagValidationError,
  NoteTemplateStore,
  openDatabase,
  uuidv7,
} from "../index.js";

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-note-org-"));
  db = openDatabase({ path: join(dir, "note-org.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function createProfile(): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", new Date().toISOString());
  return id;
}

interface Fixture {
  org: NoteOrgStore;
  notes: NoteStore;
  /** Only the folder-preference suites need it (ADR-036): a folder's default template may name a stored row. */
  templates: NoteTemplateStore;
  profileId: string;
}

function fixture(): Fixture {
  const profileId = createProfile();
  return {
    org: new NoteOrgStore(db.raw, profileId),
    notes: new NoteStore(db.raw, profileId),
    templates: new NoteTemplateStore(db.raw, profileId),
    profileId,
  };
}

const T0 = "2026-07-13T10:00:00.000Z";
const T1 = "2026-07-13T10:01:00.000Z";
const T2 = "2026-07-13T10:02:00.000Z";
const T3 = "2026-07-13T10:03:00.000Z";

describe("NoteOrgStore — folders", () => {
  it("creates a folder with a validated name and colour", () => {
    const { org } = fixture();
    const folder = org.createFolder({ parentId: null, name: "  Posao  ", color: "zlato" }, T0);

    expect(folder.name).toBe("Posao"); // trimmed
    expect(folder.color).toBe("zlato");
    expect(folder.parentId).toBeNull();
    expect(folder.createdAt).toBe(T0);
    expect(folder.updatedAt).toBe(T0);
    expect(org.listFolders().map((f) => f.id)).toEqual([folder.id]);
  });

  it("accepts a null colour", () => {
    const { org } = fixture();
    const folder = org.createFolder({ parentId: null, name: "Bez boje", color: null }, T0);
    expect(folder.color).toBeNull();
  });

  it("rejects an empty or over-100-character name", () => {
    const { org } = fixture();
    expect(() => org.createFolder({ parentId: null, name: "   ", color: null }, T0)).toThrow(
      NoteFolderValidationError,
    );
    expect(() =>
      org.createFolder({ parentId: null, name: "x".repeat(101), color: null }, T0),
    ).toThrow(NoteFolderValidationError);
    expect(() =>
      org.createFolder({ parentId: null, name: "x".repeat(100), color: null }, T0),
    ).not.toThrow();
  });

  it("rejects a colour outside the closed palette", () => {
    const { org } = fixture();
    expect(() =>
      org.createFolder({ parentId: null, name: "X", color: "plava" as never }, T0),
    ).toThrow(NoteFolderValidationError);
  });

  it("rejects a malformed now", () => {
    const { org } = fixture();
    expect(() => org.createFolder({ parentId: null, name: "X", color: null }, "nope")).toThrow(
      NoteFolderValidationError,
    );
  });

  it("nests a folder under an existing parent and rejects an unknown parent", () => {
    const { org } = fixture();
    const parent = org.createFolder({ parentId: null, name: "Root", color: null }, T0);
    const child = org.createFolder({ parentId: parent.id, name: "Child", color: null }, T1);
    expect(child.parentId).toBe(parent.id);

    expect(() =>
      org.createFolder({ parentId: "no-such", name: "Orphan", color: null }, T2),
    ).toThrow(NoteFolderNotFoundError);
  });

  it("rejects a parent owned by another profile", () => {
    const a = fixture();
    const b = fixture();
    const foreignParent = a.org.createFolder({ parentId: null, name: "A", color: null }, T0);
    expect(() =>
      b.org.createFolder({ parentId: foreignParent.id, name: "B", color: null }, T1),
    ).toThrow(NoteFolderNotFoundError);
  });

  it("updateFolder renames without touching the colour", () => {
    const { org } = fixture();
    const folder = org.createFolder({ parentId: null, name: "Staro", color: "zlato" }, T0);

    org.updateFolder(folder.id, { name: "Novo" }, T1);
    const stored = org.listFolders()[0];
    expect(stored?.name).toBe("Novo");
    expect(stored?.color).toBe("zlato"); // colour survives an omitted key
    expect(stored?.updatedAt).toBe(T1);
  });

  it("updateFolder recolours without touching the name", () => {
    const { org } = fixture();
    const folder = org.createFolder({ parentId: null, name: "Ime", color: "zlato" }, T0);

    org.updateFolder(folder.id, { color: "ruza" }, T1);
    const stored = org.listFolders()[0];
    expect(stored?.name).toBe("Ime");
    expect(stored?.color).toBe("ruza");
  });

  it("updateFolder clears the colour with an explicit null", () => {
    const { org } = fixture();
    const folder = org.createFolder({ parentId: null, name: "Ime", color: "zlato" }, T0);

    org.updateFolder(folder.id, { color: null }, T1);
    expect(org.listFolders()[0]?.color).toBeNull();
  });

  it("updateFolder validates the provided name and colour and requires the folder", () => {
    const { org } = fixture();
    const folder = org.createFolder({ parentId: null, name: "Ime", color: null }, T0);
    expect(() => org.updateFolder(folder.id, { name: "  " }, T1)).toThrow(
      NoteFolderValidationError,
    );
    expect(() => org.updateFolder(folder.id, { color: "plava" as never }, T1)).toThrow(
      NoteFolderValidationError,
    );
    expect(() => org.updateFolder("missing", { name: "X" }, T1)).toThrow(
      NoteFolderNotFoundError,
    );
  });

  it("moveFolder reparents a folder and can move it to the root", () => {
    const { org } = fixture();
    const a = org.createFolder({ parentId: null, name: "A", color: null }, T0);
    const b = org.createFolder({ parentId: null, name: "B", color: null }, T0);
    const c = org.createFolder({ parentId: a.id, name: "C", color: null }, T0);

    org.moveFolder(c.id, b.id, T1);
    expect(org.listFolders().find((f) => f.id === c.id)?.parentId).toBe(b.id);

    org.moveFolder(c.id, null, T2);
    expect(org.listFolders().find((f) => f.id === c.id)?.parentId).toBeNull();
  });

  it("moveFolder rejects moving a folder into itself", () => {
    const { org } = fixture();
    const a = org.createFolder({ parentId: null, name: "A", color: null }, T0);
    expect(() => org.moveFolder(a.id, a.id, T1)).toThrow(NoteFolderValidationError);
  });

  it("moveFolder rejects moving a folder into its own descendant", () => {
    const { org } = fixture();
    const a = org.createFolder({ parentId: null, name: "A", color: null }, T0);
    const b = org.createFolder({ parentId: a.id, name: "B", color: null }, T0);
    const c = org.createFolder({ parentId: b.id, name: "C", color: null }, T0);

    expect(() => org.moveFolder(a.id, c.id, T1)).toThrow(NoteFolderValidationError);
    expect(() => org.moveFolder(a.id, b.id, T1)).toThrow(NoteFolderValidationError);
  });

  it("moveFolder requires the folder and an existing new parent in this profile", () => {
    const a = fixture();
    const b = fixture();
    const folderA = a.org.createFolder({ parentId: null, name: "A", color: null }, T0);
    const folderB = b.org.createFolder({ parentId: null, name: "B", color: null }, T0);

    expect(() => a.org.moveFolder("missing", null, T1)).toThrow(NoteFolderNotFoundError);
    expect(() => a.org.moveFolder(folderA.id, "no-such", T1)).toThrow(NoteFolderNotFoundError);
    // the new parent must be in THIS profile.
    expect(() => a.org.moveFolder(folderA.id, folderB.id, T1)).toThrow(NoteFolderNotFoundError);
  });

  it("deleteFolder promotes child folders and notes to the grandparent, losing nothing", () => {
    const { org, notes } = fixture();
    const a = org.createFolder({ parentId: null, name: "A", color: null }, T0);
    const b = org.createFolder({ parentId: a.id, name: "B", color: null }, T0);
    const c = org.createFolder({ parentId: b.id, name: "C", color: null }, T0);
    const note = notes.create(T0);
    notes.setFolder(note.id, b.id);

    org.deleteFolder(b.id, T1);

    // B is gone; its child folder and note both promoted to A.
    const folders = org.listFolders();
    expect(folders.map((f) => f.id).sort()).toEqual([a.id, c.id].sort());
    expect(folders.find((f) => f.id === c.id)?.parentId).toBe(a.id);
    expect(notes.list().find((n) => n.id === note.id)?.folderId).toBe(a.id);
    // promotion is organizational — the note's content timestamp is untouched.
    expect(notes.list().find((n) => n.id === note.id)?.updatedAt).toBe(T0);
  });

  it("deleteFolder of a root folder promotes its children and notes to the root", () => {
    const { org, notes } = fixture();
    const root = org.createFolder({ parentId: null, name: "Root", color: null }, T0);
    const child = org.createFolder({ parentId: root.id, name: "Child", color: null }, T0);
    const note = notes.create(T0);
    notes.setFolder(note.id, root.id);

    org.deleteFolder(root.id, T1);

    expect(org.listFolders().find((f) => f.id === child.id)?.parentId).toBeNull();
    expect(notes.list().find((n) => n.id === note.id)?.folderId).toBeNull();
  });

  it("deleteFolder requires the folder in this profile", () => {
    const { org } = fixture();
    expect(() => org.deleteFolder("missing", T1)).toThrow(NoteFolderNotFoundError);
  });
});

describe("NoteOrgStore — tags", () => {
  it("createTag trims and is get-or-create for an existing name", () => {
    const { org } = fixture();
    const first = org.createTag("  važno  ", T0);
    expect(first.name).toBe("važno");

    const again = org.createTag("važno", T1);
    expect(again.id).toBe(first.id); // same trimmed name -> same tag
    expect(org.listTags()).toHaveLength(1);
  });

  it("createTag rejects an empty or over-50-character name and a malformed now", () => {
    const { org } = fixture();
    expect(() => org.createTag("   ", T0)).toThrow(NoteTagValidationError);
    expect(() => org.createTag("x".repeat(51), T0)).toThrow(NoteTagValidationError);
    expect(() => org.createTag("x".repeat(50), T0)).not.toThrow();
    expect(() => org.createTag("ok", "nope")).toThrow(NoteTagValidationError);
  });

  it("listTags returns the profile's tags", () => {
    const { org } = fixture();
    org.createTag("b", T0);
    org.createTag("a", T1);
    expect(org.listTags().map((t) => t.name).sort()).toEqual(["a", "b"]);
  });

  it("renameTag changes the name and allows renaming to its own name", () => {
    const { org } = fixture();
    const tag = org.createTag("staro", T0);
    org.renameTag(tag.id, "novo");
    expect(org.listTags()[0]?.name).toBe("novo");
    // renaming a tag to its current name is a no-op, not a collision.
    expect(() => org.renameTag(tag.id, "novo")).not.toThrow();
  });

  it("renameTag rejects a collision with another tag's name", () => {
    const { org } = fixture();
    const a = org.createTag("a", T0);
    org.createTag("b", T1);
    expect(() => org.renameTag(a.id, "b")).toThrow(NoteTagValidationError);
  });

  it("renameTag validates the name and requires the tag", () => {
    const { org } = fixture();
    const tag = org.createTag("a", T0);
    expect(() => org.renameTag(tag.id, "   ")).toThrow(NoteTagValidationError);
    expect(() => org.renameTag("missing", "x")).toThrow(NoteTagNotFoundError);
  });

  it("deleteTag removes the tag and cascades its links", () => {
    const { org, notes } = fixture();
    const tag = org.createTag("a", T0);
    const note = notes.create(T0);
    org.attachTag(note.id, tag.id);

    org.deleteTag(tag.id);
    expect(org.listTags()).toHaveLength(0);
    expect(org.listTagLinks()).toHaveLength(0);
    expect(() => org.deleteTag("missing")).toThrow(NoteTagNotFoundError);
  });
});

describe("NoteOrgStore — tag links", () => {
  it("attachTag links a note to a tag and is idempotent", () => {
    const { org, notes } = fixture();
    const tag = org.createTag("a", T0);
    const note = notes.create(T0);

    org.attachTag(note.id, tag.id);
    org.attachTag(note.id, tag.id); // second attach is a no-op
    expect(org.listTagLinks()).toEqual([{ noteId: note.id, tagId: tag.id }]);
  });

  it("attachTag rejects an unknown note or tag", () => {
    const { org, notes } = fixture();
    const tag = org.createTag("a", T0);
    const note = notes.create(T0);
    expect(() => org.attachTag("missing", tag.id)).toThrow(NoteNotFoundError);
    expect(() => org.attachTag(note.id, "missing")).toThrow(NoteTagNotFoundError);
  });

  it("attachTag rejects a note or tag owned by another profile", () => {
    const a = fixture();
    const b = fixture();
    const noteA = a.notes.create(T0);
    const tagA = a.org.createTag("a", T0);
    const noteB = b.notes.create(T0);
    const tagB = b.org.createTag("b", T0);

    expect(() => a.org.attachTag(noteB.id, tagA.id)).toThrow(NoteNotFoundError);
    expect(() => a.org.attachTag(noteA.id, tagB.id)).toThrow(NoteTagNotFoundError);
  });

  it("detachTag removes a link and is a silent no-op when none exists", () => {
    const { org, notes } = fixture();
    const tag = org.createTag("a", T0);
    const note = notes.create(T0);
    org.attachTag(note.id, tag.id);

    org.detachTag(note.id, tag.id);
    expect(org.listTagLinks()).toHaveLength(0);
    // detaching a link that does not exist throws nothing.
    expect(() => org.detachTag(note.id, tag.id)).not.toThrow();
    expect(() => org.detachTag("missing", tag.id)).not.toThrow();
  });

  it("listTagLinks excludes soft-deleted notes", () => {
    const { org, notes } = fixture();
    const tag = org.createTag("a", T0);
    const live = notes.create(T0);
    const gone = notes.create(T1);
    org.attachTag(live.id, tag.id);
    org.attachTag(gone.id, tag.id);

    notes.softDelete(gone.id, T2);
    expect(org.listTagLinks()).toEqual([{ noteId: live.id, tagId: tag.id }]);
  });

  it("isolates folders, tags and links between profiles", () => {
    const a = fixture();
    const b = fixture();
    a.org.createFolder({ parentId: null, name: "A-folder", color: null }, T0);
    const tagA = a.org.createTag("a-tag", T0);
    const noteA = a.notes.create(T0);
    a.org.attachTag(noteA.id, tagA.id);

    expect(b.org.listFolders()).toHaveLength(0);
    expect(b.org.listTags()).toHaveLength(0);
    expect(b.org.listTagLinks()).toHaveLength(0);
    // and B still cannot reach A's rows through the mutators.
    expect(() => b.org.attachTag(noteA.id, tagA.id)).toThrow(NoteNotFoundError);
    expect(() => b.org.renameTag(tagA.id, "x")).toThrow(NoteTagNotFoundError);
    expect(a.org.listFolders()).toHaveLength(1);
    expect(a.org.listTagLinks()).toHaveLength(1);
  });
});

// --- Folder preferences (ADR-036 / migration 028) ---------------------------

describe("NoteOrgStore — default template", () => {
  it("defaults a new folder to no template and no capture mark", () => {
    const { org } = fixture();
    const folder = org.createFolder({ parentId: null, name: "Posao", color: null }, T0);
    expect(folder.defaultTemplateId).toBeNull();
    expect(folder.isCaptureDefault).toBe(false);
  });

  it("accepts a BUILT-IN template id, read back off the list", () => {
    const { org } = fixture();
    const folder = org.createFolder({ parentId: null, name: "Sastanci", color: null }, T0);

    org.setDefaultTemplate(folder.id, "builtin:sastanak", T1);
    const stored = org.listFolders()[0];
    expect(stored?.defaultTemplateId).toBe("builtin:sastanak");
    expect(stored?.updatedAt).toBe(T1);
  });

  it("accepts a stored template's id", () => {
    const { org, templates } = fixture();
    const template = templates.save("Moj šablon", '{"type":"doc","content":[]}', T0);
    const folder = org.createFolder({ parentId: null, name: "Moje", color: null }, T0);

    org.setDefaultTemplate(folder.id, template.id, T1);
    expect(org.listFolders()[0]?.defaultTemplateId).toBe(template.id);
  });

  it("rejects an id that is neither a built-in nor one of this profile's templates", () => {
    const { org } = fixture();
    const folder = org.createFolder({ parentId: null, name: "X", color: null }, T0);

    expect(() => org.setDefaultTemplate(folder.id, "builtin:izmisljeni", T1)).toThrow(
      NoteFolderValidationError,
    );
    expect(() => org.setDefaultTemplate(folder.id, "no-such-template", T1)).toThrow(
      NoteFolderValidationError,
    );
  });

  it("rejects ANOTHER profile's template id", () => {
    const a = fixture();
    const b = fixture();
    const foreign = a.templates.save("A-šablon", '{"type":"doc","content":[]}', T0);
    const folder = b.org.createFolder({ parentId: null, name: "B", color: null }, T0);

    expect(() => b.org.setDefaultTemplate(folder.id, foreign.id, T1)).toThrow(
      NoteFolderValidationError,
    );
  });

  it("clears the template with null, and leaves a DANGLING id standing once its template is deleted", () => {
    const { org, templates } = fixture();
    const template = templates.save("Privremeni", '{"type":"doc","content":[]}', T0);
    const folder = org.createFolder({ parentId: null, name: "F", color: null }, T0);
    org.setDefaultTemplate(folder.id, template.id, T1);

    // Deleting the template does NOT reach into the folder: the column is
    // deliberately not a foreign key, and the apply path reads a dangling id as
    // "no template" rather than refusing to create a note (ADR-036).
    templates.remove(template.id);
    expect(org.listFolders()[0]?.defaultTemplateId).toBe(template.id);

    org.setDefaultTemplate(folder.id, null, T2);
    expect(org.listFolders()[0]?.defaultTemplateId).toBeNull();
  });

  it("rejects an unknown folder, another profile's folder, and a malformed now", () => {
    const a = fixture();
    const b = fixture();
    const folderA = a.org.createFolder({ parentId: null, name: "A", color: null }, T0);

    expect(() => a.org.setDefaultTemplate("no-such", "builtin:dnevnik", T1)).toThrow(
      NoteFolderNotFoundError,
    );
    expect(() => b.org.setDefaultTemplate(folderA.id, "builtin:dnevnik", T1)).toThrow(
      NoteFolderNotFoundError,
    );
    expect(() => a.org.setDefaultTemplate(folderA.id, "builtin:dnevnik", "nope")).toThrow(
      NoteFolderValidationError,
    );
  });

  it("leaves the name, colour and parent untouched", () => {
    const { org } = fixture();
    const parent = org.createFolder({ parentId: null, name: "Root", color: null }, T0);
    const child = org.createFolder({ parentId: parent.id, name: "Ime", color: "zlato" }, T0);

    org.setDefaultTemplate(child.id, "builtin:recept", T1);
    const stored = org.listFolders().find((folder) => folder.id === child.id);
    expect(stored?.name).toBe("Ime");
    expect(stored?.color).toBe("zlato");
    expect(stored?.parentId).toBe(parent.id);
  });
});

describe("NoteOrgStore — capture default", () => {
  it("marks one folder", () => {
    const { org } = fixture();
    const folder = org.createFolder({ parentId: null, name: "Brzi unos", color: null }, T0);

    org.setCaptureDefault(folder.id, T1);
    const stored = org.listFolders()[0];
    expect(stored?.isCaptureDefault).toBe(true);
    expect(stored?.updatedAt).toBe(T1);
  });

  it("moves the mark: setting a second folder clears the first, in one transaction", () => {
    const { org } = fixture();
    const first = org.createFolder({ parentId: null, name: "Prva", color: null }, T0);
    const second = org.createFolder({ parentId: null, name: "Druga", color: null }, T0);

    org.setCaptureDefault(first.id, T1);
    org.setCaptureDefault(second.id, T2);

    const marked = org.listFolders().filter((folder) => folder.isCaptureDefault);
    expect(marked.map((folder) => folder.id)).toEqual([second.id]);
  });

  it("clears every mark with null", () => {
    const { org } = fixture();
    const folder = org.createFolder({ parentId: null, name: "F", color: null }, T0);
    org.setCaptureDefault(folder.id, T1);

    org.setCaptureDefault(null, T2);
    expect(org.listFolders().some((f) => f.isCaptureDefault)).toBe(false);
  });

  it("is idempotent — re-marking the folder that already holds it keeps exactly one mark", () => {
    const { org } = fixture();
    const folder = org.createFolder({ parentId: null, name: "F", color: null }, T0);

    org.setCaptureDefault(folder.id, T1);
    org.setCaptureDefault(folder.id, T2);
    expect(org.listFolders().filter((f) => f.isCaptureDefault)).toHaveLength(1);
  });

  it("is per-profile: one profile's mark never disturbs another's", () => {
    const a = fixture();
    const b = fixture();
    const folderA = a.org.createFolder({ parentId: null, name: "A", color: null }, T0);
    const folderB = b.org.createFolder({ parentId: null, name: "B", color: null }, T0);

    a.org.setCaptureDefault(folderA.id, T1);
    b.org.setCaptureDefault(folderB.id, T1);

    expect(a.org.listFolders()[0]?.isCaptureDefault).toBe(true);
    expect(b.org.listFolders()[0]?.isCaptureDefault).toBe(true);
    // and clearing one leaves the other standing.
    a.org.setCaptureDefault(null, T2);
    expect(a.org.listFolders()[0]?.isCaptureDefault).toBe(false);
    expect(b.org.listFolders()[0]?.isCaptureDefault).toBe(true);
  });

  it("rejects an unknown folder, another profile's folder, and a malformed now", () => {
    const a = fixture();
    const b = fixture();
    const folderA = a.org.createFolder({ parentId: null, name: "A", color: null }, T0);

    expect(() => a.org.setCaptureDefault("no-such", T1)).toThrow(NoteFolderNotFoundError);
    expect(() => b.org.setCaptureDefault(folderA.id, T1)).toThrow(NoteFolderNotFoundError);
    expect(() => a.org.setCaptureDefault(folderA.id, "nope")).toThrow(NoteFolderValidationError);
    expect(() => a.org.setCaptureDefault(null, "nope")).toThrow(NoteFolderValidationError);
  });

  it("loses the mark with the folder — deleting it leaves the profile with none", () => {
    const { org } = fixture();
    const folder = org.createFolder({ parentId: null, name: "F", color: null }, T0);
    org.setCaptureDefault(folder.id, T1);

    org.deleteFolder(folder.id, T2);
    expect(org.listFolders()).toHaveLength(0);
  });
});
