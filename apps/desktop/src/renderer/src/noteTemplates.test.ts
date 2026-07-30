import type { JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NoteTemplate } from "../../shared/ipc.js";
import { BUILTIN_TEMPLATES, mergeTemplateEntries, stripAttachmentNodes } from "./noteTemplates.js";
import { strings } from "./strings.js";

/**
 * `noteTemplates.ts` imports TipTap for its `JSONContent` TYPE only, so the
 * module loads under node with no editor anywhere in sight — which is what
 * makes the merge and the attachment strip testable without a DOM.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

const T0 = "2026-01-01T00:00:00.000Z";

function userRow(name: string, content: string): NoteTemplate {
  return { id: `user-${name}`, profileId: "profile-1", name, content, createdAt: T0, updatedAt: T0 };
}

/** A stored row whose content is a valid, minimal document. */
function validRow(name: string): NoteTemplate {
  return userRow(name, JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }));
}

describe("BUILTIN_TEMPLATES", () => {
  it("is the five built-ins, each with a builtin:-prefixed unique id and its name from strings.ts", () => {
    expect(BUILTIN_TEMPLATES.map((template) => template.id)).toEqual([
      "builtin:sastanak",
      "builtin:dnevnik",
      "builtin:recept",
      "builtin:predmet",
      "builtin:projekat",
    ]);
    expect(BUILTIN_TEMPLATES.map((template) => template.name)).toEqual([
      strings.notes.templateBuiltins.sastanak,
      strings.notes.templateBuiltins.dnevnik,
      strings.notes.templateBuiltins.recept,
      strings.notes.templateBuiltins.predmet,
      strings.notes.templateBuiltins.projekat,
    ]);
  });

  it("gives every built-in a full doc node that opens with a level-1 heading", () => {
    for (const template of BUILTIN_TEMPLATES) {
      expect(template.content.type, template.id).toBe("doc");
      const content = template.content.content ?? [];
      expect(content.length, template.id).toBeGreaterThan(0);
      expect(content[0]?.type, template.id).toBe("heading");
      expect(content[0]?.attrs?.["level"], template.id).toBe(1);
    }
  });
});

describe("mergeTemplateEntries", () => {
  it("lists the built-ins first, in their authored order, and marks them builtin", () => {
    const entries = mergeTemplateEntries([]);
    expect(entries).toHaveLength(BUILTIN_TEMPLATES.length);
    expect(entries.map((entry) => entry.id)).toEqual(BUILTIN_TEMPLATES.map((t) => t.id));
    expect(entries.every((entry) => entry.builtin)).toBe(true);
    expect(entries.every((entry) => entry.content !== null)).toBe(true);
  });

  it("appends the profile's own rows, sr-Latn sorted by name", () => {
    const entries = mergeTemplateEntries([
      validRow("Zbirka"),
      validRow("Ana"),
      validRow("Šablon"),
      validRow("Čedo"),
    ]);
    expect(entries.slice(BUILTIN_TEMPLATES.length).map((entry) => entry.name)).toEqual([
      "Ana",
      "Čedo",
      "Šablon",
      "Zbirka",
    ]);
    expect(entries.slice(BUILTIN_TEMPLATES.length).every((entry) => !entry.builtin)).toBe(true);
  });

  it("never lets a user row displace a built-in, whatever it is called", () => {
    const entries = mergeTemplateEntries([validRow("Aaa"), validRow("Sastanak")]);
    expect(entries.slice(0, BUILTIN_TEMPLATES.length).every((entry) => entry.builtin)).toBe(true);
  });

  it("keeps a row whose stored JSON is corrupt, with a null content so it can still be renamed or deleted", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const entries = mergeTemplateEntries([userRow("Pokvaren", "{ not json"), validRow("Dobar")]);
    const corrupt = entries.find((entry) => entry.name === "Pokvaren");
    const healthy = entries.find((entry) => entry.name === "Dobar");

    expect(corrupt?.content).toBeNull();
    expect(corrupt?.builtin).toBe(false);
    expect(healthy?.content).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it("carries each row's own id through unchanged", () => {
    const row = validRow("Ana");
    const entry = mergeTemplateEntries([row]).find((candidate) => candidate.name === "Ana");
    expect(entry?.id).toBe(row.id);
  });
});

describe("stripAttachmentNodes", () => {
  /** A document with an attachment beside a wiki-link at top level, and a second one nested two lists deep. */
  function documentWithAttachments(): JSONContent {
    return {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Tekst" },
            { type: "noteLink", attrs: { noteId: "note-1", label: "Veza" } },
            { type: "attachmentImage", attrs: { attachmentId: "att-1" } },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "attachmentImage", attrs: { attachmentId: "att-2" } }] },
              ],
            },
          ],
        },
      ],
    };
  }

  /** Every `type` in the tree, so a removal at any depth is visible in one assertion. */
  function types(node: JSONContent): string[] {
    return [node.type ?? "", ...(node.content ?? []).flatMap(types)];
  }

  it("removes every attachmentImage at any depth and keeps noteLink nodes", () => {
    const stripped = stripAttachmentNodes(documentWithAttachments());
    expect(types(stripped)).not.toContain("attachmentImage");
    expect(types(stripped)).toContain("noteLink");
    expect(types(stripped)).toContain("text");
    expect(types(stripped)).toContain("bulletList");
  });

  it("leaves the source document untouched — it returns a copy", () => {
    const original = documentWithAttachments();
    const stripped = stripAttachmentNodes(original);
    expect(stripped).not.toBe(original);
    expect(types(original)).toContain("attachmentImage");
  });

  it("shallow-copies a leaf node that has no content at all", () => {
    const leaf: JSONContent = { type: "text", text: "Tekst" };
    const stripped = stripAttachmentNodes(leaf);
    expect(stripped).toEqual(leaf);
    expect(stripped).not.toBe(leaf);
  });

  it("collapses a node whose only children were attachments to an empty content array", () => {
    const stripped = stripAttachmentNodes({
      type: "paragraph",
      content: [{ type: "attachmentImage", attrs: { attachmentId: "att-1" } }],
    });
    expect(stripped.content).toEqual([]);
  });
});
