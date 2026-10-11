/**
 * The voice packs this machine has installed, read off disk for the voice
 * service (ADR-105 section 5).
 *
 * **Why this is a file rather than a call site in `register.ts`.** A voice pack
 * is an ordinary `model` pack (`ADR-091`): the signed manifest lists its files
 * and `voice.json` declares what the model IS - kind, engine, languages, rate.
 * Reading the two is a filesystem question with a rule in it (a folder that
 * declares an engine this build does not run is NOT a voice pack, and saying
 * nothing about it is correct), and the rule belongs where it can be read rather
 * than inside a handler that also has a turn engine in it.
 *
 * The list is asked for on every request by `createVoiceService`, so a voice the
 * user installs while the chat page is open is used on their next sentence.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { VOICE_DESCRIPTOR_FILE, describeVoicePack, type VoicePack } from "../../../main/assistant/voice/packs.js";
import { packIdDir, readInstalled } from "../../../main/packs/registry.js";

/**
 * Every installed voice pack, in the order the registry lists them.
 *
 * A pack is read as a voice only when its manifest says `model` and its folder
 * carries a `voice.json` this build's descriptor rule accepts; anything else is
 * a model pack that happens to be installed, which is exactly what the model
 * panel's own downloads are.
 */
export function readVoicePacks(userData: string, publicKeyPem: string): readonly VoicePack[] {
  const packs: VoicePack[] = [];
  for (const installed of readInstalled(userData, publicKeyPem)) {
    const { id, version, kind } = installed.manifest;
    if (kind !== "model") continue;
    const directory = join(packIdDir(userData, id), version);
    let descriptorText: string;
    try {
      descriptorText = readFileSync(join(directory, VOICE_DESCRIPTOR_FILE), "utf8");
    } catch {
      continue;
    }
    const described = describeVoicePack({ id, version, directory, descriptorText });
    if (described !== null) packs.push(described);
  }
  return packs;
}
