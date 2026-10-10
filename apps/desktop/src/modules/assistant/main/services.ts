import type { ModelHost } from "@nexus/core";
import type { SearchResult } from "../../../shared/ipc.js";
import type { ModuleLookup } from "../../../main/assistant/tools/app.js";
import type { PacksLookup } from "../../../main/assistant/tools/packs.js";
import type { ProfileDb } from "../../../main/assistant/tools/support.js";
import type { SecretCipher } from "../../../main/assistant/web/secrets.js";
import type { VoiceHost } from "../../../main/assistant/voice/host.js";
import type { AssistantNetworkMode } from "../shared/ipc.js";

/**
 * What the ASSISTANT's main half needs from the process it runs in, injected
 * rather than imported (ADR-090).
 *
 * **Why it cannot be imported.** `main/index.ts` owns the `userData` path, the
 * pinned release key, the mode this launch came up under, the profile database
 * handle, main's clock, the app's own global search, its packs service, the
 * TIMERS module's arming path, the module registry and the one thing that needs
 * Electron's `safeStorage`. A module may not reach `app`, `ipcMain` or an
 * account directory (ADR-090 section 3), and it must not: a `register.ts` that
 * resolved `app.getPath` could not even be imported outside Electron, which is
 * what keeps this module's whole main half testable under Vitest.
 *
 * **Why the model host arrives as a FACTORY.** `createModelHost()` builds the
 * app's own wiring, and that wiring imports Electron (it forks a utility
 * process and uses the dedicated session). So `index.ts` - which already imports
 * Electron - passes the factory, and this module calls it once per profile and
 * never imports the Electron-shaped half. The same reasoning hands over
 * `secretCipher` rather than letting this module reach `safeStorage` itself.
 *
 * **Everything that moves is a function.** The account's directories and key
 * material move with the selected account (ADR-044), so `userData` and the
 * release key are getters rather than values, exactly as `CultureServices`
 * writes down for its own two.
 */
export interface AssistantServices {
  /** `<userData>`: where the model files, `assistant-web.json` and the voice packs live. */
  userData(): string;
  /** The pinned release key installed content packs are verified against (ADR-091, ADR-104). */
  releasePublicKeyPem(): string;
  /** The mode THIS launch may act on - never the stored file (`activeNetworkMode`). */
  networkMode(): AssistantNetworkMode;
  /** Builds the model runtime; `index.ts`'s own `createModelHost` (ADR-096). */
  createModelHost(): ModelHost;
  /**
   * Builds the voice worker's host (ADR-105 section 4), on `createModelHost`'s
   * terms: the Electron-shaped half calls `utilityProcess`, so `index.ts` -
   * which already imports Electron - passes the factory and this module never
   * imports it. Nothing is started until the first request.
   */
  createVoiceHost(): VoiceHost;
  /** The device-bound cipher the Brave key is stored through (`safeStorage` in main). */
  readonly secretCipher: SecretCipher;
  /** Opens main's native `.gguf` picker and answers the chosen path, or `null` when the user cancelled. */
  pickGgufFile(): Promise<string | null>;
  /** Opens a profile's database the way every store in this app is built (SEC-EL-02). */
  readonly profileDb: ProfileDb;
  /** Main's wall clock, injected so a test can move it. */
  now(): number;
  /** The app's own global search - `runSearchQuery`'s pipeline, not a second one. */
  readonly search: (
    profileId: string,
    query: string,
    limit: number,
  ) => Promise<readonly SearchResult[]>;
  /** The Packs service, for the installed list. */
  readonly packs: PacksLookup;
  // No `timers` member, deliberately: the TIMERS host the tools are built
  // against is assembled by THIS module (`main/timers.ts`), because it needs the
  // kit's own `armUntil`/`notify` - capabilities index.ts does not hold and would
  // have had to re-implement. See that file's header.
  /** The app's module registry (`createModuleRegistry`), for navigation. */
  readonly modules: ModuleLookup;
}

let configured: AssistantServices | null = null;

/** Called once by `main/index.ts`, beside `configureCultureServices` and `configureCookbook`. */
export function configureAssistant(services: AssistantServices): void {
  configured = services;
}

/**
 * The services, or a thrown error naming the wiring.
 *
 * Throwing rather than answering a default is deliberate, on `cultureServices`'
 * terms: a handler that ran without them could start a model, write a
 * conversation or spend the user's bandwidth, and the one place that can cause
 * any of that is a build where `index.ts` forgot its one call.
 */
export function assistantServices(): AssistantServices {
  if (configured === null) {
    throw new Error(
      "Nexus: the assistant module's main-process services were never configured.",
    );
  }
  return configured;
}

/** A test's own wiring, and the teardown that puts the module back the way it was found. */
export function setAssistantServicesForTest(services: AssistantServices | null): void {
  configured = services;
}
