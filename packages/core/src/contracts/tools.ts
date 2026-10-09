/**
 * A tool a module registers with a tool host (PRD 29 UTIL, PRD 30 PRO) —
 * „Alatke", the everyday drawer, and „Stručne alatke", the professional one.
 *
 * **The host has no privileged path.** „Alatke"'s own converters and
 * calculators are declared through this very contract, exactly as any other
 * module's would be, so a future module contributes a tool by publishing a
 * declaration rather than by editing the drawer. A drawer collects
 * `manifest.tools` across the registry and renders what it finds; its chrome
 * carries no `switch` and no list of ids.
 *
 * **Identity here, render in the renderer.** This package is framework-free and
 * is loaded by the Electron MAIN process too, so a React element cannot live on
 * this type. The pairing is the one the app already uses twice — `WidgetContract`
 * against `DASHBOARD_WIDGETS`, `SettingsPanel` against `MODULE_SETTINGS_PANELS`
 * — a declaration here, a component in the renderer's own map, and a test that
 * pins the two together so neither can drift.
 */

/**
 * Which drawer a tool lands in.
 *
 * Two drawers rather than one because the audiences do not overlap: a person
 * converting a recipe from cups does not want a cable-cross-section calculator
 * in the same list, and an electrician looking for one does not want to scroll
 * past VAT. The professional drawer's module ships switched OFF and is turned on
 * by the opening questionnaire, so a user whose work Nexus knows nothing about
 * never sees that it exists.
 *
 * **What decides the drawer is `packs`, and the rule is one sentence:** a tool
 * belongs in „Alatke" if it is useful to somebody with no profession at all.
 * „Koliko je ovo u inčima" and „koliki je PDV" pass that test; „koji presek
 * kabla za ovaj pad napona" does not. So a tool that names no pack is an
 * everyday tool, and a tool that names at least one is a professional one.
 *
 * **A tool has exactly ONE home.** The temptation, once packs exist, is to list
 * the loan calculator under „Nekretnine" as well as in „Alatke", so an estate
 * agent finds it where they look. That is two entries for one screen, two search
 * hits for one answer, and a maintenance rule nobody will remember. Everybody
 * has „Alatke"; a tool that lives there is already reachable by every profession
 * there is, which is what makes the single home affordable.
 */
export const TOOL_DRAWERS = ["utilities", "professional"] as const;

export type ToolDrawer = (typeof TOOL_DRAWERS)[number];

/**
 * The toolkits — PRD 30's „packs", as the closed set the rest of the app checks
 * against.
 *
 * These are ids, never labels: they key a `feature_flags` row (`pack:<id>`), so
 * they are ASCII, lowercase, and never change once shipped. Their Serbian names
 * live in `strings.pro.packs`, like every other piece of copy.
 *
 * **A pack is a SUBJECT, not a job title, and that inversion is the whole
 * design.** The obvious table here was the twenty-two professions from the PRO
 * catalogue — `arhitekta`, `lekar`, `advokat` — and it is wrong three times
 * over. It fails closed: a *geodeta* is in nobody's list of twenty-two and would
 * be filed under „ostalo", getting nothing, while „Gradnja i projektovanje"
 * hands him nine tenths of the right kit without ever asking what he calls
 * himself. It double-counts: a joiner, a locksmith and an upholsterer want ONE
 * set of cutting, sheet-yield and material arithmetic between them, and three
 * profession packs would be three copies to keep in step. And it makes the
 * founder's own
 * requirement — that a tool may serve several professions — into a mechanism,
 * when as a subject it is simply the fact that one pack lists it.
 *
 * So the professions did not disappear; they became the vocabulary the
 * questionnaire recognises somebody by — the `who` line of each pack's copy in
 * `strings.pro.packs`.
 *
 * **A `who` line is a legal claim, not decoration, and that is why one pack is
 * missing from this list.** What makes software a medical device under
 * MDR-style rules — and Serbia's *Zakon o medicinskim sredstvima* tracks them —
 * is its INTENDED PURPOSE, and intended purpose is established by what the
 * product says it is for. A drawer of calculators that declares its audience as
 * „lekari, medicinske sestre" has a clinical intended purpose that no disclaimer
 * retracts (*SNITEM*, C-329/16: software that checks a dose against patient data
 * is a device even though it never touches the patient). There was a `zdravstvo`
 * pack here; it is gone, and §5 of `STATUS.md` records the decision that is
 * pending on it. The body-metric tools that are honestly shippable — BMI and its
 * relatives — live in `trening` under the wellness carve-out instead, which is
 * what that carve-out is for.
 *
 * **A pack is not a module and deliberately does not behave like one.** A module
 * is a place in the sidebar with pages and stored rows; a pack is a *filter over
 * one drawer*. That is why enabling six of them costs a profile nothing but a
 * longer list, and why the questionnaire may enable several without apology —
 * most people's working week is more than one subject.
 *
 * The order is the order the pack picker lists them in, grouped by the kind of
 * work rather than alphabetically: alphabetical by Serbian name would open on
 * „Agro" and close on „Zanat" for no reason anybody benefits from.
 */
