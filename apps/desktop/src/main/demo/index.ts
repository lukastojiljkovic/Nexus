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

import { TOOL_PACKS, packFlagKey } from "@nexus/core";
import { SqliteFlagStore, TaskListStore } from "@nexus/db";
import { BUSINESS_DISABLED_MODULE_IDS, createModuleRegistry } from "../../shared/modules.js";
import { seedDemoBusinessProfile } from "./business.js";
import { seedDemoCanvas } from "./canvas.js";
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

/**
 * The name the demo profile carries, re-exported from `shared/ipc.ts` where it
 * has to live: the RENDERER needs it too, to know whether the switcher should
 * still offer „Dodaj demo profil", and the renderer cannot import from `main/`.
 * Re-exported rather than moved outright so this module still reads as the one
 * place that describes what a demo profile is.
 */
export { DEMO_PROFILE_NAME } from "../../shared/ipc.js";

/** The second kind ADR-058 gives the top layer to. Named for what it is, so the switcher states which profile you are standing in. */
export const DEMO_BUSINESS_PROFILE_NAME = "Demo posao";

/**
 * Every module on, and every TOOLKIT with it.
 *
 * The module half is PRIV's argument (see `seedDemoProfile`); the pack half is
 * the same argument one level down, and it became load-bearing the moment the
 * professional drawer's tools started being pack-gated. `pro: true` with no
 * `pack:*` rows is a switched-on module whose page is empty — which is not just
 * a poor demo, it is the exact state the screenshot sweep reports as „found
 * nothing to fan out", i.e. a false alarm about a drawer that is working.
 *
 * `void` on the async `set` is safe here and only here, for the reason argued
 * at length in `seedDemoProfile`: the store's body is one synchronous
 * `better-sqlite3` `run`, so the row is on disk before the promise exists.
 */
function enableEverything(flags: SqliteFlagStore, disabledModules: ReadonlySet<string>): void {
  for (const manifest of createModuleRegistry().all()) {
    void flags.set(manifest.id, !disabledModules.has(manifest.id));
  }
  for (const pack of TOOL_PACKS) {
    void flags.set(packFlagKey(pack), true);
  }
}

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
  enableEverything(new SqliteFlagStore(db, profileId), new Set());

  // `TaskStore` refuses to place a task without a list, exactly as
  // `seedFirstRunProfile` does for a fresh profile. A demo profile seeded into
  // an account that already has one is the normal case, and `ensureInbox` is
  // idempotent, so this is safe either way.
  new TaskListStore(db, profileId).ensureInbox(new Date(now).toISOString());

  seedDemoTasks(db, ctx);
  seedDemoCalendar(db, ctx);
  seedDemoNotes(db, ctx);
  // After TASK and NOTE: its two Nexus cards resolve their ids by reading the
  // rows those two just wrote (`CanvasStore`'s own store, never a raw INSERT).
  seedDemoCanvas(db, ctx);
  seedDemoFinance(db, ctx);
  seedDemoStudy(db, ctx);
  seedDemoHabits(db, ctx);
  seedDemoFitness(db, ctx);
  seedDemoPeople(db, ctx);
  seedDemoDocuments(db, ctx);
  seedDemoFocus(db, ctx);
}

/**
 * Fills `profileId` with a working life instead of a whole one — the BUSINESS
 * half of ADR-058's two profile kinds (founder, 2026-08-08: „hoću demo naloge
 * za sve tipove poslovnih naloga koje imamo").
 *
 * Two things make it a different profile rather than the same one twice:
 *
 *  - **The module set is the product's own answer**, not a demo invention:
 *    `BUSINESS_DISABLED_MODULE_IDS` is exactly what `handleProfilesCreate`
 *    writes for a real business profile, so „Učenje" is absent here for the
 *    same reason it is absent for anybody who creates one. Reading the shared
 *    set rather than restating it means a module added to that list is off
 *    here too, without anybody remembering to come back.
 *  - **The rows are business rows** — clients, offers, invoices, VAT, an
 *    accountant — written by `business.ts`, which seeds six modules and
 *    deliberately not the four that belong to a person rather than to a
 *    practice.
 *
 * PRIV is the one deviation from the product's defaults, and it is the same one
 * `seedDemoProfile` makes: the section ships off, and a demo that never shows
 * it is a demo of thirteen modules.
 */
export function seedDemoBusiness(db: DatabaseHandle, profileId: string, now: number): void {
  enableEverything(new SqliteFlagStore(db, profileId), BUSINESS_DISABLED_MODULE_IDS);
  new TaskListStore(db, profileId).ensureInbox(new Date(now).toISOString());
  seedDemoBusinessProfile(db, createDemoContext(profileId, now));
}
