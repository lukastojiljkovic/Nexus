import type Database from "better-sqlite3-multiple-ciphers";
import type {
  ChatModel,
  Embedder,
  HardwareProfile,
  ModelEntry,
  ModelHost,
  ModelRecommendation,
  ModelTier,
  Tool,
  ToolRegistry,
  VoiceService,
  WebService,
} from "@nexus/core";
import { ConversationStore, type AssistantSettings } from "@nexus/db";
import { createKnowledgeService } from "../../../main/assistant/knowledge/index.js";
import type { KnowledgeIndex } from "../../../main/assistant/knowledge/types.js";
import { createToolRegistry } from "../../../main/assistant/tools/index.js";
import { createVoiceService } from "../../../main/assistant/voice/index.js";
import type { VoiceHost } from "../../../main/assistant/voice/host.js";
import { createWebService } from "../../../main/assistant/web/index.js";
import {
  modeAllowsWebSearch,
  readWebConfig,
  webSearchActive,
  writeWebConfig,
  type WebConfig,
} from "../../../main/assistant/web/gate.js";
import { createWebSecrets } from "../../../main/assistant/web/secrets.js";
import { createDnsResolver, createHttpsTransport } from "../../../main/assistant/web/transport.js";
import type { TimerHost } from "../../../main/assistant/tools/timers.js";
import type { AssistantDownloadView } from "../shared/ipc.js";
import type { AssistantServices } from "./services.js";
import { readVoicePacks } from "./voicePacks.js";

/**
 * THE ASSISTANT'S SERVICES FOR ONE PROFILE, built once and torn down whole.
 *
 * **Why one object per profile.** Everything here except the model runtime
 * belongs to a profile: the conversation store writes its rows, the knowledge
 * index is scoped by its id, the tools read its database and the web service's
 * consent is device-level but its citations are not. Building them per profile
 * and dropping them on a switch is also what makes "the utility process must not
 * outlive the app" true in the only place this module can make it true: a switch
 * calls `unloadAll()` on the host, so a 16 GB model is freed the moment the
 * profile it was loaded for is not the one on screen.
 *
 * **Lazily, and each half separately.** Opening the assistant's page costs
 * nothing until a turn runs: the model host is built on the first load, the
 * knowledge index on the first search, the tool registry on the first turn, and
 * the web service on the first turn that may use it. A user who never asks the
 * assistant anything never touches any of it, and a user who does pays for the
 * parts that turn needs.
 *
 * **The embedder is optional and discovered, never configured.** ADR-104's
 * requirement is that retrieval works with no model loaded; the assistant is
 * therefore allowed to work with no EMBEDDING model either. This class answers
 * `null` when no installed model declares the `embedding` capability, which is
 * the ordinary state of a machine that downloaded one chat model - and the
 * knowledge service's own design already treats that as full-text-only rather
 * than as a failure.
 */

/** Why a turn could not start: no model serves the tier this profile chose. */
export class AssistantModelMissingError extends Error {
  constructor(readonly tier: ModelTier) {
    super(
      `No installed model serves the "${tier}" tier. Download one, or choose another tier in Settings.`,
    );
    this.name = "AssistantModelMissingError";
  }
}

/** One download, as this profile's progress row reads it. */
interface DownloadJob {
  readonly entry: ModelEntry;
  readonly controller: AbortController;
  received: number;
  total: number;
  status: "running" | "stopped" | "failed";
}

export class AssistantProfile {
  readonly store: ConversationStore;
  /** Every model entry main has produced for this profile: the only ones a download may name. */
  private readonly offered = new Map<string, ModelEntry>();
  private host: ModelHost | null = null;
  private knowledge: KnowledgeIndex | null = null;
  private toolRegistry: ToolRegistry | null = null;
  private voice: VoiceService | null = null;
  private voiceHost: VoiceHost | null = null;
  private web: WebService | null = null;
  private embedderCache: Embedder | null | undefined;
  private download: DownloadJob | null = null;
  private catalogueCache: readonly ModelEntry[] | null = null;
  private lastSearch: readonly ModelEntry[] | null = null;
  /** Cancels the knowledge index's own passes when this profile's session ends. */
  private readonly knowledgeAbort = new AbortController();
  private disposed = false;