export const TOOL_PACKS = [
  // graditeljstvo i inženjerstvo
  "gradnja",
  "inzenjering",
  // softver i vizuelni rad
  "softver",
  "dizajn",
  "foto",
  "muzika",
  // obrazovanje i jezik
  "prosveta",
  "tekst",
  // telo i kuhinja
  "trening",
  "kuhinja",
  // pravo i novac
  "pravo",
  "racunovodstvo",
  // posao za sebe
  "biznis",
  "nekretnine",
  // put, zemlja, zanat, događaji
  "transport",
  "agro",
  "zanat",
  "event",
] as const;

export type ToolPack = (typeof TOOL_PACKS)[number];

/**
 * The `feature_flags` key a pack's enablement is stored under.
 *
 * Namespaced rather than bare, and that prefix is doing real work: the flags
 * table is keyed by module id, and a row called `arhitekta` sitting beside
 * `finance` would read as a module that nobody registered — which is exactly
 * how a stale row becomes indistinguishable from a module somebody forgot to
 * build. `pack:arhitekta` cannot be mistaken for anything else, and the colon is
 * the same qualifier the app already uses for `moduleId:widgetId` and
 * `moduleId:settingsKey`.
 */
export function packFlagKey(pack: ToolPack): string {
  return `pack:${pack}`;
}

/**
 * The packs a profile has, read out of its flag state.
 *
 * Absent means off. That asymmetry is the opposite of the module rule — where a
 * missing row falls through to the manifest's `defaultEnabled` — and it is
 * deliberate: there is no such thing as a pack that is on by default, because
 * every pack is an answer to a question about the person. A profile that never
 * answered has no professions, not a default one.
 */
export function enabledPacks(flags: Readonly<Record<string, boolean>>): ToolPack[] {
  return TOOL_PACKS.filter((pack) => flags[packFlagKey(pack)] === true);
}

/**
 * What a tool DOES, which is the only grouping a drawer draws — in the order
 * the rail draws them.
 *
 * **Category is the rail's axis; packs are its filter.** Grouping the
 * professional drawer by PACK instead would have been the obvious move and is
 * wrong twice over: it re-erects the very boundary the sharing was meant to
 * dissolve, and it forces a tool two professions share to appear under two
 * headings — the second entry for one screen this contract otherwise refuses.
 * Grouping by subject means a photographer and an event planner find the same
 * daylight calculator in the same place, and neither has to know it was also
 * somebody else's.
 *
 * **The seven at the bottom are the price of the axis.** Eleven categories were
 * enough while the professional drawer was one trade's; across eighteen toolkits
 * `calculation` would have collected a hundred and fifty tools and stopped being
 * a heading at all — a group that contains everything sorts nothing. They are
 * still verbs, not trades, and that is what keeps the doctrine above intact: a
 * bricklayer's lintel and a rigger's sling are both `structure` because both
 * ask what an assembly can carry, and neither pack owns the word. The trade is
 * the filter that got the tool onto the screen; the category is what it does
 * once it is there.
 *
 * There is deliberately no `legal` and no `land`: a limitation period is a date
 * (`time`), a court fee is money (`finance`), and a parcel is a polygon
 * (`geometry`). A category named after the person asking is the failure this
 * comment opens by rejecting.
 */
