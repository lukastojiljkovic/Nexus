import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import type { ModelHost } from "@nexus/core";
import type { NexusDatabase } from "@nexus/db";
import type { SearchResult } from "../../../shared/ipc.js";
import {
  NOW,
  fakeWiki,
  insertProfile,
  tempDatabase,
} from "../../../main/assistant/knowledge/testFixtures.js";
import type { WikiSource } from "../../../main/assistant/knowledge/types.js";
import { createModuleRegistry } from "../../../shared/modules.js";
import type { TimerHost } from "../../../main/assistant/tools/timers.js";
import type { VoiceHost } from "../../../main/assistant/voice/host.js";
import { AssistantProfile } from "./profile.js";
import type { AssistantServices } from "./services.js";

/**
 * THE PROFILE'S OWN WIRING, where nothing else can see it.
 *
 * `knowledge/service.test.ts` proves what the knowledge service does with a wiki
 * source; nothing there proves that a profile ever hands it one, and for as long
 * as nothing did the assistant had no way to read a downloaded Wikipedia - the
 * defect this file exists to keep closed. So the subject here is the seam
 * between the two: `AssistantServices.zimWiki()` in, a `wiki` citation out.
 *
 * No voice worker and no timers are built by any of this: the knowledge base is
 * reached directly, which is also why those two factories are stubs that throw.
 * The model host IS asked for, once, by the embedder getter - and it answers the
 * way a machine with no embedding model installed answers, so retrieval here is
 * the full-text-and-wiki search ADR-104 says it must still be.
 */

const NEVER = new AbortController().signal;
const WIKI: WikiSource = fakeWiki({
  titles: [{ path: "A/Hipotermija", title: "Hipotermija" }],
  articles: {
    "A/Hipotermija": "# Hipotermija\n\nHipotermija je stanje niske telesne temperature.",
  },
});

let db: NexusDatabase;
let dir: string;
let profileId: string;
let profile: AssistantProfile | null = null;

beforeEach(() => {
  const created = tempDatabase();
  db = created.db;
  dir = created.dir;
  profileId = insertProfile(db);
});

afterEach(async () => {
  // Before the database closes: `isSessionLive` is what stops an indexing pass
  // that is still in flight from writing to a closed connection.
  await profile?.dispose();
  profile = null;
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function services(wiki: WikiSource | null): AssistantServices {
  return {
    userData: () => dir,
    appVersion: () => "0.0.0-test",
    releasePublicKeyPem: () => "",
    networkMode: () => "offline",
    createModelHost: (): ModelHost => ({
      installed: async () => [],
      unloadAll: async () => undefined,
      hardware: unused,
      catalogue: unused,
      recommend: unused,
      searchHuggingFace: unused,
      download: unused,
      importFile: unused,
      remove: unused,
      loadChat: unused,
      loadEmbedder: unused,
    }),
    createVoiceHost: (): VoiceHost => {
      throw new Error("this test reads the knowledge base and nothing else");
    },
    secretCipher: {
      available: () => false,
      encrypt: () => "",
      decrypt: () => null,
    },
    pickGgufFile: async (): Promise<string | null> => null,
    profileDb: (id, open) => open(db.raw, id),
    now: () => Date.parse(NOW),
    search: async (): Promise<readonly SearchResult[]> => [],
    packs: { list: async () => [] },
    tools: { installed: () => [], pack: () => null, session: () => Promise.reject(new Error("no pack")) },
    zimWiki: () => wiki,
    modules: createModuleRegistry(),
  };
}

describe("AssistantProfile", () => {
  it("hands the wiki source its services provide to the knowledge base", async () => {
    profile = new AssistantProfile(services(WIKI), profileId, db.raw, timers());
    const knowledge = profile.knowledgeBase();
    await knowledge.sync(NEVER);

    const hits = await knowledge.search({ text: "hipotermija", limit: 5, locale: "sr" }, NEVER);

    // The location rides the whole way: this is the citation the assistant page
    // draws, and the item is what its module's page is handed to reveal when
    // somebody clicks it (ADR-114).
    expect(hits.map((hit) => hit.citation)).toContainEqual({
      kind: "wiki",
      id: "A/Hipotermija",
      title: "Hipotermija",
      locator: "lead",
      location: { module: "wiki", item: "A/Hipotermija" },
    });
    expect(hits.find((hit) => hit.citation.kind === "wiki")?.text).toBe(
      "Hipotermija je stanje niske telesne temperature.",
    );
  });

  it("reads no wiki at all when its services have none", async () => {
    profile = new AssistantProfile(services(null), profileId, db.raw, timers());
    const knowledge = profile.knowledgeBase();
    await knowledge.sync(NEVER);

    const hits = await knowledge.search({ text: "hipotermija", limit: 5, locale: "sr" }, NEVER);

    expect(hits.some((hit) => hit.citation.kind === "wiki")).toBe(false);
  });
});

/** The two calls the tools would make; nothing in this file builds a tool. */
function timers(): TimerHost {
  return {
    startCountdown: () => {
      throw new Error("this test builds no timers");
    },
    listCountdowns: () => [],
  };
}

/** Every member of the model host this test does not use, and says so by throwing. */
function unused(): never {
  throw new Error("this test installs no models and loads none");
}