  constructor(
    private readonly services: AssistantServices,
    readonly profileId: string,
    private readonly db: Database.Database,
    /** The TIMERS host the assistant's own timer tool is built against (`main/timers.ts`). */
    private readonly timers: TimerHost,
  ) {
    this.store = new ConversationStore(db, profileId);
  }

  // --- The five pieces -------------------------------------------------------

  modelHost(): ModelHost {
    this.host ??= this.services.createModelHost();
    return this.host;
  }

  /**
   * The profile's knowledge base, built on first use.
   *
   * It is handed the profile's own open database - the session's connection,
   * never a second one - and an `embedder` getter so a model can be loaded and
   * unloaded while the service lives, which is ADR-104's own shape.
   */
  knowledgeBase(): KnowledgeIndex {
    if (this.knowledge !== null) return this.knowledge;
    const userData = this.services.userData();
    this.knowledge = createKnowledgeService({
      profileId: this.profileId,
      db: this.db,
      userData,
      packPublicKeyPem: this.services.releasePublicKeyPem(),
      embedder: () => this.embedder(),
      // The first pass is started HERE rather than by the service, so that a
      // profile switch or a lock stops it: the service checks this signal and
      // `isSessionLive` before every batch, and a pass that outlived its profile
      // would write to a database the session has already closed.
      autoIndex: false,
      isSessionLive: () => !this.disposed,
    });
    void this.knowledge.sync(this.knowledgeAbort.signal).catch((error: unknown) => {
      console.error("Nexus: the assistant's knowledge index could not be built:", error);
    });
    return this.knowledge;
  }

  /** The tools one turn may use. `web` adds the web tools only when the consent and the mode both hold. */
  tools(web: boolean): readonly Tool[] {
    this.toolRegistry ??= createToolRegistry({
      profileDb: this.services.profileDb,
      now: () => this.services.now(),
      search: this.services.search,
      packs: this.services.packs,
      timers: this.timers,
      modules: this.services.modules,
      web: this.webService(),
    });
    return this.toolRegistry.tools({ web });
  }

  webService(): WebService {
    if (this.web !== null) return this.web;
    const userData = this.services.userData();
    this.web = createWebService({
      userData,
      mode: () => this.services.networkMode(),
      resolve: createDnsResolver(),
      http: createHttpsTransport(),
      secrets: createWebSecrets(userData, this.services.secretCipher),
    });
    return this.web;
  }

  /**
   * The profile's voice service (ADR-105), built on first use.
   *
   * **Why the pack list is a function and the host is a factory.** The service
   * reads the installed packs on EVERY request, so a voice the user installs
   * while the chat page is open is used on their next sentence; the worker host
   * starts nothing until something is asked for, which is what keeps a page that
   * never speaks from paying for a process. Both are built here rather than in
   * `index.ts` for the module kit's own reason: this module never imports
   * Electron, so the utility-process half arrives as a factory (`services.ts`).
   */
  voiceService(): VoiceService {
    if (this.voice !== null) return this.voice;
    this.voiceHost ??= this.services.createVoiceHost();
    const host = this.voiceHost;
    const userData = this.services.userData();
    const publicKeyPem = this.services.releasePublicKeyPem();
    this.voice = createVoiceService({
      packs: async () => readVoicePacks(userData, publicKeyPem),
      host,
    });
    return this.voice;
  }

  // --- Models ----------------------------------------------------------------

  /**
   * The machine's three picks, computed once per profile's life.
   *
   * The hardware probe loads the native addon, so it is asked for exactly once -
   * the runtime's own host caches it too, and this cache is what keeps a page
   * that opens the setup screen twice from paying for it twice.
   */
  async recommendations(): Promise<readonly ModelRecommendation[]> {
    const host = this.modelHost();
    const hardware = await host.hardware();
    return host.recommend(hardware, await this.catalogue());
  }

