import type { ModuleText } from "@nexus/core";

/**
 * The safety notice, in both languages, in ONE place (ADR-100).
 *
 * It lives in `shared/` because three readers need it and they are in two
 * processes: the page draws it on every article, the acknowledgement dialog
 * shows it before the first one, and main prints it on every sheet. `renderer/`
 * cannot be read from main, so the pair cannot live in the component that draws
 * it - and a notice that exists twice is a notice that can say two things.
 *
 * The sentences are the founder's own, unaltered: they are the app's promise
 * about reference material, not copy somebody may improve.
 */
export const SAFETY_NOTICE: ModuleText = {
  sr: "Samo za informisanje. Nije zamena za stručnu pomoć. Proveri informacije. U hitnom slučaju pozovi 112.",
  en: "For reference only. Not a substitute for professional help. Check the information. In an emergency, call 112.",
};
