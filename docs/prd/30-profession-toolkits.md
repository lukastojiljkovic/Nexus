# PRD 30 — Profession Toolkits (PRO) — framework (C-tier)

**Status:** draft 2026-07-05; **partially SHIPPED 2026-08-13/14 in a different
shape — read the box below before this document.** Inputs: raw-spec
(specijalizovani kalkulatori, dugoročna vizija §25), `docs/notes/razrade.md`
professions catalog (~22 professions), UTIL-011 registry, business onboarding
(ONB-011).

## What actually shipped, and where it diverges from this draft (2026-08-14)

The full record is in [STATUS.md](../STATUS.md) §3, „Programerske alatke" became
„Stručne alatke" and the two sections after it. In brief:

**A pack is a FILTER over tool registrations, not a content bundle.** The
shipped `packs?: readonly ToolPack[]` field on `ToolRegistration` decides which
toolkits a tool appears under; a tool with no `packs` is an everyday tool.
**PRO-001 as drafted did not ship** — there is no manifest, no template set, no
reminder ladder and no sample content in a pack. Those remain future work and
are not contradicted by anything built; they simply are not what „pack" means
in the code today.

**A pack is a SUBJECT, not a job title.** „Gradnja i projektovanje", not
„Arhitekta". A job-title list fails closed on every trade nobody thought of; a
subject fails open. This supersedes the launch-pack framing below.

**Eighteen toolkits, 274 tools.** `softver` (the 48 developer tools that already
existed) plus 17 built for this: gradnja, računovodstvo, foto, pravo, transport,
kuhinja, muzika, zanat, agro, trening, prosveta, dizajn, nekretnine, event,
inženjering, tekst, biznis. Sharing is a longer array rather than a mechanism,
so **PRO-004's namespacing is not needed** — a tool with three packs exists
once, with one id.

**PRO-002 shipped, changed:** selection happens in the questionnaire („Šta se
sve nađe u tvojoj nedelji?"), in a dialog off the drawer's header, and in
Settings — one component in three rooms. It is **not** business-profile-only;
the personal/business distinction was the wrong axis for „what work do you do".

**PRO-003 shipped as drafted**, plus one thing this draft did not anticipate:
`riskClass` is a required field on every registration, and it draws the tool's
notice, the line appended to every copied result, the Settings long form, and
whether the surface is allowed to render a verdict at all. „medical/legal packs
carry mandatory disclaimers" (PRO-020) became a property of the contract rather
than a rule an author has to remember.

**PRO-010/011 (predmer i predračun) did NOT ship and is still open.** The
`gradnja` toolkit that exists is calculators — concrete takeoff, rebar weight,
earthwork, roof pitch, stair geometry, U-value and the rest. A positions/
recapitulation/PDV document with XLSX and PDF export is a different feature
with a different data model, and it is still the founder's chosen example. Open
question 1 below (the norms dataset) is still open and still blocks it.

**A medicine pack was catalogued and then removed**, because intended purpose is
what makes software a medical device. See STATUS.md §5.

## Purpose

The business-profile differentiator: per-profession packs of presets,
mini-tools, calculators, and templates — "alati koji štede sate nedeljno"
inside Nexus, not vertical SaaS clones. PRO is a *framework* module; each
pack is content built on it. Launch pack #1: **Arhitekta** (founder's
chosen example — predmer i predračun).

## Functional requirements

### Framework
- **PRO-001 (M)** Pack definition format: manifest (id, name sr/en,
  profession, description) + contents: module presets (flags, widgets),
  tool registrations (UTIL-011), template sets (NOTE-009, TASK-010,
  CAL-009, CANV-012), reminder ladders, sample content.
- **PRO-002 (M)** Pack lifecycle: suggest via business onboarding (ONB-011),
  browse/enable/disable in SET module gallery (business profile only);
  disable hides, never deletes user data created with pack tools.
- **PRO-003 (M)** Pack tools follow every platform rule automatically
  (design tokens, SRCH registration, offline, IMEX export of their data).
- **PRO-004 (S)** Multiple packs simultaneously; conflicts (same tool id)
  resolved by namespacing.

### Launch pack: Arhitekta (validates the framework)
- **PRO-010 (M)** Predmer i predračun tool: positions (opis, jedinica mere,
  količina, jedinična cena), sections, rekapitulacija, PDV handling,
  norms-based quantity helpers (osnovne građevinske norme v1), export
  (XLSX/PDF via converters) — reference-only disclaimer on norms.
- **PRO-011 (S)** Arhitekta extras: površine/zapremine/materijali
  calculators (UTIL registry), razmera converter, project/investor
  evidencija template set (TASK+NOTE+CAL), rokovi dozvola ladder (CAL-004
  custom types).

### Next packs (content backlog, post-v1, from razrada catalog)
- **PRO-020 (C)** Freelancer (ponude/fakture PDV/paušal, hourly-rate,
  klijenti), Programer (dev pack presets), Profesor (rasporedi, evidencija),
  Računovođa (poreski kalendar RS!), ostali iz kataloga — each its own
  mini-spec when scheduled; medical/legal packs carry mandatory
  disclaimers.

## Integrations

ONB (suggestion), SET (gallery), UTIL (tool registry), all template targets,
IMEX (pack data in exports), FDBK (pack requests channel — which professions
next = user demand signal).

## Edge cases

Pack updated with changed templates → user copies untouched (templates are
instantiated, not linked); pack disabled with its tool's documents open →
graceful close; personal-profile user wants a pack → allowed via SET
(business profile recommended, not enforced).

## Open questions

1. Norms dataset for predmer (which reference, licensing) — same diligence
   pattern as nutrition data; founder's architect contact could validate
   pack #1 (beta user!).
2. Pack distribution post-v1: bundled vs downloadable (pre-PLUG stepping
   stone).