  /** The signed catalogue, read once. An unverifiable catalogue is an empty list, never a throw. */
  async catalogue(): Promise<readonly ModelEntry[]> {
    this.catalogueCache ??= await this.modelHost().catalogue();
    return this.catalogueCache;
  }

  /** The models on disk, read fresh: a finished download must show up on the next read. */
  async installedEntries(): Promise<readonly ModelEntry[]> {
    return await this.modelHost().installed();
  }

  /** Every entry main has offered this profile, by id - what `downloadModel` is allowed to name. */
  offer(entries: readonly ModelEntry[]): void {
    for (const entry of entries) this.offered.set(entry.id, entry);
  }

  offeredEntry(id: string): ModelEntry | null {
    return this.offered.get(id) ?? null;
  }

  /** Remembers the last search's results, so a page that polls `setup` keeps showing them. */
  rememberSearch(entries: readonly ModelEntry[]): void {
    this.lastSearch = entries;
    this.offer(entries);
  }

  searchResults(): readonly ModelEntry[] | null {
    return this.lastSearch;
  }

  /** The model that serves a tier and is installed, or `null`. */
  async installedModelFor(tier: ModelTier): Promise<ModelEntry | null> {
    const installed = new Set((await this.modelHost().installed()).map((entry) => entry.id));
    const pick = (await this.recommendations()).find(
      (recommendation) => recommendation.tier === tier && installed.has(recommendation.model.id),
    );
    return pick?.model ?? null;
  }

  /**
   * Loads the model one turn runs on.
   *
   * A tier with nothing installed is refused by NAME (`AssistantModelMissingError`)
   * rather than answered with another tier's model: the tier is the user's own
   * choice, and quietly loading a different model than the one they picked is the
   * kind of substitution nobody can see.
   */
  async loadChat(tier: ModelTier, signal: AbortSignal): Promise<ChatModel> {
    const entry = await this.installedModelFor(tier);
    if (entry === null) throw new AssistantModelMissingError(tier);
    return await this.modelHost().loadChat(entry.id, signal);
  }

  /**
   * The embedding model, or `null` when this machine has none installed.
   *
   * Asked for on every pass and cached only once it exists: a user who installs
   * an embedding model while the app runs gets vectors from the next pass, and a
   * user who has none keeps working - full text alone is a described state of the
   * knowledge base, not a degraded one.
   */
  async embedder(): Promise<Embedder | null> {
    if (this.embedderCache !== undefined) return this.embedderCache;
    try {
      const installed = await this.modelHost().installed();
      const entry = installed.find((candidate) => candidate.capabilities.includes("embedding"));
      if (entry === undefined) {
        this.embedderCache = null;
        return null;
      }
      this.embedderCache = await this.modelHost().loadEmbedder(entry.id, new AbortController().signal);
      return this.embedderCache;
    } catch (error) {
      // The embedding model is an aid; a load that fails leaves retrieval as the
      // full-text search it already is, and says so in the log rather than in a
      // page a user cannot act on.
      console.error("Nexus: the assistant's embedding model could not be loaded:", error);
      this.embedderCache = null;
      return null;
    }
  }

  // --- Downloads -------------------------------------------------------------

  /**
   * Starts (or resumes) a download of an entry main offered.
   *
   * The signal is a PAUSE, not a cancel: the runtime's own `installEntry` keeps
   * the staging file and the next call for the same entry continues it, which is
   * what makes `cancelDownload` then `resumeDownload` a resumption rather than a
   * second full download.
   */
  async downloadModel(entry: ModelEntry, onProgress: (received: number, total: number) => void): Promise<void> {
    const controller = new AbortController();
    this.download = {
      entry,
      controller,
      received: 0,
      total: entry.sizeBytes,
      status: "running",
    };
    try {
      await this.modelHost().download(
        entry,
        (progress) => {
          const job = this.download;
          if (job !== null && job.controller === controller) {
            job.received = progress.receivedBytes;
            job.total = progress.totalBytes;
          }
          onProgress(progress.receivedBytes, progress.totalBytes);
        },
        controller.signal,
      );
      this.download = null;
    } catch (error) {
      if (this.download !== null && this.download.controller === controller) {
        // A download the user stopped reads as "stopped"; anything else is a
        // failure, and the page tells them apart rather than calling both
        // "cancelled".
        this.download.status = controller.signal.aborted ? "stopped" : "failed";
      }
      throw error;
    }
  }