export const TOOL_CATEGORIES = [
  // utilities
  "conversion",
  "calculation",
  // developer
  "numbers",
  "riscv",
  "encoding",
  "data",
  "text",
  "design",
  "crypto",
  "system",
  "time",
  // professional
  "geometry",
  "materials",
  "structure",
  "electrical",
  "media",
  "body",
  "finance",
] as const;

export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

/**
 * What you NEED, rather than what you do — the eight task groups the tool
 * finder filters by.
 *
 * **A third axis, and the reason it earns a place beside the other two.** The
 * two that already existed answer „who is this for“ (a pack) and „what does it
 * do“ (a category), and neither answers the question somebody actually arrives
 * with: they need a VAT figure, or the number of days between two dates, and do
 * not know which of eighteen toolkits owns it. `TOOL_CATEGORIES` groups the rail
 * by subject, which is the right order once you know what you are looking for;
 * this is the order you are in before you do.
 *
 * **They are deliberately NOT derived from the packs.** A pack is a trade, and
 * these cut across trades on purpose: a bricklayer's rebar mass and a
 * bookkeeper's pro-rata interest are both arithmetic somebody has to be able to
 * reach without knowing whose drawer it lives in. Derived groups would re-erect
 * the very boundary this axis exists to dissolve — which is why a tool carries
 * its own assignment, one or two of them, and `modules.test.ts` refuses a tool
 * that declares none.
 *
 * Eight, and closed: a group whose every member a profile can never see is a
 * filter that opens onto nothing, so this is the whole set and the same test
 * holds each group to at least one tool. The Serbian names live in
 * `strings.toolFinder.groups`, like every other piece of copy.
 */
export const TOOL_TASK_GROUPS = [
  "money",
  "dates",
  "measure",
  "text",
  "design",
  "build",
  "data",
  "study",
] as const;

export type ToolTaskGroup = (typeof TOOL_TASK_GROUPS)[number];

/**
 * What could go wrong with this tool's answer, and who gets hurt — the founder's
 * *„da obavezno stoje vidljivi disclaimeri… da nas neko ne tuzi do bankrota"*,
 * as a closed set the contract enforces rather than copy each surface remembers.
 *
 * **A class is a behaviour bundle, not a paragraph.** It decides the notice the
 * HOST draws above the tool, whether a copied result carries a trailing line,
 * and — the part that is not about text at all — whether the surface may render
 * a VERDICT. That last rule is why this is on the registration: „is a green tick
 * allowed here" is not a question a surface should be able to answer for itself.
 *
 * **The classes are told apart by the HARM, never by the trade that asked.**
 * A cable-drop calculator and a rigging-load calculator are the same class
 * because the same thing goes wrong (an engineered system fails, a third party
 * is injured, a licensed professional was supposed to stand between the number
 * and the build) — even though one is an electrician's and one an event
 * planner's. Grouping by trade would have put them in different classes and
 * given the same danger two different answers.
 *
 * - `life-safety` — structure, electrical protection, rigging, loading, gas,
 *   chemical exposure. Third parties, bodily. No verdict, ever.
 * - `wellness` — the user's own body: body mass, training load, hydration. The
 *   MDR recital-19 carve-out, and the reason it survives is that the harm is
 *   the user's own and self-inflicted. Still no clinical classification on
 *   screen — a number, and a reference table the user reads themselves.
 * - `legal-procedure` — a right is forfeited: a term miscounted, a deadline
 *   missed. Irreversible and economic. The counting CONVENTION is the legal
 *   judgement, so it is always the user's visible choice and is restated in the
 *   result.
 * - `financial` — tax, margin, payroll, yield. Economic and mostly recoverable;
 *   verdict-style displays are fine here, because nobody dies of a margin.
 * - `food-safety` — a threshold that keeps somebody from being poisoned.
 *   Customers, bodily. Most of this class is on the refusal list; plain recipe
 *   scaling is `none`.
 * - `none` — an explicit assertion that this tool endangers nobody, NOT a
 *   default. There is no optional field here on purpose: „nobody decided" and
 *   „somebody decided it is harmless" must not look the same, which is exactly
 *   the failure mode an omitted field ships.
 *
 * There is deliberately no `medical` class. A class would imply a tool exists
 * to wear it; the honest refusal list empties that pack (see `TOOL_PACKS`), and
 * a class sitting here unused would be an invitation to fill it.
 */
