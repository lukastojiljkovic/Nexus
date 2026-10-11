import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyKlondike, dealKlondike, klondikeMoves } from "@nexus/core";
import type { KlondikeState } from "@nexus/core";
import { CARD_GAME_ARCHIVE_VERSION, CardGameStore, openDatabase, uuidv7 } from "@nexus/db";
import type { NexusDatabase } from "@nexus/db";
import { buildCardsExport, parseCardsExport } from "./imex.js";

/**
 * CARDS' archive section (ADR-090 §imex): what `exportData` writes, what `parse`
 * refuses, and the round trip between two profiles.
 *
 * **Why the parse half is the STORE's own reader.** The section is the store's value
 * rather than a second payload shape, so the refusals asserted here are the store's
 * — an unknown version, a seed outside the game's range, two rows for one slot, a
 * move list the engine will not fold — which is what makes „parse writes nothing"
 * true by construction rather than by review.
 */

const NOW = "2026-06-01T08:00:00.000Z";

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-cards-imex-"));
  db = openDatabase({ path: join(dir, "cards.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function createProfile(): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", NOW);
  return id;
}

/** A Klondike log of `turns` actions, built by PLAYING the engine rather than by hand. */
function playedKlondike(seed: number, turns: number): KlondikeState {
  let state = dealKlondike("draw1", seed);
  for (let turn = 0; turn < turns; turn += 1) {
    const moves = klondikeMoves(state);
    const move = moves[0];
    if (move === undefined) break;
    state = applyKlondike(state, move);
  }
  return state;
}

describe("the cards archive section", () => {
  it("round-trips the record and the games in progress between two profiles", () => {
    const source = createProfile();
    const target = createProfile();
    const store = new CardGameStore(db.raw, source);
    const played = playedKlondike(9, 6);
    store.saveProgress(
      { game: "klondike", variant: "draw1", seed: 9, moves: played.log, elapsedSeconds: 12 },
      NOW,
    );
    store.recordResult(
      { game: "golf", variant: "classic", won: true, elapsedSeconds: 40, score: 3 },
      NOW,
    );

    const payload = parseCardsExport(buildCardsExport(store));
    const restored = new CardGameStore(db.raw, target);
    restored.importData(payload);

    const save = restored.getProgress("klondike", "draw1");
    expect(save?.seed).toBe(9);
    expect(save?.moves).toEqual(played.log);
    expect(save?.elapsedSeconds).toBe(12);
    expect(restored.getStats("golf", "classic")).toMatchObject({
      played: 1,
      won: 1,
      bestScore: 3,
      bestTimeMs: 40_000,
    });
  });

  it("refuses a payload it does not understand, leaving the profile exactly as it found it", () => {
    const profileId = createProfile();
    const store = new CardGameStore(db.raw, profileId);
    const played = playedKlondike(4, 3);
    store.saveProgress(
      { game: "klondike", variant: "draw1", seed: 4, moves: played.log, elapsedSeconds: 0 },
      NOW,
    );

    const good = buildCardsExport(store);
    // Four shapes a later build (or a hand-edited archive) could produce: a version
    // this module does not know, a seed FreeCell's deal range does not carry, two
    // rows for the same slot, and a log the engine will not fold.
    const bad: unknown[] = [
      { version: 99, stats: [], saves: [] },
      { ...good, saves: [{ game: "freecell", variant: "classic", seed: 0, moves: [], elapsedSeconds: 0 }] },
      {
        ...good,
        stats: [good.stats[0], good.stats[0]],
      },
      {
        ...good,
        saves: [
          { game: "klondike", variant: "draw1", seed: 4, moves: [{ kind: "recycle" }], elapsedSeconds: 0 },
        ],
      },
    ];
    for (const payload of bad) {
      expect(() => parseCardsExport(payload), JSON.stringify(payload).slice(0, 40)).toThrow();
    }
    // And the profile still holds exactly what it held: parsing wrote nothing.
    expect(store.listProgress()).toHaveLength(1);
    expect(store.listStats().filter((row) => row.updatedAt !== null)).toHaveLength(good.stats.length);
  });

  it("takes the version it wrote and refuses one it did not", () => {
    const profileId = createProfile();
    const store = new CardGameStore(db.raw, profileId);
    const payload = buildCardsExport(store);
    expect(payload.version).toBe(CARD_GAME_ARCHIVE_VERSION);
    expect(parseCardsExport(payload)).toEqual(payload);
  });

  it("says nothing about a profile with no card games rather than inventing rows", () => {
    const profileId = createProfile();
    const payload = buildCardsExport(new CardGameStore(db.raw, profileId));
    expect(payload.stats).toEqual([]);
    expect(payload.saves).toEqual([]);
  });
});
