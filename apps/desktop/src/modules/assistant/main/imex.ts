import { ConversationStore, emptyAssistantExport, type AssistantExport } from "@nexus/db";
import type { ModuleSession } from "../../../main/moduleIpc.js";

/**
 * THE ASSISTANT'S section of the profile archive (ADR-090 section 5, ADR-106):
 * what this module puts in `data/modules.ndjson` and the only reader of it.
 *
 * **The store already owns the shape**, so this file owns the two things the
 * store cannot know: which value a restore applies when the archive says nothing
 * about the assistant, and the statement that the section carries the user's own
 * words rather than an index of them.
 *
 * **Why an absent section means EMPTY, not "unchanged".** A restore replaces a
 * profile whole, so a profile restored from an archive written before this
 * module existed must come back into the state a profile that never used the
 * assistant is in: no threads, no messages, and the shipped tier. That is not a
 * loss of anything the archive carried - it is the same instruction every kit
 * module runs with, and it is why these three tables are deliberately absent
 * from `RESTORE_WIPE_TABLES` (`packages/db/src/imex/restoreStore.test.ts` names
 * them beside the timers module's).
 *
 * **A model is NOT in the archive, and that is a decision rather than an
 * omission.** A `ModelEntry` names a file on this machine's disk plus the models
 * a person downloaded; carrying them would either promise a restore that
 * downloads gigabytes or a row pointing at a file that is not there. What the
 * archive carries is what the person wrote: the thread, the model's ID as the
 * record of what answered it, and the tier they chose.
 */

/** The one profile a session is about, or `null` when it names none or several. */
function soleProfile(session: ModuleSession): string | null {
  return session.profileIds.length === 1 ? (session.profileIds[0] ?? null) : null;
}

/**
 * The section this profile contributes: its threads with their messages, and its
 * one preference. `undefined` for a session with nothing to say, which the host
 * omits rather than writing as an empty value.
 */
export function exportAssistantData(session: ModuleSession): AssistantExport | undefined {
  const profileId = soleProfile(session);
  if (profileId === null) return undefined;
  return session.profileDb(
    profileId,
    (db, id) => new ConversationStore(db, id).exportData(),
  );
}

/**
 * The writing half, run inside the kit's one transaction for every adopted
 * module. `undefined` is an archive that says nothing about the assistant, which
 * this module applies as EMPTY - see the file header.
 */
export function applyAssistantData(
  payload: AssistantExport | undefined,
  session: ModuleSession,
): void {
  const section = payload ?? emptyAssistantExport();
  const now = new Date(session.now()).toISOString();
  for (const profileId of session.profileIds) {
    session.profileDb(profileId, (db, id) => {
      new ConversationStore(db, id).importData(section, now);
    });
  }
}