export const TOOL_RISK_CLASSES = [
  "none",
  "life-safety",
  "wellness",
  "legal-procedure",
  "financial",
  "food-safety",
] as const;

export type ToolRiskClass = (typeof TOOL_RISK_CLASSES)[number];

/**
 * The classes where the surface may state a quantity and must never state a
 * verdict — no „zadovoljava", no pass/fail state, no green tick.
 *
 * **The line, once, so it is not re-argued per tool:** a tool may compute a
 * quantity; it must never render the decision. „Pad napona: 4,2 V" is a number
 * the electrician carries into their own judgement — which is their chargeable,
 * licensed and *insured* act. „Presek zadovoljava" is that judgement, made by a
 * vendor who carries no such insurance. The arithmetic is identical; the posture
 * is opposite, and „the app showed a green tick" is the sentence that turns up
 * in testimony.
 *
 * Limits are still allowed as INPUTS — a tool may take „granica: 100 A" and show
 * the computed value beside it, because choosing which limit applies was the
 * user's judgement and putting two numbers side by side is arithmetic.
 */
export function toolForbidsVerdict(riskClass: ToolRiskClass): boolean {
  return riskClass === "life-safety" || riskClass === "food-safety";
}

/**
 * The three tiers a number embedded in a tool can belong to — the policy that
 * replaced „never embed a constant", which was over-broad in both directions.
 *
 * - **`physical`** — physical constants and arithmetic identities: the density
 *   of steel, `g`, `1 in = 25.4 mm`. Embed freely; nobody revises these.
 * - **`published`** — stable, versioned engineering or scientific data: a rebar
 *   mass table, a circle-of-confusion figure, the sRGB matrix. Embeddable only
 *   with the exact source and edition named ON THE SURFACE. Precise provenance
 *   („prema SRPS EN 10080") is protective; a vague compliance claim („u skladu
 *   sa standardom") is a warranty and is banned.
 * - **`regulated`** — anything that is law, or a limit against which adequacy is
 *   judged: VAT rates, statutory terms, allowable stresses, ampacity limits.
 *   NEVER embedded and never given a default. An embedded figure here is the
 *   vendor asserting what the law currently says — and embedding the limit is
 *   also what tempts a tool into rendering the verdict.
 */
export const TOOL_CONSTANT_TIERS = ["physical", "published", "regulated"] as const;

export type ToolConstantTier = (typeof TOOL_CONSTANT_TIERS)[number];

