import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_NOTE_TEMPLATE_BYTES,
  NexusDatabase,
  NoteTemplateNotFoundError,
  NoteTemplateStore,
  NoteTemplateValidationError,
  openDatabase,
  uuidv7,
} from "../index.js";

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-note-templates-"));
  db = openDatabase({ path: join(dir, "templates.db") });
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

function store(profileId = createProfile()): { profileId: string; store: NoteTemplateStore } {
  return { profileId, store: new NoteTemplateStore(db.raw, profileId) };
}

const T0 = "2026-07-25T10:00:00.000Z";
const T1 = "2026-07-25T10:01:00.000Z";
const T2 = "2026-07-25T10:02:00.000Z";

/** A minimal, valid ProseMirror document (ADR-016: `content` is PM JSON, never a Yjs snapshot). */
const DOC = JSON.stringify({ type: "doc", content: [] });

describe("NoteTemplateStore", () => {
  it("save inserts a template and list returns it with round-tripped fields", () => {
    const { profileId, store: templates } = store();

    const created = templates.save("Sastanak", DOC, T0);

    expect(created.profileId).toBe(profileId);
    expect(created.name).toBe("Sastanak");
    expect(created.content).toBe(DOC);
    expect(created.createdAt).toBe(T0);
    expect(created.updatedAt).toBe(T0);
    expect(typeof created.id).toBe("string");
    expect(created.id.length).toBeGreaterThan(0);

    expect(templates.list()).toEqual([created]);
  });

  it("save under the same trimmed name replaces content, keeps id and created_at, bumps updated_at, and does not duplicate the row", () => {
    const { store: templates } = store();

    const first = templates.save("Dnevnik", DOC, T0);
    const secondDoc = JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] });
    const second = templates.save("  Dnevnik  ", secondDoc, T1);

    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBe(T1);
    expect(second.content).toBe(secondDoc);
    expect(second.name).toBe("Dnevnik");

    const all = templates.list();
    expect(all).toHaveLength(1);
    expect(all[0]?.content).toBe(secondDoc);
  });

  it("trims the name on save", () => {
    const { store: templates } = store();
    const created = templates.save("  Recept  ", DOC, T0);
    expect(created.name).toBe("Recept");
  });

  it("lists templates ordered by name", () => {
    const { store: templates } = store();
    templates.save("Zebra", DOC, T0);
    templates.save("Alfa", DOC, T0);
    templates.save("Mango", DOC, T0);

    expect(templates.list().map((t) => t.name)).toEqual(["Alfa", "Mango", "Zebra"]);
  });

  it("rejects an empty or whitespace-only name", () => {
    const { store: templates } = store();
    expect(() => templates.save("", DOC, T0)).toThrow(NoteTemplateValidationError);
    expect(() => templates.save("   ", DOC, T0)).toThrow(NoteTemplateValidationError);
  });

  it("rejects a name over 100 characters after trimming", () => {
    const { store: templates } = store();
    const tooLong = `  ${"a".repeat(101)}  `;
    expect(() => templates.save(tooLong, DOC, T0)).toThrow(NoteTemplateValidationError);
    expect(() => templates.save(`  ${"a".repeat(100)}  `, DOC, T0)).not.toThrow();
  });

  it("rejects empty content", () => {
    const { store: templates } = store();
    expect(() => templates.save("Prazno", "", T0)).toThrow(NoteTemplateValidationError);
    expect(() => templates.save("Prazno2", "   ", T0)).toThrow(NoteTemplateValidationError);
  });

  it("rejects content over MAX_NOTE_TEMPLATE_BYTES", () => {
    const { store: templates } = store();
    const huge = "x".repeat(MAX_NOTE_TEMPLATE_BYTES + 1);
    expect(() => templates.save("Veliko", huge, T0)).toThrow(NoteTemplateValidationError);
  });

  it("rejects content that is not valid JSON", () => {
    const { store: templates } = store();
    expect(() => templates.save("Los", "not json {", T0)).toThrow(NoteTemplateValidationError);
  });

  it("rejects JSON content that parses but is not a { type: \"doc\", ... } object", () => {
    const { store: templates } = store();
    expect(() => templates.save("Niz", "[]", T0)).toThrow(NoteTemplateValidationError);
    expect(() =>
      templates.save("Pogresan tip", JSON.stringify({ type: "paragraph" }), T0),
    ).toThrow(NoteTemplateValidationError);
  });

  it("rejects a malformed now on save and rename", () => {
    const { store: templates } = store();
    expect(() => templates.save("Sastanak", DOC, "not-a-date")).toThrow(
      NoteTemplateValidationError,
    );
    const created = templates.save("Sastanak", DOC, T0);
    expect(() => templates.rename(created.id, "Novo ime", "not-a-date")).toThrow(
      NoteTemplateValidationError,
    );
  });

  it("renames a template, trimming the name and bumping updated_at", () => {
    const { store: templates } = store();
    const created = templates.save("Staro ime", DOC, T0);

    templates.rename(created.id, "  Novo ime  ", T1);

    const [renamed] = templates.list();
    expect(renamed?.name).toBe("Novo ime");
    expect(renamed?.updatedAt).toBe(T1);
    expect(renamed?.createdAt).toBe(T0);
    expect(renamed?.id).toBe(created.id);
  });

  it("renaming to its own current name is a no-op, not a collision", () => {
    const { store: templates } = store();
    const created = templates.save("Isto ime", DOC, T0);

    expect(() => templates.rename(created.id, "Isto ime", T1)).not.toThrow();
    const [renamed] = templates.list();
    expect(renamed?.name).toBe("Isto ime");
    expect(renamed?.updatedAt).toBe(T1);
  });

  it("renaming onto another template's name throws NoteTemplateValidationError", () => {
    const { store: templates } = store();
    templates.save("Prvi", DOC, T0);
    const second = templates.save("Drugi", DOC, T0);

    expect(() => templates.rename(second.id, "Prvi", T1)).toThrow(NoteTemplateValidationError);
  });

  it("rename on an unknown id throws NoteTemplateNotFoundError", () => {
    const { store: templates } = store();
    expect(() => templates.rename("unknown-id", "Bilo šta", T0)).toThrow(
      NoteTemplateNotFoundError,
    );
  });

  it("remove deletes the row", () => {
    const { store: templates } = store();
    const created = templates.save("Za brisanje", DOC, T0);

    templates.remove(created.id);

    expect(templates.list()).toEqual([]);
  });

  it("remove on an unknown id throws NoteTemplateNotFoundError", () => {
    const { store: templates } = store();
    expect(() => templates.remove("unknown-id")).toThrow(NoteTemplateNotFoundError);
  });

  it("isolates templates per profile: invisible to list, and rename/remove of another profile's id throws NoteTemplateNotFoundError", () => {
    const { store: templatesA } = store();
    const { store: templatesB } = store();

    const createdA = templatesA.save("Deljeno ime", DOC, T0);

    expect(templatesB.list()).toEqual([]);
    expect(() => templatesB.rename(createdA.id, "Novo", T1)).toThrow(NoteTemplateNotFoundError);
    expect(() => templatesB.remove(createdA.id)).toThrow(NoteTemplateNotFoundError);

    // The same name may exist in both profiles — the UNIQUE index is per-profile.
    expect(() => templatesB.save("Deljeno ime", DOC, T2)).not.toThrow();
    expect(templatesA.list().map((t) => t.name)).toEqual(["Deljeno ime"]);
    expect(templatesB.list().map((t) => t.name)).toEqual(["Deljeno ime"]);
  });
});
