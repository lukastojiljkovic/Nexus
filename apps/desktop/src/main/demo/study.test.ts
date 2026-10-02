import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CardStore,
  DeckStore,
  ExamStore,
  NexusDatabase,
  SubjectStore,
  TopicStore,
  openDatabase,
  uuidv7,
} from "@nexus/db";

import { createDemoContext, type DemoLocale } from "./context.js";
import { seedDemoStudy } from "./study.js";

const NOW = Date.UTC(2026, 7, 21, 9, 0, 0);

interface Scene {
  readonly subjectNames: readonly string[];
  readonly deckNames: readonly string[];
  readonly topicNames: readonly string[];
  readonly examScopes: readonly string[];
  readonly fronts: readonly string[];
}

/** Seeds one demo profile in `locale` and reads the whole STUDY scene back out of it. */
function seedScene(locale: DemoLocale): Scene {
  const dir = mkdtempSync(join(tmpdir(), "nexus-demo-study-"));
  let db: NexusDatabase | undefined;
  try {
    db = openDatabase({ path: join(dir, "demo.db") });
    const profileId = uuidv7();
    db.raw
      .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
      .run(profileId, "personal", "Demo", new Date(NOW).toISOString());

    seedDemoStudy(db.raw, createDemoContext(profileId, NOW, locale));

    const decks = new DeckStore(db.raw, profileId).listActive();
    const cards = new CardStore(db.raw, profileId);
    return {
      subjectNames: new SubjectStore(db.raw, profileId).listActive().map((row) => row.name),
      deckNames: decks.map((row) => row.name),
      topicNames: new TopicStore(db.raw, profileId).listAll().map((row) => row.name),
      examScopes: new ExamStore(db.raw, profileId)
        .listActive()
        .map((row) => row.scope)
        .filter((scope): scope is string => scope !== null),
      fronts: decks.flatMap((deck) => cards.listByDeck(deck.id)).map((card) => card.front),
    };
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The demo profile is offered during first run, so a renderer in English that
 * produced a Serbian demo would be the one surface in the app that ignored the
 * language choice. These pin both scenes, and the fact that they are the same
 * SIZE — a language that quietly lost a deck or an exam topic would still look
 * plausible on screen.
 */
describe("seedDemoStudy", () => {
  it("seeds the Serbian scene when no locale is given", () => {
    const scene = seedScene("sr");
    expect(scene.subjectNames).toContain("Napredne baze podataka");
    expect(scene.deckNames).toContain("Napredne baze podataka");
    expect(scene.topicNames).toContain("Indeksiranje i B-stabla");
    expect(scene.fronts.some((front) => front.includes("B-stablo"))).toBe(true);
  });

  it("seeds the whole scene in English when the context asks for it", () => {
    const scene = seedScene("en");
    expect(scene.subjectNames).toEqual(
      expect.arrayContaining([
        "Advanced Databases",
        "Machine Learning",
        "Distributed Systems",
        "Compilers",
        "Information Security",
        "Software Engineering",
        "Computer Graphics",
      ]),
    );
    expect(scene.deckNames).toEqual(expect.arrayContaining(["Advanced Databases", "Machine Learning"]));
    expect(scene.topicNames).toContain("Indexing and B-trees");
    expect(scene.fronts).toContain("What is a B-tree and why is it used for indexes?");
    expect(scene.examScopes).toContain(
      "Relational model, normalisation, indexes (B-tree, B+-tree), transaction fundamentals.",
    );
  });

  it("writes the same number of subjects, decks, topics, exams and cards in either language", () => {
    const sr = seedScene("sr");
    const en = seedScene("en");
    expect(en.subjectNames).toHaveLength(sr.subjectNames.length);
    expect(en.deckNames).toHaveLength(sr.deckNames.length);
    expect(en.topicNames).toHaveLength(sr.topicNames.length);
    expect(en.examScopes).toHaveLength(sr.examScopes.length);
    expect(en.fronts).toHaveLength(sr.fronts.length);
  });

  it("leaves no Serbian diacritic anywhere the English scene writes copy", () => {
    const scene = seedScene("en");
    const copy = [...scene.subjectNames, ...scene.deckNames, ...scene.topicNames, ...scene.examScopes, ...scene.fronts];
    expect(copy.filter((text) => /[čćžšđ]/i.test(text))).toEqual([]);
  });
});