export interface ToolRegistration {
  /** Stable tool id, unique across the UTIL registry. ASCII slug: it is a key, never a label. */
  id: string;
  /** i18n key for the tool's display name — a path into `strings`, not Serbian copy. */
  titleKey: string;
  /**
   * i18n key for the one line under the name, same rules. Optional because the
   * utilities drawer has none and needs none: „Dužina" in a list of eleven
   * converters explains itself, and a sentence under each would be noise. At
   * forty-eight tools it stops explaining itself, which is why the professional
   * drawer carries one everywhere.
   */
  blurbKey?: string;
  /** Which group of the drawer this tool belongs under. */
  category: ToolCategory;
  /**
   * Which task groups the finder files this tool under (`TOOL_TASK_GROUPS`).
   *
   * **Required, one or two, and `modules.test.ts` refuses an empty list.** A
   * tool that declared none would be reachable only by somebody who already knew
   * whose toolkit owned it — which is the question the finder exists to answer,
   * so „unassigned" is the one state this field may not have. Two is the cap
   * because a group is a way IN, not a description: a tool filed under five of
   * eight headings has told the reader nothing about where to look.
   */
  taskGroups: readonly ToolTaskGroup[];
  /**
   * The profession toolkits that list this tool — and, through
   * `toolDrawer`, which drawer it lives in at all.
   *
   * Absent means „everyday": the tool is in „Alatke" and every profile has it.
   * Present means professional, and the array is the whole answer to „who is
   * this for" — several packs where the computation is genuinely the same one
   * (a photographer and an event planner both want to know when the light
   * goes), one where it is not.
   *
   * An EMPTY array is not the same as an absent one and is rejected by
   * `modules.test.ts`: it would declare a professional tool that no profession
   * can ever see, which is a tool that ships and is unreachable.
   */
  packs?: readonly ToolPack[];
  /**
   * What could go wrong with this tool's answer (`TOOL_RISK_CLASSES`).
   *
   * **Required, with `"none"` spelled out.** An optional field would let a tool
   * ship with no notice by omission, and omission is exactly the failure this
   * exists to prevent — a notice a surface has to remember to draw is a notice
   * that will be missing on the one tool where it mattered. Written here, the
   * host draws it, so a tool cannot ship without one and cannot ship with the
   * wrong one.
   *
   * `check:risk` guards the two things TypeScript cannot see, both of which
   * fail silently: that the HOST is still drawing the notice at all — a deleted
   * `<ToolRiskNotice/>` renders nothing, which is exactly what a harmless tool
   * renders — and that no tool forbidden a verdict has grown one, in its Serbian
   * copy or as a boolean in its arithmetic. `modules.test.ts` covers the rest:
   * that every class has its four pieces of copy, and that the categories whose
   * failures land on somebody else may not call themselves harmless.
   */
  riskClass: ToolRiskClass;
  /**
   * The source and edition of every `published`-tier constant this tool embeds,
   * as an i18n key path — drawn under the result, where the professional
   * checking the number is already looking.
   *
   * Absent means the tool embeds nothing above `physical` tier, which is the
   * ordinary case. It is NOT a place for a compliance claim: it names where a
   * figure came from, never that the answer conforms to anything.
   */
  sourceKey?: string;
  /**
   * Extra words the drawer's search matches besides the name — „inč", „stopa",
   * „funta" for the length converter. Lowercase and diacritic-free, the
   * `SettingsControl.keywords` convention exactly, because a drawer of a dozen
   * tools is only searchable if „kilo" finds the mass converter — and a drawer
   * of hundreds is not usable without it.
   */
  keywords?: readonly string[];
}

/** Which drawer a registration lives in — see `TOOL_DRAWERS` for the one-sentence rule. */
export function toolDrawer(tool: Pick<ToolRegistration, "packs">): ToolDrawer {
  return tool.packs === undefined ? "utilities" : "professional";
}

/** Whether a profile with these packs may see this tool. Everyday tools are visible to everybody. */
export function toolVisibleToPacks(
  tool: Pick<ToolRegistration, "packs">,
  packs: ReadonlySet<string>,
): boolean {
  return tool.packs === undefined || tool.packs.some((pack) => packs.has(pack));
}
