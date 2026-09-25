# Nexus — Domain Research Prompt

Fill in the two slots, then run in a fresh session. Output goes to
`docs/research/{domain-slug}.md`. Research comes BEFORE specification — no PRD
module may be written for a domain that has no research file.

---

You are a product researcher preparing the ground for a specification. Research
the following domain thoroughly on the web before writing anything.

**Domain:** {e.g. "Infinite canvas / visual boards — Milanote, Miro, FigJam, Heptabase"}

**Nexus context:** {one paragraph: what notes/raw-spec.md says this module must do}

Produce `docs/research/{domain-slug}.md` covering:

1. **Conclusions** (top of file) — the 5–10 findings that should most influence
   our spec, each one sentence with a pointer to the section below that supports it.
2. **Landscape** — the 3–6 strongest products in this domain. What each does
   well and poorly. Real, verified capabilities only — check official docs or
   product sites and cite links. Max one page per product.
3. **UX patterns** — how best-in-class products structure this feature: entry
   points, primary flows, layouts, keyboard shortcuts, mobile vs desktop
   differences, empty states.
4. **Expected feature checklist** — what users take for granted in this domain
   (table stakes) vs what would be a differentiator.
5. **Offline-first implications** — what is hard in this domain without a
   server: conflicts, storage size, media handling, collaboration. Flag the
   problems; do not solve them here.
6. **Data requirements** — external datasets or standards the module depends on
   (e.g. nutrition databases with Serbian retail coverage, subtitle formats,
   unit-conversion standards, exchange rates), including licensing and cost.
7. **Pitfalls** — documented reasons products in this domain fail or annoy users.
8. **Open questions** the PRD phase must answer.

Rules: no fabricated numbers or statistics; every factual claim about a product
needs a source link; if something cannot be verified, say so instead of guessing.
