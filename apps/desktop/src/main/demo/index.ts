/**
 * The demo profile: one command that fills an account with a life.
 *
 * Two callers, one body. `--shots` needs a populated profile because a
 * screenshot of an empty module teaches nothing about how the module looks;
 * `--demo` needs one because the founder should be able to open the app and
 * see the whole product without typing five hundred rows by hand.
 *
 * Everything is written through the public stores the IPC handlers use, never
 * by raw INSERT. That is not fastidiousness: a demo profile assembled behind
 * the stores would be able to hold rows the app cannot produce — a task with no
 * list, a transaction whose currency its account does not have — and would then
 * "find" defects that only exist in the demo. Going through the front door
 * means every row here is a row a person could have made.
 */

import { SqliteFlagStore, TaskListStore } from "@nexus/db";
import { createModuleRegistry } from "../../shared/modules.js";
import { createDemoContext, type DatabaseHandle, type DemoContext } from "./context.js";
import { seedDemoTasks } from "./tasks.js";
import { seedDemoCalendar } from "./calendar.js";
import { seedDemoNotes } from "./notes.js";
import { seedDemoFinance } from "./finance.js";
import { seedDemoStudy } from "./study.js";
import { seedDemoHabits } from "./habits.js";
import { seedDemoFitness } from "./fitness.js";
import { seedDemoFocus } from "./focus.js";
import { seedDemoPeople } from "./people.js";
import { seedDemoDocuments } from "./documents.js";

/** The name the demo profile carries, so it is obvious in the switcher what it is. */
export const DEMO_PROFILE_NAME = "Demo";

/**
 * Fills `profileId` with a complete, believable life.
 *
 * Order matters in exactly one place — TASK before FOCUS, because a focus
 * session may attach itself to a task and cannot attach to one that does not
 * exist yet. Everything else is independent by construction: each seeder draws
 * from its own named random stream (`demoRandom`), so the result does not
 * depend on which ran first.
 */
export function seedDemoProfile(db: DatabaseHandle, profileId: string, now: number): void {
  const ctx: DemoContext = createDemoContext(profileId, now);

  // Every module on. A demo profile exists to show the whole product, and the
  // private section ships off by default (`defaultEnabled: false`), so without
  // this it is the one module that never appears — including in the screenshot
  // sweep, which reported „no sidebar row for module priv" on every frame it
  // tried. Enabling it puts the row in the rail; the section itself is still
  // locked until someone sets a passcode, which is exactly the state worth
  // showing.
  //
  // Through the store rather than a raw INSERT, on the same terms as everything
  // else here: the flag table is the store's, and a row written behind it is a
  // row the app did not make.
  //
  // `void` on an async call is safe here and only here: `SqliteFlagStore.set`
  // is `async` for the platform-neutral `FlagStore` contract in `@nexus/core`,
  // but its body is one synchronous `better-sqlite3` `run` — the row is on disk
  // before the promise is even constructed. This function is synchronous
  // because every other seeder is, and awaiting a promise that resolves after
  // the work is already done would only make that harder to see.
  const flags = new SqliteFlagStore(db, profileId);
  for (const manifest of createModuleRegistry().all()) {
    void flags.set(manifest.id, true);
  }

  // `TaskStore` refuses to place a task without a list, exactly as
  // `seedFirstRunProfile` does for a fresh profile. A demo profile seeded into
  // an account that already has one is the normal case, and `ensureInbox` is
  // idempotent, so this is safe either way.
  new TaskListStore(db, profileId).ensureInbox(new Date(now).toISOString());

  seedDemoTasks(db, ctx);
  seedDemoCalendar(db, ctx);
  seedDemoNotes(db, ctx);
  seedDemoFinance(db, ctx);
  seedDemoStudy(db, ctx);
  seedDemoHabits(db, ctx);
  seedDemoFitness(db, ctx);
  seedDemoPeople(db, ctx);
  seedDemoDocuments(db, ctx);
  seedDemoFocus(db, ctx);
}
