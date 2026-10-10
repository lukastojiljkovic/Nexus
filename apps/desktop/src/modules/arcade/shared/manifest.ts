import type { ModuleManifest } from "@nexus/core";

/**
 * The ARCADE module's manifest - what the shell knows about this module before
 * its page loads (ADR-090), on `timers/shared/manifest.ts`'s terms.
 *
 * **The games are OFF by default, and the reason is a founder decision rather
 * than a preference.** PRD 31 answers its own open question out loud: the
 * entertainment section is "hidden by default and never suggested during
 * onboarding - discovery/settings module only", so the module is registered,
 * built and reachable from the gallery, and a profile that never asks for it
 * never sees it. The same paragraph is why there is no widget below.
 *
 * **No dashboard card, deliberately.** A card would be a scoreboard, and a
 * scoreboard is the one shape of this module that has nothing to do from the
 * home screen: the games exist to be played, and their numbers are read on the
 * page where they were earned. PRD 31's whole theme is that this is a break a
 * person CHOOSES rather than a nudge the product makes, and a card would be the
 * nudge. (`tools`'s manifest refuses a card for its own reason; this is the
 * other half of that rule, stated where the refusal is.)
 *
 * **No settings card either.** The product asks for sound off by default, and
 * the module ships no sound at all - there is no audio file, no synthesis and no
 * notification - so a "sound" toggle would be a switch that writes nothing and
 * changes nothing. A card with one dead control is the padding SET-006 warns
 * about; the day a sprite or a sound actually exists, this module declares the
 * preference that governs it.
 */
export const manifest: ModuleManifest = {
  id: "arcade",
  // FUN is PRD 31 (Entertainment & Boosters), which the other games of this wave
  // implement as their own modules: cards, chess, boards and puzzles are separate
  // PRD-31 surfaces with their own pages and their own toggles, so the prefix is
  // shared exactly as UTIL is by `focus`, `tools` and `timers`.
  // `renderer/src/modules.test.ts` states that sharing by name, so any OTHER
  // duplicate still fails.
  prefix: "FUN",
  group: "play",
  defaultEnabled: false,
  order: 320,
  copy: {
    name: { sr: "Arkada", en: "Arcade" },
    description: {
      sr: "Pet brzih igara za predah: mine, kocke, zmija, cigle i 2048 — sve radi bez mreže.",
      en: "Five quick games for a break: Minesweeper, Blocks, Snake, Bricks and 2048 — all of it offline.",
    },
  },
};