  /** Stops the running download, keeping what it has (the runtime's pause). */
  cancelDownload(): void {
    this.download?.controller.abort();
  }

  /** The progress row, or `null` when nothing is running and the last one was cleared. */
  downloadView(): AssistantDownloadView | null {
    const job = this.download;
    if (job === null) return null;
    return {
      model: job.entry,
      receivedBytes: job.received,
      totalBytes: job.total,
      status: job.status,
    };
  }

  // --- Settings: the tier and the web consent --------------------------------

  settings(): AssistantSettings {
    return this.store.settings();
  }

  setDefaultTier(tier: ModelTier): AssistantSettings {
    return this.store.setDefaultTier(tier, this.instant());
  }

  /**
   * Whether web search may act right now: the user's consent AND a mode that
   * allows a connection (`webSearchActive`, ADR-097's own rule).
   */
  webSearchActive(): boolean {
    return webSearchActive(this.services.networkMode(), this.webConfig());
  }

  webConfig(): WebConfig {
    return readWebConfig(this.services.userData());
  }

  /** Records the consent and nothing else: the SearXNG origin is that page's own setting. */
  setWebSearch(enabled: boolean): WebConfig {
    const next = { ...this.webConfig(), enabled };
    writeWebConfig(this.services.userData(), next);
    return next;
  }

  /** Whether this launch's mode lets a download happen at all (ADR-092's rule). */
  downloadsAllowed(): boolean {
    return this.services.networkMode() === "downloads";
  }

  /** Whether this launch's mode lets web search act, before the consent is consulted. */
  modeAllowsWebSearch(): boolean {
    return modeAllowsWebSearch(this.services.networkMode());
  }

  // --- Lifetime --------------------------------------------------------------

  /**
   * Drops every service this profile held.
   *
   * Called on a session end and on a profile switch. `unloadAll` is what matters:
   * it tells the utility process to free a model that may be gigabytes, and it is
   * the only lever this module has over a child of the app's own (the child is an
   * Electron utility process, so quitting the app takes it too - which is what
   * "the utility process must not outlive the app" means in practice).
   */
  async dispose(): Promise<void> {
    this.disposed = true;
    this.knowledgeAbort.abort();
    this.cancelDownload();
    this.download = null;
    this.embedderCache = undefined;
    const host = this.host;
    this.host = null;
    this.knowledge = null;
    this.toolRegistry = null;
    this.web = null;
    this.catalogueCache = null;
    this.lastSearch = null;
    this.offered.clear();
    // The voice worker is a SECOND process: it is stopped even when no model
    // was ever loaded, because "nothing to unload" and "a worker sitting idle"
    // are the same thing to the operating system and only one of them is this
    // app's to keep.
    const voiceHost = this.voiceHost;
    this.voice = null;
    this.voiceHost = null;
    if (voiceHost !== null) {
      try {
        await voiceHost.dispose();
      } catch (error) {
        console.error("Nexus: the assistant's voice worker did not shut down cleanly:", error);
      }
    }
    if (host === null) return;
    try {
      await host.unloadAll();
    } catch (error) {
      // A host that never started a worker has nothing to unload, and one that
      // has already died is a state the exit listener reported. Either way this
      // is teardown, and there is no caller left to tell.
      console.error("Nexus: the assistant's model runtime did not shut down cleanly:", error);
    }
  }

  /** The instant a write is stamped with, from the clock main injected. */
  instant(): string {
    return new Date(this.services.now()).toISOString();
  }

  /** The hardware profile the setup screen shows. Kept here so the probe is asked for once. */
  async hardware(): Promise<HardwareProfile> {
    return await this.modelHost().hardware();
  }
}
